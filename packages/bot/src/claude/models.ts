export interface ModelChoice {
  id: string;
  label: string;
  description: string;
}

/**
 * Models offered in /model and the dashboard. IDs are Anthropic model IDs;
 * the Agent SDK passes them straight through to Claude Code.
 */
export const MODEL_CHOICES: ModelChoice[] = [
  {
    id: "claude-sonnet-5",
    label: "Sonnet 5",
    description: "Fast and smart — the recommended default",
  },
  {
    id: "claude-opus-4-8",
    label: "Opus 4.8",
    description: "Most capable, burns subscription limits faster",
  },
  {
    id: "claude-haiku-4-5-20251001",
    label: "Haiku 4.5",
    description: "Fastest and lightest, for simple questions",
  },
];

export function isKnownModel(id: string): boolean {
  return MODEL_CHOICES.some((m) => m.id === id);
}
