import { describe, expect, it } from "vitest";
import { analyzeAdminNecessity, adminNecessitySummary } from "./admin-necessity.js";

describe("analyzeAdminNecessity", () => {
  it("does not require admin for a plain marketing site", () => {
    const s = analyzeAdminNecessity({
      blob: "export default function Landing() { return <h1>Hello</h1> }",
      names: "app/page.tsx\ncomponents/Hero.tsx",
    });
    expect(s.needsAdmin).toBe(false);
    expect(s.hasAdminUi).toBe(false);
    expect(adminNecessitySummary(s)).toMatch(/do not scaffold/i);
  });

  it("flags admin UI without server authz", () => {
    const s = analyzeAdminNecessity({
      blob: `
        // apps/web/app/admin/page.tsx
        if (user.role === "admin") return <AdminPanel />
      `,
      names: "apps/web/app/admin/page.tsx",
    });
    expect(s.hasAdminUi).toBe(true);
    expect(s.hasServerAuthz).toBe(false);
    expect(s.frontendOnlyRisk).toBe(true);
  });

  it("accepts server-enforced admin when user management exists", () => {
    const s = analyzeAdminNecessity({
      blob: `
        // apps/api/src/routes/auth.ts
        export function requireAdmin() { if (user.role === "admin") ...
        app.get("/api/v1/admin/users", listUsers)
        appendAudit({ type: "admin.action" })
      `,
      names: "apps/api/src/routes/auth.ts\napps/web/app/admin/users/page.tsx",
    });
    expect(s.needsAdmin).toBe(true);
    expect(s.hasServerAuthz).toBe(true);
    expect(s.needReasons.length).toBeGreaterThan(0);
  });
});
