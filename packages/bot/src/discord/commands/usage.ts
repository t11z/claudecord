import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import type { Command } from "./types.js";

const WINDOW_DAYS = 30;

export const usage: Command = {
  data: new SlashCommandBuilder()
    .setName("usage")
    .setDescription("Show Claude usage stats for this server")
    .toJSON(),

  async execute(ctx, interaction) {
    if (!interaction.guildId) {
      await interaction.reply({ content: "This command only works in servers.", ephemeral: true });
      return;
    }

    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const totals = ctx.repos.usage.guildTotalsSince(interaction.guildId, since);
    const lastRateLimit = ctx.repos.usage.lastRateLimitAt();

    const embed = new EmbedBuilder()
      .setTitle("Claude usage — last 30 days")
      .setColor(0xd97757)
      .addFields(
        { name: "Runs", value: String(totals.runs), inline: true },
        { name: "Errors", value: String(totals.errors), inline: true },
        {
          name: "Tokens",
          value: `${totals.inputTokens.toLocaleString("en-US")} in / ${totals.outputTokens.toLocaleString("en-US")} out`,
          inline: true,
        },
        {
          name: "Est. cost",
          value: `$${totals.costUsd.toFixed(2)} (informational — subscription auth is flat-rate)`,
          inline: false,
        },
        {
          name: "Queue",
          value: `${ctx.queue.depth} waiting, ${ctx.queue.activeRuns} running`,
          inline: true,
        },
        ...(lastRateLimit
          ? [
              {
                name: "Last rate limit",
                value: `<t:${Math.floor(new Date(lastRateLimit).getTime() / 1000)}:R>`,
                inline: true,
              },
            ]
          : []),
      );

    await interaction.reply({ embeds: [embed] });
  },
};
