import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** Resolve BrokerOS / golden lab path — names are lab-only, not product locks. */
export function defaultGoldenRoot(envRoot?: string | null): string {
  if (envRoot && existsSync(envRoot)) return envRoot;
  const candidates = [
    resolve(process.cwd(), "..", "..", "brokerOS-main"),
    resolve(process.cwd(), "..", "brokerOS-main"),
    "C:\\Users\\User\\Desktop\\game\\brokerOS-main",
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0]!;
}

export function resolveWorkspaceRoot(opts: {
  queryRoot?: string | null;
  envRoot?: string | null;
}): string | null {
  const preferred =
    (opts.queryRoot && opts.queryRoot.length > 0 ? opts.queryRoot : null) ||
    (opts.envRoot && opts.envRoot.length > 0 ? opts.envRoot : null) ||
    defaultGoldenRoot(opts.envRoot ?? undefined);
  return existsSync(preferred) ? preferred : null;
}
