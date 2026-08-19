import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AnthropicProvider,
  ContextEchoProvider,
  GeminiProvider,
  LlmHttpError,
  MAX_PROVIDER_CALL_ATTEMPTS,
  OpenAiCompatibleProvider,
  completeStrict,
  completeWithFreeFallback,
  computeRetryDelayMs,
  createLlmProvider,
  detectReplyLocale,
  resetLlmDedupCache,
  resetModelCostTracker,
  setRetrySleepForTests,
  shouldRetry,
} from "./llm.js";

describe("detectReplyLocale", () => {
  it("detects Hebrew", () => {
    expect(detectReplyLocale("שלום עולם")).toBe("he");
  });
  it("detects Arabic", () => {
    expect(detectReplyLocale("مرحبا بالعالم")).toBe("ar");
  });
  it("defaults to English for Latin text", () => {
    expect(detectReplyLocale("hello world")).toBe("en");
  });
});

describe("createLlmProvider — free/offline selection (no network calls exercised)", () => {
  it("returns ContextEchoProvider for explicit LLM_PROVIDER=echo", () => {
    const provider = createLlmProvider({ LLM_PROVIDER: "echo" });
    expect(provider.name).toBe("context-echo-free");
  });

  it("returns ContextEchoProvider when no provider config is present at all", () => {
    const provider = createLlmProvider({});
    expect(provider.name).toBe("context-echo-free");
  });

  it("prefers an explicit ANTHROPIC_API_KEY provider over the free fallback", () => {
    const provider = createLlmProvider({
      LLM_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "sk-test",
    });
    expect(provider.name).not.toBe("context-echo-free");
  });

  it("falls back to echo when an explicit paid provider is selected without its API key", () => {
    const provider = createLlmProvider({ LLM_PROVIDER: "anthropic" });
    expect(provider.name).toBe("context-echo-free");
  });
});

describe("ContextEchoProvider", () => {
  it("replies in Hebrew when the user message is Hebrew", async () => {
    const provider = new ContextEchoProvider();
    const reply = await provider.complete([
      { role: "system", content: "ctx" },
      { role: "user", content: "מה המצב?" },
    ]);
    expect(reply.text).toContain("ArletOS");
  });

  it("never throws for an empty message list", async () => {
    const provider = new ContextEchoProvider();
    await expect(provider.complete([])).resolves.toBeTypeOf("object");
  });

  it("reports real (not synthetic) zero cost/usage — it never calls a billed API", async () => {
    const provider = new ContextEchoProvider();
    const reply = await provider.complete([{ role: "user", content: "hi" }]);
    expect(reply.usage).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costUsd: 0,
    });
  });
});

describe("real (non-synthetic) usage/cost parsed from provider responses", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("AnthropicProvider reads real input/output token counts from the response `usage` object and prices them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          content: [{ type: "text", text: "hello" }],
          usage: { input_tokens: 1000, output_tokens: 500 },
        }),
      }),
    );
    const provider = new AnthropicProvider("sk-test", "claude-sonnet-4-20250514");
    const reply = await provider.complete([{ role: "user", content: "hi" }]);
    expect(reply.text).toBe("hello");
    expect(reply.usage.promptTokens).toBe(1000);
    expect(reply.usage.completionTokens).toBe(500);
    expect(reply.usage.totalTokens).toBe(1500);
    // 1000/1e6 * $3 + 500/1e6 * $15 = 0.003 + 0.0075 = 0.0105
    expect(reply.usage.costUsd).toBeCloseTo(0.0105, 6);
  });

  it("OpenAiCompatibleProvider reads real prompt/completion token counts from the response `usage` object and prices them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: "hi there" } }],
          usage: { prompt_tokens: 2000, completion_tokens: 1000, total_tokens: 3000 },
        }),
      }),
    );
    const provider = new OpenAiCompatibleProvider(
      "sk-test",
      "gpt-4o-mini",
      "https://api.openai.com/v1",
      "openai",
    );
    const reply = await provider.complete([{ role: "user", content: "hi" }]);
    expect(reply.text).toBe("hi there");
    expect(reply.usage.promptTokens).toBe(2000);
    expect(reply.usage.completionTokens).toBe(1000);
    expect(reply.usage.totalTokens).toBe(3000);
    // 2000/1e6 * $0.15 + 1000/1e6 * $0.6 = 0.0003 + 0.0006 = 0.0009
    expect(reply.usage.costUsd).toBeCloseTo(0.0009, 6);
  });

  it("GeminiProvider reads real prompt/candidate token counts from `usageMetadata` and prices them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: "hi there" }] } }],
          usageMetadata: {
            promptTokenCount: 1000,
            candidatesTokenCount: 200,
            totalTokenCount: 1200,
          },
        }),
      }),
    );
    const provider = new GeminiProvider("key-test", "gemini-2.0-flash");
    const reply = await provider.complete([{ role: "user", content: "hi" }]);
    expect(reply.text).toBe("hi there");
    expect(reply.usage.promptTokens).toBe(1000);
    expect(reply.usage.completionTokens).toBe(200);
    expect(reply.usage.totalTokens).toBe(1200);
    // 1000/1e6 * $0.1 + 200/1e6 * $0.4 = 0.0001 + 0.00008 = 0.00018
    expect(reply.usage.costUsd).toBeCloseTo(0.00018, 6);
  });

  it("falls back to 0 cost/usage (not a guess) when a provider response omits `usage`", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "hi" } }] }),
      }),
    );
    const provider = new OpenAiCompatibleProvider(
      undefined,
      "llama3.2",
      "http://127.0.0.1:11434/v1",
      "llama-ollama-local",
    );
    const reply = await provider.complete([{ role: "user", content: "hi" }]);
    expect(reply.usage).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costUsd: 0,
    });
  });
});

