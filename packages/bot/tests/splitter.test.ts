import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_THRESHOLD,
  closeOpenFences,
  DISCORD_MESSAGE_LIMIT,
  splitMessage,
} from "../src/discord/splitter.js";

describe("splitMessage", () => {
  it("returns a single chunk for short text", () => {
    const result = splitMessage("hello world");
    expect(result.chunks).toEqual(["hello world"]);
    expect(result.asAttachment).toBe(false);
  });

  it("returns no chunks for empty text", () => {
    expect(splitMessage("").chunks).toEqual([]);
    expect(splitMessage("   \n  ").chunks).toEqual([]);
  });

  it("keeps every chunk within the limit", () => {
    const text = Array.from({ length: 100 }, (_, i) => `line ${i} ${"x".repeat(50)}`).join("\n");
    const { chunks } = splitMessage(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(DISCORD_MESSAGE_LIMIT);
    }
    // No content lost (modulo the added fence markers, none here).
    expect(chunks.join("\n")).toBe(text);
  });

  it("never breaks a code fence: closes and reopens with the language tag", () => {
    const code = Array.from(
      { length: 80 },
      (_, i) => `const value${i} = computeSomethingReasonablyLong(${i}, "padding-${i}");`,
    ).join("\n");
    const text = `Intro paragraph.\n\`\`\`typescript\n${code}\n\`\`\`\nOutro.`;
    const { chunks } = splitMessage(text);
    expect(chunks.length).toBeGreaterThan(1);

    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(DISCORD_MESSAGE_LIMIT);
      // Balanced fences in every chunk: an even number of fence lines.
      const fenceLines = chunk.split("\n").filter((l) => /^\s{0,3}```/.test(l));
      expect(fenceLines.length % 2).toBe(0);
    }
    // Continuation chunks reopen with the original language tag.
    expect(chunks[1]!.startsWith("```typescript")).toBe(true);
  });

  it("hard-splits a single line longer than the limit", () => {
    const long = "a".repeat(5000);
    const { chunks } = splitMessage(long);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(DISCORD_MESSAGE_LIMIT);
    }
    expect(chunks.join("")).toBe(long);
  });

  it("hard-splits an overlong line inside a fence without losing the fence", () => {
    const text = `\`\`\`\n${"b".repeat(4500)}\n\`\`\``;
    const { chunks } = splitMessage(text);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(DISCORD_MESSAGE_LIMIT);
      const fenceLines = chunk.split("\n").filter((l) => /^\s{0,3}```/.test(l));
      expect(fenceLines.length % 2).toBe(0);
    }
  });

  it("flags long output as attachment", () => {
    const text = "word ".repeat(ATTACHMENT_THRESHOLD / 4);
    expect(splitMessage(text).asAttachment).toBe(true);
  });

  it("does not treat ~~~ as closing a ``` fence", () => {
    const text = ["```js", "~~~", "x".repeat(2100), "```"].join("\n");
    const { chunks } = splitMessage(text);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(DISCORD_MESSAGE_LIMIT);
    }
    expect(chunks[1]!.startsWith("```js")).toBe(true);
  });
});

describe("closeOpenFences", () => {
  it("leaves balanced text unchanged", () => {
    expect(closeOpenFences("plain text")).toBe("plain text");
    expect(closeOpenFences("```js\nconst a = 1;\n```")).toBe("```js\nconst a = 1;\n```");
    expect(closeOpenFences("")).toBe("");
  });

  it("closes an open ``` fence", () => {
    expect(closeOpenFences("```js\nconst a = 1;")).toBe("```js\nconst a = 1;\n```");
  });

  it("closes an open ~~~ fence with its own marker", () => {
    expect(closeOpenFences("~~~\nsome code")).toBe("~~~\nsome code\n~~~");
  });

  it("closes a fence opened on the last line", () => {
    expect(closeOpenFences("intro\n```typescript")).toBe("intro\n```typescript\n```");
  });

  it("does not treat ~~~ as closing a ``` fence", () => {
    expect(closeOpenFences("```\n~~~\nstill open")).toBe("```\n~~~\nstill open\n```");
  });

  it("matches the closing marker length rule (longer close, shorter open stays closed)", () => {
    // ```` opened then ``` cannot close it (shorter), so still open.
    expect(closeOpenFences("````\ncode\n```")).toBe("````\ncode\n```\n````");
  });
});
