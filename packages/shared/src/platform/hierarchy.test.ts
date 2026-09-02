import { describe, expect, it } from "vitest";
import {
  ATLAS_PLATFORM_HIERARCHY,
  TENANT_ADMIN_SURFACE,
  isAtlasProductSurface,
  platformHierarchyDocument,
} from "./hierarchy.js";

describe("Atlas platform hierarchy", () => {
  it("places Admin above Control and Studio", () => {
    expect(ATLAS_PLATFORM_HIERARCHY.ADMIN.parent).toBeNull();
    expect(ATLAS_PLATFORM_HIERARCHY.ADMIN.supervises).toEqual([
      "CONTROL",
      "STUDIO",
    ]);
    expect(ATLAS_PLATFORM_HIERARCHY.CONTROL.parent).toBe("ADMIN");
    expect(ATLAS_PLATFORM_HIERARCHY.STUDIO.parent).toBe("ADMIN");
  });

  it("does not put Studio under Control", () => {
    expect(
      (ATLAS_PLATFORM_HIERARCHY.CONTROL.supervises as readonly string[]).includes(
        "STUDIO",
      ),
    ).toBe(false);
    expect(ATLAS_PLATFORM_HIERARCHY.STUDIO.runtime).toBe("apps/web");
    expect(ATLAS_PLATFORM_HIERARCHY.STUDIO.route).toBe("/[locale]/studio");
  });

  it("keeps tenant admin distinct from Atlas Admin", () => {
    const doc = platformHierarchyDocument();
    expect(doc.tenantAdminIsNotAtlasAdmin).toBe(true);
    expect(TENANT_ADMIN_SURFACE.runtime).toBe("apps/web/app/admin");
    expect(isAtlasProductSurface("ADMIN")).toBe(true);
    expect(isAtlasProductSurface("TENANT_ADMIN")).toBe(false);
  });
});
