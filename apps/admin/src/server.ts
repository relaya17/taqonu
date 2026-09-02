import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { platformHierarchyDocument } from "@atlas/shared";
import { authorizeAdminRequest } from "./admin-auth.js";
import { renderPlatformHtml } from "./platform-html.js";
import { composePlatformOverview } from "./platform-overview.js";
import {
  authenticateAdminBrowser,
  clearAdminBrowserSession,
  issueAdminBrowserSession,
  readAdminBrowserSession,
} from "./browser-session.js";

const PORT = parseInt(process.env["ADMIN_PORT"] ?? "3200", 10);
const HOST = process.env["HOST"] ?? "127.0.0.1";
const CONTROL_API =
  (process.env["ATLAS_CONTROL_PLANE_URL"] ?? "http://127.0.0.1:3100").replace(
    /\/$/,
    "",
  );
const WEB_ORIGIN = (process.env["WEB_ORIGIN"] ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);
const DEMO_LOGIN_ENABLED =
  process.env["NODE_ENV"] !== "production" ||
  process.env["ATLAS_DEMO_LOGIN_ENABLED"] === "1";

function adminOrigin(): string {
  return `http://${HOST}:${PORT}`;
}

function demoFields(): { demoEmail?: string; demoPassword?: string } {
  if (!DEMO_LOGIN_ENABLED) return {};
  return {
    demoEmail: process.env["ATLAS_DEV_EMAIL"] ?? "dev@atlas.local",
    demoPassword: process.env["ATLAS_DEV_PASSWORD"] ?? "AtlasDev1!",
  };
}

function platformPageBase() {
  return {
    controlOrigin: CONTROL_API,
    studioOrigin: WEB_ORIGIN,
    adminOrigin: adminOrigin(),
    ...demoFields(),
  };
}

async function fetchSupervisedJson(url: string): Promise<unknown> {
  const headers: Record<string, string> = {};
  const token = process.env["ATLAS_CONTROL_PLANE_TOKEN"]?.trim();
  if (token && url.startsWith(CONTROL_API)) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`${url} → ${res.status}`);
  }
  return res.json();
}

async function loadPlatformOverview() {
  return composePlatformOverview({
    adminOrigin: adminOrigin(),
    controlOrigin: CONTROL_API,
    studioOrigin: WEB_ORIGIN,
    fetchJson: fetchSupervisedJson,
  });
}

async function loadPlatformPage() {
  const overview = await loadPlatformOverview();
  return renderPlatformHtml({
    ...platformPageBase(),
    overview,
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}

function loginHtml(message = ""): string {
  const demoEnabled =
    process.env["NODE_ENV"] !== "production" ||
    process.env["ATLAS_DEMO_LOGIN_ENABLED"] === "1";
  const email = demoEnabled
    ? escapeHtml(process.env["ATLAS_DEV_EMAIL"] ?? "dev@atlas.local")
    : "";
  const password = demoEnabled
    ? escapeHtml(process.env["ATLAS_DEV_PASSWORD"] ?? "AtlasDev1!")
    : "";
  const escaped = escapeHtml(message);
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Atlas Admin</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0d10;color:#f5f5f5;font:16px sans-serif}main{width:min(360px,calc(100% - 40px));padding:28px;border:1px solid #30343b;background:#14171c}h1{font-size:24px;margin:0 0 8px}p{color:#aeb4be}label{display:block;margin-top:16px}input{box-sizing:border-box;width:100%;margin-top:6px;padding:11px;background:#0b0d10;color:#fff;border:1px solid #454b55}button{width:100%;margin-top:20px;padding:12px;border:0;background:#fff;color:#111;font-weight:700;cursor:pointer}.error{color:#ff8c8c}</style></head><body><main><h1>Atlas Admin</h1><p>כניסת בעלים בלבד</p>${escaped ? `<p class="error">${escaped}</p>` : ""}<form method="post" action="/auth/login"><label>אימייל<input type="email" name="email" value="${email}" autocomplete="username" required></label><label>סיסמה<input type="password" name="password" value="${password}" autocomplete="current-password" required autofocus></label><button type="submit">כניסה</button></form></main></body></html>`;
}

function sendHtml(res: ServerResponse, body: string, status = 200): void {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
  });
  res.end(body);
}

async function readLogin(req: IncomingMessage): Promise<{ email: string; password: string }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 16_384) throw new Error("Login request is too large");
    chunks.push(buffer);
  }
  const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
  return { email: form.get("email")?.trim() ?? "", password: form.get("password") ?? "" };
}

export function handleAdminRequest(
  req: IncomingMessage,
  res: ServerResponse,
): void {
  void handleAdminRequestAsync(req, res).catch((error: unknown) => {
    console.error(`[atlas-admin] request failed: ${error instanceof Error ? error.message : String(error)}`);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  });
}

async function handleAdminRequestAsync(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  const pathname = new URL(
    req.url ?? "/",
    `http://${req.headers.host ?? "localhost"}`,
  ).pathname;
  const method = (req.method ?? "GET").toUpperCase();
  if (pathname === "/favicon.ico" && (method === "GET" || method === "HEAD")) {
    res.writeHead(204, { "Cache-Control": "public, max-age=86400" });
    res.end();
    return;
  }
  if (pathname === "/" && method === "GET") {
    const hasBearer = typeof req.headers.authorization === "string";
    if (!hasBearer && !readAdminBrowserSession(req)) {
      sendHtml(res, renderPlatformHtml({ ...platformPageBase(), promoOnly: true }));
      return;
    }
  }
  if (pathname === "/login" && method === "GET") {
    const hasBearer = typeof req.headers.authorization === "string";
    if (!hasBearer && !readAdminBrowserSession(req)) {
      sendHtml(res, loginHtml());
      return;
    }
    res.writeHead(303, { Location: "/" });
    res.end();
    return;
  }
  if (pathname === "/auth/login" && method === "POST") {
    const credentials = await readLogin(req);
    const session = await authenticateAdminBrowser(credentials.email, credentials.password);
    if (!session) {
      sendHtml(res, loginHtml("פרטי הכניסה שגויים או שאין הרשאת owner"), 401);
      return;
    }
    res.setHeader("Set-Cookie", issueAdminBrowserSession(session.subject));
    res.writeHead(303, { Location: "/" });
    res.end();
    return;
  }
  if (pathname === "/auth/logout" && method === "POST") {
    res.setHeader("Set-Cookie", clearAdminBrowserSession());
    res.writeHead(303, { Location: "/login" });
    res.end();
    return;
  }
  if (!authorizeAdminRequest(req, res)) return;
  if (pathname === "/api/v1/platform/hierarchy" && method === "GET") {
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(platformHierarchyDocument()));
    return;
  }
  if (pathname === "/api/v1/platform/overview" && method === "GET") {
    const overview = await loadPlatformOverview();
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(overview));
    return;
  }
  if (pathname === "/" || pathname === "/index.html") {
    const html = await loadPlatformPage();
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    });
    res.end(html);
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
}

/** Entry used by the Vercel serverless function; see api/index.js. */
export function createRequestHandler(): (
  req: IncomingMessage,
  res: ServerResponse,
) => void {
  return handleAdminRequest;
}

const server = createServer(handleAdminRequest);

// Vercel invokes the exported handler per request. Binding a port inside a
// serverless function never gets a listener and stalls the invocation.
if (!process.env["VERCEL"]) {
  server.listen(PORT, HOST, () => {
    console.log(`[atlas-admin] Atlas Admin (platform supervisor) http://${HOST}:${PORT}/`);
  });
}

export { server };
