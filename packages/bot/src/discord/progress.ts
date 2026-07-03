import type { Message } from "discord.js";

const CURSOR = " ▌";
const PREVIEW_LIMIT = 1900;
const MIN_INTERVAL_MS = 1500;
const BACKOFF_FACTOR = 1.6;
const MAX_INTERVAL_MS = 8000;

/**
 * Edit-based pseudo-streaming: owns one placeholder message and periodically
 * edits it with the tail of the streamed text. Widens the edit interval when
 * Discord pushes back instead of dropping edits.
 */
export class ThrottledEditor {
  private text = "";
  private activity: string | null = null;
  private dirty = false;
  private timer: NodeJS.Timeout | null = null;
  private intervalMs = MIN_INTERVAL_MS;
  private editing = false;
  private stopped = false;

  constructor(private readonly placeholder: Message) {}

  start(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => void this.tick(), this.intervalMs);
  }

  appendText(delta: string): void {
    this.text += delta;
    this.dirty = true;
  }

  setActivity(label: string | null): void {
    this.activity = label;
    this.dirty = true;
  }

  private render(): string {
    const tail =
      this.text.length > PREVIEW_LIMIT ? `…${this.text.slice(-PREVIEW_LIMIT)}` : this.text;
    const activityLine = this.activity ? `\n\n-# 🔧 ${this.activity}` : "";
    const body = tail.trimEnd();
    return body.length > 0 ? body + CURSOR + activityLine : `⏳ Thinking…${activityLine}`;
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    if (this.dirty && !this.editing) {
      this.editing = true;
      this.dirty = false;
      const started = Date.now();
      try {
        await this.placeholder.edit({ content: this.render(), allowedMentions: { parse: [] } });
        // If the edit itself was slow (rate-limit queuing), widen the interval.
        if (Date.now() - started > this.intervalMs) {
          this.intervalMs = Math.min(this.intervalMs * BACKOFF_FACTOR, MAX_INTERVAL_MS);
        }
      } catch {
        this.intervalMs = Math.min(this.intervalMs * BACKOFF_FACTOR, MAX_INTERVAL_MS);
        this.dirty = true;
      } finally {
        this.editing = false;
      }
    }
    if (!this.stopped) {
      this.timer = setTimeout(() => void this.tick(), this.intervalMs);
    }
  }

  /** Stops the edit loop. The caller finalizes the placeholder itself. */
  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
