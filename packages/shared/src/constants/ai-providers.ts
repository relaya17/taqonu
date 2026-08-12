/** AI model catalog — only ArletOS Agent is free; market models are low/mid/high credits. */

import { AI_PROVIDER_AR } from "./ai-provider-ar.js";

export const AI_PRICE_TIERS = ["free", "low", "mid", "high"] as const;
export type AiPriceTier = (typeof AI_PRICE_TIERS)[number];

export const AI_SKILLS = [
  "code",
  "uiux",
  "programming",
  "speed",
  "reasoning",
  "vision",
  "hebrew",
  "memory",
] as const;
export type AiSkill = (typeof AI_SKILLS)[number];

export const AI_PROVIDER_IDS = [
  "arletos-included",
  "claude-haiku",
  "deepseek-chat",
  "gpt-4o-mini",
  "gemini-flash",
  "llama-groq",
  "llama-local",
  "claude-sonnet",
  "gpt-4o",
  "gemini-pro",
  "claude-opus",
  "o3-mini",
  "local-checklist",
  "gpt-4o-vision",
] as const;

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export type AiProviderBackend =
  | "echo"
  | "anthropic"
  | "openai"
  | "gemini"
  | "ollama"
  | "groq"
  | "deepseek"
  | "local";

export interface AiProviderDefinition {
  readonly id: AiProviderId;
  readonly vendor: string;
  readonly titleEn: string;
  readonly titleHe: string;
  readonly titleAr: string;
  readonly billing: "included" | "credits";
  readonly priceTier: AiPriceTier;
  readonly creditCost: number;
  readonly kind: "agent" | "assist" | "both";
  readonly backend: AiProviderBackend;
  readonly modelHint: string;
  readonly skills: readonly AiSkill[];
  readonly requiresKey:
    | "none"
    | "anthropic"
    | "openai"
    | "gemini"
    | "ollama"
    | "groq"
    | "deepseek";
  readonly strengthsEn: readonly string[];
  readonly strengthsHe: readonly string[];
  readonly weaknessesEn: readonly string[];
  readonly weaknessesHe: readonly string[];
  readonly bestForEn: string;
  readonly bestForHe: string;
  /** Optional Arabic — filled via AI_PROVIDER_AR overlay when listing. */
  readonly strengthsAr?: readonly string[];
  readonly weaknessesAr?: readonly string[];
  readonly bestForAr?: string;
}

export const AI_PROVIDER_CATALOG: Readonly<
  Record<AiProviderId, AiProviderDefinition>
