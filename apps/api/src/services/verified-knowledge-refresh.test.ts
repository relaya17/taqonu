import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { hydrateKnowledgeCorpus, listKnowledgeCorpus } from "@atlas/knowledge";
import { osStore } from "../store/os-store.js";
import {
  extractOfficialText,
  KNOWLEDGE_REFRESH_META,
  knowledgeRefreshIsDue,
  refreshVerifiedKnowledge,
} from "./verified-knowledge-refresh.js";

const env = {
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
  SUPABASE_SERVICE_ROLE_KEY: "",
};

// Isolation gap fix: this previously set neither `ATLAS_STORE_PATH` nor
// `ATLAS_SKIP_STORE_PERSIST` at all, so the "fetches allow-listed pages...
// writes the ledger" test's `refreshVerifiedKnowledge({ persist: true })`
// really called `osStore.setMeta(KNOWLEDGE_REFRESH_META, ...)` against the
// REAL `.atlas/store.json` at the repo root on every test run.
const storeDir = mkdtempSync(join(tmpdir(), "atlas-knowledge-refresh-store-"));

describe("verified knowledge refresh", () => {
  beforeAll(() => {
    process.env.ATLAS_SKIP_STORE_PERSIST = "1";
    process.env.ATLAS_STORE_PATH = join(storeDir, "store.json");
  });

  afterAll(() => {
    delete process.env.ATLAS_SKIP_STORE_PERSIST;
    delete process.env.ATLAS_STORE_PATH;
    rmSync(storeDir, { recursive: true, force: true });
  });

  afterEach(() => {
    delete process.env.ATLAS_KNOWLEDGE_CORPUS_PATH;
  });

  it("extracts title and text from official HTML", () => {
    const extracted = extractOfficialText(
      "<html><head><title>NIST SP 800</title></head><body><nav>skip</nav><p>Access control guidance for federal systems.</p></body></html>",
    );
    expect(extracted.title).toBe("NIST SP 800");
    expect(extracted.text).toContain("Access control guidance");
    expect(extracted.text).not.toContain("skip");
  });

  it("fetches allow-listed pages, upserts corpus, and writes the ledger", async () => {
    const dir = mkdtempSync(join(tmpdir(), "atlas-kf-"));
    const corpusPath = join(dir, "corpus.json");
    writeFileSync(corpusPath, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), documents: [] }), "utf8");
    process.env.ATLAS_KNOWLEDGE_CORPUS_PATH = corpusPath;
    hydrateKnowledgeCorpus({ enablePersist: true, force: true, path: corpusPath });

    const report = await refreshVerifiedKnowledge({
      env,
      persist: true,
      targets: [
        {
          id: "kf_tech_nist-sp800",
          title: "NIST SP 800",
          url: "https://csrc.nist.gov/publications/sp800",
          sourceClass: "GOVERNMENT_OR_STANDARDS",
          family: "tech",
          priority: 0,
        },
      ],
      fetchFn: async () =>
        new Response(
          "<html><head><title>SP 800 publications</title></head><body><p>NIST Special Publication 800 series — cybersecurity controls for federal information systems. Cite the primary URL.</p></body></html>",
          {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          },
        ),
    });

    expect(report.items[0]?.error ?? null).toBeNull();
    expect(report.ok).toBe(1);
    expect(report.failed).toBe(0);
    const doc = listKnowledgeCorpus().find((d) => d.id === "kf_tech_nist-sp800");
    expect(doc?.excerpt).toContain("NIST Special Publication 800");
    expect(doc?.sourceUpdatedAt).toBeTruthy();
    const ledger = JSON.parse(osStore.getMeta(KNOWLEDGE_REFRESH_META) ?? "{}") as {
      lastOk: number;
    };
    expect(ledger.lastOk).toBe(1);
    expect(knowledgeRefreshIsDue(Date.now(), 24 * 60 * 60 * 1000)).toBe(false);
  });

  it("refuses a target that is not on the allow-list", async () => {
    const report = await refreshVerifiedKnowledge({
      env,
      persist: false,
      targets: [
        {
          id: "kf_blog",
          title: "Blog",
          url: "https://medium.com/not-allowed",
          sourceClass: "TECHNICAL_ARTICLE",
          family: "tech",
          priority: 9,
        },
      ],
      fetchFn: async () => {
        throw new Error("should not fetch");
      },
    });
    expect(report.ok).toBe(0);
    expect(report.failed).toBe(1);
    expect(report.items[0]?.error).toMatch(/allow-list/i);
  });
});
