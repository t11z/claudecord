import type { Message, SendableChannels } from "discord.js";
import { closeOpenFences } from "./splitter.js";

const PREVIEW_LIMIT = 1900;
const MIN_INTERVAL_MS = 1500;
const BACKOFF_FACTOR = 1.6;
const MAX_INTERVAL_MS = 8000;
// Discord's typing indicator expires after ~10s, so re-pulse comfortably inside that.
const TYPING_INTERVAL_MS = 7000;

/** Minimal structural view of a channel that can show the native typing state. */
export interface TypingChannel {
  sendTyping(): Promise<void>;
}

/**
 * Drives Discord's native "Bot is typing…" indicator for the lifetime of a turn.
 * This is the canonical Discord "working on it" signal — it replaces the old
 * mutating `⏳ Thinking…` placeholder for the pre-answer (thinking/tool) phase.
 */
export class TypingIndicator {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly channel: TypingChannel) {}

  start(): void {
    if (this.timer) return;
    void this.pulse();
    this.timer = setInterval(() => void this.pulse(), TYPING_INTERVAL_MS);
  }

  private async pulse(): Promise<void> {
    try {
      await this.channel.sendTyping();
    } catch {
      // Missing permission or a transient error — the indicator is best-effort.
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

/**
 * Edit-based streaming of the *answer text* only. The message is created lazily
 * on the first text delta — before that, the typing indicator carries the wait,
 * so no placeholder is ever posted. Widens the edit interval on Discord
 * backpressure instead of dropping edits, and keeps the live preview fence-safe.
 */
export class StreamingReply {
  private text = "";
  private activity: string | null = null;
  private dirty = false;
  private timer: NodeJS.Timeout | null = null;
  private intervalMs = MIN_INTERVAL_MS;
  private editing = false;
  private stopped = false;
  private message: Message | null = null;

  constructor(private readonly channel: SendableChannels) {}

  /** The streamed message, or null if no answer text ever arrived. */
  get sent(): Message | null {
    return this.message;
  }

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
    // Activity is a subtext line on the streamed message; only worth a render
    // once that message exists (otherwise the typing indicator covers the wait).
    if (this.message) this.dirty = true;
  }

  private render(): string {
    const tail =
      this.text.length > PREVIEW_LIMIT ? `…${this.text.slice(-PREVIEW_LIMIT)}` : this.text;
    const body = closeOpenFences(tail.trimEnd());
    const activityLine = this.activity ? `\n\n-# 🔧 ${this.activity}` : "";
    return body + activityLine;
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    // Stay silent until real answer text has arrived; the typing indicator is
    // the signal during the thinking/tool phase.
    if (this.dirty && !this.editing && this.text.trimEnd().length > 0) {
      this.editing = true;
      this.dirty = false;
      const started = Date.now();
      try {
        const content = this.render();
        if (this.message) {
          await this.message.edit({ content, allowedMentions: { parse: [] } });
        } else {
          this.message = await this.channel.send({ content, allowedMentions: { parse: [] } });
        }
        // If the edit/send itself was slow (rate-limit queuing), widen the interval.
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

  /** Stops the edit loop. The caller finalizes the streamed message itself. */
  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
