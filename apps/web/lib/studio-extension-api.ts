"use client";

import { useMemo } from "react";
import { apiDelete, apiGet, apiPost, apiPut, type ApiRequestInit } from "@/lib/api";

/** Where an extension panel acts (ADR-026). */
export interface StudioExtensionScope {
  readonly extensionId: string;
  readonly projectId: string | null;
}

export const STUDIO_EXTENSION_HEADER = "x-arletos-extension";
export const STUDIO_EXTENSION_PROJECT_HEADER = "x-arletos-project";

export function studioExtensionHeaders(
  scope: StudioExtensionScope | null | undefined,
): Record<string, string> | undefined {
  if (!scope) return undefined;
  return {
    [STUDIO_EXTENSION_HEADER]: scope.extensionId,
    ...(scope.projectId ? { [STUDIO_EXTENSION_PROJECT_HEADER]: scope.projectId } : {}),
  };
}

/**
 * The API helpers, scoped to a Studio extension when the panel is rendered by
 * one: every request then carries the extension headers and the API enforces
 * the extension's declared routes and granted permissions. Without a scope
 * (core Studio surfaces such as Checks) they are the plain helpers.
 */
export function useStudioApi(scope?: StudioExtensionScope | null) {
  const extensionId = scope?.extensionId ?? null;
  const projectId = scope?.projectId ?? null;
  return useMemo(() => {
    const headers = studioExtensionHeaders(extensionId ? { extensionId, projectId } : null);
    const withHeaders = (init: ApiRequestInit = {}): ApiRequestInit =>
      headers ? { ...init, headers: { ...(init.headers ?? {}), ...headers } } : init;
    return {
      apiGet: <T,>(path: string, init?: ApiRequestInit) => apiGet<T>(path, withHeaders(init)),
      apiPost: <T,>(path: string, body: unknown, init?: ApiRequestInit) =>
        apiPost<T>(path, body, withHeaders(init)),
      apiPut: <T,>(path: string, body: unknown, init?: ApiRequestInit) =>
        apiPut<T>(path, body, withHeaders(init)),
      apiDelete: <T,>(path: string, body?: unknown, init?: ApiRequestInit) =>
        apiDelete<T>(path, body, withHeaders(init)),
    };
  }, [extensionId, projectId]);
}
