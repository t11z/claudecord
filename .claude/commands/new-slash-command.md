---
description: Scaffold a new Discord slash command for the bot, following the existing pattern
argument-hint: <command-name> <what it should do>
---

Scaffold a new Discord slash command for claudecord.

Command spec (ask the user for anything missing — name, one-line description,
options/subcommands, whether it's admin-only): $ARGUMENTS

## Steps

1. Read `packages/bot/src/discord/commands/types.ts` for the `Command` interface,
   and `packages/bot/src/discord/commands/reset.ts` + `packages/bot/src/discord/commands/config.ts`
   as references — the latter shows the admin-gating pattern
   (`.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)`) and
   subcommands. Also skim `packages/bot/src/context.ts` for the `AppContext`
   shape (`ctx.repos`, `ctx.env`, `ctx.queue`, `ctx.engine`, `ctx.discord`,
   `ctx.activeRuns`) available inside `execute`.

2. Create `packages/bot/src/discord/commands/<name>.ts`:
   - Export `const <name>: Command`
   - Build `data` with `SlashCommandBuilder` — `.setName()`, `.setDescription()`,
     any `.addStringOption()`/`.addBooleanOption()`/`.addSubcommand()` needed
   - Implement `async execute(ctx, interaction)`. Guard on `interaction.guildId`
     first if the command only makes sense inside a server (see existing
     commands for the exact reply text pattern).
   - Keep it a thin wrapper: business logic belongs in `ctx.repos.*` or
     `claude/runner.ts`, not inline in the command file.

3. Register it in `packages/bot/src/discord/commands/index.ts`: import the
   command and add it to the `commands` array (alphabetical-ish, matches
   existing order).

4. Update docs:
   - Add a row to the slash command table in
     `docs/src/content/docs/guide/usage.md`
   - If admin-gated, also mention it in
     `docs/src/content/docs/guide/access-control.md` where relevant

5. Verify: `npm run lint && npm run typecheck` from the repo root (or
   `-w @claudecord/bot` for just the bot package). If the command has
   non-trivial logic beyond simple repo calls, flag to the user that it may
   be worth a unit test — most existing command files aren't unit-tested
   directly since they're thin wrappers around already-tested repos/engine.

## After creating the files

Summarize what was added and remind the user that slash commands are
registered with Discord automatically on every bot startup
(`register-commands.ts`, called from `discord/client.ts`) — there is no
separate manual deploy step, but Discord can take a few minutes to
propagate new commands globally.
