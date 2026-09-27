export type TextDirection = "rtl" | "ltr";

const RTL_LOCALES: ReadonlySet<string> = new Set(["he", "ar"]);

export function localeDir(locale: string): TextDirection {
  return RTL_LOCALES.has(locale) ? "rtl" : "ltr";
}
