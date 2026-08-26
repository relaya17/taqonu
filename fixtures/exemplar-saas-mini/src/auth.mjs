import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const users = new Map();

function hashPassword(secret, password) {
  return createHmac("sha256", secret).update(password).digest("hex");
}

function signToken(secret, userId) {
  const payload = Buffer.from(JSON.stringify({ sub: userId, iat: Date.now() })).toString(
    "base64url",
  );
  const mac = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

export function verifyToken(secret, token) {
  const [payload, mac] = String(token || "").split(".");
  if (!payload || !mac) return null;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof data.sub === "string" ? data.sub : null;
  } catch {
    return null;
  }
}

export function registerUser(secret, email, password) {
  const key = email.trim().toLowerCase();
  if (!key || password.length < 8) {
    throw new Error("Email required and password must be at least 8 characters");
  }
  if (users.has(key)) throw new Error("Email already registered");
  const id = randomBytes(8).toString("hex");
  users.set(key, { id, email: key, passwordHash: hashPassword(secret, password) });
  return { id, email: key, token: signToken(secret, id) };
}

export function loginUser(secret, email, password) {
  const row = users.get(email.trim().toLowerCase());
  if (!row) throw new Error("Invalid email or password");
  const hash = hashPassword(secret, password);
  const a = Buffer.from(hash);
  const b = Buffer.from(row.passwordHash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("Invalid email or password");
  }
  return { id: row.id, email: row.email, token: signToken(secret, row.id) };
}

export function getUserById(id) {
  for (const row of users.values()) {
    if (row.id === id) return { id: row.id, email: row.email };
  }
  return null;
}

export function resetUsersForTests() {
  users.clear();
}
