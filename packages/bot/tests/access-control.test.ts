import { describe, expect, it } from "vitest";
import type { GuildConfig } from "../src/db/repos/guild-config.js";
import { isAllowed } from "../src/discord/access-control.js";

function config(overrides: Partial<GuildConfig> = {}): GuildConfig {
  return {
    guildId: "g1",
    enabled: true,
    allowedChannelIds: [],
    allowedRoleIds: [],
    agenticEnabled: false,
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
