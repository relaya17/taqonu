export interface LlmMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

/**
 * Real (not synthetic) token/cost accounting for a single `complete()` call.
 * `promptTokens`/`completionTokens` are read directly from the provider's own
 * `usage` (Anthropic/OpenAI-compatible) or `usageMetadata` (Gemini) response
 * field when the provider returns one. `costUsd` is then derived from those
 * real counts via `MODEL_PRICING_USD_PER_1M_TOKENS` below. When a provider
 * genuinely has no cost (ContextEchoProvider — free, offline, no API call) or
 * the model isn't in the pricing table, every field here is legitimately 0 —
 * that is an honest zero, not a placeholder.
 */
export interface LlmUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly costUsd: number;
}

export interface LlmCompletion {
  readonly text: string;
  readonly usage: LlmUsage;
}

export interface LlmProvider {
  readonly name: string;
  /**
   * The concrete model id this provider instance talks to (e.g.
   * `"claude-sonnet-4-20250514"`). Optional because a hand-written provider
   * implementing this interface elsewhere isn't required to have one, but
   * every provider defined in this file sets it — it's what the dedup cache
   * key and the rolling cost tracker (below) key their data on.
   */
  readonly model?: string;
  complete(messages: readonly LlmMessage[]): Promise<LlmCompletion>;
}

const ZERO_USAGE: LlmUsage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  costUsd: 0,
};

/**
 * Manually-maintained pricing snapshot (USD per 1,000,000 tokens), keyed by
 * the exact model id this codebase passes to each provider's API. Vendors
 * change published pricing without notice — this table is NOT fetched live
 * and WILL drift; re-check it against vendor pricing pages periodically:
 *   - Anthropic: https://www.anthropic.com/pricing
 *   - OpenAI:    https://openai.com/api/pricing/
 *   - Google:    https://ai.google.dev/gemini-api/docs/pricing
 *   - Groq:      https://groq.com/pricing/
 *   - DeepSeek:  https://api-docs.deepseek.com/quick_start/pricing
 * Snapshot taken: 2026-08-18. A model id not present here yields costUsd=0
 * rather than an invented/guessed rate — an honest "unknown" beats a fake
 * number. Locally-hosted models (e.g. Ollama) are intentionally absent: they
 * have no metered API cost, so $0 is the correct, real value for them too.
 */
export const MODEL_PRICING_USD_PER_1M_TOKENS: Readonly<
  Record<string, { readonly input: number; readonly output: number }>
> = {
  // Anthropic
  "claude-sonnet-4-20250514": { input: 3, output: 15 },
  "claude-opus-4-20250514": { input: 15, output: 75 },
  "claude-3-5-haiku-20241022": { input: 0.8, output: 4 },
  // OpenAI
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10 },
  // Google Gemini
  "gemini-2.0-flash": { input: 0.1, output: 0.4 },
  "gemini-1.5-pro": { input: 1.25, output: 5 },
  // Groq-hosted OSS models
  "llama-3.1-8b-instant": { input: 0.05, output: 0.08 },
  // DeepSeek
  "deepseek-chat": { input: 0.27, output: 1.1 },
};

/** Real cost from real token counts — 0 (not a guess) when the model is unpriced. */
function computeCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const rate = MODEL_PRICING_USD_PER_1M_TOKENS[model];
  if (!rate) return 0;
  const cost =
    (promptTokens / 1_000_000) * rate.input +
    (completionTokens / 1_000_000) * rate.output;
  return Number(cost.toFixed(6));
}

/**
 * ---------------------------------------------------------------------
 * Rolling per-model cost/latency/error tracker.
 * ---------------------------------------------------------------------
 * A single, real, completed provider call (fresh — never a dedup cache
 * hit; see the dedup cache below) is recorded here via `recordModelCall`.
 * The call site is `runProviderCall` further down, the one place both
 * `completeWithFreeFallback` and `completeStrict` funnel through.
 *
 * Window strategy: a fixed-size ring buffer of the last
 * `ROLLING_WINDOW_SIZE` calls *per model id*, no time decay. This is a
 * deliberate simplicity tradeoff over a time-decayed EMA: it's
 * trivially testable (record N synthetic calls, assert the average),
 * self-bounds memory per model, and "the last 20 calls" is close enough
 * to "recent behavior" for a routing *hint* — this is not a billing
 * system, it's a nudge for `router/genius.ts`.
 */
