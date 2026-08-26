import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { loginUser, registerUser, resetUsersForTests, verifyToken } from "./auth.mjs";

const SECRET = "12345678901234567890123456789012";

describe("auth", () => {
  beforeEach(() => resetUsersForTests());

  it("registers and logs in with a signed session token", () => {
    const created = registerUser(SECRET, "a@example.com", "password1");
    assert.ok(verifyToken(SECRET, created.token));
    const logged = loginUser(SECRET, "a@example.com", "password1");
    assert.equal(logged.email, "a@example.com");
  });

  it("rejects short passwords and bad login", () => {
    assert.throws(() => registerUser(SECRET, "b@example.com", "short"), /8/);
    registerUser(SECRET, "c@example.com", "password1");
    assert.throws(() => loginUser(SECRET, "c@example.com", "wrongpass"), /Invalid/);
  });
});
