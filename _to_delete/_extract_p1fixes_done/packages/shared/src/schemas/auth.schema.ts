import { z } from "zod";
import { isoDateTimeSchema, uuidSchema } from "./common.schema.js";

export const userRoleSchema = z.enum(["user", "admin"]);

export const authUserSchema = z.object({
  id: uuidSchema,
  email: z.string().email(),
  displayName: z.string().min(1).max(120).nullable(),
  role: userRoleSchema,
  locale: z.enum(["he", "en", "ar"]).default("he"),
  provider: z
    .enum(["email", "google", "github", "apple", "local"])
    .default("local"),
  avatarUrl: z.string().url().nullable().optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema.optional(),
  emailVerified: z.boolean().default(false),
  disabled: z.boolean().default(false),
  hasPassword: z.boolean().default(false),
  /** Whether TOTP-based MFA is fully enabled (post `mfa/confirm`) for this account. */
  mfaEnabled: z.boolean().default(false),
});

export const registerSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(120).optional(),
  locale: z.enum(["he", "en", "ar"]).optional(),
});

export const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
});

export const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(120).nullable().optional(),
  locale: z.enum(["he", "en", "ar"]).optional(),
  avatarUrl: z.string().url().max(2048).nullable().optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email().max(254),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(256),
  newPassword: z.string().min(8).max(128),
});

export const deleteAccountSchema = z.object({
  password: z.string().min(1).max(128).optional(),
  confirmEmail: z.string().email().optional(),
});

export const revokeSessionSchema = z.object({
  sessionId: z.string().uuid(),
});

/** Body for `/auth/mfa/confirm` and `/auth/mfa/disable` — a TOTP code or a backup code. */
export const mfaCodeSchema = z.object({
  code: z.string().min(6).max(24),
});

/** Body for `/auth/mfa/verify` — completes a login that returned `mfaRequired`. */
export const mfaVerifySchema = z.object({
  mfaToken: z.string().min(10).max(200),
  code: z.string().min(6).max(24),
});

/** Response of `/auth/mfa/setup` — secret + otpauth URI (render as QR client-side) + one-time backup codes. */
export const mfaSetupResponseSchema = z.object({
  secret: z.string().min(16),
  otpauthUrl: z.string(),
  backupCodes: z.array(z.string()).min(1),
});

/** Returned by `/auth/login` instead of a session when the account has MFA enabled. */
export const mfaRequiredResponseSchema = z.object({
  mfaRequired: z.literal(true),
  mfaToken: z.string(),
});

export const adminUpdateUserSchema = z.object({
  role: userRoleSchema.optional(),
  disabled: z.boolean().optional(),
});

export const authProvidersSchema = z.object({
  emailPassword: z.boolean(),
  google: z.boolean(),
  github: z.boolean(),
  apple: z.boolean(),
  cloudAuth: z.boolean(),
  supabaseUrl: z.string().url().nullable(),
});

export const authSessionSchema = z.object({
  user: authUserSchema,
  expiresAt: isoDateTimeSchema,
});

/** Capabilities the signed-in principal may exercise via API write guards. */
export const authCapabilitySchema = z.enum([
  "session",
  "write.patches.approve",
  "write.patches.apply",
  "write.patches.rollback",
  "write.contract",
  "write.workspace_root",
  "write.billing.plan",
  "write.billing.credits",
  "admin",
]);

export const authSessionDetailSchema = z.object({
  authenticated: z.literal(true),
  user: authUserSchema,
  role: userRoleSchema,
  capabilities: z.array(authCapabilitySchema).min(1),
  expiresAt: isoDateTimeSchema,
  sessionId: z.string().uuid().nullable().optional(),
});

export const authSessionAnonymousSchema = z.object({
  authenticated: z.literal(false),
  user: z.null(),
  role: z.null(),
  capabilities: z.array(authCapabilitySchema).length(0),
  expiresAt: z.null(),
  sessionId: z.null().optional(),
});

export const authSessionStateSchema = z.discriminatedUnion("authenticated", [
  authSessionDetailSchema,
  authSessionAnonymousSchema,
]);

export const authDeviceSessionSchema = z.object({
  id: uuidSchema,
  createdAt: isoDateTimeSchema,
  lastSeenAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema,
  userAgent: z.string().nullable(),
  ip: z.string().nullable(),
  current: z.boolean(),
});

export type AuthUser = z.infer<typeof authUserSchema>;
export type UserRole = z.infer<typeof userRoleSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type MfaCodeInput = z.infer<typeof mfaCodeSchema>;
export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>;
export type MfaSetupResponse = z.infer<typeof mfaSetupResponseSchema>;
export type MfaRequiredResponse = z.infer<typeof mfaRequiredResponseSchema>;
export type AuthProviders = z.infer<typeof authProvidersSchema>;
export type AuthSession = z.infer<typeof authSessionSchema>;
export type AuthCapability = z.infer<typeof authCapabilitySchema>;
export type AuthSessionDetail = z.infer<typeof authSessionDetailSchema>;
export type AuthSessionState = z.infer<typeof authSessionStateSchema>;
export type AuthDeviceSession = z.infer<typeof authDeviceSessionSchema>;

/** Shared helper: capabilities granted by role (Auth JWT when live; local fallback). */
export function capabilitiesForRole(role: UserRole): readonly AuthCapability[] {
  const base: AuthCapability[] = [
    "session",
    "write.patches.approve",
    "write.patches.apply",
    "write.patches.rollback",
    "write.contract",
    "write.workspace_root",
    "write.billing.plan",
    "write.billing.credits",
  ];
  if (role === "admin") {
    base.push("admin");
  }
  return base;
}
