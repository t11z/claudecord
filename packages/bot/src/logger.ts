import pino from "pino";

export type Logger = pino.Logger;

export function createLogger(level: string): Logger {
  const pretty = process.stdout.isTTY && process.env.NODE_ENV !== "production";
  return pino({
    level,
    ...(pretty ? { transport: { target: "pino-pretty", options: { colorize: true } } } : {}),
    redact: {
      paths: [
        "CLAUDE_CODE_OAUTH_TOKEN",
        "ANTHROPIC_API_KEY",
        "DISCORD_BOT_TOKEN",
        "GITHUB_TOKEN",
        "GH_TOKEN",
        "GITHUB_APP_CLIENT_SECRET",
        "accessToken",
        "refreshToken",
      ],
      censor: "[redacted]",
    },
  });
}