describe("completeStrict — short-TTL call dedup cache", () => {
  const env = {
    LLM_PROVIDER: "anthropic",
    ANTHROPIC_API_KEY: "sk-test",
    ANTHROPIC_MODEL: "claude-sonnet-4-20250514",
  };
  const messages = [{ role: "user" as const, content: "what is the deploy status?" }];

  function stubFetchOnce() {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: "text", text: "all green" }],
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  beforeEach(() => {
    resetLlmDedupCache();
    resetModelCostTracker();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("returns the cached result for an identical call within the TTL window and does NOT re-invoke the provider", async () => {
    const fetchMock = stubFetchOnce();

    const first = await completeStrict(env, messages);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.cacheHit).toBe(false);
    expect(first.text).toBe("all green");

    const second = await completeStrict(env, messages);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no new provider call
    expect(second.cacheHit).toBe(true);
    expect(second.text).toBe("all green");
    expect(second.usage).toEqual(first.usage);
  });

  it("does NOT dedup calls with different messages (different cache key)", async () => {
    const fetchMock = stubFetchOnce();

    await completeStrict(env, messages);
    await completeStrict(env, [{ role: "user", content: "what is the incident status?" }]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT dedup calls to a different model (different cache key)", async () => {
    const fetchMock = stubFetchOnce();

    await completeStrict(env, messages);
    await completeStrict({ ...env, ANTHROPIC_MODEL: "claude-opus-4-20250514" }, messages);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT dedup an identical call made outside the TTL window", async () => {
    vi.useFakeTimers();
    const fetchMock = stubFetchOnce();

    await completeStrict(env, messages);
    vi.advanceTimersByTime(46_000); // > 45s TTL
    await completeStrict(env, messages);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("records a fresh (non-cache-hit) call into the rolling cost tracker, and does not double-record a cache hit", async () => {
    stubFetchOnce();
    const { getModelRollingStats } = await import("./llm.js");

    await completeStrict(env, messages);
    await completeStrict(env, messages); // cache hit — must not add a second sample

    const stats = getModelRollingStats("claude-sonnet-4-20250514");
    expect(stats?.sampleSize).toBe(1);
  });
});

describe("shouldRetry — retry policy", () => {
  it("retries a network-level failure (no HTTP status) while attempts remain", () => {
    const err = new TypeError("fetch failed");
    expect(shouldRetry(err, 1)).toBe(true);
    expect(shouldRetry(err, 2)).toBe(true);
  });

  it("stops retrying once MAX_PROVIDER_CALL_ATTEMPTS has been reached, even for a transient error", () => {
    const err = new TypeError("fetch failed");
    expect(shouldRetry(err, MAX_PROVIDER_CALL_ATTEMPTS)).toBe(false);
    expect(shouldRetry(err, MAX_PROVIDER_CALL_ATTEMPTS + 1)).toBe(false);
  });

  it("retries a 5xx LlmHttpError (server-side, transient)", () => {
    expect(shouldRetry(new LlmHttpError(500, "boom"), 1)).toBe(true);
    expect(shouldRetry(new LlmHttpError(503, "boom"), 1)).toBe(true);
  });

  it("retries a 429 rate-limit LlmHttpError (transient)", () => {
    expect(shouldRetry(new LlmHttpError(429, "rate limited"), 1)).toBe(true);
  });

  it("does NOT retry a 4xx LlmHttpError other than 429 — the request itself is bad, retrying won't help", () => {
    expect(shouldRetry(new LlmHttpError(400, "bad request"), 1)).toBe(false);
    expect(shouldRetry(new LlmHttpError(401, "unauthorized"), 1)).toBe(false);
    expect(shouldRetry(new LlmHttpError(404, "not found"), 1)).toBe(false);
  });
});

describe("computeRetryDelayMs — bounded exponential backoff", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("grows with the attempt number but stays capped at a bounded ceiling", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const d1 = computeRetryDelayMs(1);
    const d2 = computeRetryDelayMs(2);
    const d3 = computeRetryDelayMs(3);
    expect(d1).toBeGreaterThan(0);
    expect(d2).toBeGreaterThanOrEqual(d1);
    expect(d3).toBeGreaterThanOrEqual(d2);
    expect(d3).toBeLessThanOrEqual(1_000);
  });

  it("never exceeds the cap even at maximum jitter or a large attempt number", () => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    for (const attempt of [1, 2, 3, 10]) {
      expect(computeRetryDelayMs(attempt)).toBeLessThanOrEqual(1_000);
    }
  });
});

