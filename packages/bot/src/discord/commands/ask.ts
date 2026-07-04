import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AttachmentBuilder, SlashCommandBuilder } from "discord.js";
import { classifyFailure } from "../../claude/errors.js";
import { DISCORD_MESSAGE_LIMIT, splitMessage } from "../splitter.js";
import type { Command } from "./types.js";

/**
 * One-shot question without a thread or session. Kept intentionally short
 * (low maxTurns) — the 15-minute interaction token limits long agentic runs.
 */
export const ask: Command = {
  data: new SlashCommandBuilder()
    .setName("ask")
    .setDescription("Ask Claude a one-shot question (no conversation memory)")
    .addStringOption((o) =>
      o.setName("prompt").setDescription("Your question").setRequired(true).setMaxLength(1900),
    )
    .addBooleanOption((o) =>
      o.setName("private").setDescription("Only you can see the answer (default: false)"),
    )
    .toJSON(),

  async execute(ctx, interaction) {
    if (!interaction.guildId) {
      await interaction.reply({ content: "This command only works in servers.", ephemeral: true });
      return;
    }
    const prompt = interaction.options.getString("prompt", true);
    const isPrivate = interaction.options.getBoolean("private") ?? false;
    await interaction.deferReply({ ephemeral: isPrivate });

    const config = ctx.repos.guildConfig.get(interaction.guildId);
    const cwd = path.join(os.tmpdir(), "claudecord-ask");
    fs.mkdirSync(cwd, { recursive: true });

    const startedAt = new Date().toISOString();
    const runId = randomUUID();
    const { promise } = ctx.queue.enqueue(interaction.guildId, () =>
      ctx.engine({
        prompt,
        cwd,
        model: config.model ?? ctx.env.CLAUDE_MODEL,
        mode: "chat",
        systemPromptExtra: config.systemPromptExtra,
        maxTurns: 6,
      }),
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

    const classified = result.ok
      ? null
      : classifyFailure(result.errorText ?? "", new Date(), { numTurns: result.numTurns });

    ctx.repos.usage.record({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      threadId: null,
      runId,
      startedAt,
      durationMs: result.durationMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd: result.costUsd,
      model: config.model ?? ctx.env.CLAUDE_MODEL,
      ok: result.ok,
      errorKind: classified?.kind ?? null,
      errorSubtype: result.errorSubtype,
      errorDetail: result.ok ? null : (result.errorText ?? "").slice(0, 2000),
    });

    if (!result.ok) {
      ctx.logger.error(
        {
          runId,
          guildId: interaction.guildId,
          userId: interaction.user.id,
          kind: classified?.kind,
          subtype: result.errorSubtype ?? undefined,
        },
        "ask run failed",
      );
      await interaction.editReply({ content: `❌ ${classified?.message ?? ""}` }).catch(() => {});
      return;
    }

    const { chunks, asAttachment } = splitMessage(result.text);
    try {
      if (asAttachment) {
        const file = new AttachmentBuilder(Buffer.from(result.text, "utf8"), {
          name: "response.md",
        });
        await interaction.editReply({
          content:
            `The full answer is attached.\n\n${result.text.slice(0, DISCORD_MESSAGE_LIMIT - 120).trimEnd()}…`.slice(
              0,
              DISCORD_MESSAGE_LIMIT,
            ),
          files: [file],
        });
      } else if (chunks.length === 0) {
        await interaction.editReply({ content: "*(empty response)*" });
      } else {
        await interaction.editReply({ content: chunks[0]! });
        for (const chunk of chunks.slice(1)) {
          await interaction.followUp({ content: chunk, ephemeral: isPrivate });
        }
      }
    } catch (err) {
      ctx.logger.warn({ err }, "failed to deliver /ask response");
    }
  },
};
