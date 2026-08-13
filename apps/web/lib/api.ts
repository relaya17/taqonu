const CONFIGURED_API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const LOOPBACK = new Set(["localhost", "127.0.0.1"]);

/**
 * Prefer the same loopback host the page was opened with so cookies/CORS stay
 * aligned (localhost vs 127.0.0.1).
 */
export function resolveApiUrl(): string {
  try {
    const configured = new URL(CONFIGURED_API_URL);
    if (typeof window !== "undefined" && LOOPBACK.has(configured.hostname)) {
      const pageHost = window.location.hostname;
      if (LOOPBACK.has(pageHost)) {
        configured.hostname = pageHost;
      }
    }
    return configured.toString().replace(/\/$/, "");
  } catch {
    return CONFIGURED_API_URL.replace(/\/$/, "");
  }
}

/** @deprecated Prefer resolveApiUrl() in browser code — kept for SSR imports. */
export const API_URL = CONFIGURED_API_URL.replace(/\/$/, "");

/** Separate admin console path (not under locale app shell). */
export const ADMIN_BASE_PATH = "/admin";
export const ADMIN_LOGIN_PATH = "/admin/login";

export function verifiedSourcesDownloadUrl(
  format: "json" | "markdown" = "json",
): string {
  return `${resolveApiUrl()}/api/v1/knowledge/verified-sources/download?format=${format}`;
}

export function downloadVerifiedSourcesPack(
  format: "json" | "markdown" = "json",
): void {
  if (typeof window === "undefined") return;
  window.open(verifiedSourcesDownloadUrl(format), "_blank", "noopener,noreferrer");
}

async function readError(path: string, response: Response): Promise<never> {
  let detail = `API ${path} failed with ${response.status}`;
  try {
    const json = (await response.json()) as {
      message?: string;
      error?: string | { message?: string };
    };
    if (typeof json.error === "object" && json.error?.message) {
      detail = json.error.message;
    } else if (typeof json.error === "string") {
      detail = json.error;
    } else if (json.message) {
      detail = json.message;
    }
  } catch {
    // ignore parse errors
  }
  throw new Error(detail);
}

const defaultInit: NonNullable<Parameters<typeof fetch>[1]> = {
  credentials: "include",
  cache: "no-store",
};

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${resolveApiUrl()}${path}`, {
    ...defaultInit,
  });
  if (!response.ok) {
    await readError(path, response);
  }
  return (await response.json()) as T;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${resolveApiUrl()}${path}`, {
    ...defaultInit,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    await readError(path, response);
  }
  return (await response.json()) as T;
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${resolveApiUrl()}${path}`, {
    ...defaultInit,
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    await readError(path, response);
  }
  return (await response.json()) as T;
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${resolveApiUrl()}${path}`, {
    ...defaultInit,
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    await readError(path, response);
  }
  return (await response.json()) as T;
}

export async function apiDelete<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${resolveApiUrl()}${path}`, {
    ...defaultInit,
    method: "DELETE",
    ...(body !== undefined
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  if (!response.ok) {
    await readError(path, response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}
