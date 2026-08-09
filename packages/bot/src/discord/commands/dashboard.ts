import {
  type ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import type { AppContext } from "../../context.js";
import { isAllowed } from "../access-control.js";
import type { Command } from "./types.js";

/** Role ids of the invoking member, handling both cached and raw API shapes. */
function memberRoleIds(interaction: ChatInputCommandInteraction): string[] {
  const member = interaction.member;
  if (!member) return [];
  const roles = member.roles;
  if (Array.isArray(roles)) return roles; // APIInteractionGuildMember
  return [...roles.cache.keys()]; // GuildMember
}

function publicUrl(ctx: AppContext): string {
  return ctx.env.DASHBOARD_PUBLIC_URL ?? `http://localhost:${ctx.env.DASHBOARD_PORT}`;
}

export const dashboard: Command = {
  data: new SlashCommandBuilder()
    .setName("dashboard")
    .setDescription("Get a one-time sign-in link for the web dashboard")
    .toJSON(),

  async execute(ctx, interaction) {
    if (!interaction.guildId) {
      await interaction.reply({
        ephemeral: true,
        content: "Run `/dashboard` inside a server so I can check your roles.",
      });
      return;
    }

    const config = ctx.repos.guildConfig.get(interaction.guildId);
    if (
      !isAllowed(config, {
        channelId: interaction.channelId,
        parentChannelId: null,
        memberRoleIds: memberRoleIds(interaction),
      })
    ) {
      await interaction.reply({
        ephemeral: true,
        content:
          "You're not allowed to use the bot on this server, so there's nothing to sign into.",
      });
      return;
    }

    const token = ctx.magicLink.mint({
      sub: interaction.user.id,
      username: interaction.user.username,
      globalName: interaction.user.globalName ?? null,
      avatarUrl: interaction.user.avatarURL({ size: 64 }),
      hasManageGuild: interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false,
    });

    await interaction.reply({
      ephemeral: true,
      content: [
        "**Your dashboard sign-in link** (works once, expires in 5 minutes):",
        `${publicUrl(ctx)}/api/auth/link?token=${token}`,
        "",
        "-# Don't share this link — anyone who opens it signs in as you.",
      ].join("\n"),
    });
  },
};
