export interface ModelChoice {
  id: string;
  label: string;
  description: string;
}

/**
 * Last-resort list, used only when the live query to Anthropic can't run (no
 * linked token) or fails. Kept current, but the whole point of this module is
 * that `getModelChoices` normally returns whatever Anthropic is serving *right
 * now* — see fetchAnthropicModels.
 */
export const FALLBACK_MODEL_CHOICES: ModelChoice[] = [
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

const ANTHROPIC_API_BASE = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";
// Claude Code OAuth tokens (see claude/identity-store.ts) authenticate via
// `Authorization: Bearer` plus this beta header — NOT the `x-api-key` header an
// API key would use. Without the header the token is rejected.
const OAUTH_BETA = "oauth-2025-04-20";

/** How long a successful live list is trusted before we re-query Anthropic. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/** Cap the network wait so an `/model` autocomplete never blows its deadline. */
const DEFAULT_TIMEOUT_MS = 2000;

/** Shape of the `/v1/models` list items we actually read. */
interface AnthropicModel {
  id: string;
  display_name?: string;
  max_input_tokens?: number;
}

interface AnthropicModelsPage {
  data?: AnthropicModel[];
  has_more?: boolean;
  last_id?: string | null;
}

interface ModelCache {
  choices: ModelChoice[];
  fetchedAt: number;
}

let cache: ModelCache | null = null;
// Collapses concurrent refreshes (e.g. an admin hammering autocomplete) into a
// single in-flight request.
let inFlight: Promise<ModelChoice[]> | null = null;

export interface GetModelChoicesOptions {
  now?: () => number;
  timeoutMs?: number;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * The models Anthropic is currently offering, newest first, mapped to the
 * shape `/model` and the dashboard consume. Served from a short-lived cache;
 * on a cold cache it queries Anthropic with the given OAuth token. Any failure
 * (no token, network error, timeout, auth rejection) degrades to the most
 * recent good list, or FALLBACK_MODEL_CHOICES — it never throws.
 */
export async function getModelChoices(
  token: string | null,
  opts: GetModelChoicesOptions = {},
): Promise<ModelChoice[]> {
  const now = opts.now ?? Date.now;
  if (cache && now() - cache.fetchedAt < CACHE_TTL_MS) return cache.choices;
  if (!token) return cache?.choices ?? FALLBACK_MODEL_CHOICES;

  if (!inFlight) {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const fetchImpl = opts.fetchImpl ?? fetch;
    inFlight = fetchAnthropicModels(token, fetchImpl, timeoutMs)
      .then((choices) => {
        if (choices.length > 0) cache = { choices, fetchedAt: now() };
        return cache?.choices ?? FALLBACK_MODEL_CHOICES;
      })
      .catch(() => cache?.choices ?? FALLBACK_MODEL_CHOICES)
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

export function findModelChoice(choices: ModelChoice[], id: string): ModelChoice | undefined {
  return choices.find((m) => m.id === id);
}

/** Test-only: drop the cached list so each case starts cold. */
export function resetModelCache(): void {
  cache = null;
  inFlight = null;
}

async function fetchAnthropicModels(
  token: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<ModelChoice[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const choices: ModelChoice[] = [];
    let afterId: string | undefined;
    // The list is small; the page/count guards are just belt-and-suspenders
    // against a pagination bug turning into an unbounded loop.
    for (let page = 0; page < 20 && choices.length < 500; page++) {
      const url = new URL("/v1/models", ANTHROPIC_API_BASE);
      url.searchParams.set("limit", "100");
      if (afterId) url.searchParams.set("after_id", afterId);

      const res = await fetchImpl(url, {
        headers: {
          authorization: `Bearer ${token}`,
          "anthropic-version": ANTHROPIC_VERSION,
          "anthropic-beta": OAUTH_BETA,
        },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Anthropic models list returned ${res.status}`);

      const body = (await res.json()) as AnthropicModelsPage;
      for (const model of body.data ?? []) choices.push(toModelChoice(model));
      if (!body.has_more || !body.last_id) break;
      afterId = body.last_id;
    }
    return choices;
  } finally {
    clearTimeout(timer);
  }
}

function toModelChoice(model: AnthropicModel): ModelChoice {
  const label = model.display_name?.trim() || model.id;
  const description =
    typeof model.max_input_tokens === "number" && model.max_input_tokens > 0
      ? `${Math.round(model.max_input_tokens / 1000)}K context`
      : "Anthropic model";
  return { id: model.id, label, description };
}
