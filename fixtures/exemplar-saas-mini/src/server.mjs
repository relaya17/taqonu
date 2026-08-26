import { createServer } from "node:http";
import { loadConfig } from "./config.mjs";
import { getUserById, loginUser, registerUser } from "./auth.mjs";
import { requireSession } from "./session.mjs";
import { applyWebhook, createCheckout } from "./payments.mjs";
import { healthPayload } from "./health.mjs";

function send(res, status, body, extraHeaders = {}) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "http://localhost:3000",
    "access-control-allow-credentials": "true",
    ...extraHeaders,
  });
  res.end(json);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

const config = loadConfig();
const server = createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "http://localhost:3000",
        "access-control-allow-credentials": "true",
        "access-control-allow-headers": "content-type",
        "access-control-allow-methods": "GET,POST,OPTIONS",
      });
      res.end();
      return;
    }
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/health") {
      send(res, 200, healthPayload(config.version));
      return;
    }
    if (req.method === "POST" && url.pathname === "/auth/register") {
      const body = await readBody(req);
      const user = registerUser(config.cookieSecret, body.email, body.password);
      send(res, 201, { user: { id: user.id, email: user.email } }, {
        "set-cookie": `session=${encodeURIComponent(user.token)}; HttpOnly; Path=/; SameSite=Lax`,
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/auth/login") {
      const body = await readBody(req);
      const user = loginUser(config.cookieSecret, body.email, body.password);
      send(res, 200, { user: { id: user.id, email: user.email } }, {
        "set-cookie": `session=${encodeURIComponent(user.token)}; HttpOnly; Path=/; SameSite=Lax`,
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/auth/me") {
      const userId = requireSession(config.cookieSecret, req.headers.cookie);
      send(res, 200, { user: getUserById(userId) });
      return;
    }
    if (req.method === "POST" && url.pathname === "/payments/checkout") {
      const userId = requireSession(config.cookieSecret, req.headers.cookie);
      const body = await readBody(req);
      send(res, 201, createCheckout(userId, body.amountCents));
      return;
    }
    if (req.method === "POST" && url.pathname === "/payments/webhook") {
      const body = await readBody(req);
      send(res, 200, applyWebhook(body.eventId, body.checkoutId));
      return;
    }
    send(res, 404, { error: "not found" });
  } catch (error) {
    const status = error?.statusCode === 401 ? 401 : 400;
    send(res, status, { error: error instanceof Error ? error.message : "error" });
  }
});

server.listen(config.port, "0.0.0.0", () => {
  process.stderr.write(`exemplar-saas-mini listening on ${config.port}\n`);
});
