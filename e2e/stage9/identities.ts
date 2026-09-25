import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Local/test-only Stage 9 identities.
 *
 * Scope: Playwright + local API on loopback. Never Production.
 * These emails are not Production accounts. Passwords are deterministic
 * test secrets for the local register/login path only.
 *
 * Do not use `approver@atlas.local` — that identity is not part of the
 * product architecture. SoD is two distinct registered users.
 *
 * Playwright/API test process may set:
 *   ATLAS_OPERATOR_EMAILS=stage9-decider@atlas.test
 * so bootstrapRole yields operator for the decider (existing write bypass
 * in assertProjectWriteAccess). Never set this in Production vercel.json.
 */
export const STAGE9_REQUESTER_EMAIL = "stage9-requester@atlas.test";
export const STAGE9_DECIDER_EMAIL = "stage9-decider@atlas.test";

/** Deterministic local-only password. Not a Production credential. */
export const STAGE9_REQUESTER_PASSWORD = "Stage9-Requester-Local-Only!";
/** Distinct deterministic local-only password. Not a Production credential. */
export const STAGE9_DECIDER_PASSWORD = "Stage9-Decider-Local-Only!";

export const STAGE9_OPERATOR_EMAILS_ENV = STAGE9_DECIDER_EMAIL;

const here = dirname(fileURLToPath(import.meta.url));

export const STAGE9_AUTH_DIR = join(here, "..", ".auth");
export const STAGE9_REQUESTER_STATE = join(STAGE9_AUTH_DIR, "requester.json");
export const STAGE9_DECIDER_STATE = join(STAGE9_AUTH_DIR, "decider.json");
export const STAGE9_IDENTITY_RECORD = join(STAGE9_AUTH_DIR, "identities.json");

export interface Stage9Identity {
  readonly key: "requester" | "decider";
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
}

export const STAGE9_REQUESTER: Stage9Identity = {
  key: "requester",
  email: STAGE9_REQUESTER_EMAIL,
  password: STAGE9_REQUESTER_PASSWORD,
  displayName: "Stage9 Requester",
};

export const STAGE9_DECIDER: Stage9Identity = {
  key: "decider",
  email: STAGE9_DECIDER_EMAIL,
  password: STAGE9_DECIDER_PASSWORD,
  displayName: "Stage9 Decider",
};

export interface Stage9IdentityRecord {
  readonly id: string;
  readonly email: string;
  readonly role: string;
}

export interface Stage9IdentityFile {
  readonly requester: Stage9IdentityRecord;
  readonly decider: Stage9IdentityRecord;
}
