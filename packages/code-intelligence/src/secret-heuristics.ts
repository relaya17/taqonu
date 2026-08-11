/** Heuristic: real secret material vs scanner pattern catalogs. */
export function looksLikeEmbeddedSecret(text: string): boolean {
  if (/(?:api[_-]?key|password)\s*[:=]\s*['\"][^'\"]{8,}/i.test(text)) {
    return true;
  }
  if (!/BEGIN (RSA |OPENSSH )?PRIVATE KEY/.test(text)) return false;
  // Ignore secret-scanner pattern catalogs (regex literals), not real key material.
  const withoutRegexLiterals = text.replace(
    /\/(?:\\\/|[^/\n])+\/[gimsuy]*/g,
    "",
  );
  return /BEGIN (RSA |OPENSSH )?PRIVATE KEY/.test(withoutRegexLiterals);
}
