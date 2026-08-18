import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AnthropicProvider,
  ContextEchoProvider,
  GeminiProvider,
  OpenAiCompatibleProvider,
  createLlmProvider,
  detectReplyLocale,
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