export interface ModelCallRecord {
  readonly model: string;
  readonly costUsd: number;
  readonly latencyMs: number;
  readonly ok: boolean;
  readonly at: number;
}

export interface ModelRollingStats {
  readonly model: string;
  readonly avgCostUsd: number;
  readonly avgLatencyMs: number;
  readonly errorRate: number;
  readonly sampleSize: number;
}

const ROLLING_WINDOW_SIZE = 20;
const modelCallHistory = new Map<string, ModelCallRecord[]>();

/** Record one real, completed provider call. Never call this for a dedup cache hit. */
export function recordModelCall(record: ModelCallRecord): void {
  const history = modelCallHistory.get(record.model) ?? [];
  history.push(record);
  if (history.length > ROLLING_WINDOW_SIZE) {
    history.shift();
  }
  modelCallHistory.set(record.model, history);
}

/** Rolling stats for one model, or undefined if no calls have been recorded yet. */
export function getModelRollingStats(model: string): ModelRollingStats | undefined {
  const history = modelCallHistory.get(model);
  if (!history || history.length === 0) return undefined;
  const sampleSize = history.length;
  const avgCostUsd = history.reduce((sum, r) => sum + r.costUsd, 0) / sampleSize;
  const avgLatencyMs = history.reduce((sum, r) => sum + r.latencyMs, 0) / sampleSize;
  const errorRate = history.filter((r) => !r.ok).length / sampleSize;
  return { model, avgCostUsd, avgLatencyMs, errorRate, sampleSize };
}

/** Rolling stats for every model that has recorded at least one call. */
export function getAllModelRollingStats(): readonly ModelRollingStats[] {
  return [...modelCallHistory.keys()]
    .map((model) => getModelRollingStats(model))
    .filter((s): s is ModelRollingStats => s !== undefined);
}

/** Test-only: clear the rolling tracker so tests don't leak state into each other. */
export function resetModelCostTracker(): void {
  modelCallHistory.clear();
}

/**
 * ---------------------------------------------------------------------
 * Short-TTL call dedup cache.
 * ---------------------------------------------------------------------
 * Keyed on `(provider name, model, normalized messages)`. None of the
 * providers in this file expose a caller-configurable temperature or
 * other sampling param today (each hardcodes `temperature: 0.2`), so
 * there's nothing else that affects determinism to fold into the key
 * right now — if a param like that is ever threaded through, it must be
 * added to `buildDedupCacheKey` too.
 *
 * TTL: 45s. Long enough to absorb the duplicate-call cases this exists
 * for — a UI double-submit, an automation retry after a transient
 * network blip, a webhook firing twice — without silently serving a
 * stale answer to a user who deliberately asks a near-identical
 * follow-up half a minute later expecting fresh output.
 *
 * Every provider's `complete()` here is a plain request/response call
 * (fetch a JSON completion) with no streaming and no external side
 * effect beyond the metered API call itself, so dedup is safe to apply
 * uniformly through `runProviderCall`. If a streaming or
 * intentionally-non-idempotent provider is ever added, route it around
 * `runProviderCall` instead of through it.
 */
const DEDUP_TTL_MS = 45_000;
const MAX_DEDUP_CACHE_ENTRIES = 200;

export interface LlmCallResult {
  readonly provider: string;
  readonly text: string;
  readonly usage: LlmUsage;
  /** True when this result was served from the dedup cache instead of calling the provider. */
  readonly cacheHit: boolean;
}

interface DedupCacheEntry {
  readonly result: Omit<LlmCallResult, "cacheHit">;
  readonly expiresAt: number;
}

const dedupCache = new Map<string, DedupCacheEntry>();

function normalizeMessagesForCacheKey(messages: readonly LlmMessage[]): string {
  return messages.map((m) => `${m.role}:${m.content.trim()}`).join("␟");
}

