import { describe, expect, it } from "bun:test";
import { splitMessage } from "../src/utils/splitter";
import { sanitizeMentions } from "../src/utils/sanitizer";

describe("Utility Modules", () => {
  describe("Message Splitter (splitMessage)", () => {
    it("returns short messages as a single chunk", () => {
      const text = "Hello, world!";
      expect(splitMessage(text)).toEqual(["Hello, world!"]);
    });

    it("splits long messages along paragraph breaks", () => {
      const para1 = "A".repeat(1200);
      const para2 = "B".repeat(1200);
      const fullText = `${para1}\n\n${para2}`;

      const chunks = splitMessage(fullText, { maxLength: 2000 });
      expect(chunks.length).toBe(2);
      expect(chunks[0]).toBe(para1);
      expect(chunks[1]).toBe(para2);
    });

    it("splits along single line breaks when no paragraph break exists", () => {
      const line1 = "X".repeat(1200);
      const line2 = "Y".repeat(1200);
      const fullText = `${line1}\n${line2}`;

      const chunks = splitMessage(fullText, { maxLength: 2000 });
      expect(chunks.length).toBe(2);
      expect(chunks[0]).toBe(line1);
      expect(chunks[1]).toBe(line2);
    });

    it("splits along space boundaries when no line breaks exist", () => {
      const word1 = "W".repeat(1500);
      const word2 = "Z".repeat(1000);
      const fullText = `${word1} ${word2}`;

      const chunks = splitMessage(fullText, { maxLength: 2000 });
      expect(chunks.length).toBe(2);
      expect(chunks[0]).toBe(word1);
      expect(chunks[1]).toBe(word2);
    });

    it("hard splits when no spaces exist in a continuous string", () => {
      const longContinuous = "C".repeat(3500);
      const chunks = splitMessage(longContinuous, { maxLength: 2000 });

      expect(chunks.length).toBe(2);
      expect(chunks[0].length).toBe(2000);
      expect(chunks[1].length).toBe(1500);
    });

    it("preserves and closes code fences across chunk boundaries", () => {
      const codeStart = "```typescript\nconst a = 1;\n";
      const codeMiddle = "const b = 2;\n".repeat(200); // ~2600 chars
      const codeEnd = "console.log(a, b);\n```";
      const fullCode = codeStart + codeMiddle + codeEnd;

      const chunks = splitMessage(fullCode, { maxLength: 2000 });
      expect(chunks.length).toBeGreaterThan(1);

      // The first chunk must be terminated with closing fence
      expect(chunks[0].endsWith("```")).toBe(true);
      // The second chunk must reopen the fence
      expect(chunks[1].startsWith("```typescript")).toBe(true);
    });
  });

  describe("Mention Sanitizer (sanitizeMentions)", () => {
    it("handles empty or falsy strings", () => {
      expect(sanitizeMentions("")).toBe("");
    });

    it("sanitizes @everyone and @here with zero-width spaces", () => {
      expect(sanitizeMentions("Hey @everyone check this out")).toBe("Hey @\u200Beveryone check this out");
      expect(sanitizeMentions("Alert @here!")).toBe("Alert @\u200Bhere!");
    });

    it("sanitizes case-insensitive variants of @EVERYONE", () => {
      expect(sanitizeMentions("Attention @EVERYONE")).toBe("Attention @\u200BEVERYONE");
    });

    it("sanitizes role and user mention tokens", () => {
      expect(sanitizeMentions("Ping <@&123456789>")).toBe("Ping <@&\u200B123456789>");
      expect(sanitizeMentions("User <@987654321>")).toBe("User <@\u200B987654321>");
    });
  });
});
