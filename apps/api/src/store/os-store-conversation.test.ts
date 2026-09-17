import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * D1 — conversation threads must survive process restart via the existing
 * osStore JSON persist path (same pattern as kill-switch runtime overrides).
 */
const tmpDir = mkdtempSync(join(tmpdir(), "atlas-os-store-conversation-test-"));
const storePath = join(tmpDir, "store.json");
process.env.ATLAS_STORE_PATH = storePath;
process.env.ATLAS_SKIP_AUDIT_LOG = "1";
delete process.env.ATLAS_SKIP_STORE_PERSIST;

const { osStore } = await import("./os-store.js");

describe("OsStore conversation thread persistence (D1)", () => {
  afterEach(() => {
    osStore.unloadForTests();
  });

  it("setConversationThread binds owner/project and survives a simulated restart", () => {
    const threadId = "55555555-5555-4555-8555-555555555555";
    osStore.setConversationThread(
      threadId,
      [
        {
          role: "user",
          content: "d1-disk-persist-marker",
          at: "2026-09-17T00:00:00.000Z",
        },
        {
          role: "assistant",
          content: "acknowledged",
          at: "2026-09-17T00:00:01.000Z",
        },
      ],
      {
        ownerId: "22222222-2222-4222-8222-222222222222",
        projectId: "66666666-6666-4666-8666-666666666666",
      },
    );

    osStore.unloadForTests();
    const turns = osStore.getConversationThread(threadId);
    expect(turns).toHaveLength(2);
    expect(turns[0]?.content).toBe("d1-disk-persist-marker");
    const meta = osStore.getConversationThreadMeta(threadId);
    expect(meta?.ownerId).toBe("22222222-2222-4222-8222-222222222222");
    expect(meta?.projectId).toBe("66666666-6666-4666-8666-666666666666");

    const listed = osStore.listConversationThreadsByOwner(
      "22222222-2222-4222-8222-222222222222",
      "66666666-6666-4666-8666-666666666666",
    );
    expect(listed).toHaveLength(1);
    expect(listed[0]?.threadId).toBe(threadId);
  });

  it("listConversationThreadsByOwner never returns another owner's thread", () => {
    osStore.setConversationThread(
      "77777777-7777-4777-8777-777777777777",
      [{ role: "user", content: "mine", at: "2026-09-17T00:00:00.000Z" }],
      { ownerId: "owner-a", projectId: null },
    );
    osStore.setConversationThread(
      "88888888-8888-4888-8888-888888888888",
      [{ role: "user", content: "theirs", at: "2026-09-17T00:00:00.000Z" }],
      { ownerId: "owner-b", projectId: null },
    );
    const listed = osStore.listConversationThreadsByOwner("owner-a");
    expect(listed.map((item) => item.threadId)).toEqual([
      "77777777-7777-4777-8777-777777777777",
    ]);
  });
});
