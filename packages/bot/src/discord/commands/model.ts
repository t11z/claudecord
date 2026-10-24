import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { findModelChoice, getModelChoices, type ModelChoice } from "../../claude/models.js";
import type { AppContext } from "../../context.js";
import type { Command } from "./types.js";

const DEFAULT_CHOICE = "default";
// Discord caps an autocomplete reply at 25 options and each option `name` at
// 100 chars.
const MAX_OPTIONS = 25;
const MAX_NAME_LEN = 100;

/**
 * A token to list models with. The acting admin's own token is preferred, but
 * any linked token works — the model list is identity-agnostic and the call is
 * free (see ClaudeIdentityStore.anyToken). Null means fall back to the static
 * list.
 */
function listToken(ctx: AppContext, userId: string): string | null {
  return ctx.claude.getToken(userId) ?? ctx.claude.anyToken();
}

function truncate(name: string): string {
  return name.length <= MAX_NAME_LEN ? name : `${name.slice(0, MAX_NAME_LEN - 1)}…`;
}

export const model: Command = {
  data: new SlashCommandBuilder()
    .setName("model")
    .setDescription("Choose the Claude model for new conversations in this server (admins only)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((o) =>
      o
        .setName("model")
        .setDescription("Model for new threads — start typing to see every model Anthropic offers")
        .setRequired(true)
        .setAutocomplete(true),
    )
    .toJSON(),

  async autocomplete(ctx, interaction) {
    const query = interaction.options.getFocused().toLowerCase();
    const choices = await getModelChoices(listToken(ctx, interaction.user.id)).catch(
      () => [] as ModelChoice[],
    );

    const defaultName = `Server default (${ctx.env.CLAUDE_MODEL})`;
    const options: { name: string; value: string }[] = [];
    if (!query || DEFAULT_CHOICE.includes(query) || defaultName.toLowerCase().includes(query)) {
      options.push({ name: truncate(defaultName), value: DEFAULT_CHOICE });
    }
    for (const choice of choices) {
      if (options.length >= MAX_OPTIONS) break;
      if (query && !`${choice.label} ${choice.id}`.toLowerCase().includes(query)) continue;
      options.push({ name: truncate(`${choice.label} — ${choice.description}`), value: choice.id });
    }
    await interaction.respond(options.slice(0, MAX_OPTIONS));
  },

  async execute(ctx, interaction) {
    if (!interaction.guildId) {
      await interaction.reply({ content: "This command only works in servers.", ephemeral: true });
      return;
    }
    const choice = interaction.options.getString("model", true);

    let label: string;
    if (choice === DEFAULT_CHOICE) {
      label = `the server default (${ctx.env.CLAUDE_MODEL})`;
    } else {
      const choices = await getModelChoices(listToken(ctx, interaction.user.id)).catch(
        () => [] as ModelChoice[],
      );
      const known = findModelChoice(choices, choice);
      // Reject an unknown id only when we actually have a live list to judge
      // against — if the lookup failed we have no grounds to block the admin.
      if (choices.length > 0 && !known) {
        await interaction.reply({
          ephemeral: true,
          content:
            `❌ **${choice}** isn't one of the models Anthropic is currently offering. ` +
            "Clear the field, start typing, and pick one of the suggestions.",
        });
        return;
      }
      label = known?.label ?? choice;
    }

    const config = ctx.repos.guildConfig.get(interaction.guildId);
    config.model = choice === DEFAULT_CHOICE ? null : choice;
    ctx.repos.guildConfig.upsert(config);

    await interaction.reply({
      content: `✅ New conversations will use **${label}**. Existing threads keep their model.`,
    });
  },
};
