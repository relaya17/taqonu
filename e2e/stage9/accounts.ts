import { mkdir, writeFile } from "node:fs/promises";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { API_BASE } from "../helpers";
import { assertLocalTestApiUrl, stage9ApiBase } from "./local-api";
import {
  STAGE9_AUTH_DIR,
  STAGE9_DECIDER,
  STAGE9_IDENTITY_RECORD,
  STAGE9_REQUESTER,
  type Stage9Identity,
  type Stage9IdentityFile,
  type Stage9IdentityRecord,
} from "./identities";

interface SessionPayload {
  authenticated?: boolean;
  user?: { id?: string; email?: string; role?: string };
  role?: string;
}

export async function ensureStage9Account(
  request: APIRequestContext,
  identity: Stage9Identity,
): Promise<Stage9IdentityRecord> {
  const api = assertLocalTestApiUrl(API_BASE).toString().replace(/\/$/, "");
  const register = await request.post(`${api}/api/v1/auth/register`, {
    data: {
      email: identity.email,
      password: identity.password,
      displayName: identity.displayName,
      locale: "en",
    },
    headers: { "content-type": "application/json" },
  });

  if (register.status() === 201) {
    return recordFromSession(identity, (await register.json()) as SessionPayload);
  }

  if (register.status() !== 409) {
    const body = await register.text();
    throw new Error(
      `Stage 9 register for ${identity.email} failed: ${register.status()} ${body}`,
    );
  }

  const login = await request.post(`${api}/api/v1/auth/login`, {
    data: { email: identity.email, password: identity.password },
    headers: { "content-type": "application/json" },
  });
  if (!login.ok()) {
    const body = await login.text();
    throw new Error(
      `Stage 9 login for existing ${identity.email} failed: ${login.status()} ${body}`,
    );
  }
  return recordFromSession(identity, (await login.json()) as SessionPayload);
}

export async function loginViaUi(page: Page, identity: Stage9Identity): Promise<void> {
  await page.goto("/en/auth/login", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1, name: /sign in/i })).toBeVisible({
    timeout: 60_000,
  });
  const email = page.getByRole("textbox", { name: /email/i });
  const password = page.getByRole("textbox", { name: /password/i });
  const submit = page.getByRole("button", { name: /^sign in$/i });
  await expect(email).toBeEditable();
  await email.click();
  await email.fill(identity.email);
  await expect(email).toHaveValue(identity.email);
  await password.click();
  await password.fill("");
  await password.pressSequentially(identity.password, { delay: 15 });
  await expect(password).toHaveValue(identity.password);
  await expect(submit).toBeEnabled({ timeout: 20_000 });
  await submit.click();
  await page.waitForURL(/\/(en|he|ar)\/studio/, { timeout: 120_000 });
}

export async function sessionFromPage(page: Page): Promise<Stage9IdentityRecord> {
  const api = stage9ApiBase(page.url());
  const res = await page.request.get(`${api}/api/v1/auth/me`);
  if (!res.ok()) {
    throw new Error(`Stage 9 /auth/me failed after UI login: ${res.status()}`);
  }
  return recordFromSession(
    { email: "unknown", password: "", displayName: "", key: "requester" },
    (await res.json()) as SessionPayload,
  );
}

export async function writeStage9IdentityFile(file: Stage9IdentityFile): Promise<void> {
  await mkdir(STAGE9_AUTH_DIR, { recursive: true });
  await writeFile(STAGE9_IDENTITY_RECORD, `${JSON.stringify(file, null, 2)}\n`, "utf8");
}

function recordFromSession(
  identity: Pick<Stage9Identity, "email">,
  payload: SessionPayload,
): Stage9IdentityRecord {
  const id = payload.user?.id;
  const email = payload.user?.email ?? identity.email;
  const role = payload.user?.role ?? payload.role;
  if (!payload.authenticated || !id || !role) {
    throw new Error(`Stage 9 expected an authenticated session for ${identity.email}`);
  }
  return { id, email, role };
}
