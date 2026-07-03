import { z } from "zod";

const envSchema = z.object({
  CLAUDE_CODE_OAUTH_TOKEN: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  DISCORD_BOT_TOKEN: z.string().min(1).optional(),
  DISCORD_APPLICATION_ID: z.string().min(1).optional(),
  /**
   * GitHub token for `git`/`gh` inside agentic runs. GH_TOKEN is accepted as
   * an alias so an existing gh setup works unchanged; GITHUB_TOKEN wins.
   */
  GITHUB_TOKEN: z.string().min(1).optional(),
  GH_TOKEN: z.string().min(1).optional(),
  /**
   * GitHub App credentials for per-user OAuth Device Flow linking. When set,
   * role-gated Discord users can `/link-github` their own account and agentic
   * runs act in their namespace. Env values take precedence over secrets.json.
   */
  GITHUB_APP_CLIENT_ID: z.string().min(1).optional(),
  GITHUB_APP_CLIENT_SECRET: z.string().min(1).optional(),
  DASHBOARD_HOST: z.string().default("127.0.0.1"),
  DASHBOARD_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DASHBOARD_PASSWORD: z.string().min(8).optional(),
  /**
   * Allows a non-localhost bind without a password. Only safe when the port
   * is not actually reachable from outside — e.g. inside Docker with the
   * container port mapped to the host's loopback interface, as the shipped
   * docker-compose.yml does.
   */
  DASHBOARD_INSECURE_BIND: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),
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

const LOCALHOST_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export function isLocalhost(host: string): boolean {
  return LOCALHOST_HOSTS.has(host);
}
