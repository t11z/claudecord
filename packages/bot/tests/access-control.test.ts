import { describe, expect, it } from "vitest";
import type { GuildConfig } from "../src/db/repos/guild-config.js";
import {
  canUseGithub,
  chooseGithubToken,
  isAllowed,
  isGithubGateActive,
} from "../src/discord/access-control.js";

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

describe("GitHub role gate", () => {
  it("is inactive with no github roles, active otherwise", () => {
    expect(isGithubGateActive(config())).toBe(false);
    expect(isGithubGateActive(config({ githubRoleIds: ["g"] }))).toBe(true);
  });

  it("permits everyone when no gate is set", () => {
    expect(canUseGithub(config(), [])).toBe(true);
  });

  it("permits only members holding a github role when gated", () => {
    const cfg = config({ githubRoleIds: ["gh"] });
    expect(canUseGithub(cfg, ["gh"])).toBe(true);
    expect(canUseGithub(cfg, ["other"])).toBe(false);
    expect(canUseGithub(cfg, [])).toBe(false);
  });
});

describe("chooseGithubToken", () => {
  it("uses the shared token as fallback when there is no gate", () => {
    expect(
      chooseGithubToken({
        gateActive: false,
        memberAllowed: true,
        perUserToken: null,
        sharedToken: "shared",
      }),
    ).toBe("shared");
  });

  it("prefers the user's own token over the shared one", () => {
    expect(
      chooseGithubToken({
        gateActive: false,
        memberAllowed: true,
        perUserToken: "mine",
        sharedToken: "shared",
      }),
    ).toBe("mine");
  });

  it("never falls back to the shared token when a gate is active", () => {
    // Gated-in but not linked → no token at all (not the shared one).
    expect(
      chooseGithubToken({
        gateActive: true,
        memberAllowed: true,
        perUserToken: null,
        sharedToken: "shared",
      }),
    ).toBeUndefined();
    // Gated-in and linked → their own token.
    expect(
      chooseGithubToken({
        gateActive: true,
        memberAllowed: true,
        perUserToken: "mine",
        sharedToken: "shared",
      }),
    ).toBe("mine");
  });

  it("gives gated-out members no token", () => {
    expect(
      chooseGithubToken({
        gateActive: true,
        memberAllowed: false,
        perUserToken: "mine",
        sharedToken: "shared",
      }),
    ).toBeUndefined();
  });
});
