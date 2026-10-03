"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPut } from "@/lib/api";

/** ADR-026 — shapes returned by /api/v1/studio/extensions and /projects/:id/studio/extensions. */
export interface StudioExtensionManifest {
  readonly id: string;
  readonly name: string;
  readonly kind: "builtin" | "official";
  readonly publisher: string;
  readonly version: string;
  readonly studio: string;
  readonly permissions: readonly string[];
  readonly capabilities: ReadonlyArray<{
    id: string;
    permission: string | null;
    source: string;
    dependencies: ReadonlyArray<StudioExtensionDependency>;
  }>;
  readonly contributes: {
    readonly activity: { icon: string; panel: string } | null;
    readonly commands: readonly string[];
  };
  readonly dependencies: ReadonlyArray<StudioExtensionDependency>;
}

export interface StudioExtensionDependency {
  readonly kind: string;
  readonly key?: string;
  readonly optional?: boolean;
}

/** Health contract (ADR-026): informational only — never authorization. */
export type StudioHealthState = "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "NOT_CHECKED";

export interface StudioExtensionHealth {
  readonly at: string;
  readonly status: StudioHealthState;
  readonly counts: {
    readonly healthy: number;
    readonly degraded: number;
    readonly unavailable: number;
    readonly notChecked: number;
    readonly total: number;
  };
  readonly capabilities: ReadonlyArray<{
    readonly id: string;
    readonly status: StudioHealthState;
    readonly dependencies: ReadonlyArray<{
      readonly kind: string;
      readonly key: string | null;
      readonly optional: boolean;
      readonly status: string;
      readonly reason: string | null;
      readonly durationMs: number;
    }>;
  }>;
}

export interface StudioExtensionEntry {
  readonly manifest: StudioExtensionManifest;
  readonly compatible: boolean;
  readonly installed: boolean;
  readonly installedVersion: string | null;
  readonly updateAvailable: boolean;
  readonly granted: readonly string[];
  readonly pendingPermissions: readonly string[];
  /** Project scope only. */
  readonly enabled?: boolean;
  readonly health?: StudioExtensionHealth | null;
}

export interface StudioExtensionsResponse {
  readonly studioVersion: string;
  readonly order?: readonly string[];
  readonly extensions: readonly StudioExtensionEntry[];
}

/** Health results younger than this are reused when a panel opens (contract §G). */
export const HEALTH_CACHE_MS = 60_000;

/** True when the API answered 429 — a temporary rate limit, not an outage. */
export function isRateLimitedError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { status?: unknown }).status === 429);
}

/** next-intl treats "." as a path separator; message keys use "_". */
export function extensionMessageKey(id: string): string {
  return id.replace(/[.-]/g, "_");
}

export function studioExtensionsQueryKey(projectId: string | null) {
  return ["studio-extensions", projectId ?? "catalog"] as const;
}

/** Catalog + install state (user scope), with project state when a project is open. */
export function useStudioExtensions(projectId: string | null) {
  return useQuery({
    queryKey: studioExtensionsQueryKey(projectId),
    queryFn: () =>
      apiGet<StudioExtensionsResponse>(
        projectId
          ? `/api/v1/projects/${encodeURIComponent(projectId)}/studio/extensions`
          : "/api/v1/studio/extensions/catalog",
      ),
    staleTime: 30_000,
  });
}

/** Enabled extensions that contribute an activity-bar icon, in the project's order. */
export function activityExtensions(data: StudioExtensionsResponse | undefined): StudioExtensionEntry[] {
  if (!data) return [];
  const order = data.order ?? [];
  const rank = (id: string) => {
    const index = order.indexOf(id);
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  };
  return data.extensions
    .filter((e) => e.enabled && e.manifest.contributes.activity)
    .slice()
    .sort((a, b) => rank(a.manifest.id) - rank(b.manifest.id));
}

export type StudioExtensionAction =
  | { kind: "install" | "uninstall" | "update"; id: string }
  | { kind: "enable" | "disable" | "verify"; id: string }
  | { kind: "permissions"; id: string; grant: string[]; revoke: string[] }
  | { kind: "order"; order: string[] };

export function useStudioExtensionAction(projectId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (action: StudioExtensionAction) => {
      const project = projectId ? encodeURIComponent(projectId) : null;
      switch (action.kind) {
        case "install":
        case "uninstall":
        case "update":
          return apiPost(`/api/v1/studio/extensions/${encodeURIComponent(action.id)}/${action.kind}`, {});
        case "permissions":
          return apiPost(`/api/v1/studio/extensions/${encodeURIComponent(action.id)}/permissions`, {
            grant: action.grant,
            revoke: action.revoke,
          });
        case "enable":
        case "disable":
        case "verify":
          if (!project) throw new Error("No project");
          return apiPost(
            `/api/v1/projects/${project}/studio/extensions/${encodeURIComponent(action.id)}/${action.kind}`,
            {},
          );
        case "order":
          if (!project) throw new Error("No project");
          return apiPut(`/api/v1/projects/${project}/studio/extensions/order`, { order: action.order });
      }
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["studio-extensions"] });
    },
  });
}
