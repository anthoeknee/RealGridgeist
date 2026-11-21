export interface SplitOptions {
  maxLength?: number;
  appendContinuation?: boolean;
}

/**
 * Splits a text into chunks that do not exceed the Discord message character limit (default 2,000).
 * Prioritizes splitting along paragraph breaks, line breaks, and whitespace boundaries.
 * Preserves code fences across chunks by closing and reopening unclosed code blocks.
 */
export function splitMessage(text: string, options: SplitOptions = {}): string[] {
  const maxLength = options.maxLength ?? 2000;

  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;
  let inCodeBlock = false;
  let codeBlockLanguage = "";

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Determine target split point within maxLength
    let splitIndex = -1;

    // Search for double newline (paragraph break)
    const paragraphBreak = remaining.lastIndexOf("\n\n", maxLength);
    if (paragraphBreak > 0) {
      splitIndex = paragraphBreak;
    } else {
      // Search for single newline
      const lineBreak = remaining.lastIndexOf("\n", maxLength);
      if (lineBreak > 0) {
        splitIndex = lineBreak;
      } else {
        // Search for whitespace
        const spaceBreak = remaining.lastIndexOf(" ", maxLength);
        if (spaceBreak > 0) {
          splitIndex = spaceBreak;
        } else {
          // Hard cut if no natural whitespace break exists
          splitIndex = maxLength;
        }
      }
    }

    let chunk = remaining.slice(0, splitIndex).trimEnd();
    remaining = remaining.slice(splitIndex).trimStart();

    // Check code fence parity in current chunk
    const codeFenceMatches = chunk.match(/```([a-zA-Z0-9_-]*)/g);
    const codeFenceCount = codeFenceMatches ? codeFenceMatches.length : 0;

    // Toggle inCodeBlock state
    if (codeFenceCount % 2 !== 0) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        // Capture the language tag from the last opening fence
        const lastFence = codeFenceMatches ? codeFenceMatches[codeFenceMatches.length - 1] : "```";
        codeBlockLanguage = lastFence ? lastFence.replace("```", "").trim() : "";
        // Close code fence at the end of the current chunk
        chunk += "\n```";
      } else {
        inCodeBlock = false;
        codeBlockLanguage = "";
      }
    } else if (inCodeBlock) {
      // Still inside an active code block from a previous chunk
      chunk = `\`\`\`${codeBlockLanguage}\n` + chunk + "\n```";
    }

    if (inCodeBlock && remaining.length > 0) {
      // Prepend reopening fence to remaining text
      remaining = `\`\`\`${codeBlockLanguage}\n` + remaining;
    }

    chunks.push(chunk);
  }

  return chunks;
}
