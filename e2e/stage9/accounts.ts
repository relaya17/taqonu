import { mkdir, writeFile } from "node:fs/promises";
import { expect, type APIResponse, type BrowserContext, type Page } from "@playwright/test";
import {
  assertLoopbackCookieHost,
  softenLoopbackSessionCookies,
  stage9ApiBase,
  stage9MutationHeaders,
} from "./local-api";
import {
  STAGE9_AUTH_DIR,
  STAGE9_IDENTITY_RECORD,
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
  context: BrowserContext,
  identity: Stage9Identity,
): Promise<Stage9IdentityRecord> {
  const api = stage9ApiBase();
  const register = await context.request.post(`${api}/api/v1/auth/register`, {
    data: {
      email: identity.email,
      password: identity.password,
      displayName: identity.displayName,
      locale: "en",
    },
    headers: stage9MutationHeaders(),
  });

  if (register.status() === 201) {
    await installLoopbackAuthCookies(context, register);
    return recordFromSession(identity, (await register.json()) as SessionPayload);
  }

  if (register.status() !== 409) {
    const body = await register.text();
    throw new Error(
      `Stage 9 register for ${identity.email} failed: ${register.status()} ${body}`,
    );
  }

  const login = await context.request.post(`${api}/api/v1/auth/login`, {
    data: { email: identity.email, password: identity.password },
    headers: stage9MutationHeaders(),
  });
  if (!login.ok()) {
    const body = await login.text();
    throw new Error(
      `Stage 9 login for existing ${identity.email} failed: ${login.status()} ${body}`,
    );
  }
  await installLoopbackAuthCookies(context, login);
  return recordFromSession(identity, (await login.json()) as SessionPayload);
}

async function installLoopbackAuthCookies(
  context: BrowserContext,
  response: APIResponse,
): Promise<void> {
  const api = stage9ApiBase();
  const setCookies = response
    .headersArray()
    .filter((header) => header.name.toLowerCase() === "set-cookie");
  if (setCookies.length === 0) {
    await softenLoopbackSessionCookies(context);
    return;
  }
  const cookies = setCookies.flatMap(({ value }) => {
    const attrs = value.split(";");
    const pair = attrs[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq <= 0) {
      return [];
    }
    const domainAttr = attrs.find((part) => /^\s*domain=/i.test(part));
    if (domainAttr) {
      assertLoopbackCookieHost(domainAttr.replace(/^\s*domain=/i, "").trim());
    }
    const rawValue = pair.slice(eq + 1).trim();
    let decoded = rawValue;
    try {
      decoded = decodeURIComponent(rawValue);
    } catch {
      decoded = rawValue;
    }
    // Playwright 1.51 rewriteCookies: url XOR path. Passing both throws
    // "Cookie should have either url or path".
    return [
      {
        name: pair.slice(0, eq).trim(),
        value: decoded,
        url: api,
        httpOnly: /httponly/i.test(value),
        sameSite: "Lax" as const,
      },
    ];
  });
  if (cookies.length === 0) {
    throw new Error("Stage 9 fixture: Set-Cookie headers were not parseable");
  }
  await context.clearCookies();
  await context.addCookies(cookies);
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
  await page.waitForURL(/\/(en|he|ar)\/studio(?:[/?#]|$)/, {
    timeout: 120_000,
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("heading", { level: 1, name: "Project Studio" }),
  ).toBeVisible({ timeout: 45_000 });
  await softenLoopbackSessionCookies(page.context());
}

export async function sessionFromPage(page: Page): Promise<Stage9IdentityRecord> {
  const api = stage9ApiBase(page.url());
  const res = await page.context().request.get(`${api}/api/v1/auth/me`);
  if (!res.ok()) {
    throw new Error(`Stage 9 /auth/me failed after local session setup: ${res.status()}`);
  }
  return recordFromSession(
    { email: "unknown" },
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
