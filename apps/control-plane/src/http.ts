import type { IncomingMessage, ServerResponse } from "node:http";
import { createApiRouter } from "./routes/api.js";
import { getDashboardHtml } from "./routes/dashboard.js";
import { getLandingHtml } from "./routes/landing.js";
import { html, json, methodNotAllowed, notFound } from "./routes/router.js";
import {
  authorizeControlPlaneRequest,
  isControlPlanePublicPath,
} from "./control-plane-auth.js";
import { refuseAuditMutation } from "./services/governance-state.js";
import {
  applyControlPlaneSecurityHeaders,
  checkRateLimit,
  resolveRequestId,
} from "./services/control-plane-hardening.js";
import {
  authenticateControlBrowser,
  clearControlBrowserSession,
  completeControlBrowserMfa,
  issueControlBrowserSession,
  readControlBrowserSession,
} from "./browser-session.js";

const apiRouter = createApiRouter();

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}

function loginHtml(
  message = "",
  challenge?: { readonly mfaToken: string; readonly email: string },
): string {
  const demoEnabled =
    process.env["NODE_ENV"] !== "production" ||
    process.env["ATLAS_DEMO_LOGIN_ENABLED"] === "1";
  const email = escapeHtml(
    challenge?.email ||
      (demoEnabled ? (process.env["ATLAS_DEV_EMAIL"] ?? "dev@atlas.local") : ""),
  );
  const password = demoEnabled && !challenge
    ? escapeHtml(process.env["ATLAS_DEV_PASSWORD"] ?? "AtlasDev1!")
    : "";
  const escaped = escapeHtml(message);
  const mfaFields = challenge
    ? `<input type="hidden" name="mfaToken" value="${escapeHtml(challenge.mfaToken)}"><label>קוד MFA<input type="text" name="code" inputmode="numeric" autocomplete="one-time-code" required autofocus></label>`
    : `<label>סיסמה<input type="password" name="password" value="${password}" autocomplete="current-password" required autofocus></label>`;
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Atlas Control</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0d10;color:#f5f5f5;font:16px sans-serif}main{width:min(360px,calc(100% - 40px));padding:28px;border:1px solid #30343b;background:#14171c}h1{font-size:24px;margin:0 0 8px}p{color:#aeb4be}label{display:block;margin-top:16px}input{box-sizing:border-box;width:100%;margin-top:6px;padding:11px;background:#0b0d10;color:#fff;border:1px solid #454b55}button{width:100%;margin-top:20px;padding:12px;border:0;background:#fff;color:#111;font-weight:700;cursor:pointer}.error{color:#ff8c8c}</style></head><body><main><h1>Atlas Control</h1><p>${challenge ? "נדרש קוד אימות" : "כניסת מפעיל או בעלים"}</p>${escaped ? `<p class="error">${escaped}</p>` : ""}<form method="post" action="/auth/login"><label>אימייל<input type="email" name="email" value="${email}" autocomplete="username" required></label>${mfaFields}<button type="submit">כניסה</button></form></main></body></html>`;
}

async function readLogin(req: IncomingMessage): Promise<{
  email: string;
  password: string;
  mfaToken: string;
  code: string;
}> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 16_384) throw new Error("Login request is too large");
    chunks.push(buffer);
  }
  const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
  return {
    email: form.get("email")?.trim() ?? "",
    password: form.get("password") ?? "",
    mfaToken: form.get("mfaToken")?.trim() ?? "",
    code: form.get("code")?.trim() ?? "",
  };
}

