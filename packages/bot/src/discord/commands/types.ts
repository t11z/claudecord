import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";
import type { AppContext } from "../../context.js";

export interface Command {
  data: RESTPostAPIChatInputApplicationCommandsJSONBody;
  execute(ctx: AppContext, interaction: ChatInputCommandInteraction): Promise<void>;
  /** Present only on commands with an autocompleting option (e.g. `/model`). */
  autocomplete?(ctx: AppContext, interaction: AutocompleteInteraction): Promise<void>;
}
