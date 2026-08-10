import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AppContext, createContext } from "../src/context.js";
import { loadEnv } from "../src/env.js";
import { createLogger } from "../src/logger.js";
import { warnAboutRemovedGithubGate } from "../src/startup-warnings.js";

/**
 * The separate GitHub role gate was removed — GitHub now follows the bot's
 * allowed roles. Where an operator had set it *narrower*, that restriction has
 * been lifted, and a security rule must not widen without saying so. These tests
 * pin exactly when the warning fires.
 */

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "claudecord-warn-test-"));
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function makeCtx(): AppContext {
  return createContext(loadEnv({ DATA_DIR: dataDir }), createLogger("silent"));
}

function warnSpy(ctx: AppContext) {
  return vi.spyOn(ctx.logger, "warn").mockImplementation(() => ctx.logger);
}

function setConfig(ctx: AppContext, guildId: string, allowed: string[], github: string[]) {
  ctx.repos.guildConfig.upsert({
    ...ctx.repos.guildConfig.get(guildId),
    guildId,
    allowedRoleIds: allowed,
    githubRoleIds: github,
  });
}

describe("warnAboutRemovedGithubGate", () => {
  it("says nothing when no GitHub roles were ever set", () => {
    const ctx = makeCtx();
    setConfig(ctx, "g1", ["team"], []);
    const spy = warnSpy(ctx);
    warnAboutRemovedGithubGate(ctx);
    expect(spy).not.toHaveBeenCalled();
  });

  it("says nothing when the two lists already matched — the common case", () => {
    const ctx = makeCtx();
    setConfig(ctx, "g1", ["team", "ops"], ["ops", "team"]); // same set, different order
    const spy = warnSpy(ctx);
    warnAboutRemovedGithubGate(ctx);
    expect(spy).not.toHaveBeenCalled();
  });

  it("warns, naming the guild and both lists, when GitHub was narrower", () => {
    const ctx = makeCtx();
    setConfig(ctx, "g1", ["everyone-ish"], ["devs"]);
    const spy = warnSpy(ctx);
    warnAboutRemovedGithubGate(ctx);
    expect(spy).toHaveBeenCalledTimes(1);
    const [payload, message] = spy.mock.calls[0]!;
    expect(payload).toMatchObject({
      guildId: "g1",
      formerGithubRoleIds: ["devs"],
      allowedRoleIds: ["everyone-ish"],
    });
    expect(String(message)).toMatch(/GitHub role gate has been removed/i);
  });

  it("warns once per affected guild and skips the unaffected ones", () => {
    const ctx = makeCtx();
    setConfig(ctx, "g-narrow", ["all"], ["devs"]);
    setConfig(ctx, "g-same", ["all"], ["all"]);
    setConfig(ctx, "g-none", ["all"], []);
    const spy = warnSpy(ctx);
    warnAboutRemovedGithubGate(ctx);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toMatchObject({ guildId: "g-narrow" });
  });
});
