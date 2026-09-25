import { readFileSync } from "node:fs";

/**
 * Stage 9 local fixture only.
 * These emails already exist in the developer's local Supabase under the
 * old .atlas user ids. A fresh local auth file would register a new id,
 * then /auth/me would return the old Supabase id. Remove the Auth users
 * so the next register creates one id in both stores.
 * No-op when Supabase is the non-live sentinel (CI).
 */
const EMAILS = new Set([
  "stage9-requester@atlas.test",
  "stage9-decider@atlas.test",
]);

function envValue(text, key) {
  const line = text.split(/\r?\n/).find((entry) => entry.startsWith(`${key}=`));
  if (!line) return "";
  return line.slice(key.length + 1).trim().replace(/^["']|["']$/g, "");
}

const text = readFileSync("apps/api/.env", "utf8");
const url = envValue(text, "SUPABASE_URL").replace(/\/$/, "");
const key = envValue(text, "SUPABASE_SERVICE_ROLE_KEY");
if (!url || !key || key === "replace-me") {
  console.log("stage9 auth reset skipped: supabase is not live");
  process.exit(0);
}

const headers = {
  apikey: key,
  authorization: `Bearer ${key}`,
};

const found = [];
for (let page = 1; page < 20; page += 1) {
  const listed = await fetch(
    `${url}/auth/v1/admin/users?page=${page}&per_page=200`,
    { headers },
  );
  if (!listed.ok) {
    console.error(`stage9 auth reset: list users failed ${listed.status}`);
    process.exit(1);
  }
  const body = await listed.json();
  const users = Array.isArray(body.users) ? body.users : [];
  for (const user of users) {
    const email = String(user.email ?? "").toLowerCase();
    if (EMAILS.has(email)) found.push({ id: user.id, email });
  }
  if (users.length < 200) break;
}

for (const user of found) {
  const removed = await fetch(`${url}/auth/v1/admin/users/${user.id}`, {
    method: "DELETE",
    headers,
  });
  if (!removed.ok && removed.status !== 404) {
    console.error(`stage9 auth reset: delete ${user.email} failed ${removed.status}`);
    process.exit(1);
  }
  console.log(`stage9 auth reset: removed ${user.email}`);
}
if (found.length === 0) {
  console.log("stage9 auth reset: no existing fixture users");
}
