import type { Message, SendableChannels } from "discord.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StreamingReply, type TypingChannel, TypingIndicator } from "../src/discord/progress.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TypingIndicator", () => {
  it("pulses immediately and then on the interval, and stops", async () => {
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const channel = { sendTyping } as TypingChannel;
    const indicator = new TypingIndicator(channel);

    indicator.start();
    expect(sendTyping).toHaveBeenCalledTimes(1); // immediate pulse

    await vi.advanceTimersByTimeAsync(7000);
    expect(sendTyping).toHaveBeenCalledTimes(2);

    indicator.stop();
    await vi.advanceTimersByTimeAsync(21000);
    expect(sendTyping).toHaveBeenCalledTimes(2); // no more pulses after stop
  });

  it("swallows sendTyping errors", async () => {
    const sendTyping = vi.fn().mockRejectedValue(new Error("no permission"));
    const indicator = new TypingIndicator({ sendTyping } as TypingChannel);
    expect(() => indicator.start()).not.toThrow();
    await vi.advanceTimersByTimeAsync(7000);
    indicator.stop();
  });
});

describe("StreamingReply", () => {
  function mockChannel() {
    const edit = vi.fn().mockResolvedValue(undefined);
    const message = { edit } as unknown as Message;
    const send = vi.fn().mockResolvedValue(message);
    const channel = { send } as unknown as SendableChannels;
    return { channel, send, message, edit };
  }

  it("stays silent until answer text arrives", async () => {
    const { channel, send } = mockChannel();
    const reply = new StreamingReply(channel);
    reply.start();

    await vi.advanceTimersByTimeAsync(5000);
    expect(send).not.toHaveBeenCalled();
    expect(reply.sent).toBeNull();

    reply.stop();
  });

  it("creates the message lazily on first text, then edits it", async () => {
    const { channel, send, message, edit } = mockChannel();
    const reply = new StreamingReply(channel);
    reply.start();

    reply.appendText("hello");
    await vi.advanceTimersByTimeAsync(1500);
    expect(send).toHaveBeenCalledTimes(1);
    expect(reply.sent).toBe(message);
    expect((send.mock.calls[0]![0] as { content: string }).content).toBe("hello");

    reply.appendText(" world");
    await vi.advanceTimersByTimeAsync(1500);
    expect(edit).toHaveBeenCalledTimes(1);
    expect((edit.mock.calls[0]![0] as { content: string }).content).toBe("hello world");

    reply.stop();
  });

  it("renders no blinking cursor", async () => {
    const { channel, send } = mockChannel();
    const reply = new StreamingReply(channel);
    reply.start();
    reply.appendText("some answer");
    await vi.advanceTimersByTimeAsync(1500);
    const content = (send.mock.calls[0]![0] as { content: string }).content;
    expect(content).not.toContain("▌");
    reply.stop();
  });

  it("keeps the live preview fence-safe (closes an open code fence)", async () => {
    const { channel, send } = mockChannel();
    const reply = new StreamingReply(channel);
    reply.start();
    reply.appendText("```js\nconst a = 1;");
    await vi.advanceTimersByTimeAsync(1500);
    const content = (send.mock.calls[0]![0] as { content: string }).content;
    const fences = content.split("\n").filter((l) => /^\s{0,3}```/.test(l));
    expect(fences.length % 2).toBe(0);
    expect(content.endsWith("```")).toBe(true);
    reply.stop();
  });
});