function buildDedupCacheKey(provider: LlmProvider, messages: readonly LlmMessage[]): string {
  return [provider.name, provider.model ?? "", normalizeMessagesForCacheKey(messages)].join(
    "␞",
  );
}

function getDedupCached(key: string): Omit<LlmCallResult, "cacheHit"> | undefined {
  const entry = dedupCache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    dedupCache.delete(key);
    return undefined;
  }
  return entry.result;
}

function setDedupCached(key: string, result: Omit<LlmCallResult, "cacheHit">): void {
  if (dedupCache.size >= MAX_DEDUP_CACHE_ENTRIES && !dedupCache.has(key)) {
    const oldestKey = dedupCache.keys().next().value;
    if (oldestKey !== undefined) dedupCache.delete(oldestKey);
  }
  dedupCache.set(key, { result, expiresAt: Date.now() + DEDUP_TTL_MS });
}

/** Test-only: clear the dedup cache so tests don't leak state into each other. */
export function resetLlmDedupCache(): void {
  dedupCache.clear();
}

/**
 * Single funnel every real provider call goes through: dedup cache lookup,
 * then (on a miss) the actual `provider.complete()` call timed for the
 * rolling cost tracker above, with the fresh result cached for the next
 * identical call within `DEDUP_TTL_MS`.
 */
export const MAX_PROVIDER_CALL_ATTEMPTS = 3;
const RETRY_DELAY_CAP_MS = 1_000;
const RETRY_DELAY_BASE_MS = 50;

export class LlmHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "LlmHttpError";
    this.status = status;
  }
}

export function shouldRetry(err: unknown, attempt: number): boolean {
  if (attempt >= MAX_PROVIDER_CALL_ATTEMPTS) return false;
  if (err instanceof LlmHttpError) {
    return err.status >= 500 || err.status === 429;
  }
  return true;
}

export function computeRetryDelayMs(attempt: number): number {
  const exp = Math.min(RETRY_DELAY_CAP_MS, RETRY_DELAY_BASE_MS * 2 ** (attempt - 1));
  return Math.min(RETRY_DELAY_CAP_MS, exp + Math.random() * exp);
}

let retrySleep: (ms: number) => Promise<void> = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export function setRetrySleepForTests(
  fn: ((ms: number) => Promise<void>) | undefined,
): void {
  retrySleep =
    fn ??
    ((ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }));
}

async function runProviderCall(
  provider: LlmProvider,
  messages: readonly LlmMessage[],
): Promise<LlmCallResult> {
  const key = buildDedupCacheKey(provider, messages);
  const cached = getDedupCached(key);
  if (cached) {
    return { ...cached, cacheHit: true };
  }

  const modelKey = provider.model ?? provider.name;
  const startedAt = Date.now();
  let completion: LlmCompletion | undefined;
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_PROVIDER_CALL_ATTEMPTS; attempt += 1) {
    try {
      completion = await provider.complete(messages);
      lastError = undefined;
      break;
    } catch (err) {
      lastError = err;
      if (!shouldRetry(err, attempt)) {
        break;
      }
      await retrySleep(computeRetryDelayMs(attempt));
    }
  }

  if (!completion) {
    recordModelCall({
      model: modelKey,
      costUsd: 0,
      latencyMs: Date.now() - startedAt,
      ok: false,
      at: Date.now(),
    });
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  recordModelCall({
    model: modelKey,
    costUsd: completion.usage.costUsd,
    latencyMs: Date.now() - startedAt,
    ok: true,
    at: Date.now(),
  });

  const result: Omit<LlmCallResult, "cacheHit"> = {
    provider: provider.name,
    text: completion.text,
    usage: completion.usage,
  };
  setDedupCached(key, result);
  return { ...result, cacheHit: false };
}

export type ReplyLocale = "he" | "ar" | "en";

export function detectReplyLocale(text: string): ReplyLocale {
  if (/[\u0600-\u06FF]/.test(text)) {
    return "ar";
  }
  if (/[\u0590-\u05FF]/.test(text)) {
    return "he";
  }
  return "en";
}

