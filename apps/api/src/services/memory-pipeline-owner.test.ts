import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  STUB_OWNER_ID,
  SYSTEM_OWNER_ID,
  type QaPortfolioPattern,
} from "@atlas/shared";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-memory-owner-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_EVENT_DISPATCH = "1";

const { osStore } = await import("../store/os-store.js");
const { appendDomainEvent, retrieveMemories, seedPortfolioPatternMemories } =
  await import("./memory-pipeline.js");

const OWNER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("seedPortfolioPatternMemories ownership (B5)", () => {
  const prevSkip = process.env.ATLAS_SKIP_STORE_PERSIST;
  const prevSkipDispatch = process.env.ATLAS_SKIP_EVENT_DISPATCH;

  beforeEach(() => {
    process.env.ATLAS_SKIP_STORE_PERSIST = "1";
    process.env.ATLAS_SKIP_EVENT_DISPATCH = "1";
    osStore.resetInMemoryForTests();
  });

  afterEach(() => {
    if (prevSkip === undefined) delete process.env.ATLAS_SKIP_STORE_PERSIST;
    else process.env.ATLAS_SKIP_STORE_PERSIST = prevSkip;
    if (prevSkipDispatch === undefined) {
      delete process.env.ATLAS_SKIP_EVENT_DISPATCH;
    } else {
      process.env.ATLAS_SKIP_EVENT_DISPATCH = prevSkipDispatch;
    }
  });

  it("stamps SYSTEM_OWNER_ID, not STUB_OWNER_ID, and does not leak into a tenant retrieve", async () => {
    const pattern: Pick<
      QaPortfolioPattern,
      | "id"
      | "patternKey"
      | "title"
      | "summary"
      | "projectIds"
      | "findingIds"
      | "epistemicState"
    > = {
      id: crypto.randomUUID(),
      patternKey: "cross-project-timeout",
      title: "Timeouts in checkout",
      summary: "Two projects share the same timeout class.",
      projectIds: [crypto.randomUUID(), crypto.randomUUID()],
      findingIds: [crypto.randomUUID()],
      epistemicState: "INFERRED",
    };
    const seeded = seedPortfolioPatternMemories([pattern]);
    expect(seeded).toHaveLength(1);
    expect(seeded[0]!.ownerId).toBe(SYSTEM_OWNER_ID);
    expect(seeded[0]!.ownerId).not.toBe(STUB_OWNER_ID);

    const tenant = await retrieveMemories({ budget: 20, ownerId: OWNER_A });
    expect(tenant.items.map((row) => row.id)).not.toContain(seeded[0]!.id);
  });
});

describe("appendDomainEvent ownership (B5)", () => {
  const prevSkip = process.env.ATLAS_SKIP_STORE_PERSIST;
  const prevSkipDispatch = process.env.ATLAS_SKIP_EVENT_DISPATCH;

  beforeEach(() => {
    process.env.ATLAS_SKIP_STORE_PERSIST = "1";
    process.env.ATLAS_SKIP_EVENT_DISPATCH = "1";
    osStore.resetInMemoryForTests();
  });

  afterEach(() => {
    if (prevSkip === undefined) delete process.env.ATLAS_SKIP_STORE_PERSIST;
    else process.env.ATLAS_SKIP_STORE_PERSIST = prevSkip;
    if (prevSkipDispatch === undefined) {
      delete process.env.ATLAS_SKIP_EVENT_DISPATCH;
    } else {
      process.env.ATLAS_SKIP_EVENT_DISPATCH = prevSkipDispatch;
    }
  });

  it("defaults to SYSTEM_OWNER_ID rather than the legacy stub", () => {
    const event = appendDomainEvent({
      type: "memory.created",
      payload: { memoryId: crypto.randomUUID() },
    });
    expect(event.ownerId).toBe(SYSTEM_OWNER_ID);
    expect(event.ownerId).not.toBe(STUB_OWNER_ID);
  });

  it("stamps a caller-supplied ownerId", () => {
    const event = appendDomainEvent({
      type: "memory.created",
      ownerId: OWNER_A,
      payload: { memoryId: crypto.randomUUID() },
    });
    expect(event.ownerId).toBe(OWNER_A);
    expect(event.ownerId).not.toBe(STUB_OWNER_ID);
  });
});
