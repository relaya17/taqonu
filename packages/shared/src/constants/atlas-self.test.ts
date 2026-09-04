import { describe, expect, it } from "vitest";
import {
  ATLAS_SELF_APPLICATION_ID,
  ATLAS_SELF_PROJECT_ID,
  ATLAS_SELF_TENANT_ID,
  atlasSelfApprovalContext,
  isAtlasSelfApplicationId,
  isAtlasSelfApprovalContext,
  isAtlasSelfProjectId,
} from "./atlas-self.js";
import {
  atlasSelfArtifactHash,
  atlasSelfControlArtifactHash,
} from "./atlas-self-hash.js";

describe("Atlas-self identity", () => {
  it("preserves def-000 and rejects a wrong application id", () => {
    expect(ATLAS_SELF_APPLICATION_ID).toBe("def-000");
    expect(isAtlasSelfApplicationId("def-000")).toBe(true);
    expect(isAtlasSelfApplicationId("hotel-os")).toBe(false);
    expect(isAtlasSelfApplicationId(null)).toBe(false);
  });

  it("rejects a wrong project and tenant on the context helper", () => {
    expect(isAtlasSelfProjectId(ATLAS_SELF_PROJECT_ID)).toBe(true);
    expect(isAtlasSelfProjectId("11111111-1111-4111-8111-111111111111")).toBe(
      false,
    );
    const context = atlasSelfApprovalContext({ route: "test" });
    expect(context["applicationId"]).toBe("def-000");
    expect(context["projectId"]).toBe(ATLAS_SELF_PROJECT_ID);
    expect(context["tenantId"]).toBe(ATLAS_SELF_TENANT_ID);
    expect(isAtlasSelfApprovalContext(context)).toBe(true);
    expect(isAtlasSelfApprovalContext({ applicationId: "hotel-os" })).toBe(
      false,
    );
    expect(isAtlasSelfApprovalContext({})).toBe(false);
  });

  it("artifact hashes are stable and change when the bound target changes", () => {
    const a = atlasSelfArtifactHash({ path: "a.ts", projectId: ATLAS_SELF_PROJECT_ID });
    const b = atlasSelfArtifactHash({ path: "a.ts", projectId: ATLAS_SELF_PROJECT_ID });
    const c = atlasSelfArtifactHash({ path: "b.ts", projectId: ATLAS_SELF_PROJECT_ID });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    const pause = atlasSelfControlArtifactHash("CODE_ENGINEER", "pause");
    expect(pause).toBe(
      atlasSelfArtifactHash({
        applicationId: ATLAS_SELF_APPLICATION_ID,
        agentId: "CODE_ENGINEER",
        controlAction: "pause",
      }),
    );
    expect(pause).not.toBe(atlasSelfControlArtifactHash("QA", "pause"));
  });
});
