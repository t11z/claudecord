/**
 * "Sign in with Discord" — the second door into the dashboard, for anyone who
 * hasn't got a Discord client at hand to run `/dashboard`.
 *
 * Uses the *same* Discord application as the bot: `DISCORD_APPLICATION_ID` is
 * already the OAuth2 `client_id`. Only the application's client secret is extra,
 * and a bot token cannot stand in for it — different credential class.
 *
 * Scope is `identify` alone. That is deliberate and sufficient: the guild and
 * permission questions are answered server-side from the bot's own connection
 * (see `resolveLogin`), which is stronger evidence than anything the user's
 * token could report, and it keeps the consent screen minimal.
 */

import { PermissionFlagsBits } from "discord.js";
import type { AppContext } from "../context.js";
import { mayUseBot } from "../discord/access-control.js";

const AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
const TOKEN_URL = "https://discord.com/api/oauth2/token";
const USER_URL = "https://discord.com/api/users/@me";

/** The `state` payload: nothing about the user, who is unknown at mint time. */
export interface OAuthState {
  /** Purpose tag, so a state token can never be mistaken for a magic link. */
  kind: "discord-oauth";
}

export interface DiscordProfile {
  id: string;
  username: string;
  globalName: string | null;
  avatarUrl: string | null;
}

/** Where Discord sends the user back. Must match the Developer Portal exactly. */
export function redirectUri(publicUrl: string): string {
  return `${publicUrl}/api/auth/discord/callback`;
}

export function authorizeUrl(clientId: string, publicUrl: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    scope: "identify",
    redirect_uri: redirectUri(publicUrl),
    state,
    // No `prompt`: Discord skips the consent screen for a grant the user has
    // already given, so a returning user is one click. Switching accounts is
    // still possible from Discord's own UI.
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export class DiscordOAuthError extends Error {}

/** Exchanges the one-time code for an access token. Never logs the response. */
export async function exchangeCode(
  clientId: string,
  clientSecret: string,
  code: string,
  publicUrl: string,
): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(publicUrl),
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!res.ok || !data.access_token) {
    // `error` is Discord's machine code (e.g. invalid_grant); safe to surface.
    throw new DiscordOAuthError(data.error ?? `Discord returned HTTP ${res.status}`);
  }
  return data.access_token;
}

/** Identifies the user behind the access token. */
export async function fetchProfile(accessToken: string): Promise<DiscordProfile> {
  const res = await fetch(USER_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new DiscordOAuthError(`Couldn't read your Discord profile (${res.status}).`);
  const u = (await res.json()) as {
    id: string;
    username: string;
    global_name?: string | null;
    avatar?: string | null;
  };
  return {
    id: u.id,
    username: u.username,
    globalName: u.global_name ?? null,
    // /users/@me returns an avatar *hash*; the rest of the app stores a CDN URL
    // (discord.js's avatarURL() shape), so build the same thing here.
    avatarUrl: u.avatar
      ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64`
      : null,
  };
}

export type LoginDecision =
  | { ok: true; hasManageGuild: boolean }
  | { ok: false; status: 403 | 503; message: string };

/**
 * Decides whether this Discord user may sign in, and whether they hold Manage
 * Guild — both answered from the bot's own connection, never from anything the
 * user or their token claims.
 *
 * Two separate questions, deliberately kept apart:
 *   access      — does any mutual guild's role allowlist admit them?
 *   ManageGuild — do they hold it in a guild that also admits them?
 *
 * The intersection matters. `decideIsAdmin`'s bootstrap turns `hasManageGuild`
 * into an instance-wide admin on a fresh install, so counting a guild the user
 * isn't even allowed to use the bot in would make this door strictly wider than
 * `/dashboard`, which only ever looked at the one guild it was typed in.
 */
export async function resolveLogin(ctx: AppContext, userId: string): Promise<LoginDecision> {
  if (!ctx.discord) {
    return {
      ok: false,
      status: 503,
      message: "The bot isn't connected to Discord right now. Try again in a moment.",
    };
  }

  let admitted = false;
  let hasManageGuild = false;
  for (const guild of ctx.discord.guilds.cache.values()) {
    try {
      const member = await guild.members.fetch(userId);
      const config = ctx.repos.guildConfig.get(guild.id);
      if (!mayUseBot(config, [...member.roles.cache.keys()])) continue;
      admitted = true;
      if (member.permissions.has(PermissionFlagsBits.ManageGuild)) hasManageGuild = true;
    } catch {
      // Not a member, or Discord didn't answer — this guild simply doesn't
      // count. Failing closed per guild, never 500 for the whole login.
    }
  }

  if (!admitted) {
    return {
      ok: false,
      status: 403,
      message:
        "No server you share with the bot allows you to use it. Ask an admin to grant your role access, then try again.",
    };
  }
  return { ok: true, hasManageGuild };
}
