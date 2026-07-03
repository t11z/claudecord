import type {
  ChatInputCommandInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";
import type { AppContext } from "../../context.js";

export interface Command {
  data: RESTPostAPIChatInputApplicationCommandsJSONBody;
  execute(ctx: AppContext, interaction: ChatInputCommandInteraction): Promise<void>;
}