function localeInstructions(locale: ReplyLocale): string {
  switch (locale) {
    case "he":
      return "ענה בעברית. הבחן בין עובדה / מאושר / הסקה / הצעה / לא ידוע / קונפליקט.";
    case "ar":
      return "أجب بالعربية. ميّز بين حقيقة / مؤكد / مستنتج / مقترح / غير معروف / تعارض.";
    default:
      return "Reply in English. Distinguish FACT / CONFIRMED / INFERRED / PROPOSED / UNKNOWN / CONFLICTED.";
  }
}

/** Fully free offline fallback — no API cost. */
export class ContextEchoProvider implements LlmProvider {
  readonly name = "context-echo-free";
  readonly model = "context-echo-free";

  async complete(messages: readonly LlmMessage[]): Promise<LlmCompletion> {
    const text = await this.render(messages);
    // Free offline provider — no API call, no tokens billed, so 0 is the
    // real cost, not an estimate.
    return { text, usage: ZERO_USAGE };
  }

  private async render(messages: readonly LlmMessage[]): Promise<string> {
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    const user = messages.find((m) => m.role === "user")?.content ?? "";
    const locale = detectReplyLocale(user);

    if (locale === "he") {
      return [
        "ArletOS — מערכת הנדסה (מצב קריאה/ניתוח). ללא עלות API.",
        "אני עונה מתוך Current State, Evidence, Decisions ו-Portfolio — לא משיחה בלבד.",
        "",
        "### הקשר שאוחזר",
        system.slice(0, 6000),
        "",
        "### מענה",
        `לגבי: ${user}`,
        "",
        "משמעת אפיסטמית: מה שלא מסומן כעובדה/מאושר — לא מוצג כעובדה.",
        "אם משהו UNKNOWN — ציין איזו ראיה חסרה (סנכרון GitHub, פיד DB וכו').",
        "המלצה: הפעל reconcile וצרף החלטות עם provenance.",
      ].join("\n");
    }

    if (locale === "ar") {
      return [
        "ArletOS — نظام هندسي (وضع قراءة/تحليل). بدون تكلفة API.",
        "أجيب من Current State وEvidence وDecisions وPortfolio — وليس من المحادثة وحدها.",
        "",
        "### السياق المسترجع",
        system.slice(0, 6000),
        "",
        "### الرد",
        `بخصوص: ${user}`,
        "",
        "انضباط معرفي: ما لم يُوسم كحقيقة/مؤكد لا يُعرض كحقيقة.",
        "إذا كان UNKNOWN فاذكر الدليل الناقص.",
        "توصية: نفّذ reconcile وأرفق قرارات مع provenance.",
      ].join("\n");
    }

    return [
      "ArletOS Engineering OS (READ/ANALYZE). Free offline provider.",
      "I answer from Current State, Evidence, Decisions, and Portfolio.",
      "",
      "### Retrieved context",
      system.slice(0, 6000),
      "",
      "### Response",
      `Regarding: ${user}`,
      "",
      "Epistemic discipline: unlabeled claims are not asserted as FACT.",
      "If UNKNOWN, say what evidence is missing.",
    ].join("\n");
  }
}

/** OpenAI-compatible chat API (Ollama / Groq / optional paid). */
export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name: string;

  constructor(
    private readonly apiKey: string | undefined,
    readonly model: string,
    private readonly baseUrl: string,
    name: string,
  ) {
    this.name = name;
  }

  async complete(messages: readonly LlmMessage[]): Promise<LlmCompletion> {
    const user = messages.find((m) => m.role === "user")?.content ?? "";
    const locale = detectReplyLocale(user);
    const withLocale: LlmMessage[] = [
      {
        role: "system",
        content: localeInstructions(locale),
      },
      ...messages,
    ];

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          messages: withLocale,
        }),
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      throw new LlmHttpError(response.status, `LLM provider failed: ${response.status}`);
    }
    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      // OpenAI-compatible chat/completions responses (OpenAI, Groq,
      // DeepSeek, and most Ollama builds) include this `usage` object with
      // real token counts — previously parsed but discarded entirely.
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };
    const text = json.choices?.[0]?.message?.content ?? "";
    const promptTokens = json.usage?.prompt_tokens ?? 0;
    const completionTokens = json.usage?.completion_tokens ?? 0;
    // Not every OpenAI-compatible backend returns `usage` (some local Ollama
    // builds omit it) — when absent we honestly report 0 rather than
    // guessing token counts from text length.
    return {
      text,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: json.usage?.total_tokens ?? promptTokens + completionTokens,
        costUsd: computeCostUsd(this.model, promptTokens, completionTokens),
      },
    };
  }
}

