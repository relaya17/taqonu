import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { authorizeAdminRequest } from "./admin-auth.js";
import { renderOwnerHtml } from "./owner-html.js";
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

async function fetchJson(path: string): Promise<unknown> {
  const headers: Record<string, string> = {};
  const token = process.env["ATLAS_CONTROL_PLANE_TOKEN"]?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${CONTROL_API}${path}`, { headers });
  if (!res.ok) {
    throw new Error(`${path} → ${res.status}`);
  }
  return res.json();
}

async function loadOwnerPage() {
  try {
    const [apps, agents, brief, selfAudit, portfolio] = await Promise.all([
      fetchJson("/api/v1/applications"),
      fetchJson("/api/v1/agents"),
      fetchJson("/api/v1/owner/brief"),
      fetchJson("/api/v1/self-audit"),
      fetchJson("/api/v1/portfolio-governance").catch(() => null),
    ]);
    const appItems =
      apps && typeof apps === "object" && "items" in apps
        ? (apps as { items: Record<string, unknown>[] }).items
        : [];
    const agentItems = Array.isArray(agents)
      ? (agents as Record<string, unknown>[])
      : [];
    const portfolioRecord =
      portfolio && typeof portfolio === "object"
        ? (portfolio as {
            snapshot?: {
              applications?: Record<string, unknown>[];
              sourceAgents?: Record<string, unknown>[];
              capabilities?: Record<string, unknown>[];
              evidence?: Record<string, unknown>[];
              dedupRelations?: Record<string, unknown>[];
              governanceDecisions?: Record<string, unknown>[];
              conflicts?: Record<string, unknown>[];
              canonicalCapabilities?: Record<string, unknown>[];
            };
          })
        : null;
    return renderOwnerHtml({
      controlApi: CONTROL_API,
      applications: appItems,
      agents: agentItems,
      portfolioApps: portfolioRecord?.snapshot?.applications ?? [],
      portfolioSourceAgents: portfolioRecord?.snapshot?.sourceAgents ?? [],
      portfolioCapabilities: portfolioRecord?.snapshot?.capabilities ?? [],
      portfolioEvidence: portfolioRecord?.snapshot?.evidence ?? [],
      portfolioDedup: portfolioRecord?.snapshot?.dedupRelations ?? [],
      portfolioDecisions: portfolioRecord?.snapshot?.governanceDecisions ?? [],
      portfolioConflicts: portfolioRecord?.snapshot?.conflicts ?? [],
      portfolioCanonicals: portfolioRecord?.snapshot?.canonicalCapabilities ?? [],
      brief: (brief as Record<string, unknown>) ?? null,
      selfAudit: (selfAudit as Record<string, unknown>) ?? null,
      error: null,
    });
  } catch (error) {
    return renderOwnerHtml({
      controlApi: CONTROL_API,
      applications: [],
      agents: [],
      portfolioApps: [],
      portfolioSourceAgents: [],
      portfolioCapabilities: [],
      portfolioEvidence: [],
      portfolioDedup: [],
      portfolioDecisions: [],
      portfolioConflicts: [],
      portfolioCanonicals: [],
      brief: null,
      selfAudit: null,
      error:
        error instanceof Error
          ? `Control API unreachable (${error.message}). Start apps/control-plane on 3100.`
          : "Control API unreachable",
    });
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}

function loginHtml(message = ""): string {
  const development = process.env["NODE_ENV"] !== "production";
  const email = development
    ? escapeHtml(process.env["ATLAS_DEV_EMAIL"] ?? "dev@atlas.local")
    : "";
  const password = development
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
  if ((pathname === "/" || pathname === "/login") && method === "GET") {
    const hasBearer = typeof req.headers.authorization === "string";
    if (!hasBearer && !readAdminBrowserSession(req)) {
      sendHtml(res, loginHtml());
      return;
    }
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
  if (pathname === "/" || pathname === "/index.html") {
    void loadOwnerPage().then((html) => {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
      });
      res.end(html);
    });
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
    console.log(`[atlas-admin] Owner Control Plane UI http://${HOST}:${PORT}/`);
  });
}

export { server };
