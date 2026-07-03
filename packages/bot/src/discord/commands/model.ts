import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { MODEL_CHOICES } from "../../claude/models.js";
import type { Command } from "./types.js";

export const model: Command = {
  data: new SlashCommandBuilder()
    .setName("model")
    .setDescription("Choose the Claude model for new conversations in this server (admins only)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((o) =>
      o
        .setName("model")
        .setDescription("Model for new threads")
        .setRequired(true)
        .addChoices(
          { name: "Server default", value: "default" },
          ...MODEL_CHOICES.map((m) => ({ name: `${m.label} — ${m.description}`, value: m.id })),
        ),
    )
    .toJSON(),

  async execute(ctx, interaction) {
    if (!interaction.guildId) {
      await interaction.reply({ content: "This command only works in servers.", ephemeral: true });
      return;
    }
    const choice = interaction.options.getString("model", true);
    const config = ctx.repos.guildConfig.get(interaction.guildId);
    config.model = choice === "default" ? null : choice;
    ctx.repos.guildConfig.upsert(config);

    const label =
      choice === "default"
        ? `the server default (${ctx.env.CLAUDE_MODEL})`
        : (MODEL_CHOICES.find((m) => m.id === choice)?.label ?? choice);
    await interaction.reply({
      content: `✅ New conversations will use **${label}**. Existing threads keep their model.`,
    });
  },
};