async function requestHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  res.setHeader("Access-Control-Allow-Origin", process.env["WEB_ORIGIN"] ?? "http://localhost:3000");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Atlas-Reason, X-Atlas-Reauth, X-Request-Id, X-Idempotency-Key, X-Atlas-Civio-Timestamp, X-Atlas-Civio-Nonce, X-Atlas-Civio-Signature",
  );

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const requestId = resolveRequestId(req);
  req.headers["x-request-id"] = requestId;
  applyControlPlaneSecurityHeaders(res, requestId);

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
    const webOrigin = process.env["WEB_ORIGIN"];
    const adminOrigin = process.env["ATLAS_ADMIN_URL"];
    const demoEnabled =
      process.env["NODE_ENV"] !== "production" ||
      process.env["ATLAS_DEMO_LOGIN_ENABLED"] === "1";
    html(res, getLandingHtml({
      ...(webOrigin ? { webOrigin } : {}),
      ...(adminOrigin ? { adminOrigin } : {}),
      ...(demoEnabled
        ? {
            demoEmail: process.env["ATLAS_DEV_EMAIL"] ?? "dev@atlas.local",
            demoPassword: process.env["ATLAS_DEV_PASSWORD"] ?? "AtlasDev1!",
          }
        : {}),
    }));
    return;
  }

  if (pathname === "/login" && method === "GET") {
    if (readControlBrowserSession(req)) {
      res.writeHead(303, { Location: "/dashboard" });
      res.end();
      return;
    }
    html(res, loginHtml());
    return;
  }

  if (pathname === "/auth/login" && method === "POST") {
    const credentials = await readLogin(req);
    if (credentials.mfaToken) {
      const session = await completeControlBrowserMfa(credentials.mfaToken, credentials.code);
      if (!session) {
        html(
          res,
          loginHtml("קוד האימות שגוי או שפג תוקפו", {
            mfaToken: credentials.mfaToken,
            email: credentials.email,
          }),
          401,
        );
        return;
      }
      res.setHeader(
        "Set-Cookie",
        issueControlBrowserSession(session.role, session.subject, { mfaSatisfied: true }),
      );
      res.writeHead(303, { Location: "/dashboard" });
      res.end();
      return;
    }
    const result = await authenticateControlBrowser(credentials.email, credentials.password);
    if (!result) {
      html(res, loginHtml("פרטי הכניסה שגויים או שאין הרשאת Control Plane"), 401);
      return;
    }
    if (result.status === "mfa_required") {
      html(res, loginHtml("", { mfaToken: result.mfaToken, email: credentials.email }));
      return;
    }
    res.setHeader(
      "Set-Cookie",
      issueControlBrowserSession(result.role, result.subject, { mfaSatisfied: false }),
    );
    res.writeHead(303, { Location: "/dashboard" });
    res.end();
    return;
  }

  if (pathname === "/auth/logout" && method === "POST") {
    res.setHeader("Set-Cookie", clearControlBrowserSession());
    res.writeHead(303, { Location: "/login" });
    res.end();
    return;
  }

  if (!isControlPlanePublicPath(pathname)) {
    const limited = checkRateLimit(req);
    if (!limited.allowed) {
      res.setHeader("Retry-After", String(limited.retryAfterSec));
      json(res, { error: "Too many requests", requestId }, 429);
      return;
    }
  }

  if (!authorizeControlPlaneRequest(req, res, pathname)) return;

  if (
    pathname.startsWith("/api/v1/audit") &&
    (method === "DELETE" || method === "PUT" || method === "PATCH")
  ) {
    const refused = refuseAuditMutation(method);
    methodNotAllowed(res, refused.error);
    return;
  }

  const handled = await apiRouter.handle(req, res);
  if (handled) return;

  if (pathname === "/dashboard") {
    html(res, getDashboardHtml());
    return;
  }

  notFound(res);
}

function handleControlPlaneRequest(
  req: IncomingMessage,
  res: ServerResponse,
): void {
  requestHandler(req, res).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[control-plane] unhandled error: ${message}`);
    if (!res.headersSent) {
      res.writeHead(500, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  });
}

/** Entry used by the Vercel serverless function and integration tests. */
export function createRequestHandler(): (
  req: IncomingMessage,
  res: ServerResponse,
) => void {
  return handleControlPlaneRequest;
}
