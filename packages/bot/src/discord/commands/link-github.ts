import { type ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import type { AppContext } from "../../context.js";
import { DeviceFlowError, pollForToken, requestDeviceCode } from "../../github/device-flow.js";
import { revokeUserToken } from "../../github/refresh.js";
import { canUseGithub, isGithubGateActive } from "../access-control.js";
import type { Command } from "./types.js";

/** Role ids of the invoking member, handling both cached and raw API shapes. */
function memberRoleIds(interaction: ChatInputCommandInteraction): string[] {
  const member = interaction.member;
  if (!member) return [];
  const roles = member.roles;
  if (Array.isArray(roles)) return roles; // APIInteractionGuildMember
  return [...roles.cache.keys()]; // GuildMember
}

async function runLink(ctx: AppContext, interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({
      ephemeral: true,
      content: "Run `/link-github link` inside a server so I can check your roles.",
    });
    return;
  }

  const creds = ctx.credentials();
  if (!creds.githubAppClientId) {
    await interaction.reply({
      ephemeral: true,
      content:
        "GitHub linking isn't set up on this bot yet. Ask an operator to configure a GitHub App (GITHUB_APP_CLIENT_ID / _SECRET).",
    });
    return;
  }

  const config = ctx.repos.guildConfig.get(interaction.guildId);
  if (isGithubGateActive(config) && !canUseGithub(config, memberRoleIds(interaction))) {
    await interaction.reply({
      ephemeral: true,
      content: "You don't have a role that's allowed to link a GitHub account on this server.",
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  let device: Awaited<ReturnType<typeof requestDeviceCode>>;
  try {
    device = await requestDeviceCode(creds.githubAppClientId);
  } catch (err) {
    const msg = err instanceof DeviceFlowError ? err.message : "Couldn't reach GitHub.";
    await interaction.editReply({ content: `❌ ${msg}` });
    return;
  }

  await interaction.editReply({
    content: [
      "**Link your GitHub account**",
      `1. Open ${device.verificationUri}`,
      `2. Enter this code: \`${device.userCode}\``,
      "",
      "-# Waiting for you to authorize… this message updates automatically.",
    ].join("\n"),
  });

  try {
    const tokens = await pollForToken(creds.githubAppClientId, device.deviceCode, {
      intervalSec: device.interval,
      expiresInSec: device.expiresIn,
    });
    const summary = await ctx.github.link(interaction.user.id, tokens);
    await interaction.editReply({
      content: `✅ Linked as **@${summary.login ?? "unknown"}**. Agentic runs you start now act in your GitHub namespace.`,
    });
    ctx.logger.info(
      { userId: interaction.user.id, login: summary.login },
      "github identity linked",
    );
  } catch (err) {
    const msg = err instanceof DeviceFlowError ? err.message : "Linking failed.";
    await interaction.editReply({ content: `❌ ${msg}` });
  }
}

async function runStatus(ctx: AppContext, interaction: ChatInputCommandInteraction): Promise<void> {
  const identity = ctx.github.get(interaction.user.id);
  if (!identity) {
    await interaction.reply({
      ephemeral: true,
      content: "You haven't linked a GitHub account. Run `/link-github link` in a server.",
    });
    return;
  }
  const expiry = identity.expiresAt
    ? `expires <t:${Math.floor(Date.parse(identity.expiresAt) / 1000)}:R>`
    : "no expiry";
  await interaction.reply({
    ephemeral: true,
    content: `Linked as **@${identity.login ?? "unknown"}** (${expiry}). Use \`/link-github unlink\` to disconnect.`,
  });
}

async function runUnlink(ctx: AppContext, interaction: ChatInputCommandInteraction): Promise<void> {
  const identity = ctx.github.get(interaction.user.id);
  if (!identity) {
    await interaction.reply({ ephemeral: true, content: "Nothing to unlink." });
    return;
  }
  const creds = ctx.credentials();
  if (creds.githubAppClientId && creds.githubAppClientSecret) {
    await revokeUserToken(
      creds.githubAppClientId,
      creds.githubAppClientSecret,
      identity.accessToken,
    );
  }
  ctx.github.unlink(interaction.user.id);
  await interaction.reply({
    ephemeral: true,
    content: "🔌 Unlinked your GitHub account. Agentic runs will no longer act as you.",
  });
}

export const linkGithub: Command = {
  data: new SlashCommandBuilder()
    .setName("link-github")
    .setDescription("Connect your own GitHub account so agentic runs act in your namespace")
    .addSubcommand((s) =>
      s.setName("link").setDescription("Link your GitHub account via a one-time code"),
    )
    .addSubcommand((s) => s.setName("status").setDescription("Show your linked GitHub account"))
    .addSubcommand((s) => s.setName("unlink").setDescription("Disconnect your GitHub account"))
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
