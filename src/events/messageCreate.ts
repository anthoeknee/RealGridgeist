import { createEvent } from "seyfert";
import { addMessageToBuffer } from "../memory/buffer";
import { playerRepo } from "../memory/playerRepo";
import { shouldRespondToMessage, handleChatMessage } from "../chat";

export default createEvent({
  data: {
    name: "messageCreate",
  },
  async run(message, client) {
    // Ignore messages with no author (e.g. system dispatch anomalies)
    if (!message.author) return;

    const authorName =
      message.member?.nick ||
      message.author.globalName ||
      message.author.username;

    // Resolve reply author name if the message is replying to another message
    const replyToAuthorName =
      message.referencedMessage?.author?.username ??
      message.referencedMessage?.author?.globalName ??
      null;

    // 1. Buffer the message into short-term channel memory
    addMessageToBuffer(message.channelId, {
      authorId: message.author.id,
      authorName,
      isBot: Boolean(message.author.bot),
      content: message.content ?? "",
      timestamp: message.timestamp ? new Date(message.timestamp).getTime() : Date.now(),
      replyToAuthorName,
    });

    // 2. Asynchronously update player profile for human users (non-blocking)
    if (!message.author.bot) {
      queueMicrotask(() => {
        try {
          playerRepo.upsertPlayer({
            user_id: message.author.id,
            username: message.author.username,
            preferred_name: authorName !== message.author.username ? authorName : null,
            last_seen_at: new Date().toISOString(),
          });
        } catch (error) {
          client.logger?.error?.(
            `Failed to upsert player profile for user ${message.author.id}:`,
            error,
          );
        }
      });
    }

    // 3. Dispatch to AI chat pipeline if message triggers bot response
    try {
      if (shouldRespondToMessage(message, client)) {
        await handleChatMessage(message, client);
      }
    } catch (error) {
      client.logger?.error?.(
        `Failed to dispatch chat message ${message.id}:`,
        error,
      );
    }
  },
});
