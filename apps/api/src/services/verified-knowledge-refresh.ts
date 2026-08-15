import {
  isAuthorizedOfficialKnowledgeUrl,
  listOfficialRefreshTargets,
  type OfficialRefreshTarget,
} from "@atlas/shared";
import { hydrateKnowledgeCorpus } from "@atlas/knowledge";
import { osStore } from "../store/os-store.js";
import {
  ingestKnowledgeClosedLoop,
  type HybridRagEnv,
} from "./hybrid-rag.js";

export const KNOWLEDGE_REFRESH_META = "knowledge.refresh.v1";
export const KNOWLEDGE_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 12_000;
const MAX_BYTES = 1_500_000;
const MAX_TEXT_CHARS = 12_000;
const CONCURRENCY = 3;

export type KnowledgeFetchFn = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

export interface KnowledgeRefreshItem {
  id: string;
  url: string;
  title: string;
  status: "ok" | "failed" | "skipped";
  contentHash: string | null;
  bytes: number;
  error: string | null;
}

export interface KnowledgeRefreshReport {
  startedAt: string;
  finishedAt: string;
  ok: number;
  failed: number;
  skipped: number;
  persisted: boolean;
  pgvectorWrites: number;
  items: KnowledgeRefreshItem[];
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"');
}

/** Public HTML → title + plain text. Caps size; no off-list follow-up. */
export function extractOfficialText(
  html: string,
  maxChars = MAX_TEXT_CHARS,
): { title: string; text: string } {
  const title =
    html
      .match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      ?.replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim() ?? "";
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return {
    title: decodeEntities(title).slice(0, 200),
    text: decodeEntities(stripped).slice(0, maxChars),
  };
}

export function readKnowledgeRefreshLedger(): {
  lastFinishedAt: string | null;
  lastOk: number;
  lastFailed: number;
} | null {
  const raw = osStore.getMeta(KNOWLEDGE_REFRESH_META);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      lastFinishedAt?: string;
      lastOk?: number;
      lastFailed?: number;
    };
    return {
      lastFinishedAt: parsed.lastFinishedAt ?? null,
      lastOk: parsed.lastOk ?? 0,
      lastFailed: parsed.lastFailed ?? 0,
    };
  } catch {
    return null;
  }
}

export function knowledgeRefreshIsDue(
  now = Date.now(),
  intervalMs = KNOWLEDGE_REFRESH_INTERVAL_MS,
): boolean {
  const ledger = readKnowledgeRefreshLedger();
  if (!ledger?.lastFinishedAt) return true;
  const then = new Date(ledger.lastFinishedAt).getTime();
  if (!Number.isFinite(then)) return true;
  return now - then >= intervalMs;
}

async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i;
      i += 1;
      out[idx] = await fn(items[idx]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return out;
}

async function fetchOfficialPage(
  target: OfficialRefreshTarget,
  fetchFn: KnowledgeFetchFn,
): Promise<{ title: string; text: string; bytes: number; fetchedAt: string }> {
  if (!isAuthorizedOfficialKnowledgeUrl(target.url)) {
    throw new Error("URL is not on the official allow-list");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchFn(target.url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
        "User-Agent":
          "AtlasKnowledgeRefresh/1.0 (allow-listed official docs; +https://github.com/relaya17/taqonu)",
      },
    });
    const reported = res.url?.trim() ?? "";
    const finalUrl =
      !reported ||
      reported.startsWith("http://localhost") ||
      reported.startsWith("https://localhost")
        ? target.url
        : reported;
    if (!isAuthorizedOfficialKnowledgeUrl(finalUrl)) {
      throw new Error(`Redirect left the allow-list: ${finalUrl}`);
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const length = Number(res.headers.get("content-length") ?? "0");
    if (length > MAX_BYTES) {
      throw new Error(`Response too large (${length} bytes)`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) {
      throw new Error(`Response too large (${buf.length} bytes)`);
    }
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    const fetchedAt = new Date().toISOString();
    if (contentType.includes("pdf") || contentType.includes("octet-stream")) {
      return {
        title: target.title,
        text: `${target.title}. Official document at ${finalUrl} (binary not stored). Retrieved ${fetchedAt}. Cite the primary URL.`,
        bytes: buf.length,
        fetchedAt,
      };
    }
    const raw = buf.toString("utf8");
    const extracted = extractOfficialText(raw);
    const text =
      extracted.text.length >= 80
        ? extracted.text
        : `${target.title}. Official source ${finalUrl}. Retrieved ${fetchedAt}. Cite the primary URL — page text was too short to snapshot.`;
    return {
      title: extracted.title || target.title,
      text,
      bytes: buf.length,
      fetchedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function refreshVerifiedKnowledge(input: {
  env: HybridRagEnv;
  fetchFn?: KnowledgeFetchFn;
  persist?: boolean;
  targets?: OfficialRefreshTarget[];
}): Promise<KnowledgeRefreshReport> {
  const startedAt = new Date().toISOString();
  hydrateKnowledgeCorpus({ enablePersist: input.persist !== false });
  const targets = input.targets ?? listOfficialRefreshTargets();
  const fetchFn = input.fetchFn ?? fetch;
  let pgvectorWrites = 0;

  const items = await mapPool(targets, CONCURRENCY, async (target) => {
    try {
      const page = await fetchOfficialPage(target, fetchFn);
      const { document, pgvector } = await ingestKnowledgeClosedLoop(input.env, {
        id: target.id,
        title: page.title,
        excerpt: page.text,
        sourceClass: target.sourceClass,
        url: target.url,
        sourceUpdatedAt: page.fetchedAt,
        projectScoped: false,
      });
      if (pgvector) pgvectorWrites += 1;
      return {
        id: target.id,
        url: target.url,
        title: page.title,
        status: "ok" as const,
        contentHash: document.contentHash,
        bytes: page.bytes,
        error: null,
      };
    } catch (err) {
      return {
        id: target.id,
        url: target.url,
        title: target.title,
        status: "failed" as const,
        contentHash: null,
        bytes: 0,
        error: err instanceof Error ? err.message : "refresh failed",
      };
    }
  });

  const ok = items.filter((i) => i.status === "ok").length;
  const failed = items.filter((i) => i.status === "failed").length;
  const finishedAt = new Date().toISOString();
  const report: KnowledgeRefreshReport = {
    startedAt,
    finishedAt,
    ok,
    failed,
    skipped: 0,
    persisted: input.persist !== false,
    pgvectorWrites,
    items,
  };
  osStore.setMeta(
    KNOWLEDGE_REFRESH_META,
    JSON.stringify({
      lastStartedAt: startedAt,
      lastFinishedAt: finishedAt,
      lastOk: ok,
      lastFailed: failed,
      pgvectorWrites,
      nextDueAt: new Date(
        Date.now() + KNOWLEDGE_REFRESH_INTERVAL_MS,
      ).toISOString(),
    }),
  );
  return report;
}

export function shouldSkipAutoKnowledgeRefresh(): boolean {
  if (process.env.ATLAS_SKIP_KNOWLEDGE_REFRESH === "true") return true;
  if (process.env.VITEST) return true;
  if (process.env.NODE_ENV === "test") return true;
  return false;
}

export async function maybeRefreshVerifiedKnowledge(input: {
  env: HybridRagEnv;
  fetchFn?: KnowledgeFetchFn;
}): Promise<KnowledgeRefreshReport | null> {
  if (shouldSkipAutoKnowledgeRefresh()) return null;
  if (!knowledgeRefreshIsDue()) return null;
  return refreshVerifiedKnowledge(input);
}
