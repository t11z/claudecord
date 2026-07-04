/**
 * In agentic runs Claude narrates between tool calls: each narration arrives as
 * a separate assistant text block, separated from the next by a `tool_use`.
 * Streamed as raw deltas they concatenate into one wall of text. This tiny state
 * machine tracks those segment boundaries and prefixes the first delta of each
 * new segment with a blank line so the live preview reads as paragraphs.
 *
 * Pure and dependency-free (no SDK import) so it can be unit-tested in isolation,
 * in the spirit of `discord/splitter.ts`.
 */
export class SegmentJoiner {
  private hasText = false;
  private breakPending = false;

  /** A `tool_use` (or other non-text block) ended the current text segment. */
  boundary(): void {
    if (this.hasText) this.breakPending = true;
  }

  /** The delta to append, prefixed with "\n\n" when it starts a new segment. */
  push(delta: string): string {
    // Whitespace-only deltas carry no segment content: pass them through without
    // consuming the pending break, so the break still lands on the real text.
    if (delta.trim().length === 0) return delta;
    if (this.breakPending) {
      this.breakPending = false;
      this.hasText = true;
      return `\n\n${delta}`;
    }
    this.hasText = true;
    return delta;
  }
}
