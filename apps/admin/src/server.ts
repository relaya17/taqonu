import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { authorizeAdminRequest } from "./admin-auth.js";
import { renderOwnerHtml } from "./owner-html.js";

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
    const [apps, agents, brief, selfAudit] = await Promise.all([
      fetchJson("/api/v1/applications"),
      fetchJson("/api/v1/agents"),
      fetchJson("/api/v1/owner/brief"),
      fetchJson("/api/v1/self-audit"),
    ]);
    const appItems =
      apps && typeof apps === "object" && "items" in apps
        ? (apps as { items: Record<string, unknown>[] }).items
        : [];
    const agentItems = Array.isArray(agents)
      ? (agents as Record<string, unknown>[])
      : [];
    return renderOwnerHtml({
      controlApi: CONTROL_API,
      applications: appItems,
      agents: agentItems,
      brief: (brief as Record<string, unknown>) ?? null,
      selfAudit: (selfAudit as Record<string, unknown>) ?? null,
      error: null,
    });
  } catch (error) {
    return renderOwnerHtml({
      controlApi: CONTROL_API,
      applications: [],
      agents: [],
      brief: null,
      selfAudit: null,
      error:
        error instanceof Error
          ? `Control API unreachable (${error.message}). Start apps/control-plane on 3100.`
          : "Control API unreachable",
    });
  }
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (!authorizeAdminRequest(req, res)) return;
  const pathname = new URL(
    req.url ?? "/",
    `http://${req.headers.host ?? "localhost"}`,
  ).pathname;
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
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`[atlas-admin] Owner Control Plane UI http://${HOST}:${PORT}/`);
});

export { server };
