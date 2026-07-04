import { randomUUID } from "node:crypto";
import {
  AttachmentBuilder,
  type Message,
  type MessageReaction,
  type SendableChannels,
} from "discord.js";
import { classifyFailure } from "../claude/errors.js";
import type { AppContext } from "../context.js";
import type { GuildConfig } from "../db/repos/guild-config.js";
import type { ThreadSession } from "../db/repos/sessions.js";
import { canUseGithub, chooseGithubToken, isGithubGateActive } from "./access-control.js";
import { buildPrompt } from "./attachments.js";
import { StreamingReply, TypingIndicator } from "./progress.js";
import { DISCORD_MESSAGE_LIMIT, splitMessage } from "./splitter.js";

const RATE_LIMIT_PAUSE_MS = 60_000;

/**
 * Decides which GitHub token (if any) an agentic turn runs with. The acting
 * user is the message author, so runs happen in *their* GitHub namespace.
 *
 * - When a guild has a per-user GitHub role gate: only gated-in members get a
 *   token, and it is strictly their own — the shared operator token is never a
 *   fallback there (safe on multi-user servers).
 * - With no gate: prefer the author's linked token, else the shared token
 *   (backwards-compatible single-user behaviour).
 */
async function resolveTurnGithubToken(
  ctx: AppContext,
  config: GuildConfig,
  message: Message,
): Promise<string | undefined> {
  const memberRoleIds = [...(message.member?.roles.cache.keys() ?? [])];
  const gateActive = isGithubGateActive(config);
  const memberAllowed = canUseGithub(config, memberRoleIds);
  // Skip the token lookup entirely for gated-out members.
  const perUserToken =
    gateActive && !memberAllowed ? null : await ctx.github.getFreshToken(message.author.id);
  return chooseGithubToken({
    gateActive,
    memberAllowed,
    perUserToken,
    sharedToken: ctx.credentials().githubToken,
  });
}

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
 * Runs one conversation turn: reactions, the native typing indicator, live
 * streaming of the answer text, the queued Claude query, splitting/attachment
 * of the final answer and usage logging.
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

  // While queued behind the concurrency semaphore, a small ⏳ hint on the user's
  // message. The typing indicator only starts once the run actually begins.
  const position = ctx.queue.keyDepth(session.guildId);
  const queuedReaction: MessageReaction | null =
    position > 0 ? await userMessage.react("⏳").catch(() => null) : null;

  const rawText = stripBotMention(userMessage.content, botId);
  const author = userMessage.member?.displayName ?? userMessage.author.username;
  const { prompt, skipped } = await buildPrompt(
    `${author}: ${rawText.length > 0 ? rawText : "(no text)"}`,
    userMessage.attachments,
  );

  const typing = new TypingIndicator(targetChannel);
  const reply = new StreamingReply(targetChannel);
  let started = false;
  // Fires on the first signal from the run: swap the ⏳ queue hint for the
  // native typing indicator and begin streaming the answer.
  const onStart = () => {
    if (started) return;
    started = true;
    typing.start();
    reply.start();
    if (queuedReaction) void queuedReaction.users.remove(botId).catch(() => {});
  };

  const abort = new AbortController();
  ctx.activeRuns.set(session.threadId, abort);
  const startedAt = new Date().toISOString();

  // A correlation id for this single turn. Stamped on every log line and
  // persisted with the usage row, so one Discord failure maps to exactly one
  // grep-able record — the Claude session id is per-thread, too coarse for this.
  const runId = randomUUID();
  const runLog = ctx.logger.child({
    runId,
    threadId: session.threadId,
    guildId: session.guildId,
    userId: userMessage.author.id,
    model: session.model,
    mode: session.mode,
  });
  runLog.info("run.started");

  const guildConfig = ctx.repos.guildConfig.get(session.guildId);
  const githubToken =
    session.mode === "agentic"
      ? await resolveTurnGithubToken(ctx, guildConfig, userMessage)
      : undefined;

  const { promise } = ctx.queue.enqueue(session.guildId, () =>
    ctx.engine(
      {
        prompt,
        claudeSessionId: session.claudeSessionId ?? undefined,
        cwd: session.cwd,
        model: session.model,
        mode: session.mode,
        systemPromptExtra: guildConfig.systemPromptExtra,
        githubToken,
        abortController: abort,
      },
      {
        onSessionId: (id) => {
          onStart();
          ctx.repos.sessions.setClaudeSessionId(session.threadId, id);
        },
        onTextDelta: (delta) => {
          onStart();
          reply.appendText(delta);
        },
        onToolUse: (tool) => {
          onStart();
          reply.setActivity(`${tool}…`);
        },
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
    errorSubtype: null,
    numTurns: null,
    partial: false,
  }));

  ctx.activeRuns.delete(session.threadId);
  typing.stop();
  reply.stop();
  if (queuedReaction) void queuedReaction.users.remove(botId).catch(() => {});

  // The streamed answer message, reused as the anchor for the final content
  // (or null if no answer text ever arrived — then we send fresh).
  const anchor = reply.sent;

  // Classify once and reuse for the usage row, the lifecycle log, and the
  // Discord message. numTurns sharpens the max-turns wording.
  const classified = result.ok
    ? null
    : classifyFailure(result.errorText ?? "", new Date(), { numTurns: result.numTurns });

  ctx.repos.usage.record({
    guildId: session.guildId,
    userId: userMessage.author.id,
    threadId: session.threadId,
    runId,
    startedAt,
    durationMs: result.durationMs,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costUsd: result.costUsd,
    model: session.model,
    ok: result.ok,
    errorKind: classified?.kind ?? null,
    errorSubtype: result.errorSubtype,
    errorDetail: result.ok ? null : (result.errorText ?? "").slice(0, 2000),
  });

  // One structured lifecycle event per turn — success at info, failure at error
  // so it survives LOG_LEVEL=error. The raw errorText already lives in the DB.
  runLog[result.ok ? "info" : "error"](
    {
      ok: result.ok,
      durationMs: result.durationMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd: result.costUsd,
      sessionId: result.sessionId,
      kind: classified?.kind,
      subtype: result.errorSubtype ?? undefined,
      numTurns: result.numTurns ?? undefined,
      partial: result.partial,
    },
    result.ok ? "run.finished" : "run.failed",
  );

  if (classified?.kind === "rate_limit") {
    ctx.queue.pauseFor(RATE_LIMIT_PAUSE_MS);
  }

  // A partial answer (e.g. max-turns) still carries useful work — fall through
  // to deliver it with a footnote rather than replacing it with the error.
  const hasPartialAnswer = !result.ok && result.partial && result.text.trim().length > 0;

  if (!result.ok && !hasPartialAnswer) {
    const errorContent = `❌ ${classified?.message ?? ""}`;
    await (anchor
      ? anchor.edit({ content: errorContent, allowedMentions: { parse: [] } })
      : targetChannel.send({ content: errorContent, allowedMentions: { parse: [] } })
    ).catch(() => {});
    await react(userMessage, "❌");
    return;
  }

  if (result.ok) ctx.repos.sessions.touch(session.threadId);

  const footnotes = [
    skipped.length > 0 ? `⚠️ Skipped attachments: ${skipped.join(", ")}` : null,
    hasPartialAnswer ? `⚠️ ${classified?.message}` : null,
  ].filter(Boolean);
  const notes = footnotes.length > 0 ? `\n\n${footnotes.map((n) => `-# ${n}`).join("\n")}` : "";
  const { chunks, asAttachment } = splitMessage(result.text + notes);

  try {
    if (asAttachment) {
      const file = new AttachmentBuilder(Buffer.from(result.text + notes, "utf8"), {
        name: "response.md",
      });
      const previewLimit = Math.max(0, DISCORD_MESSAGE_LIMIT - 120 - notes.length);
      const summary = `${result.text.slice(0, previewLimit).trimEnd()}…${notes}`;
      const content = `The full answer is attached.\n\n${summary}`.slice(0, DISCORD_MESSAGE_LIMIT);
      await (anchor
        ? anchor.edit({ content, files: [file], allowedMentions: { parse: [] } })
        : targetChannel.send({ content, files: [file], allowedMentions: { parse: [] } }));
    } else if (chunks.length === 0) {
      const content = "*(empty response)*";
      await (anchor
        ? anchor.edit({ content, allowedMentions: { parse: [] } })
        : targetChannel.send({ content, allowedMentions: { parse: [] } }));
    } else {
      await (anchor
        ? anchor.edit({ content: chunks[0]!, allowedMentions: { parse: [] } })
        : targetChannel.send({ content: chunks[0]!, allowedMentions: { parse: [] } }));
      for (const chunk of chunks.slice(1)) {
        await targetChannel.send({ content: chunk, allowedMentions: { parse: [] } });
      }
    }
    await react(userMessage, hasPartialAnswer ? "⚠️" : "✅");
  } catch (err) {
    runLog.warn({ err }, "failed to deliver response");
    await react(userMessage, "❌");
  }
}
