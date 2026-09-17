import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STUB_OWNER_ID, SYSTEM_OWNER_ID } from "@atlas/shared";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-write-owner-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";

const { resolveEvidenceOwnerId } = await import("./write-owner.js");
const { bindProjectOwner } = await import("./project-access.js");
const { osStore } = await import("../store/os-store.js");

const REQUEST_OWNER = "11111111-1111-4111-8111-111111111111";
const PROJECT_OWNER = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("resolveEvidenceOwnerId", () => {
  beforeEach(() => {
    osStore.resetInMemoryForTests();
  });

  it("prefers the authenticated request owner", () => {
    bindProjectOwner(PROJECT_ID, PROJECT_OWNER, "bound_on_create");
    expect(
      resolveEvidenceOwnerId({
        requestOwnerId: REQUEST_OWNER,
        projectId: PROJECT_ID,
      }),
    ).toBe(REQUEST_OWNER);
  });

  it("uses the bound project owner when no request owner is present", () => {
    bindProjectOwner(PROJECT_ID, PROJECT_OWNER, "bound_on_create");
    expect(resolveEvidenceOwnerId({ projectId: PROJECT_ID })).toBe(PROJECT_OWNER);
  });

  it("falls back to SYSTEM_OWNER_ID, never STUB_OWNER_ID", () => {
    expect(resolveEvidenceOwnerId({})).toBe(SYSTEM_OWNER_ID);
    expect(resolveEvidenceOwnerId({ projectId: PROJECT_ID })).toBe(SYSTEM_OWNER_ID);
    expect(resolveEvidenceOwnerId({})).not.toBe(STUB_OWNER_ID);
  });
});
