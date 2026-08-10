import { describe, expect, it } from "vitest";
import type { GuildConfig } from "../src/db/repos/guild-config.js";
import { isAllowed, mayUseBot } from "../src/discord/access-control.js";

function config(overrides: Partial<GuildConfig> = {}): GuildConfig {
  return {
    guildId: "g1",
    enabled: true,
    allowedChannelIds: [],
    allowedRoleIds: [],
    agenticEnabled: false,
    githubRoleIds: [],
    model: null,
    systemPromptExtra: null,
    ...overrides,
  };
}

describe("isAllowed", () => {
  it("allows everything by default", () => {
    expect(isAllowed(config(), { channelId: "c1", parentChannelId: null, memberRoleIds: [] })).toBe(
      true,
    );
  });

  it("denies everything when disabled", () => {
    expect(
      isAllowed(config({ enabled: false }), {
        channelId: "c1",
        parentChannelId: null,
        memberRoleIds: ["r1"],
      }),
    ).toBe(false);
  });

  it("enforces the channel allowlist", () => {
    const cfg = config({ allowedChannelIds: ["c1"] });
    expect(isAllowed(cfg, { channelId: "c1", parentChannelId: null, memberRoleIds: [] })).toBe(
      true,
    );
    expect(isAllowed(cfg, { channelId: "c2", parentChannelId: null, memberRoleIds: [] })).toBe(
      false,
    );
  });

  it("checks the parent channel for threads", () => {
    const cfg = config({ allowedChannelIds: ["c1"] });
    expect(isAllowed(cfg, { channelId: "thread9", parentChannelId: "c1", memberRoleIds: [] })).toBe(
      true,
    );
    expect(isAllowed(cfg, { channelId: "thread9", parentChannelId: "c2", memberRoleIds: [] })).toBe(
      false,
    );
  });

  it("enforces the role allowlist", () => {
    const cfg = config({ allowedRoleIds: ["r1", "r2"] });
    expect(isAllowed(cfg, { channelId: "c1", parentChannelId: null, memberRoleIds: ["r2"] })).toBe(
      true,
    );
    expect(isAllowed(cfg, { channelId: "c1", parentChannelId: null, memberRoleIds: ["r3"] })).toBe(
      false,
    );
    expect(isAllowed(cfg, { channelId: "c1", parentChannelId: null, memberRoleIds: [] })).toBe(
      false,
    );
  });

  it("requires both channel and role when both lists are set", () => {
    const cfg = config({ allowedChannelIds: ["c1"], allowedRoleIds: ["r1"] });
    expect(isAllowed(cfg, { channelId: "c1", parentChannelId: null, memberRoleIds: ["r1"] })).toBe(
      true,
    );
    expect(isAllowed(cfg, { channelId: "c1", parentChannelId: null, memberRoleIds: [] })).toBe(
      false,
    );
    expect(isAllowed(cfg, { channelId: "c2", parentChannelId: null, memberRoleIds: ["r1"] })).toBe(
      false,
    );
  });
});

/**
 * `mayUseBot` is the single access rule: it decides talking to the bot, signing
 * in to the dashboard, and connecting a GitHub account. There is no separate
 * GitHub role list any more, so there is nothing here that can drift out of
 * step with `isAllowed` — which delegates to this.
 */
describe("mayUseBot", () => {
  it("refuses when the bot is disabled for the guild, whatever the roles", () => {
    expect(mayUseBot(config({ enabled: false }), ["anything"])).toBe(false);
  });

  it("permits everyone when no role allowlist is set", () => {
    expect(mayUseBot(config(), [])).toBe(true);
  });

  it("permits only members holding an allowed role when one is set", () => {
    const cfg = config({ allowedRoleIds: ["team"] });
    expect(mayUseBot(cfg, ["team"])).toBe(true);
    expect(mayUseBot(cfg, ["other"])).toBe(false);
    expect(mayUseBot(cfg, [])).toBe(false);
  });

  it("is the rule isAllowed uses — a role that fails here fails there too", () => {
    const cfg = config({ allowedRoleIds: ["team"] });
    expect(
      isAllowed(cfg, { channelId: "c1", parentChannelId: null, memberRoleIds: ["other"] }),
    ).toBe(false);
    expect(
      isAllowed(cfg, { channelId: "c1", parentChannelId: null, memberRoleIds: ["team"] }),
    ).toBe(true);
  });
});
