import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import en from "../messages/en.json";
import fr from "../messages/fr.json";
import { localeDir } from "./locale-dir";
import { PTY_COPY, ptyCopyFor } from "./studio-pty-copy";

type Tree = { [key: string]: string | Tree };

function leaves(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(path, value);
    else for (const [p, v] of leaves(value, path)) out.set(p, v);
  }
  return out;
}

function placeholders(value: string): string[] {
  return (value.match(/\{[a-zA-Z0-9_]+\}/g) ?? []).sort();
}

const enLeaves = leaves(en as Tree);
const frLeaves = leaves(fr as Tree);

describe("French messages", () => {
  it("has exactly the same keys as English", () => {
    expect([...frLeaves.keys()].sort()).toEqual([...enLeaves.keys()].sort());
  });

  it("keeps every placeholder of the English message", () => {
    const mismatched = [...enLeaves].filter(
      ([key, value]) => placeholders(value).join() !== placeholders(frLeaves.get(key) ?? "").join(),
    );
    expect(mismatched.map(([key]) => key)).toEqual([]);
  });

  it("never leaves a translated value empty", () => {
    const empty = [...enLeaves].filter(
      ([key, value]) => value.trim() !== "" && (frLeaves.get(key) ?? "").trim() === "",
    );
    expect(empty.map(([key]) => key)).toEqual([]);
  });

  it("uses no ASCII apostrophe, which ICU treats as an escape before braces", () => {
    const withApostrophe = [...frLeaves].filter(([, value]) => value.includes("'"));
    expect(withApostrophe.map(([key]) => key)).toEqual([]);
  });

  it("formats every message through next-intl without errors", () => {
    const errors: string[] = [];
    const t = createTranslator({
      locale: "fr",
      messages: fr,
      onError: (error) => errors.push(error.message),
    });
    for (const [key, value] of frLeaves) {
      const values = Object.fromEntries(
        placeholders(value).map((p) => [p.slice(1, -1), "x"]),
      );
      (t as unknown as (k: string, v: Record<string, string>) => string)(key, values);
    }
    expect(errors).toEqual([]);
  });
});

describe("French locale wiring", () => {
  it("renders French left-to-right and only Hebrew and Arabic right-to-left", () => {
    expect(localeDir("fr")).toBe("ltr");
    expect(localeDir("en")).toBe("ltr");
    expect(localeDir("he")).toBe("rtl");
    expect(localeDir("ar")).toBe("rtl");
  });

  it("gives the Studio terminal a French copy with the same keys", () => {
    expect(ptyCopyFor("fr")).toBe(PTY_COPY.fr);
    expect(Object.keys(PTY_COPY.fr).sort()).toEqual(Object.keys(PTY_COPY.en).sort());
  });
});
