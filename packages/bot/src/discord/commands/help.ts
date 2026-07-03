import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import type { Command } from "./types.js";

const DOCS_URL = "https://t11z.github.io/claudecord/";

export const help: Command = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("How to talk to Claude on this server")
    .toJSON(),

  async execute(_ctx, interaction) {
    const embed = new EmbedBuilder()
      .setTitle("👋 Talking to Claude")
      .setColor(0xd97757)
      .setDescription(
        [
          "**Start a conversation** — mention me in any allowed channel:",
          "> @Claude how do I center a div?",
          "I'll open a thread and answer there. Inside the thread, just keep typing — no mention needed. I remember the whole thread.",
          "",
          "**Attachments** — drop text files or images into your message and I'll read them.",
          "**Ignore me** — start a message with `//` inside a thread and I'll stay quiet.",
        ].join("\n"),
      )
      .addFields(
        { name: "/ask", value: "One-shot question without a thread", inline: true },
        { name: "/reset", value: "Make me forget this thread", inline: true },
        { name: "/usage", value: "Usage stats for this server", inline: true },
        { name: "/model", value: "Pick the model (admins)", inline: true },
        { name: "/config", value: "Allowlists & agentic mode (admins)", inline: true },
        { name: "/link-github", value: "Use your own GitHub in agentic runs", inline: true },
      )
      .setFooter({ text: `Self-hosted claudecord • Docs: ${DOCS_URL}` });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
