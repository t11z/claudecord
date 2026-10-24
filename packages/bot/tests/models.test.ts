import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FALLBACK_MODEL_CHOICES,
  findModelChoice,
  getModelChoices,
  resetModelCache,
} from "../src/claude/models.js";

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: "",
    json: async () => body,
  } as unknown as Response;
}

/** A fetch that serves one page per call, in order. */
function pagedFetch(pages: unknown[]): typeof fetch {
  let i = 0;
  return vi.fn(async () =>
    jsonResponse(pages[Math.min(i++, pages.length - 1)]),
  ) as unknown as typeof fetch;
}

beforeEach(() => {
  resetModelCache();
});

describe("getModelChoices", () => {
  it("maps the live /v1/models list to choices", async () => {
    const fetchImpl = pagedFetch([
      {
        data: [
          { id: "claude-opus-4-8", display_name: "Claude Opus 4.8", max_input_tokens: 1_000_000 },
          { id: "claude-haiku-4-5", display_name: "Claude Haiku 4.5", max_input_tokens: 200_000 },
        ],
        has_more: false,
      },
    ]);

    const choices = await getModelChoices("tok", { fetchImpl });

    expect(choices).toEqual([
      { id: "claude-opus-4-8", label: "Claude Opus 4.8", description: "1000K context" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", description: "200K context" },
    ]);
  });

  it("falls back to the id and a generic description when fields are missing", async () => {
    const fetchImpl = pagedFetch([{ data: [{ id: "claude-mystery" }], has_more: false }]);
    const [choice] = await getModelChoices("tok", { fetchImpl });
    expect(choice).toEqual({
      id: "claude-mystery",
      label: "claude-mystery",
      description: "Anthropic model",
    });
  });

  it("authenticates the OAuth token with Bearer + the oauth beta header", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: [{ id: "m", display_name: "M" }], has_more: false }),
    ) as unknown as typeof fetch;

    await getModelChoices("sk-ant-oat01-xyz", { fetchImpl });

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String(url)).toContain("/v1/models");
    expect(String(url)).toContain("limit=100");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-ant-oat01-xyz");
    expect(headers["anthropic-beta"]).toBe("oauth-2025-04-20");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("follows pagination via has_more / last_id", async () => {
    const fetchImpl = pagedFetch([
      { data: [{ id: "a", display_name: "A" }], has_more: true, last_id: "a" },
      { data: [{ id: "b", display_name: "B" }], has_more: false },
    ]);

    const choices = await getModelChoices("tok", { fetchImpl });

    expect(choices.map((c) => c.id)).toEqual(["a", "b"]);
    const mock = fetchImpl as unknown as ReturnType<typeof vi.fn>;
    expect(mock).toHaveBeenCalledTimes(2);
    expect(String(mock.mock.calls[1]![0])).toContain("after_id=a");
  });

  it("serves from cache within the TTL, then refetches after it expires", async () => {
    const fetchImpl = pagedFetch([
      { data: [{ id: "a", display_name: "A" }], has_more: false },
      { data: [{ id: "b", display_name: "B" }], has_more: false },
    ]);
    const mock = fetchImpl as unknown as ReturnType<typeof vi.fn>;
    let now = 1_000;

    const first = await getModelChoices("tok", { fetchImpl, now: () => now });
    expect(first.map((c) => c.id)).toEqual(["a"]);

    now += 60 * 60 * 1000; // +1h, still inside the 6h TTL
    const cached = await getModelChoices("tok", { fetchImpl, now: () => now });
    expect(cached.map((c) => c.id)).toEqual(["a"]);
    expect(mock).toHaveBeenCalledTimes(1);

    now += 6 * 60 * 60 * 1000; // past the TTL
    const refreshed = await getModelChoices("tok", { fetchImpl, now: () => now });
    expect(refreshed.map((c) => c.id)).toEqual(["b"]);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("returns the fallback list without a token and never fetches", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const choices = await getModelChoices(null, { fetchImpl });
    expect(choices).toBe(FALLBACK_MODEL_CHOICES);
    expect(fetchImpl as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("returns the fallback list when Anthropic rejects the request", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: "unauthorized" }, { ok: false, status: 401 }),
    ) as unknown as typeof fetch;
    const choices = await getModelChoices("bad-token", { fetchImpl });
    expect(choices).toBe(FALLBACK_MODEL_CHOICES);
  });

  it("returns the fallback list when the request times out", async () => {
    const fetchImpl = vi.fn(
      (_input: Parameters<typeof fetch>[0], init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    ) as unknown as typeof fetch;

    const choices = await getModelChoices("tok", { fetchImpl, timeoutMs: 10 });
    expect(choices).toBe(FALLBACK_MODEL_CHOICES);
  });

  it("collapses concurrent cold refreshes into one request", async () => {
    const fetchImpl = pagedFetch([{ data: [{ id: "a", display_name: "A" }], has_more: false }]);
    const [first, second] = await Promise.all([
      getModelChoices("tok", { fetchImpl }),
      getModelChoices("tok", { fetchImpl }),
    ]);
    expect(first).toBe(second);
    expect(fetchImpl as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
  });
});

describe("findModelChoice", () => {
  it("finds by id and returns undefined otherwise", () => {
    expect(findModelChoice(FALLBACK_MODEL_CHOICES, "claude-opus-4-8")?.label).toBe("Opus 4.8");
    expect(findModelChoice(FALLBACK_MODEL_CHOICES, "nope")).toBeUndefined();
  });
});
