export const AUTH_SESSION_QUERY_KEY = ["auth-session"] as const;

/** Thrown by fetchAuthSession when the API returns authenticated:false (no active session). */
export class SignedOutError extends Error {
  constructor() {
    super("Not signed in");
    this.name = "SignedOutError";
  }
}

export type SessionGate = "checking" | "signed-in" | "signed-out" | "unavailable";

export interface AuthSession<T> {
  authenticated: boolean;
  user: T;
  role: string;
  capabilities: string[];
}

/**
 * Fetches the current auth session.
 * The endpoint is a soft probe: it always returns HTTP 200.
 * Throws SignedOutError when the response indicates no active session
 * (authenticated: false or missing user).
 * Throws Error on non-OK HTTP responses (network, 5xx, etc.).
 */
export async function fetchAuthSession<T>(): Promise<AuthSession<T>> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

  const response = await fetch(`${base}/api/v1/auth/session`, {
    credentials: "include",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Auth session fetch failed with ${response.status}`);
  }

  const data = (await response.json()) as {
    authenticated: boolean;
    user: T | null;
    role: string | null;
    capabilities: string[];
  };

  if (!data.authenticated || !data.user) {
    throw new SignedOutError();
  }

  return {
    authenticated: true,
    user: data.user,
    role: data.role ?? "",
    capabilities: data.capabilities,
  };
}

/**
 * Maps a TanStack Query result to a SessionGate state.
 * - "signed-in"   — query succeeded
 * - "signed-out"  — query failed with SignedOutError
 * - "unavailable" — query failed with any other error
 * - "checking"    — query is pending
 */
export function sessionGate(query: {
  isSuccess: boolean;
  isError: boolean;
  error: unknown;
}): SessionGate {
  if (query.isSuccess) return "signed-in";
  if (query.isError) {
    return query.error instanceof SignedOutError ? "signed-out" : "unavailable";
  }
  return "checking";
}
