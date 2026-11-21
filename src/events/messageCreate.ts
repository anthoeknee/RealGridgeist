import { createEvent } from "seyfert";
import { addMessageToBuffer } from "../memory/buffer";
import { playerRepo } from "../memory/playerRepo";

export default createEvent({
  data: {
    name: "messageCreate",
  },
  run(message, client) {
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
          client.logger.error(
            `Failed to upsert player profile for user ${message.author.id}:`,
            error,
          );
        }
      });
    }
  },
});
