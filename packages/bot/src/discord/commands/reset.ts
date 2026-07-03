import { SlashCommandBuilder } from "discord.js";
import type { Command } from "./types.js";

export const reset: Command = {
  data: new SlashCommandBuilder()
    .setName("reset")
    .setDescription("Forget this thread's conversation — the next message starts fresh")
    .toJSON(),

  async execute(ctx, interaction) {
    const threadId = interaction.channelId;
    const session = ctx.repos.sessions.get(threadId);
    if (!session) {
      await interaction.reply({
        content: "This isn't a Claude conversation thread — nothing to reset.",
        ephemeral: true,
      });
      return;
    }

    ctx.activeRuns.get(threadId)?.abort();
    ctx.repos.sessions.delete(threadId);
    // Recreate the mapping so follow-up messages still work, but with a
    // fresh Claude session on the next turn.
    ctx.repos.sessions.create({
      threadId: session.threadId,
      guildId: session.guildId,
      channelId: session.channelId,
      claudeSessionId: null,
      model: session.model,
      mode: session.mode,
      cwd: session.cwd,
    });

    await interaction.reply({
      content: "🧹 Conversation reset — I've forgotten everything in this thread.",
    });
  },
};
