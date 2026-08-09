import {
  type ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import type { Env } from "../../env.js";
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

/**
 * Base URL for the sign-in link. Trailing slashes are stripped: a configured
 * `DASHBOARD_PUBLIC_URL` ending in `/` would build `…//api/auth/link`, which
 * Hono does not match — the request falls through to `serveStatic` and gets
 * a silent 200 with the SPA instead of a login, with no error anywhere.
 */
export function publicUrl(env: Env): string {
  const base = env.DASHBOARD_PUBLIC_URL ?? `http://localhost:${env.DASHBOARD_PORT}`;
  return base.replace(/\/+$/, "");
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
      // Ephemeral via flags (the `ephemeral` boolean is deprecated), plus
      // SuppressEmbeds, plus the URL in angle brackets: three separate asks
      // to Discord not to unfurl this link. None is a guarantee — the actual
      // fix is that `GET /api/auth/link` writes nothing; see web/routes/auth.ts.
      flags: [MessageFlags.Ephemeral, MessageFlags.SuppressEmbeds],
      content: [
        "**Your dashboard sign-in link** (works once, expires in 5 minutes):",
        `<${publicUrl(ctx.env)}/api/auth/link?token=${token}>`,
        "",
        "-# Don't share this link — anyone who opens it signs in as you.",
      ].join("\n"),
    });
  },
};
