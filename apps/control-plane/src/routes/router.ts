import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Minimal typed HTTP router for the control plane.
 *
 * No frameworks — the control plane is a governance surface, not a
 * product UI. It needs to be auditable, self-contained, and free of
 * third-party runtime dependencies that could introduce supply-chain
 * risk into the oversight layer.
 *
 * ── Why not share a framework with the engineering surface ────────────
 *
 * The two surfaces must be independently deployable. If both depend on
 * the same framework version, a framework upgrade in the engineering
 * surface forces a coordinated upgrade in the control plane — exactly
 * the coupling the two-surface architecture is designed to avoid.
 */

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
) => Promise<void> | void;

interface Route {
  readonly method: string;
  readonly pattern: RegExp;
  readonly paramNames: readonly string[];
  readonly handler: RouteHandler;
}

export class Router {
  private readonly routes: Route[] = [];

  get(path: string, handler: RouteHandler): void {
    this.addRoute("GET", path, handler);
  }

  post(path: string, handler: RouteHandler): void {
    this.addRoute("POST", path, handler);
  }

  private addRoute(method: string, path: string, handler: RouteHandler): void {
    const paramNames: string[] = [];
    const patternStr = path.replace(/:(\w+)/g, (_match, name: string) => {
      paramNames.push(name);
      return "([^/]+)";
    });
    this.routes.push({
      method,
      pattern: new RegExp(`^${patternStr}$`),
      paramNames,
      handler,
    });
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const pathname = url.pathname;

    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = route.pattern.exec(pathname);
      if (!match) continue;

      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => {
        const value = match[i + 1];
        if (value !== undefined) {
          params[name] = value;
        }
      });

      await route.handler(req, res, params);
      return true;
    }

    return false;
  }
}

// ── Response helpers ────────────────────────────────────────────────────

export function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data, null, 2));
}

export function html(res: ServerResponse, body: string, status = 200): void {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

export function notFound(res: ServerResponse): void {
  json(res, { error: "Not found" }, 404);
}
