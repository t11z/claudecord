import { AttachmentBuilder, type Message, type SendableChannels } from "discord.js";
import { classifyFailure } from "../claude/errors.js";
import type { AppContext } from "../context.js";
import type { ThreadSession } from "../db/repos/sessions.js";
import { buildPrompt } from "./attachments.js";
import { ThrottledEditor } from "./progress.js";
import { DISCORD_MESSAGE_LIMIT, splitMessage } from "./splitter.js";

const RATE_LIMIT_PAUSE_MS = 60_000;

async function react(message: Message, emoji: string): Promise<void> {
  try {
    await message.react(emoji);
  } catch {
    // Missing permission or deleted message — never fatal.
  }
}

function stripBotMention(content: string, botId: string): string {
  return content.replaceAll(new RegExp(`<@!?${botId}>`, "g"), "").trim();
}

/**
 * Runs one conversation turn: reactions, placeholder streaming, the queued
 * Claude query, splitting/attachment of the final answer and usage logging.
 */
export async function runConversationTurn(
  ctx: AppContext,
  userMessage: Message,
  targetChannel: SendableChannels,
  session: ThreadSession,
): Promise<void> {
  const botId = ctx.discord?.user?.id;
  if (!botId) return;

  await react(userMessage, "👀");

  const position = ctx.queue.keyDepth(session.guildId);
  const placeholderText = position > 0 ? `⏳ Queued (position ${position})…` : "⏳ Thinking…";

  let placeholder: Message;
  try {
    placeholder = await targetChannel.send({
      content: placeholderText,
      allowedMentions: { parse: [] },
    });
  } catch (err) {
    ctx.logger.warn({ err }, "could not send placeholder message");
    return;
  }

  const rawText = stripBotMention(userMessage.content, botId);
  const author = userMessage.member?.displayName ?? userMessage.author.username;
  const { prompt, skipped } = await buildPrompt(
    `${author}: ${rawText.length > 0 ? rawText : "(no text)"}`,
    userMessage.attachments,
  );

  const editor = new ThrottledEditor(placeholder);
  editor.start();

  const abort = new AbortController();
  ctx.activeRuns.set(session.threadId, abort);
  const startedAt = new Date().toISOString();

  const guildConfig = ctx.repos.guildConfig.get(session.guildId);

  const { promise } = ctx.queue.enqueue(session.guildId, () =>
    ctx.engine(
      {
        prompt,
        claudeSessionId: session.claudeSessionId ?? undefined,
        cwd: session.cwd,
        model: session.model,
        mode: session.mode,
        systemPromptExtra: guildConfig.systemPromptExtra,
        abortController: abort,
      },
      {
        onSessionId: (id) => ctx.repos.sessions.setClaudeSessionId(session.threadId, id),
        onTextDelta: (delta) => editor.appendText(delta),
        onToolUse: (tool) => editor.setActivity(`${tool}…`),
      },
    ),
  );

  const result = await promise.catch((err: unknown) => ({
    ok: false as const,
    text: "",
    sessionId: null,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
    errorText: err instanceof Error ? err.message : String(err),
  }));

  ctx.activeRuns.delete(session.threadId);
  editor.stop();

  ctx.repos.usage.record({
    guildId: session.guildId,
    userId: userMessage.author.id,
    threadId: session.threadId,
    startedAt,
    durationMs: result.durationMs,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costUsd: result.costUsd,
    model: session.model,
    ok: result.ok,
    errorKind: result.ok ? null : classifyFailure(result.errorText ?? "").kind,
  });

  if (!result.ok) {
    const classified = classifyFailure(result.errorText ?? "");
    if (classified.kind === "rate_limit") {
      ctx.queue.pauseFor(RATE_LIMIT_PAUSE_MS);
    }
    ctx.logger.warn(
      { threadId: session.threadId, kind: classified.kind, error: result.errorText },
      "claude run failed",
    );
    await placeholder
      .edit({ content: `❌ ${classified.message}`, allowedMentions: { parse: [] } })
      .catch(() => {});
    await react(userMessage, "❌");
    return;
  }

  ctx.repos.sessions.touch(session.threadId);

  const notes = skipped.length > 0 ? `\n\n-# ⚠️ Skipped attachments: ${skipped.join(", ")}` : "";
  const { chunks, asAttachment } = splitMessage(result.text + notes);

  try {
    if (asAttachment) {
      const file = new AttachmentBuilder(Buffer.from(result.text + notes, "utf8"), {
        name: "response.md",
      });
      const previewLimit = Math.max(0, DISCORD_MESSAGE_LIMIT - 120 - notes.length);
      const summary = `${result.text.slice(0, previewLimit).trimEnd()}…${notes}`;
      await placeholder.edit({
        content: `The full answer is attached.\n\n${summary}`.slice(0, DISCORD_MESSAGE_LIMIT),
        files: [file],
        allowedMentions: { parse: [] },
      });
    } else if (chunks.length === 0) {
      await placeholder.edit({ content: "*(empty response)*", allowedMentions: { parse: [] } });
    } else {
      await placeholder.edit({ content: chunks[0]!, allowedMentions: { parse: [] } });
      for (const chunk of chunks.slice(1)) {
        await targetChannel.send({ content: chunk, allowedMentions: { parse: [] } });
      }
    }
    await react(userMessage, "✅");
  } catch (err) {
    ctx.logger.warn({ err }, "failed to deliver response");
    await react(userMessage, "❌");
  }
}
