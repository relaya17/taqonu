export interface LlmMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface LlmProvider {
  readonly name: string;
  complete(messages: readonly LlmMessage[]): Promise<string>;
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

  async complete(messages: readonly LlmMessage[]): Promise<string> {
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
    private readonly model: string,
    private readonly baseUrl: string,
    name: string,
  ) {
    this.name = name;
  }

  async complete(messages: readonly LlmMessage[]): Promise<string> {
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
      throw new Error(`LLM provider failed: ${response.status}`);
    }
    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return json.choices?.[0]?.message?.content ?? "";
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
    private readonly model: string,
  ) {}

  async complete(messages: readonly LlmMessage[]): Promise<string> {
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
      throw new Error(`Anthropic failed: ${response.status}`);
    }
    const json = (await response.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    return (
      json.content
        ?.filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("\n") ?? ""
    );
  }
}

/** Google Gemini generateContent. */
export class GeminiProvider implements LlmProvider {
  readonly name = "google-gemini";

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async complete(messages: readonly LlmMessage[]): Promise<string> {
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
      throw new Error(`Gemini failed: ${response.status}`);
    }
    const json = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };
    return (
      json.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? "")
        .join("\n") ?? ""
    );
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

/** Resolve provider with automatic free fallback if Ollama is down. */
export async function completeWithFreeFallback(
  env: LlmEnv,
  messages: readonly LlmMessage[],
): Promise<{ provider: string; text: string }> {
  const primary = createLlmProvider(env);
  try {
    const text = await primary.complete(messages);
    if (text.trim().length > 0) {
      return { provider: primary.name, text };
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
      const text = await groq.complete(messages);
      return { provider: groq.name, text };
    } catch {
      // fall through
    }
  }

  const echo = new ContextEchoProvider();
  return { provider: echo.name, text: await echo.complete(messages) };
}

/**
 * Paid / explicit provider completion — no silent free fallback.
 * Use when the user selected a credits-billed model so they get that model or a clear error.
 */
export async function completeStrict(
  env: LlmEnv,
  messages: readonly LlmMessage[],
): Promise<{ provider: string; text: string }> {
  const primary = createLlmProvider(env);
  const text = await primary.complete(messages);
  if (!text.trim()) {
    throw new Error(`LLM provider ${primary.name} returned an empty response`);
  }
  return { provider: primary.name, text };
}
