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
  }));

  ctx.activeRuns.delete(session.threadId);
  typing.stop();
  reply.stop();
  if (queuedReaction) void queuedReaction.users.remove(botId).catch(() => {});

  // The streamed answer message, reused as the anchor for the final content
  // (or null if no answer text ever arrived — then we send fresh).
  const anchor = reply.sent;

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
    const errorContent = `❌ ${classified.message}`;
    await (anchor
      ? anchor.edit({ content: errorContent, allowedMentions: { parse: [] } })
      : targetChannel.send({ content: errorContent, allowedMentions: { parse: [] } })
    ).catch(() => {});
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
    await react(userMessage, "✅");
  } catch (err) {
    ctx.logger.warn({ err }, "failed to deliver response");
    await react(userMessage, "❌");
  }
}
