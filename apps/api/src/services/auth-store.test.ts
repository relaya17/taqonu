import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  changeLocalPassword,
  createLocalUser,
  peekSession,
  setLocalPasswordByEmail,
  setUserDisabled,
  signSession,
  ensureDevLocalUser,
  updateLocalUserProfile,
  verifyLocalPassword,
} from "./auth-store.js";
import {
  consumePasswordResetToken,
  createPasswordResetToken,
} from "./auth-reset.js";
import { listAuthSessionsForUser, revokeAuthSession } from "./auth-sessions.js";

const temps: string[] = [];

afterEach(() => {
  delete process.env.ATLAS_AUTH_PATH;
  delete process.env.ATLAS_SESSIONS_PATH;
  delete process.env.ATLAS_RESET_PATH;
  delete process.env.ATLAS_DEMO_LOGIN_ENABLED;
  delete process.env.NODE_ENV;
  for (const d of temps.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "atlas-auth-"));
  temps.push(dir);
  process.env.ATLAS_AUTH_PATH = join(dir, "users.json");
  process.env.ATLAS_SESSIONS_PATH = join(dir, "sessions.json");
  process.env.ATLAS_RESET_PATH = join(dir, "resets.json");
  writeFileSync(process.env.ATLAS_AUTH_PATH, JSON.stringify({ users: [] }));
  return dir;
}

describe("auth user system", () => {
  it("registers, updates profile, changes password, and tracks sessions", () => {
    sandbox();
    const user = createLocalUser({
      email: "owner@example.com",
      password: "password1",
      displayName: "Owner",
    });
    expect(user.role).toBe("admin");
    expect(user.hasPassword).toBe(true);

    const updated = updateLocalUserProfile(user.id, {
      displayName: "Atlas Owner",
      locale: "en",
    });
    expect(updated?.displayName).toBe("Atlas Owner");
    expect(updated?.locale).toBe("en");

    const session = signSession(user.id, "test-secret", 3600, {
      userAgent: "vitest",
      ip: "127.0.0.1",
    });
    const peeked = peekSession(session.token, "test-secret");
    expect(peeked?.userId).toBe(user.id);
    expect(peeked?.sessionId).toBe(session.sessionId);
    expect(listAuthSessionsForUser(user.id).length).toBe(1);

    expect(
      changeLocalPassword(user.id, "password1", "password2")?.hasPassword,
    ).toBe(true);
    expect(verifyLocalPassword("owner@example.com", "password2")?.id).toBe(
      user.id,
    );
    expect(verifyLocalPassword("owner@example.com", "password1")).toBeNull();

    revokeAuthSession(user.id, session.sessionId);
    expect(peekSession(session.token, "test-secret")).toBeNull();
  });

  it("supports password reset and disables login when account disabled", () => {
    sandbox();
    createLocalUser({
      email: "member@example.com",
      password: "password1",
    });
    const { token } = createPasswordResetToken("member@example.com");
    const consumed = consumePasswordResetToken(token);
    expect(consumed?.email).toBe("member@example.com");
    const resetUser = setLocalPasswordByEmail("member@example.com", "freshpass");
    expect(resetUser).not.toBeNull();
    expect(verifyLocalPassword("member@example.com", "freshpass")).not.toBeNull();

    setUserDisabled(resetUser!.id, true);
    expect(verifyLocalPassword("member@example.com", "freshpass")).toBeNull();
  });

  it("enables the demo owner in production only with an explicit flag", () => {
    sandbox();
    process.env.NODE_ENV = "production";
    expect(ensureDevLocalUser()).toBeNull();

    process.env.ATLAS_DEMO_LOGIN_ENABLED = "1";
    expect(ensureDevLocalUser()).toEqual({
      email: "dev@atlas.local",
      created: true,
    });
    expect(verifyLocalPassword("dev@atlas.local", "AtlasDev1!")?.role).toBe("owner");
  });
});
