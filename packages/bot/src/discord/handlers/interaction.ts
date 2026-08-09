import type { Interaction } from "discord.js";
import type { AppContext } from "../../context.js";
import { commandMap } from "../commands/index.js";
import { handleLinkClaudeModal, LINK_CLAUDE_MODAL_ID } from "../commands/link-claude.js";

export async function handleInteraction(ctx: AppContext, interaction: Interaction): Promise<void> {
  if (interaction.isModalSubmit()) {
    if (interaction.customId !== LINK_CLAUDE_MODAL_ID) return;
    try {
      await handleLinkClaudeModal(ctx, interaction);
    } catch (err) {
      ctx.logger.error({ err }, "link-claude modal failed");
      const content = "Something went wrong linking your subscription.";
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content }).catch(() => {});
      } else {
        await interaction.reply({ content, ephemeral: true }).catch(() => {});
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  const command = commandMap.get(interaction.commandName);
  if (!command) return;
  try {
    await command.execute(ctx, interaction);
  } catch (err) {
    ctx.logger.error({ err, command: interaction.commandName }, "command failed");
    const content = "Something went wrong running that command.";
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content }).catch(() => {});
    } else {
      await interaction.reply({ content, ephemeral: true }).catch(() => {});
    }
  }
}
