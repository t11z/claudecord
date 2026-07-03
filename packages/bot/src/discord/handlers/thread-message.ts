import type { Message } from "discord.js";
import type { AppContext } from "../../context.js";
import { isAllowed } from "../access-control.js";
import { runConversationTurn } from "../conversation.js";

/**
 * Follow-up message inside a thread that is mapped to a Claude session.
 * No mention required. Messages starting with "//" are ignored so people
 * can talk to each other without waking the bot.
 */
export async function handleThreadMessage(ctx: AppContext, message: Message): Promise<void> {
  if (!message.guildId || !message.member) return;
  if (message.content.startsWith("//")) return;

  const session = ctx.repos.sessions.get(message.channelId);
  if (!session) return;

  const config = ctx.repos.guildConfig.get(message.guildId);
  const parentId = message.channel.isThread() ? message.channel.parentId : null;
  if (
    !isAllowed(config, {
      channelId: message.channelId,
      parentChannelId: parentId,
      memberRoleIds: [...message.member.roles.cache.keys()],
    })
  ) {
    return;
  }

  if (!message.channel.isSendable()) return;
  await runConversationTurn(ctx, message, message.channel, session);
}
