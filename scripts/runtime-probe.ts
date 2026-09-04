#!/usr/bin/env tsx
/**
 * Local runtime probe — observation only.
 * Does not start services. Reports whether default local ports respond.
 *
 * Usage: pnpm runtime:probe
 */
const TARGETS: readonly { readonly name: string; readonly url: string }[] = [
  { name: "web", url: "http://127.0.0.1:3000/" },
  { name: "control-plane", url: "http://127.0.0.1:3100/api/v1/status" },
  { name: "admin", url: "http://127.0.0.1:3200/" },
  { name: "api", url: "http://127.0.0.1:4000/health" },
];

async function probe(url: string): Promise<{ ok: boolean; status: number | null; error: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "manual" });
    return { ok: response.status > 0, status: response.status, error: null };
  } catch (error) {
    const message =
      error instanceof Error ? `${error.name}: ${error.message}` : "fetch-failed";
    return {
      ok: false,
      status: null,
      error: message,
    };
  } finally {
    clearTimeout(timer);
  }
}

const rows = [];
for (const target of TARGETS) {
  const result = await probe(target.url);
  rows.push({ ...target, ...result });
}

console.log(JSON.stringify({ probedAt: new Date().toISOString(), targets: rows }, null, 2));