> = {
  "arletos-included": {
    id: "arletos-included",
    vendor: "ArletOS",
    titleEn: "ArletOS Agent",
    titleHe: "סוכן ArletOS",
    titleAr: "وكيل ArletOS",
    billing: "included",
    priceTier: "free",
    creditCost: 0,
    kind: "agent",
    backend: "echo",
    modelHint: "arletos-memory",
    skills: ["memory", "programming", "uiux", "hebrew", "code"],
    requiresKey: "none",
    strengthsEn: [
      "Only free agent — builds your private knowledge moat",
      "Answers from portfolio evidence + accumulated memory",
      "Gets smarter as decisions, QA, and lessons are stored",
    ],
    strengthsHe: [
      "הסוכן החינמי היחיד — צובר ידע פרטי שלכם",
      "עונה מראיות התיק + זיכרון שנצבר",
      "נהיה חכם יותר ככל שנשמרות החלטות, QA ושיעורים",
    ],
    weaknessesEn: [
      "Not a frontier LLM by itself",
      "Quality tracks how much memory you accumulate",
      "No raw vision without an assist model",
    ],
    weaknessesHe: [
      "לא מודל frontier בפני עצמו",
      "האיכות תלויה בכמות הזיכרון שנצבר",
      "בלי vision גולמי בלי מודל סיוע",
    ],
    bestForEn: "Daily work — grow the house intelligence for free",
    bestForHe: "עבודה יומית — לגדל את הבינה של הבית בחינם",
  },
  "claude-haiku": {
    id: "claude-haiku",
    vendor: "Anthropic",
    titleEn: "Claude Haiku",
    titleHe: "Claude Haiku",
    titleAr: "Claude Haiku",
    billing: "credits",
    priceTier: "low",
    creditCost: 1,
    kind: "agent",
    backend: "anthropic",
    modelHint: "claude-3-5-haiku-latest",
    skills: ["speed", "code", "uiux", "programming", "hebrew"],
    requiresKey: "anthropic",
    strengthsEn: [
      "Very fast and cheap",
      "Good short code + UI copy drafts",
      "Solid for quick programming checks",
    ],
    strengthsHe: [
      "מהיר וזול מאוד",
      "טוב לטיוטות קוד קצרות ו־UI copy",
      "חזק לבדיקות תכנות מהירות",
    ],
    weaknessesEn: [
      "Weaker deep reasoning than Sonnet/Opus",
      "Needs Anthropic key",
      "Can miss subtle architecture risks",
    ],
    weaknessesHe: [
      "חלש יותר מהסקה עמוקה מול Sonnet/Opus",
      "דורש מפתח Anthropic",
      "עלול לפספס סיכוני ארכיטקטורה עדינים",
    ],
    bestForEn: "Fast cheap code / UI drafts",
    bestForHe: "טיוטות קוד ו־UI מהירות וזולות",
  },
  "deepseek-chat": {
    id: "deepseek-chat",
    vendor: "DeepSeek",
    titleEn: "DeepSeek Chat",
    titleHe: "DeepSeek Chat",
    titleAr: "DeepSeek Chat",
    billing: "credits",
    priceTier: "low",
    creditCost: 1,
    kind: "agent",
    backend: "deepseek",
    modelHint: "deepseek-chat",
    skills: ["code", "programming", "speed", "reasoning"],
    requiresKey: "deepseek",
    strengthsEn: [
      "Excellent coding value for price",
      "Strong algorithmic / programming help",
      "Low credit cost",
    ],
    strengthsHe: [
      "יחס קוד/מחיר מצוין",
      "חזק בעזרה אלגוריתמית ותכנות",
      "עלות קרדיטים נמוכה",
    ],
    weaknessesEn: [
      "Needs DEEPSEEK_API_KEY",
      "Weaker product/UI taste than Claude",
      "Hebrew quality varies",
    ],
    weaknessesHe: [
      "דורש DEEPSEEK_API_KEY",
      "חלש יותר בטעם מוצר/UI מול Claude",
      "איכות עברית משתנה",
    ],
    bestForEn: "Budget coding agent",
    bestForHe: "סוכן קוד בתקציב נמוך",
  },
  "gpt-4o-mini": {
    id: "gpt-4o-mini",
    vendor: "OpenAI",
    titleEn: "GPT-4o mini",
    titleHe: "GPT-4o mini",
    titleAr: "GPT-4o mini",
    billing: "credits",
    priceTier: "low",
    creditCost: 2,
    kind: "agent",
    backend: "openai",
    modelHint: "gpt-4o-mini",
    skills: ["speed", "code", "programming", "uiux", "hebrew"],
    requiresKey: "openai",
    strengthsEn: [
      "Cheap and fast OpenAI quality",
      "Decent code + UI suggestions",
      "Good multilingual short answers",
    ],
    strengthsHe: [
      "איכות OpenAI זולה ומהירה",
      "הצעות קוד ו־UI סבירות",
      "תשובות קצרות רב־לשוניות טובות",
    ],
    weaknessesEn: [
      "Weaker than GPT-4o / Claude Sonnet",
      "Needs OpenAI key + credits",
      "Shallow on long architecture reviews",
    ],
    weaknessesHe: [
      "חלש מ־GPT-4o / Claude Sonnet",
      "דורש מפתח OpenAI + קרדיטים",
      "שטחי בסקירות ארכיטקטורה ארוכות",
    ],
    bestForEn: "Everyday coding help on a budget",
    bestForHe: "עזרת קוד יומיומית בתקציב נמוך",
  },
  "gemini-flash": {
    id: "gemini-flash",
    vendor: "Google",
    titleEn: "Gemini 2.0 Flash",
    titleHe: "Gemini 2.0 Flash",
    titleAr: "Gemini 2.0 Flash",
    billing: "credits",
    priceTier: "low",
    creditCost: 2,
    kind: "agent",
    backend: "gemini",
    modelHint: "gemini-2.0-flash",
    skills: ["speed", "uiux", "code", "programming"],
    requiresKey: "gemini",
    strengthsEn: [
      "Very fast Google model",
      "Good for UI/UX brainstorming",
      "Competitive low tier",
    ],
    strengthsHe: [
      "מודל Google מהיר מאוד",
      "טוב לסיעור מוחות UI/UX",
      "שכבה נמוכה תחרותית",
    ],
    weaknessesEn: [
      "Needs GEMINI_API_KEY",
      "Less careful than Claude on constraints",
      "Hebrew edge cases vary",
    ],
    weaknessesHe: [
      "דורש GEMINI_API_KEY",
      "פחות זהיר מ־Claude במגבלות",
      "מקרי קצה בעברית משתנים",
    ],
    bestForEn: "Fast UI/UX + light coding",
    bestForHe: "UI/UX מהיר + קוד קל",
  },
  "llama-groq": {
    id: "llama-groq",
    vendor: "Meta · Groq",
    titleEn: "Llama 3.1 (Groq)",
    titleHe: "Llama 3.1 (Groq)",
    titleAr: "Llama 3.1 (Groq)",
    billing: "credits",
    priceTier: "low",
    creditCost: 1,
    kind: "agent",
    backend: "groq",
    modelHint: "llama-3.1-8b-instant",
    skills: ["speed", "code", "programming"],
    requiresKey: "groq",
    strengthsEn: [
      "Extremely low latency",
      "Cheap cloud Llama",
      "OK for short code snippets",
    ],
    strengthsHe: [
      "השהייה נמוכה מאוד",
      "Llama זול בענן",
      "סביר לקטעי קוד קצרים",
    ],
    weaknessesEn: [
      "Smaller model — weak deep UI/architecture",
      "Needs GROQ_API_KEY",
      "Does not grow ArletOS memory moat",
    ],
    weaknessesHe: [
      "מודל קטן — חלש ב־UI/ארכיטקטורה עמוקה",
      "דורש GROQ_API_KEY",
      "לא מזין את מודיעין ArletOS",
    ],
    bestForEn: "Burst-speed cheap replies",
    bestForHe: "תשובות זולות במהירות גבוהה",
  },
  "llama-local": {
    id: "llama-local",
    vendor: "Meta · Ollama",
    titleEn: "Llama 3 (local)",
    titleHe: "Llama 3 (מקומי)",
    titleAr: "Llama 3 (محلي)",
    billing: "credits",
    priceTier: "low",
    creditCost: 1,
    kind: "agent",
    backend: "ollama",
    modelHint: "llama3.2",
    skills: ["code", "programming", "hebrew"],
    requiresKey: "ollama",
    strengthsEn: [
      "Private on your machine",
      "Useful offline coding help",
      "Low credit cost",
    ],
    strengthsHe: [
      "פרטי על המחשב שלכם",
      "עזרת קוד אופליין שימושית",
      "עלות קרדיטים נמוכה",
    ],
    weaknessesEn: [
      "Requires Ollama install",
      "Weaker than Claude/GPT on hard tasks",
      "Not the free house agent",
    ],
    weaknessesHe: [
      "דורש התקנת Ollama",
      "חלש מ־Claude/GPT במשימות קשות",
      "לא הסוכן החינמי של הבית",
    ],
    bestForEn: "Private low-cost coding",
    bestForHe: "קוד פרטי בעלות נמוכה",
  },
  "claude-sonnet": {
    id: "claude-sonnet",
    vendor: "Anthropic",
    titleEn: "Claude Sonnet",
    titleHe: "Claude Sonnet",
    titleAr: "Claude Sonnet",
    billing: "credits",
    priceTier: "mid",
    creditCost: 5,
    kind: "agent",
    backend: "anthropic",
    modelHint: "claude-sonnet-4-20250514",
    skills: ["code", "uiux", "programming", "reasoning", "hebrew"],
    requiresKey: "anthropic",
    strengthsEn: [
      "Strong code + UI/UX judgment",
      "Careful engineering analysis",
      "Excellent structured briefs",
    ],
    strengthsHe: [
      "שיפוט חזק בקוד ו־UI/UX",
      "ניתוח הנדסי זהיר",
      "Briefים מובנים מצוינים",
    ],
    weaknessesEn: [
      "Mid credit cost",
      "Needs Anthropic key",
      "Rented intelligence — does not own your memory",
    ],
    weaknessesHe: [
      "עלות בינונית",
      "דורש מפתח Anthropic",
      "בינה שכורה — לא מחזיקה את הזיכרון שלכם",
    ],
    bestForEn: "Serious code + UX reviews",
    bestForHe: "סקירות קוד ו־UX רציניות",
  },
  "gpt-4o": {
    id: "gpt-4o",
    vendor: "OpenAI",
    titleEn: "GPT-4o",
    titleHe: "GPT-4o",
    titleAr: "GPT-4o",
    billing: "credits",
    priceTier: "mid",
    creditCost: 4,
    kind: "agent",
    backend: "openai",
    modelHint: "gpt-4o",
    skills: ["code", "programming", "uiux", "reasoning", "hebrew"],
    requiresKey: "openai",
    strengthsEn: [
      "Broad coding + product sense",
      "Strong multilingual drafting",
      "Good all-round mid tier",
    ],
    strengthsHe: [
      "קוד + חוש מוצר רחבים",
      "ניסוח רב־לשוני חזק",
      "שכבה בינונית מאוזנת",
    ],
    weaknessesEn: [
      "Can invent details if prompts are loose",
      "Needs OpenAI key",
      "Does not accumulate into ArletOS memory",
    ],
    weaknessesHe: [
      "עלול להמציא פרטים בפרומפט רופף",
      "דורש מפתח OpenAI",
      "לא נצבר לזיכרון ArletOS",
    ],
    bestForEn: "Balanced coding + planning",
    bestForHe: "תכנות ותכנון מאוזנים",
  },
  "gemini-pro": {
    id: "gemini-pro",
    vendor: "Google",
    titleEn: "Gemini 1.5 Pro",
    titleHe: "Gemini 1.5 Pro",
    titleAr: "Gemini 1.5 Pro",
    billing: "credits",
    priceTier: "mid",
    creditCost: 4,
    kind: "agent",
    backend: "gemini",
    modelHint: "gemini-1.5-pro",
    skills: ["reasoning", "code", "uiux", "programming"],
    requiresKey: "gemini",
    strengthsEn: [
      "Long-context Google model",
      "Good multi-file reasoning",
      "Solid mid-tier alternative",
    ],
    strengthsHe: [
      "מודל Google עם הקשר ארוך",
      "הסקה טובה על כמה קבצים",
      "חלופה בינונית טובה",
    ],
    weaknessesEn: [
      "Needs GEMINI_API_KEY",
      "Less consistent UI taste than Claude",
      "Credit mid cost",
    ],
    weaknessesHe: [
      "דורש GEMINI_API_KEY",
      "טעם UI פחות עקבי מ־Claude",
      "עלות בינונית",
    ],
    bestForEn: "Long-context mid-tier analysis",
    bestForHe: "ניתוח בינוני עם הקשר ארוך",
  },
  "claude-opus": {
    id: "claude-opus",
    vendor: "Anthropic",
    titleEn: "Claude Opus",
    titleHe: "Claude Opus",
    titleAr: "Claude Opus",
    billing: "credits",
    priceTier: "high",
    creditCost: 10,
    kind: "agent",
    backend: "anthropic",
    modelHint: "claude-opus-4-20250514",
    skills: ["reasoning", "code", "uiux", "programming", "hebrew"],
    requiresKey: "anthropic",
    strengthsEn: [
      "Top-tier reasoning for hard systems",
      "Excellent architecture + UX critique",
      "Best rented quality in this catalog",
    ],
    strengthsHe: [
      "הסקה ברמה גבוהה למערכות קשות",
      "ביקורת ארכיטקטורה ו־UX מעולה",
      "האיכות השכורה הגבוהה בקטלוג",
    ],
    weaknessesEn: [
      "Highest credit cost",
      "Slower / more expensive",
      "Still rented — your moat stays with ArletOS Agent",
    ],
    weaknessesHe: [
      "עלות הקרדיטים הגבוהה ביותר",
      "איטי/יקר יותר",
      "עדיין שכור — המודיעין שלכם נשאר אצל סוכן ArletOS",
    ],
    bestForEn: "Hardest code + product decisions",
    bestForHe: "החלטות קוד ומוצר הקשות ביותר",
  },
  "o3-mini": {
    id: "o3-mini",
    vendor: "OpenAI",
    titleEn: "o3-mini",
    titleHe: "o3-mini",
    titleAr: "o3-mini",
    billing: "credits",
    priceTier: "high",
    creditCost: 8,
    kind: "agent",
    backend: "openai",
    modelHint: "o3-mini",
    skills: ["reasoning", "code", "programming"],
    requiresKey: "openai",
    strengthsEn: [
      "Strong reasoning on hard bugs",
      "Good for algorithmic programming",
      "High-tier OpenAI option",
    ],
    strengthsHe: [
      "הסקה חזקה על באגים קשים",
      "טוב לתכנות אלגוריתמי",
      "אופציית OpenAI בשכבה גבוהה",
    ],
    weaknessesEn: [
      "High credit cost",
      "Weaker design/UI taste than Claude",
      "Needs OpenAI key",
    ],
    weaknessesHe: [
      "עלות קרדיטים גבוהה",
      "חלש יותר בטעם עיצוב/UI מול Claude",
      "דורש מפתח OpenAI",
    ],
    bestForEn: "Hard debugging & algorithms",
    bestForHe: "דיבוג קשה ואלגוריתמים",
  },
  "local-checklist": {
    id: "local-checklist",
    vendor: "ArletOS",
    titleEn: "ArletOS Checklist",
    titleHe: "רשימת בדיקה ArletOS",
    titleAr: "قائمة فحص ArletOS",
    billing: "included",
    priceTier: "free",
    creditCost: 0,
    kind: "assist",
    backend: "local",
    modelHint: "checklist",
    skills: ["uiux"],
    requiresKey: "none",
    strengthsEn: [
      "Free artifact assist",
      "Deterministic expert checklist",
      "Feeds findings into the portfolio",
    ],
    strengthsHe: [
      "סיוע קבצים חינם",
      "צ׳ק־ליסט מומחה דטרמיניסטי",
      "מזין ממצאים לתיק",
    ],
    weaknessesEn: [
      "No real vision model",
      "Shallow image understanding",
      "Baseline only",
    ],
    weaknessesHe: [
      "בלי מודל vision אמיתי",
      "הבנת תמונה שטחית",
      "רק כבסיס",
    ],
    bestForEn: "Free first pass on uploads",
    bestForHe: "מעבר ראשון חינם על העלאות",
  },
  "gpt-4o-vision": {
    id: "gpt-4o-vision",
    vendor: "OpenAI",
    titleEn: "GPT-4o Vision",
    titleHe: "GPT-4o Vision",
    titleAr: "GPT-4o Vision",
    billing: "credits",
    priceTier: "high",
    creditCost: 5,
    kind: "assist",
    backend: "openai",
    modelHint: "gpt-4o",
    skills: ["vision", "uiux"],
    requiresKey: "openai",
    strengthsEn: [
      "Understands UI screenshots",
      "Pairs with UI/UX experts",
      "Actionable visual bullets",
    ],
    strengthsHe: [
      "מבין צילומי מסך של UI",
      "משתלב עם מומחי UI/UX",
      "נקודות ויזואליות מעשיות",
    ],
    weaknessesEn: [
      "High assist cost",
      "Needs OPENAI_API_KEY",
      "Output stays INFERRED",
    ],
    weaknessesHe: [
      "עלות סיוע גבוהה",
      "דורש OPENAI_API_KEY",
      "הפלט נשאר INFERRED",
    ],
    bestForEn: "Screenshot visual review",
    bestForHe: "ביקורת ויזואל על צילומים",
  },
};

export const AGENT_PROVIDER_IDS = AI_PROVIDER_IDS.filter(
  (id) =>
    AI_PROVIDER_CATALOG[id].kind === "agent" ||
    AI_PROVIDER_CATALOG[id].kind === "both",
) as readonly AiProviderId[];

export function listAiProviders(): readonly AiProviderDefinition[] {
  return AI_PROVIDER_IDS.map((id) => {
    const base = AI_PROVIDER_CATALOG[id];
    const ar = AI_PROVIDER_AR[id];
    return {
      ...base,
      strengthsAr: ar.strengths,
      weaknessesAr: ar.weaknesses,
      bestForAr: ar.bestFor,
    };
  });
}
