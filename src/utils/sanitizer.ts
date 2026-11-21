/**
 * Sanitizes Discord user and role mentions to prevent accidental @everyone,
 * @here, or rogue ping exploits. Inserts a zero-width space after the '@' character.
 */
export function sanitizeMentions(content: string): string {
  if (!content) return "";

  return content
    .replace(/@(everyone|here)/gi, "@\u200B$1")
    .replace(/<@&(\d+)>/g, "<@&\u200B$1>")
    .replace(/<@!?(\d+)>/g, (match, id) => `<@\u200B${id}>`);
}
