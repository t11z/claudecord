import { REST, Routes } from "discord.js";
import type { AppContext } from "../context.js";
import { commands } from "./commands/index.js";

export async function registerCommands(
  ctx: AppContext,
  token: string,
  applicationId: string,
): Promise<void> {
  const rest = new REST().setToken(token);
  await rest.put(Routes.applicationCommands(applicationId), {
    body: commands.map((c) => c.data),
  });
  ctx.logger.info({ count: commands.length }, "slash commands registered");
}
