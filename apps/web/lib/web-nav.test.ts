import { describe, expect, it } from "vitest";
import {
  ADVANCED_NAV_KEYS,
  NAV_GROUPS,
  PRIMARY_NAV_KEYS,
  isWebNavSelected,
  navItemHref,
  renderedNavKeys,
  sidebarOmitsStudioChecks,
} from "./web-nav";

describe("Stage 6 primary navigation", () => {
  it("keeps D9 destinations and does not list Studio checks", () => {
    expect(PRIMARY_NAV_KEYS).toEqual([
      "studio",
      "dashboard",
      "agents",
      "settings",
    ]);
    expect(sidebarOmitsStudioChecks()).toBe(true);
    expect(renderedNavKeys()).not.toEqual(
      expect.arrayContaining([
        "truth",
        "health",
        "readiness",
        "qa",
        "processAudit",
        "observer",
        "sentinel",
      ]),
    );
  });

  it("has four primary destinations and no separate advanced group", () => {
    expect(NAV_GROUPS.map((group) => group.id)).toEqual(["main"]);
    expect(ADVANCED_NAV_KEYS).toEqual([]);
    expect(renderedNavKeys()).toEqual(["studio", "dashboard", "agents", "settings"]);
  });

  it("selects Studio while a check tab is open", () => {
    const params = {
      get: (name: string) =>
        name === "tab" ? "checks" : name === "check" ? "truth" : null,
    };
    expect(isWebNavSelected("studio", "/studio", params)).toBe(true);
    expect(isWebNavSelected("dashboard", "/studio", params)).toBe(false);
    expect(isWebNavSelected("truth", "/studio", params)).toBe(true);
    expect(renderedNavKeys()).not.toContain("truth");
  });

  it("does not mark Projects selected on a project state page", () => {
    const params = { get: () => null };
    expect(
      isWebNavSelected("projects", "/projects/abc/state", params),
    ).toBe(false);
    expect(isWebNavSelected("projects", "/projects", params)).toBe(true);
  });

  it("would still send a check key into Studio with the current project", () => {
    expect(navItemHref("truth", "proj-1")).toEqual({
      pathname: "/studio",
      query: { tab: "checks", check: "truth", project: "proj-1" },
    });
    expect(navItemHref("settings", "proj-1")).toBe("/settings");
    expect(navItemHref("studio", null)).toEqual({
      pathname: "/studio",
      query: { tab: "files" },
    });
    expect(navItemHref("studio", "  ")).toEqual({
      pathname: "/studio",
      query: { tab: "files" },
    });
    expect(navItemHref("studio", "proj-1")).toEqual({
      pathname: "/studio",
      query: { tab: "files", project: "proj-1" },
    });
    expect(navItemHref("projects", "proj-1")).toBe("/projects");
    expect(navItemHref("dashboard", "proj-1")).toBe("/");
    expect(navItemHref("agents", "proj-1")).toBe("/agents");
  });
});

describe("Stage 6 nav labels", () => {
  it("names Account and Agents in EN, HE, and AR and keeps the More group", async () => {
    const en = (await import("../messages/en.json")).default;
    const he = (await import("../messages/he.json")).default;
    const ar = (await import("../messages/ar.json")).default;
    expect(en.nav.settings).toBe("Account");
    expect(en.nav.agents).toBe("Agents");
    expect(en.nav.advancedGroup).toBe("More");
    expect(he.nav.settings).toBe("חשבון");
    expect(he.nav.agents).toBe("סוכנים");
    expect(he.nav.advancedGroup.length).toBeGreaterThan(0);
    expect(ar.nav.settings).toBe("الحساب");
    expect(ar.nav.agents).toBe("الوكلاء");
    expect(ar.nav.advancedGroup.length).toBeGreaterThan(0);
    expect(en.nav.opsGroup.length).toBeGreaterThan(0);
    expect(en.projects.openAgentChat).toBe("Agent chat");
    expect(he.projects.openAgentChat.length).toBeGreaterThan(0);
    expect(ar.projects.openAgentChat.length).toBeGreaterThan(0);
  });
});
