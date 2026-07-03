import { Client, Events, GatewayIntentBits } from "discord.js";
import type { AppContext } from "../context.js";
import { handleInteraction } from "./handlers/interaction.js";
import { handleMention } from "./handlers/mention.js";
import { handleThreadMessage } from "./handlers/thread-message.js";
import { registerCommands } from "./register-commands.js";

export function createDiscordClient(ctx: AppContext): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      // Privileged! Must be enabled on the Bot page of the Developer Portal.
      GatewayIntentBits.MessageContent,
    ],
  });

  client.on(Events.MessageCreate, (message) => {
    if (message.author.bot || !message.inGuild()) return;
    void (async () => {
      try {
        // A thread mapped to a session takes priority — no mention needed there.
        if (message.channel.isThread() && ctx.repos.sessions.get(message.channelId)) {
          await handleThreadMessage(ctx, message);
          return;
        }
        if (client.user && message.mentions.users.has(client.user.id)) {
          await handleMention(ctx, message);
        }
      } catch (err) {
        ctx.logger.error({ err }, "message handler failed");
      }
    })();
  });

  client.on(Events.InteractionCreate, (interaction) => {
    void handleInteraction(ctx, interaction);
  });

  client.once(Events.ClientReady, (ready) => {
    ctx.logger.info({ user: ready.user.tag, guilds: ready.guilds.cache.size }, "discord ready");
  });

  return client;
}

/**
 * Connects to Discord and registers slash commands. Throws a descriptive
 * error when the MessageContent intent is not enabled in the Dev Portal.
 */
export async function startDiscord(ctx: AppContext, token: string): Promise<Client> {
  const client = createDiscordClient(ctx);
  try {
    await client.login(token);
  } catch (err) {
    if (err instanceof Error && /disallowed intents/i.test(err.message)) {
      throw new Error(
        "Discord rejected the connection: the Message Content intent is not enabled. " +
          "Open your app in the Discord Developer Portal → Bot → enable 'Message Content Intent'.",
      );
    }
    throw err;
  }
  ctx.discord = client;

  const appId = ctx.credentials().discordApplicationId ?? client.user?.id;
  if (appId) {
    await registerCommands(ctx, token, appId);
  } else {
    ctx.logger.warn("no application id available — slash commands not registered");
  }
  return client;
}
