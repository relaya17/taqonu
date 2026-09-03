import { describe, expect, it } from "vitest";
import {
  classifiedSourceAuthority,
  resolveCanonicalKnowledgeSource,
} from "./source-registry.js";

describe("canonical knowledge source registry", () => {
  it("binds allow-listed tech URLs to registry source_id, not the raw URL", () => {
    const source = resolveCanonicalKnowledgeSource({
      url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript",
      sourceClass: "OFFICIAL_VENDOR_DOCS",
      title: "MDN",
    });
    expect(source.allowed).toBe(true);
    expect(source.sourceId).toBe("mdn-js");
    expect(source.sourceId.startsWith("https://")).toBe(false);
    expect(source.authority).toBeGreaterThan(0.9);
  });

  it("treats unknown source classes as ineligible", () => {
    expect(classifiedSourceAuthority("BLOG_SPAM")).toBeNull();
    const source = resolveCanonicalKnowledgeSource({
      url: "https://medium.com/foo",
      sourceClass: "BLOG_SPAM",
    });
    expect(source.allowed).toBe(false);
    expect(source.authority).toBeNull();
  });

  it("keeps classified repository sources eligible without an allow-listed URL", () => {
    const source = resolveCanonicalKnowledgeSource({
      url: null,
      sourceClass: "REPOSITORY_SOURCE",
      title: "Lesson",
    });
    expect(source.allowed).toBe(true);
    expect(source.sourceId).toBe("repository");
  });
});
