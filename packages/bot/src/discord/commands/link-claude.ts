import {
  ActionRowBuilder,
  type ChatInputCommandInteraction,
  ModalBuilder,
  type ModalSubmitInteraction,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { checkClaudeAuth } from "../../claude/auth-check.js";
import type { AppContext } from "../../context.js";
import type { Command } from "./types.js";

export const LINK_CLAUDE_MODAL_ID = "link-claude:token";
const TOKEN_FIELD_ID = "token";

async function runLink(_ctx: AppContext, interaction: ChatInputCommandInteraction): Promise<void> {
  const modal = new ModalBuilder()
    .setCustomId(LINK_CLAUDE_MODAL_ID)
    .setTitle("Link your Claude subscription");
  const tokenInput = new TextInputBuilder()
    .setCustomId(TOKEN_FIELD_ID)
    .setLabel("Token from `claude setup-token`")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(tokenInput));
  // Modals must be shown as the direct response to the interaction — never
  // after a deferReply, or Discord rejects it.
  await interaction.showModal(modal);
}

/**
 * Handles the token submitted through the /link-claude modal. Wired into
 * handlers/interaction.ts as the isModalSubmit() branch.
 */
export async function handleLinkClaudeModal(
  ctx: AppContext,
  interaction: ModalSubmitInteraction,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const token = interaction.fields.getTextInputValue(TOKEN_FIELD_ID).trim();

  if (!token) {
    await interaction.editReply({ content: "❌ Token is empty." });
    return;
  }
  if (token.startsWith("sk-ant-api")) {
    await interaction.editReply({
      content:
        "❌ That looks like a plain Anthropic API key. claudecord runs on Claude Code subscriptions — " +
        "get a token with `claude setup-token` instead.",
    });
    return;
  }

  const check = await checkClaudeAuth(ctx.engine, token);
  if (!check.ok) {
    await interaction.editReply({ content: `❌ ${check.message}` });
    return;
  }

  ctx.claude.link(interaction.user.id, token);
  await interaction.editReply({
    content: "✅ Linked your Claude subscription. I'll use it for every run you start.",
  });
  ctx.logger.info({ userId: interaction.user.id }, "claude identity linked");
}

async function runStatus(ctx: AppContext, interaction: ChatInputCommandInteraction): Promise<void> {
  const identity = ctx.claude.get(interaction.user.id);
  if (!identity) {
    await interaction.reply({
      ephemeral: true,
      content: "You haven't linked a Claude subscription. Run `/link-claude link`.",
    });
    return;
  }
  const verified = identity.lastVerifiedAt
    ? `last verified <t:${Math.floor(Date.parse(identity.lastVerifiedAt) / 1000)}:R>`
    : "never re-verified";
  await interaction.reply({
    ephemeral: true,
    content: `Linked (${verified}). Use \`/link-claude unlink\` to disconnect.`,
  });
}

async function runUnlink(ctx: AppContext, interaction: ChatInputCommandInteraction): Promise<void> {
  const removed = ctx.claude.unlink(interaction.user.id);
  await interaction.reply({
    ephemeral: true,
    content: removed
      ? "🔌 Unlinked your Claude subscription. You'll need to `/link-claude link` again before I'll run for you."
      : "Nothing to unlink.",
  });
}

export const linkClaude: Command = {
  data: new SlashCommandBuilder()
    .setName("link-claude")
    .setDescription("Connect your own Claude subscription so runs are billed to you")
    .addSubcommand((s) => s.setName("link").setDescription("Link your Claude Code OAuth token"))
    .addSubcommand((s) =>
      s.setName("status").setDescription("Show your linked Claude subscription"),
    )
    .addSubcommand((s) => s.setName("unlink").setDescription("Disconnect your Claude subscription"))
    .toJSON(),

  async execute(ctx, interaction) {
    switch (interaction.options.getSubcommand()) {
      case "status":
        return runStatus(ctx, interaction);
      case "unlink":
        return runUnlink(ctx, interaction);
      default:
        return runLink(ctx, interaction);
    }
  },
};