describe("runProviderCall retry-with-backoff (exercised via completeStrict / completeWithFreeFallback)", () => {
  const env = {
    LLM_PROVIDER: "anthropic",
    ANTHROPIC_API_KEY: "sk-test",
    ANTHROPIC_MODEL: "claude-sonnet-4-20250514",
  };
  const messages = [{ role: "user" as const, content: "what is the deploy status?" }];

  const okResponse = (text: string) => ({
    ok: true,
    status: 200,
    json: async () => ({
      content: [{ type: "text", text }],
      usage: { input_tokens: 10, output_tokens: 5 },
    }),
  });
  const httpErrorResponse = (status: number) => ({
    ok: false,
    status,
    json: async () => ({}),
  });

  beforeEach(() => {
    resetLlmDedupCache();
    resetModelCostTracker();
    // Don't actually wait out the backoff delay in tests.
    setRetrySleepForTests(async () => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setRetrySleepForTests(undefined);
  });

  it("retries a transient network failure and succeeds on a later attempt", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(okResponse("all green"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await completeStrict(env, messages);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.text).toBe("all green");
    expect(result.cacheHit).toBe(false);
  });

  it("retries a transient 5xx-style HTTP failure and succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(httpErrorResponse(503))
      .mockResolvedValueOnce(okResponse("recovered"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await completeStrict(env, messages);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.text).toBe("recovered");
  });

  it("does NOT retry a 4xx-style client error — fails on the very first attempt", async () => {
    const fetchMock = vi.fn().mockResolvedValue(httpErrorResponse(401));
    vi.stubGlobal("fetch", fetchMock);

    await expect(completeStrict(env, messages)).rejects.toThrow("Anthropic failed: 401");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry a clean empty response — it's a legitimate provider signal, not a transport failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ content: [], usage: { input_tokens: 5, output_tokens: 0 } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(completeStrict(env, messages)).rejects.toThrow("returned an empty response");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("exhausts all retries (MAX_PROVIDER_CALL_ATTEMPTS) and surfaces the final error to completeStrict", async () => {
    const fetchMock = vi.fn().mockResolvedValue(httpErrorResponse(500));
    vi.stubGlobal("fetch", fetchMock);

    await expect(completeStrict(env, messages)).rejects.toThrow("Anthropic failed: 500");
    expect(fetchMock).toHaveBeenCalledTimes(MAX_PROVIDER_CALL_ATTEMPTS);
  });

  it("exhausts all retries and completeWithFreeFallback falls through to the free echo provider", async () => {
    const fetchMock = vi.fn().mockResolvedValue(httpErrorResponse(500));
    vi.stubGlobal("fetch", fetchMock);

    const result = await completeWithFreeFallback(env, messages);

    expect(fetchMock).toHaveBeenCalledTimes(MAX_PROVIDER_CALL_ATTEMPTS);
    expect(result.provider).toBe("context-echo-free");
    expect(result.text.length).toBeGreaterThan(0);
  });

  it("a retried-then-successful call still dedups on a repeat and records exactly one rolling-cost sample", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(okResponse("all green"));
    vi.stubGlobal("fetch", fetchMock);
    const { getModelRollingStats } = await import("./llm.js");

    const first = await completeStrict(env, messages);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const second = await completeStrict(env, messages); // identical call — should hit dedup cache
    expect(fetchMock).toHaveBeenCalledTimes(2); // no additional provider calls
    expect(second.cacheHit).toBe(true);
    expect(second.text).toBe(first.text);

    const stats = getModelRollingStats("claude-sonnet-4-20250514");
    // One rolling-tracker sample for the whole retried call, not one per attempt.
    expect(stats?.sampleSize).toBe(1);
  });
});
