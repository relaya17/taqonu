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

export function handleAdminRequest(
  req: IncomingMessage,
  res: ServerResponse,
): void {
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
