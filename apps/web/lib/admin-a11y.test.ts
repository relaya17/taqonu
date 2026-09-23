import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("R19 admin Control surfaces", () => {
  it("admin login submits through a labeled form so Enter activates login", () => {
    const src = readFileSync(join(root, "app/admin/login/page.tsx"), "utf8");
    expect(src).toContain('component="form"');
    expect(src).toContain('type="submit"');
    expect(src).toContain('label="אימייל"');
    expect(src).toContain('label="סיסמה"');
    expect(src).toContain('role="alert"');
  });

  it("keeps Studio cancel-run copy in EN, HE, and AR", async () => {
    const en = (await import("../messages/en.json")).default;
    const he = (await import("../messages/he.json")).default;
    const ar = (await import("../messages/ar.json")).default;
    expect(en.studio.cancelRun.length).toBeGreaterThan(0);
    expect(he.studio.cancelRun.length).toBeGreaterThan(0);
    expect(ar.studio.cancelRun.length).toBeGreaterThan(0);
  });

  it("register-plugin dialog submits through a form and announces errors", () => {
    const src = readFileSync(
      join(root, "components/admin/Marketplace/RegisterPluginDialog.tsx"),
      "utf8",
    );
    expect(src).toContain('component="form"');
    expect(src).toContain('type="submit"');
    expect(src).toContain('role="alert"');
    expect(src).toContain('label="מזהה (id)"');
  });
});
