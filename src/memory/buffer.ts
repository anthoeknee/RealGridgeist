import type {
  BufferedMessage,
  AddBufferedMessageInput,
  FormatBufferOptions,
  ConversationHistoryOptions,
  ChannelBufferOptions,
} from "./types";

export const DEFAULT_MAX_MESSAGES_PER_CHANNEL = 20;
export const DEFAULT_BUFFER_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours in ms
export const DEFAULT_CLEANUP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes in ms

/**
 * Manages short-term rolling message buffers per Discord channel/thread.
 * Keeps up to 20 messages per channel and automatically expires inactive channels older than 2 hours.
 */
export class ChannelMessageBuffer {
  public readonly buffers: Map<string, BufferedMessage[]>;
  private readonly lastActiveMap: Map<string, number>;
  public readonly maxMessages: number;
  public readonly ttlMs: number;
  public readonly cleanupIntervalMs: number;
  private cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(options: ChannelBufferOptions = {}) {
    this.buffers = new Map<string, BufferedMessage[]>();
    this.lastActiveMap = new Map<string, number>();
    this.maxMessages = options.maxMessages ?? DEFAULT_MAX_MESSAGES_PER_CHANNEL;
    this.ttlMs = options.ttlMs ?? DEFAULT_BUFFER_TTL_MS;
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS;

    if (options.autoStartCleanup !== false) {
      this.startCleanupTimer();
    }
  }

  /**
   * Starts the background timer to periodically purge expired channel buffers.
   */
  public startCleanupTimer(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      this.pruneExpired();
    }, this.cleanupIntervalMs);

    if (typeof this.cleanupTimer?.unref === "function") {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Stops the background cleanup timer (useful for clean teardown or tests).
   */
  public stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  /**
   * Checks if a channel buffer has been inactive for longer than the TTL.
   */
  public isChannelExpired(channelId: string, now: number = Date.now()): boolean {
    const messages = this.buffers.get(channelId);
    if (!messages) {
      return false;
    }

    const lastActive =
      this.lastActiveMap.get(channelId) ??
      messages[messages.length - 1]?.timestamp ??
      0;

    return now - lastActive >= this.ttlMs;
  }

  /**
   * Removes all inactive channel buffers older than the configured TTL (default 2 hours).
   * Returns the number of expired channels pruned.
   */
  public pruneExpired(now: number = Date.now()): number {
    let prunedCount = 0;
    for (const channelId of Array.from(this.buffers.keys())) {
      if (this.isChannelExpired(channelId, now)) {
        this.buffers.delete(channelId);
        this.lastActiveMap.delete(channelId);
        prunedCount++;
      }
    }

    // Clean up any lingering lastActive keys for channels no longer present
    for (const channelId of Array.from(this.lastActiveMap.keys())) {
      if (!this.buffers.has(channelId)) {
        this.lastActiveMap.delete(channelId);
      }
    }

    return prunedCount;
  }

  /**
   * Adds a message to the channel's working memory buffer.
   * Maintains chronological order and caps buffer to the last 20 messages.
   * If the channel had expired, old messages are purged before inserting the new one.
   */
  public addMessage(
    channelId: string,
    input: AddBufferedMessageInput,
    now: number = Date.now(),
  ): BufferedMessage[] {
    // If the channel was inactive and expired, purge old messages first
    if (this.isChannelExpired(channelId, now)) {
      this.buffers.delete(channelId);
      this.lastActiveMap.delete(channelId);
    }

    const ts =
      typeof input.timestamp === "number"
        ? input.timestamp
        : input.timestamp instanceof Date
          ? input.timestamp.getTime()
          : now;

    const message: BufferedMessage = {
      authorId: input.authorId,
      authorName: input.authorName,
      isBot: Boolean(input.isBot),
      content: input.content,
      timestamp: ts,
      replyToAuthorName: input.replyToAuthorName ?? null,
    };

    let messages = this.buffers.get(channelId);
    if (!messages) {
      messages = [];
      this.buffers.set(channelId, messages);
    }

    messages.push(message);

    // Keep up to maxMessages (most recent 20)
    if (messages.length > this.maxMessages) {
      messages.splice(0, messages.length - this.maxMessages);
    }

    const currentLastActive = this.lastActiveMap.get(channelId) ?? 0;
    this.lastActiveMap.set(channelId, Math.max(currentLastActive, now, ts));

    return [...messages];
  }

  /**
   * Retrieves messages for a channel. If expired, automatically purges the buffer and returns an empty array.
   */
  public getMessages(channelId: string, now: number = Date.now()): BufferedMessage[] {
    if (this.isChannelExpired(channelId, now)) {
      this.buffers.delete(channelId);
      this.lastActiveMap.delete(channelId);
      return [];
    }

    const messages = this.buffers.get(channelId);
    return messages ? [...messages] : [];
  }

  /**
   * Retrieves structured conversation history turns suitable for LLM multi-turn APIs (Gemini/Groq).
   * Maps messages into roles ("user" | "model") with author attribution on group messages,
   * with options to limit the count and exclude the trailing prompt message to avoid duplicate context.
   */
  public getConversationHistory(
    channelId: string,
    options?: ConversationHistoryOptions,
    now: number = Date.now(),
  ): Array<{ role: "user" | "model"; content: string; authorName?: string; isBot?: boolean }> {
    const rawMessages = this.getMessages(channelId, now);
    if (rawMessages.length === 0) {
      return [];
    }

    const messages = options?.excludeLast ? rawMessages.slice(0, -1) : rawMessages;
    const targetMessages =
      options?.limit && options.limit > 0
        ? messages.slice(-options.limit)
        : messages;

    return targetMessages.map((msg) => {
      if (msg.isBot) {
        return {
          role: "model" as const,
          content: msg.content.trim(),
          authorName: msg.authorName,
          isBot: true,
        };
      }

      // Format speaker attribution so the LLM knows who said what in multi-user channels
      const speaker = msg.authorName.trim() || msg.authorId;
      const replyContext = msg.replyToAuthorName ? ` (replying to ${msg.replyToAuthorName})` : "";
      const content = `[${speaker}${replyContext}]: ${msg.content.trim()}`;

      return {
        role: "user" as const,
        content,
        authorName: msg.authorName,
        isBot: false,
      };
    });
  }

  /**
   * Formats the recent chat history of a channel into a clean dialogue script
   * showing who said what, clearly distinguishing multiple human speakers, bot responses,
   * and message replies.
   */
  public formatBufferForPrompt(
    channelId: string,
    options?: FormatBufferOptions,
    now: number = Date.now(),
  ): string {
    const messages = this.getMessages(channelId, now);
    if (messages.length === 0) {
      return "";
    }

    const targetMessages =
      options?.limit && options.limit > 0
        ? messages.slice(-options.limit)
        : messages;

    return targetMessages
      .map((msg) => this.formatMessageLine(msg, options))
      .filter((line) => line.length > 0)
      .join("\n");
  }

  /**
   * Formats a single buffered message into a script line.
   */
  private formatMessageLine(
    msg: BufferedMessage,
    options?: FormatBufferOptions,
  ): string {
    const rawName = msg.authorName.trim() || msg.authorId;
    let speaker = rawName;

    if (options?.includeBotTag !== false && msg.isBot) {
      if (!speaker.includes("[BOT]")) {
        speaker += " [BOT]";
      }
    }

    if (
      options?.includeReplies !== false &&
      msg.replyToAuthorName &&
      msg.replyToAuthorName.trim().length > 0
    ) {
      speaker += ` (replying to ${msg.replyToAuthorName.trim()})`;
    }

    const content = msg.content.trim() || "[empty message]";
    return `${speaker}: ${content}`;
  }

  /**
   * Clears the buffer for a specific channel.
   */
  public clearChannel(channelId: string): boolean {
    const hadChannel = this.buffers.has(channelId);
    this.buffers.delete(channelId);
    this.lastActiveMap.delete(channelId);
    return hadChannel;
  }

  /**
   * Clears all channel buffers.
   */
  public clearAll(): void {
    this.buffers.clear();
    this.lastActiveMap.clear();
  }

  /**
   * Returns total active channel buffers count.
   */
  public getChannelCount(): number {
    return this.buffers.size;
  }

  /**
   * Returns the recorded last active timestamp for a channel, if any.
   */
  public getLastActive(channelId: string): number | undefined {
    return this.lastActiveMap.get(channelId);
  }
}