export interface LlmEnv {
  readonly LLM_PROVIDER?: string | undefined;
  readonly OLLAMA_BASE_URL?: string | undefined;
  readonly OLLAMA_MODEL?: string | undefined;
  readonly GROQ_API_KEY?: string | undefined;
  readonly GROQ_MODEL?: string | undefined;
  readonly OPENAI_API_KEY?: string | undefined;
  readonly OPENAI_BASE_URL?: string | undefined;
  readonly OPENAI_MODEL?: string | undefined;
  readonly ANTHROPIC_API_KEY?: string | undefined;
  readonly ANTHROPIC_MODEL?: string | undefined;
  readonly GEMINI_API_KEY?: string | undefined;
  readonly GEMINI_MODEL?: string | undefined;
  readonly DEEPSEEK_API_KEY?: string | undefined;
  readonly DEEPSEEK_MODEL?: string | undefined;
}

/** Anthropic Messages API (Claude). */
export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic-claude";

  constructor(
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  async complete(messages: readonly LlmMessage[]): Promise<LlmCompletion> {
    const user = messages.find((m) => m.role === "user")?.content ?? "";
    const locale = detectReplyLocale(user);
    const systemParts = [
      localeInstructions(locale),
      ...messages.filter((m) => m.role === "system").map((m) => m.content),
    ];
    const chat = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      }));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    let response: Response;
    try {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          max_tokens: 1200,
          temperature: 0.2,
          system: systemParts.join("\n\n"),
          messages: chat.length > 0 ? chat : [{ role: "user", content: user }],
        }),
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      throw new LlmHttpError(response.status, `Anthropic failed: ${response.status}`);
    }
    const json = (await response.json()) as {
      content?: Array<{ type?: string; text?: string }>;
      // Anthropic's Messages API always returns a top-level `usage` object
      // with real input/output token counts — previously parsed but
      // discarded entirely.
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text =
      json.content
        ?.filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("\n") ?? "";
    const promptTokens = json.usage?.input_tokens ?? 0;
    const completionTokens = json.usage?.output_tokens ?? 0;
    return {
      text,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        costUsd: computeCostUsd(this.model, promptTokens, completionTokens),
      },
    };
  }
}

/** Google Gemini generateContent. */
export class GeminiProvider implements LlmProvider {
  readonly name = "google-gemini";

  constructor(
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  async complete(messages: readonly LlmMessage[]): Promise<LlmCompletion> {
    const user = messages.find((m) => m.role === "user")?.content ?? "";
    const locale = detectReplyLocale(user);
    const system = [
      localeInstructions(locale),
      ...messages.filter((m) => m.role === "system").map((m) => m.content),
    ].join("\n\n");
    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents:
            contents.length > 0
              ? contents
              : [{ role: "user", parts: [{ text: user }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 1200 },
        }),
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      throw new LlmHttpError(response.status, `Gemini failed: ${response.status}`);
    }
    const json = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
      // Gemini's generateContent responses include a top-level
      // `usageMetadata` object with real prompt/output token counts —
      // previously parsed but discarded entirely.
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
      };
    };
    const text =
      json.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? "")
        .join("\n") ?? "";
    const promptTokens = json.usageMetadata?.promptTokenCount ?? 0;
    const completionTokens = json.usageMetadata?.candidatesTokenCount ?? 0;
    return {
      text,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens:
          json.usageMetadata?.totalTokenCount ?? promptTokens + completionTokens,
        costUsd: computeCostUsd(this.model, promptTokens, completionTokens),
      },
    };
  }
}

