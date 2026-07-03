import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { Command } from "./types.js";

function formatList(ids: string[], prefix: string): string {
  return ids.length === 0
    ? "*everyone/everywhere*"
    : ids.map((id) => `<${prefix}${id}>`).join(", ");
}

export const config: Command = {
  data: new SlashCommandBuilder()
    .setName("config")
    .setDescription("Configure claudecord for this server (admins only)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName("show").setDescription("Show the current configuration"))
    .addSubcommand((s) =>
      s
        .setName("allow-channel")
        .setDescription("Add or remove a channel from the allowlist")
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("Channel to toggle")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("allow-role")
        .setDescription("Add or remove a role from the allowlist")
        .addRoleOption((o) => o.setName("role").setDescription("Role to toggle").setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName("allow-github-role")
        .setDescription("Add/remove a role that may link & use its own GitHub in agentic runs")
        .addRoleOption((o) => o.setName("role").setDescription("Role to toggle").setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName("agentic")
        .setDescription("Toggle agentic mode (file & shell tools) — read the security docs first!")
        .addBooleanOption((o) =>
          o.setName("enabled").setDescription("Enable agentic mode").setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("enabled")
        .setDescription("Enable or disable the bot in this server")
        .addBooleanOption((o) =>
          o.setName("enabled").setDescription("Enable the bot").setRequired(true),
        ),
    )
    .toJSON(),

  async execute(ctx, interaction) {
    if (!interaction.guildId) {
      await interaction.reply({ content: "This command only works in servers.", ephemeral: true });
      return;
    }
    const cfg = ctx.repos.guildConfig.get(interaction.guildId);
    const sub = interaction.options.getSubcommand();

    switch (sub) {
      case "show": {
        await interaction.reply({
          ephemeral: true,
          content: [
            `**claudecord configuration**`,
            `Enabled: ${cfg.enabled ? "✅" : "❌"}`,
            `Allowed channels: ${formatList(cfg.allowedChannelIds, "#")}`,
            `Allowed roles: ${formatList(cfg.allowedRoleIds, "@&")}`,
            `GitHub roles: ${formatList(cfg.githubRoleIds, "@&")}`,
            `Agentic mode: ${cfg.agenticEnabled ? "⚠️ ON" : "off"}`,
            `Model: ${cfg.model ?? `default (${ctx.env.CLAUDE_MODEL})`}`,
          ].join("\n"),
        });
        return;
      }
      case "allow-channel": {
        const channel = interaction.options.getChannel("channel", true);
        const idx = cfg.allowedChannelIds.indexOf(channel.id);
        if (idx >= 0) {
          cfg.allowedChannelIds.splice(idx, 1);
        } else {
          cfg.allowedChannelIds.push(channel.id);
        }
        ctx.repos.guildConfig.upsert(cfg);
        await interaction.reply({
          ephemeral: true,
          content:
            idx >= 0
              ? `Removed <#${channel.id}> from the allowlist. Now allowed: ${formatList(cfg.allowedChannelIds, "#")}`
              : `Added <#${channel.id}> to the allowlist. Now allowed: ${formatList(cfg.allowedChannelIds, "#")}`,
        });
        return;
      }
      case "allow-role": {
        const role = interaction.options.getRole("role", true);
        const idx = cfg.allowedRoleIds.indexOf(role.id);
        if (idx >= 0) {
          cfg.allowedRoleIds.splice(idx, 1);
        } else {
          cfg.allowedRoleIds.push(role.id);
        }
        ctx.repos.guildConfig.upsert(cfg);
        await interaction.reply({
          ephemeral: true,
          content:
            idx >= 0
              ? `Removed <@&${role.id}> from the allowlist.`
              : `Added <@&${role.id}> to the allowlist.`,
        });
        return;
      }
      case "allow-github-role": {
        const role = interaction.options.getRole("role", true);
        const idx = cfg.githubRoleIds.indexOf(role.id);
        if (idx >= 0) {
          cfg.githubRoleIds.splice(idx, 1);
        } else {
          cfg.githubRoleIds.push(role.id);
        }
        ctx.repos.guildConfig.upsert(cfg);
        const gateNote =
          cfg.githubRoleIds.length > 0
            ? "Members with a GitHub role can run `/link-github` to connect their own account; agentic runs then act in their namespace. The shared GitHub token is not used for this server while a gate is set."
            : "No GitHub roles set — per-user gating is off.";
        await interaction.reply({
          ephemeral: true,
          content:
            (idx >= 0
              ? `Removed <@&${role.id}> from the GitHub roles.`
              : `Added <@&${role.id}> to the GitHub roles.`) + `\n${gateNote}`,
        });
        return;
      }
      case "agentic": {
        const enabled = interaction.options.getBoolean("enabled", true);
        cfg.agenticEnabled = enabled;
        ctx.repos.guildConfig.upsert(cfg);
        await interaction.reply({
          ephemeral: true,
          content: enabled
            ? "⚠️ **Agentic mode enabled.** New threads get file & shell tools inside their sandbox workspace. Anyone allowed to talk to the bot can indirectly run commands — make sure the bot runs in Docker and you trust the allowed roles. See the security docs."
            : "Agentic mode disabled. New threads are chat-only.",
        });
        return;
      }
      case "enabled": {
        const enabled = interaction.options.getBoolean("enabled", true);
        cfg.enabled = enabled;
        ctx.repos.guildConfig.upsert(cfg);
        await interaction.reply({
          ephemeral: true,
          content: enabled ? "✅ Bot enabled in this server." : "💤 Bot disabled in this server.",
        });
        return;
      }
      default: {
        await interaction.reply({ content: "Unknown subcommand.", ephemeral: true });
      }
    }
  },
};
