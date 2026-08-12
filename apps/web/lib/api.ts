export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

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
  const response = await fetch(`${API_URL}${path}`, {
    ...defaultInit,
  });
  if (!response.ok) {
    await readError(path, response);
  }
  return (await response.json()) as T;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
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
  const response = await fetch(`${API_URL}${path}`, {
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

export async function apiDelete<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
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