// Global default singleton instance
export const defaultMessageBuffer = new ChannelMessageBuffer();

// Direct Map reference matching Requirement 1: Map<string, BufferedMessage[]>
export const channelBuffers: Map<string, BufferedMessage[]> =
  defaultMessageBuffer.buffers;

/**
 * Convenience wrapper: adds a message to the global channel buffer.
 */
export function addMessageToBuffer(
  channelId: string,
  message: AddBufferedMessageInput,
  now?: number,
): BufferedMessage[] {
  return defaultMessageBuffer.addMessage(channelId, message, now);
}

/**
 * Convenience wrapper: retrieves messages from the global channel buffer.
 */
export function getBuffer(channelId: string, now?: number): BufferedMessage[] {
  return defaultMessageBuffer.getMessages(channelId, now);
}

/**
 * Convenience wrapper: retrieves structured conversation history turns for LLMs.
 */
export function getConversationHistory(
  channelId: string,
  options?: ConversationHistoryOptions,
  now?: number,
): Array<{ role: "user" | "model"; content: string; authorName?: string; isBot?: boolean }> {
  return defaultMessageBuffer.getConversationHistory(channelId, options, now);
}

/**
 * Convenience wrapper: formats channel history into a clean prompt script.
 */
export function formatBufferForPrompt(
  channelId: string,
  options?: FormatBufferOptions,
  now?: number,
): string {
  return defaultMessageBuffer.formatBufferForPrompt(channelId, options, now);
}

/**
 * Convenience wrapper: clears a channel's buffer.
 */
export function clearBuffer(channelId: string): boolean {
  return defaultMessageBuffer.clearChannel(channelId);
}

/**
 * Convenience wrapper: clears all channel buffers.
 */
export function clearAllBuffers(): void {
  defaultMessageBuffer.clearAll();
}

/**
 * Convenience wrapper: manually runs expired channel cleanup.
 */
export function pruneExpiredBuffers(now?: number): number {
  return defaultMessageBuffer.pruneExpired(now);
}

/**
 * Convenience wrapper: checks if a channel buffer has expired.
 */
export function isChannelExpired(channelId: string, now?: number): boolean {
  return defaultMessageBuffer.isChannelExpired(channelId, now);
}
