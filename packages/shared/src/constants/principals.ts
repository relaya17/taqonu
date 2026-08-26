/**
 * Atlas principal kinds — who is acting, not a second policy engine.
 *
 * Customer admin ≠ Atlas operator. An agent is never a human. A Control
 * Plane bearer token is a SERVICE, never an implicit owner.
 */

export const ATLAS_PRINCIPAL_KINDS = [
  "CUSTOMER_USER",
  "CUSTOMER_ADMIN",
  "ATLAS_OPERATOR",
  "ATLAS_OWNER",
  "AGENT",
  "SERVICE",
] as const;

export type AtlasPrincipalKind = (typeof ATLAS_PRINCIPAL_KINDS)[number];

/** Authenticated Control Plane process — never "atlas-owner" by default. */
export const CONTROL_PLANE_SERVICE_ID = "cp:service";

export function principalKindFromRole(
  role: "user" | "admin" | "operator" | "owner",
): AtlasPrincipalKind {
  switch (role) {
    case "user":
      return "CUSTOMER_USER";
    case "admin":
      return "CUSTOMER_ADMIN";
    case "operator":
      return "ATLAS_OPERATOR";
    case "owner":
      return "ATLAS_OWNER";
  }
}

export function principalKindFromAgent(): AtlasPrincipalKind {
  return "AGENT";
}

export function controlPlaneServicePrincipal(): {
  readonly kind: "SERVICE";
  readonly id: typeof CONTROL_PLANE_SERVICE_ID;
} {
  return { kind: "SERVICE", id: CONTROL_PLANE_SERVICE_ID };
}

export function mayAccessControlPlane(kind: AtlasPrincipalKind): boolean {
  return kind === "ATLAS_OPERATOR" || kind === "ATLAS_OWNER" || kind === "SERVICE";
}

export function mayAdministerCustomerDirectory(kind: AtlasPrincipalKind): boolean {
  return (
    kind === "CUSTOMER_ADMIN" ||
    kind === "ATLAS_OPERATOR" ||
    kind === "ATLAS_OWNER"
  );
}

/** Control Plane roles are env-bootstrap only — never via /admin/users. */
export function mayGrantControlPlaneRole(kind: AtlasPrincipalKind): boolean {
  void kind;
  return false;
}

export function isCustomerPrincipal(kind: AtlasPrincipalKind): boolean {
  return kind === "CUSTOMER_USER" || kind === "CUSTOMER_ADMIN";
}
