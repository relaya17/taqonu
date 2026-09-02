/**
 * ADR-021 (amended 2026-09-02) — Atlas trust planes.
 *
 * PUBLIC        — explicitly published marketing / health / auth handshake
 * USER PLANE    — authenticated tenant data; includes Studio and tenant /admin
 * CONTROL       — operational supervision (`apps/control-plane` :3100)
 * ADMIN         — platform supervisor over Control and Studio (`apps/admin` :3200)
 *
 * Admin is a parent surface. It is not a second Control dashboard.
 * Customer `admin` role is tenant administration, not Atlas Admin.
 */
export const ATLAS_TRUST_PLANES = ["public", "user", "control", "admin"] as const;
export type AtlasTrustPlane = (typeof ATLAS_TRUST_PLANES)[number];

export const CONTROL_PLANE_ROLES = ["operator", "owner"] as const;
export type ControlPlaneRole = (typeof CONTROL_PLANE_ROLES)[number];

/** Roles a customer admin may grant via UI. Never operator/owner. */
export const CUSTOMER_GRANTABLE_ROLES = ["user", "admin"] as const;
export type CustomerGrantableRole = (typeof CUSTOMER_GRANTABLE_ROLES)[number];

export const ATLAS_ARCHITECTURE_PRINCIPLES = [
  "PRIVATE-BY-DEFAULT",
  "CONTROLLED-EGRESS",
  "SEPARATE-CONTROL-PLANE",
  "SELF-GOVERNANCE",
] as const;

export function isControlPlaneRole(role: string | null | undefined): boolean {
  return role === "owner" || role === "operator";
}

export function isCustomerGrantableRole(
  role: string | null | undefined,
): role is CustomerGrantableRole {
  return role === "user" || role === "admin";
}

export function parseAtlasRole(
  raw: unknown,
): "user" | "admin" | "operator" | "owner" | null {
  if (raw === "user" || raw === "admin" || raw === "operator" || raw === "owner") {
    return raw;
  }
  return null;
}
