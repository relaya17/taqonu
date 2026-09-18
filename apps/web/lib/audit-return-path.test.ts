import { describe, expect, it } from "vitest";
import {
  allowlistedAuditNext,
  auditReturnPath,
  authHrefWithNext,
  inputDirForLocale,
} from "./audit-return-path";

describe("allowlistedAuditNext", () => {
  it("accepts Partners and Experts only", () => {
    expect(allowlistedAuditNext("/partners")).toBe("/partners");
    expect(allowlistedAuditNext("/experts")).toBe("/experts");
  });

  it("rejects external, protocol-relative, and unknown paths", () => {
    expect(allowlistedAuditNext("https://evil.example")).toBeNull();
    expect(allowlistedAuditNext("//evil.example")).toBeNull();
    expect(allowlistedAuditNext("/studio")).toBeNull();
    expect(allowlistedAuditNext("/partners/../evil")).toBeNull();
    expect(allowlistedAuditNext(null)).toBeNull();
  });
});

describe("auditReturnPath", () => {
  it("prefixes locale for allowlisted next", () => {
    expect(auditReturnPath("en", "/partners")).toBe("/en/partners");
    expect(auditReturnPath("he", "/experts")).toBe("/he/experts");
  });

  it("returns null so callers use Studio default", () => {
    expect(auditReturnPath("en", "https://evil.example")).toBeNull();
  });
});

describe("authHrefWithNext", () => {
  it("forwards allowlisted next on auth hops", () => {
    expect(authHrefWithNext("/auth/register", "/partners")).toBe(
      "/auth/register?next=/partners",
    );
    expect(authHrefWithNext("/auth/login", "/experts")).toBe(
      "/auth/login?next=/experts",
    );
  });

  it("omits next when not allowlisted", () => {
    expect(authHrefWithNext("/auth/register", "https://evil.example")).toBe(
      "/auth/register",
    );
  });

  it("appends next beside an existing query string", () => {
    expect(
      authHrefWithNext("/auth/reset?token=abc", "/partners"),
    ).toBe("/auth/reset?token=abc&next=/partners");
  });
});

describe("inputDirForLocale", () => {
  it("uses document direction, not a hardcoded RTL field", () => {
    expect(inputDirForLocale("en")).toBe("ltr");
    expect(inputDirForLocale("he")).toBe("rtl");
    expect(inputDirForLocale("ar")).toBe("rtl");
  });
});