/**
 * Provider order (cost-first, no paid default):
 * 1. explicit LLM_PROVIDER
 * 2. Ollama when OLLAMA_BASE_URL set
 * 3. Groq free-tier when GROQ_API_KEY set
 * 4. Paid providers only when explicitly selected
 * 5. ContextEcho — always free
 */
export function createLlmProvider(env: LlmEnv): LlmProvider {
  const explicit = (env.LLM_PROVIDER ?? "").toLowerCase();

  if (explicit === "echo" || explicit === "context-echo") {
    return new ContextEchoProvider();
  }

  if (explicit === "anthropic" && env.ANTHROPIC_API_KEY) {
    return new AnthropicProvider(
      env.ANTHROPIC_API_KEY,
      env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514",
    );
  }

  if (explicit === "gemini" && env.GEMINI_API_KEY) {
    return new GeminiProvider(
      env.GEMINI_API_KEY,
      env.GEMINI_MODEL ?? "gemini-2.0-flash",
    );
  }

  if (explicit === "deepseek" && env.DEEPSEEK_API_KEY) {
    return new OpenAiCompatibleProvider(
      env.DEEPSEEK_API_KEY,
      env.DEEPSEEK_MODEL ?? "deepseek-chat",
      "https://api.deepseek.com/v1",
      "deepseek",
    );
  }

  if (explicit === "ollama" || (!explicit && env.OLLAMA_BASE_URL)) {
    const base = env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
    return new OpenAiCompatibleProvider(
      undefined,
      env.OLLAMA_MODEL ?? "llama3.2",
      `${base.replace(/\/$/, "")}/v1`,
      "llama-ollama-local",
    );
  }

  if (
    (explicit === "groq" || (!explicit && env.GROQ_API_KEY)) &&
    env.GROQ_API_KEY
  ) {
    return new OpenAiCompatibleProvider(
      env.GROQ_API_KEY,
      env.GROQ_MODEL ?? "llama-3.1-8b-instant",
      "https://api.groq.com/openai/v1",
      "llama-groq",
    );
  }

  if (explicit === "openai" && env.OPENAI_API_KEY) {
    return new OpenAiCompatibleProvider(
      env.OPENAI_API_KEY,
      env.OPENAI_MODEL ?? "gpt-4o-mini",
      env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      "openai",
    );
  }

  return new ContextEchoProvider();
}

/**
 * Resolve provider with automatic free fallback if Ollama is down.
 *
 * Every attempt goes through `runProviderCall`, so an identical call made
 * again within `DEDUP_TTL_MS` is served from cache (`cacheHit: true`)
 * instead of re-billing/re-calling the provider, and every fresh attempt
 * feeds the rolling cost/error tracker that `router/genius.ts` consults.
 */
export async function completeWithFreeFallback(
  env: LlmEnv,
  messages: readonly LlmMessage[],
): Promise<LlmCallResult> {
  const primary = createLlmProvider(env);
  try {
    const result = await runProviderCall(primary, messages);
    if (result.text.trim().length > 0) {
      return result;
    }
  } catch {
    // fall through
  }

  // If primary was ollama and failed, try Groq then echo
  if (env.GROQ_API_KEY) {
    try {
      const groq = new OpenAiCompatibleProvider(
        env.GROQ_API_KEY,
        env.GROQ_MODEL ?? "llama-3.1-8b-instant",
        "https://api.groq.com/openai/v1",
        "groq-free-tier",
      );
      return await runProviderCall(groq, messages);
    } catch {
      // fall through
    }
  }

  const echo = new ContextEchoProvider();
  return await runProviderCall(echo, messages);
}

/**
 * Paid / explicit provider completion — no silent free fallback.
 * Use when the user selected a credits-billed model so they get that model or a clear error.
 */
export async function completeStrict(
  env: LlmEnv,
  messages: readonly LlmMessage[],
): Promise<LlmCallResult> {
  const primary = createLlmProvider(env);
  const result = await runProviderCall(primary, messages);
  if (!result.text.trim()) {
    throw new Error(`LLM provider ${result.provider} returned an empty response`);
  }
  return result;
}
