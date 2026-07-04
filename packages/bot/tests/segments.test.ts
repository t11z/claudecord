import { describe, expect, it } from "vitest";
import { SegmentJoiner } from "../src/claude/segments.js";

describe("SegmentJoiner", () => {
  it("does not prefix a break before the first segment", () => {
    const j = new SegmentJoiner();
    expect(j.push("Hello")).toBe("Hello");
  });

  it("does not break between consecutive deltas of the same segment", () => {
    const j = new SegmentJoiner();
    expect(j.push("Hel")).toBe("Hel");
    expect(j.push("lo")).toBe("lo");
    expect(j.push(" world")).toBe(" world");
  });

  it("inserts exactly one blank line between two segments", () => {
    const j = new SegmentJoiner();
    const a = j.push("Let me look.");
    j.boundary();
    const b = j.push("Found it.");
    expect(a + b).toBe("Let me look.\n\nFound it.");
  });

  it("does not emit a leading break when boundary precedes any text", () => {
    const j = new SegmentJoiner();
    j.boundary();
    expect(j.push("First words.")).toBe("First words.");
  });

  it("breaks once per new segment even after repeated boundaries", () => {
    const j = new SegmentJoiner();
    j.push("A");
    j.boundary();
    j.boundary();
    expect(j.push("B")).toBe("\n\nB");
    // The break was consumed; subsequent deltas in this segment don't re-break.
    expect(j.push("C")).toBe("C");
  });

  it("does not consume the pending break on whitespace-only deltas", () => {
    const j = new SegmentJoiner();
    j.push("A");
    j.boundary();
    expect(j.push(" ")).toBe(" "); // passed through, break still pending
    expect(j.push("B")).toBe("\n\nB");
  });

  it("handles a multi-segment agentic run end to end", () => {
    const j = new SegmentJoiner();
    let out = "";
    out += j.push("Ich lege los.");
    j.boundary(); // tool call
    out += j.push("Gefunden: kenny.");
    j.boundary(); // tool call
    out += j.push("Umfangreiches Projekt.");
    expect(out).toBe("Ich lege los.\n\nGefunden: kenny.\n\nUmfangreiches Projekt.");
  });
});
