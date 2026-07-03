import { ChannelType, type Message } from "discord.js";
import type { AppContext } from "../../context.js";
import { workspaceDir } from "../../context.js";
import { isAllowed } from "../access-control.js";
import { runConversationTurn } from "../conversation.js";

function deriveThreadTitle(content: string, botId: string): string {
  const stripped = content
    .replaceAll(new RegExp(`<@!?${botId}>`, "g"), "")
    .replaceAll(/\s+/g, " ")
    .trim();
  if (stripped.length === 0) return "Chat with Claude";
  return stripped.length > 80 ? `${stripped.slice(0, 77)}…` : stripped;
}

/**
 * A fresh @mention in a regular channel: create a thread, map it to a new
 * Claude session and run the first turn inside the thread.
 */
export async function handleMention(ctx: AppContext, message: Message): Promise<void> {
  if (!message.guildId || !message.member) return;

  const config = ctx.repos.guildConfig.get(message.guildId);
  if (
    !isAllowed(config, {
      channelId: message.channelId,
      parentChannelId: null,
      memberRoleIds: [...message.member.roles.cache.keys()],
    })
  ) {
    return;
  }

  if (
    message.channel.type !== ChannelType.GuildText &&
    message.channel.type !== ChannelType.GuildAnnouncement
  ) {
    await message
      .reply({
        content:
          "I can only start conversations in regular text channels. Mention me there and I'll open a thread!",
        allowedMentions: { parse: [] },
      })
      .catch(() => {});
    return;
  }

  const botId = ctx.discord?.user?.id;
  if (!botId) return;

  let thread: Awaited<ReturnType<Message["startThread"]>>;
  try {
    thread = await message.startThread({
      name: deriveThreadTitle(message.content, botId),
      autoArchiveDuration: 1440,
    });
  } catch (err) {
    ctx.logger.warn({ err }, "could not create thread");
    await message
      .reply({
        content: "I couldn't create a thread here (missing permission?).",
        allowedMentions: { parse: [] },
      })
      .catch(() => {});
    return;
  }

  const session = ctx.repos.sessions.create({
    threadId: thread.id,
    guildId: message.guildId,
    channelId: message.channelId,
    claudeSessionId: null,
    model: config.model ?? ctx.env.CLAUDE_MODEL,
    mode: config.agenticEnabled ? "agentic" : "chat",
    cwd: workspaceDir(ctx, message.guildId, thread.id),
  });

  await runConversationTurn(ctx, message, thread, session);
}
