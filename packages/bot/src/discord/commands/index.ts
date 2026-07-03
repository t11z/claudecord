import { ask } from "./ask.js";
import { config } from "./config.js";
import { help } from "./help.js";
import { linkGithub } from "./link-github.js";
import { model } from "./model.js";
import { reset } from "./reset.js";
import type { Command } from "./types.js";
import { usage } from "./usage.js";

export const commands: Command[] = [ask, reset, usage, model, config, linkGithub, help];

export const commandMap = new Map(commands.map((c) => [c.data.name, c]));
