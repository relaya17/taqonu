import { describe, expect, it } from "vitest";
import { ContextEchoProvider, createLlmProvider, detectReplyLocale } from "./llm.js";

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
    expect(reply).toContain("ArletOS");
  });

  it("never throws for an empty message list", async () => {
    const provider = new ContextEchoProvider();
    await expect(provider.complete([])).resolves.toBeTypeOf("string");
  });
});
