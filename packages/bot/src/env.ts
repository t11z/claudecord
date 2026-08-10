import { z } from "zod";

const envSchema = z.object({
  DISCORD_BOT_TOKEN: z.string().min(1).optional(),
  DISCORD_APPLICATION_ID: z.string().min(1).optional(),
  /**
   * GitHub App credentials for per-user OAuth Device Flow linking. When set,
   * role-gated Discord users can `/link-github` their own account and agentic
   * runs act in their namespace. Env values take precedence over secrets.json.
   */
  GITHUB_APP_CLIENT_ID: z.string().min(1).optional(),
  GITHUB_APP_CLIENT_SECRET: z.string().min(1).optional(),
  /**
   * Client secret of the same Discord application as the bot, enabling
   * "Sign in with Discord" on the dashboard. Without it that button is not
   * offered and `/dashboard` remains the only way in. Env wins over
   * secrets.json, same as the GitHub App pair.
   */
  DISCORD_CLIENT_SECRET: z.string().min(1).optional(),
  DASHBOARD_HOST: z.string().default("127.0.0.1"),
  DASHBOARD_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /**
   * Base URL the bot uses to build magic-sign-in links (see
   * `/dashboard` and `web/magic-link.ts`). Must be reachable by whoever runs
   * `/dashboard` — defaults to localhost, which is only correct for a
   * single-machine setup; set it explicitly for anything else.
   */
  DASHBOARD_PUBLIC_URL: z.string().url().optional(),
  /**
   * Comma-separated Discord user IDs that are always dashboard admins,
   * regardless of what's stored in `dashboard_users`. The recommended way to
   * grant admin on anything beyond a personal server — see
   * `web/routes/auth.ts` for the alternative (claim-on-first-login).
   */
  DASHBOARD_ADMIN_IDS: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean)
        : [],
    ),
  /**
   * Baked into the image at build time from the GitHub Release tag (see the
   * Dockerfile's APP_VERSION build arg). Keeps the reported version in sync
   * with the published container instead of the static package.json 0.1.0.
   */
  APP_VERSION: z.string().min(1).optional(),
  CLAUDE_MODEL: z.string().default("claude-sonnet-5"),
  DATA_DIR: z.string().default("./data"),
  MAX_CONCURRENT_RUNS: z.coerce.number().int().min(1).max(32).default(4),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
