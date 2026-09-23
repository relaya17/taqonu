/**
 * R11 — resolve, classify, pin, then connect.
 *
 * DNS is performed once. The validated address is supplied to the TCP
 * connect via `lookup` override so Host / SNI stay on the original hostname
 * and a second unpinned lookup cannot happen. If that pin cannot be applied,
 * the request is rejected — never passed to generic `fetch(hostname)`.
 */

import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import type { IncomingHttpHeaders } from "node:http";
import {
  parseOutboundHttpUrl,
  requireHttpsUnlessAtlasInternal,
  verdictForResolvedAddresses,
  type ClassifiedAddress,
} from "../security/outbound-address.js";

const MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 12_000;

export class SafeOutboundHttpError extends Error {
  readonly code: string;

  constructor(code: string, message = code) {
    super(message);
    this.name = "SafeOutboundHttpError";
    this.code = code;
  }
}

export type OutboundResolveFn = (
  hostname: string,
) => Promise<readonly string[]>;

export interface OutboundConnectRequest {
  readonly url: URL;
  readonly pin: ClassifiedAddress;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: Buffer;
  readonly signal?: AbortSignal;
}

export interface OutboundConnectResult {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: Buffer;
}

export type OutboundConnectFn = (
  request: OutboundConnectRequest,
) => Promise<OutboundConnectResult>;

export interface SafeOutboundFetchOptions {
  readonly env?: {
    readonly ATLAS_API_URL?: string;
    readonly ATLAS_CONTROL_PLANE_URL?: string;
  };
  readonly resolve?: OutboundResolveFn;
  readonly connect?: OutboundConnectFn;
  readonly maxRedirects?: number;
}

export type SafeOutboundHeaders =
  | Record<string, string>
  | Iterable<readonly [string, string]>;

export interface SafeOutboundRequestInit {
  readonly method?: string;
  readonly headers?: SafeOutboundHeaders | unknown;
  readonly body?: string | Uint8Array | ArrayBuffer | null | unknown;
  readonly signal?: AbortSignal;
  readonly redirect?: "follow" | "error" | "manual" | string;
}

function isIpLiteral(hostname: string): boolean {
  const trimmed = hostname.replace(/^\[|\]$/g, "");
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(trimmed)) return true;
  return trimmed.includes(":");
}

export async function defaultResolveOutboundAddresses(
  hostname: string,
): Promise<readonly string[]> {
  if (isIpLiteral(hostname)) {
    return [hostname.replace(/^\[|\]$/g, "")];
  }
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  return records.map((row) => row.address);
}

function headersToRecord(headers?: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  const withForEach = headers as {
    forEach?: (callback: (value: string, key: string) => void) => void;
  };
  if (typeof withForEach.forEach === "function") {
    withForEach.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Symbol.iterator in Object(headers)) {
    for (const [key, value] of headers as Iterable<readonly [string, string]>) {
      out[key] = value;
    }
    return out;
  }
  for (const [key, value] of Object.entries(headers as Record<string, string>)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

function encodeBody(body: unknown): Buffer | undefined {
  if (body == null) return undefined;
  if (typeof body === "string") return Buffer.from(body);
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  throw new SafeOutboundHttpError(
    "OUTBOUND_BODY_UNSUPPORTED",
    "Safe outbound HTTP only accepts string or buffer bodies",
  );
}

function headerValue(headers: IncomingHttpHeaders, name: string): string | null {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0] ?? null;
  return typeof raw === "string" ? raw : null;
}

function toFetchHeaders(headers: IncomingHttpHeaders): Headers {
  const out = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (value == null || key === "transfer-encoding") continue;
    if (Array.isArray(value)) {
      for (const item of value) out.append(key, item);
    } else {
      out.set(key, value);
    }
  }
  return out;
}

function attachUrl(response: Response, url: string): Response {
  Object.defineProperty(response, "url", { value: url, configurable: true });
  return response;
}

export async function defaultPinnedConnect(
  request: OutboundConnectRequest,
): Promise<OutboundConnectResult> {
  const lib = request.url.protocol === "https:" ? https : http;
  const port =
    request.url.port === ""
      ? request.url.protocol === "https:"
        ? 443
        : 80
      : Number(request.url.port);
  if (!Number.isInteger(port) || port <= 0) {
    throw new SafeOutboundHttpError("OUTBOUND_PORT_INVALID");
  }

  return await new Promise<OutboundConnectResult>((resolve, reject) => {
    const req = lib.request(
      {
        protocol: request.url.protocol,
        hostname: request.url.hostname,
        port,
        path: `${request.url.pathname}${request.url.search}`,
        method: request.method,
        headers: {
          ...request.headers,
          host: request.url.host,
        },
        ...(request.url.protocol === "https:"
          ? { servername: request.url.hostname }
          : {}),
        lookup: (_hostname, _options, callback) => {
          callback(null, request.pin.address, request.pin.family);
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    req.on("error", (err) => {
      reject(
        new SafeOutboundHttpError(
          "OUTBOUND_CONNECT_FAILED",
          err instanceof Error ? err.message : "connect failed",
        ),
      );
    });
    const abort = () => {
      req.destroy(new SafeOutboundHttpError("OUTBOUND_ABORTED"));
    };
    if (request.signal) {
      if (request.signal.aborted) {
        abort();
        return;
      }
      request.signal.addEventListener("abort", abort, { once: true });
    }
    req.setTimeout(DEFAULT_TIMEOUT_MS, () => {
      req.destroy(new SafeOutboundHttpError("OUTBOUND_TIMEOUT"));
    });
    if (request.body) req.write(request.body);
    req.end();
  });
}

function redirectMethod(status: number, method: string): string {
  if (status === 303) return "GET";
  if ((status === 301 || status === 302) && method !== "GET" && method !== "HEAD") {
    return "GET";
  }
  return method;
}

export async function safeOutboundFetch(
  input: string | URL,
  init: SafeOutboundRequestInit = {},
  options: SafeOutboundFetchOptions = {},
): Promise<Response> {
  const env = options.env ?? process.env;
  const resolve = options.resolve ?? defaultResolveOutboundAddresses;
  const connect = options.connect ?? defaultPinnedConnect;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  const redirectMode = (init.redirect ?? "follow") as
    | "follow"
    | "error"
    | "manual";

  let current: URL;
  try {
    current = parseOutboundHttpUrl(String(input));
  } catch (err) {
    throw new SafeOutboundHttpError(
      err instanceof Error ? err.message : "OUTBOUND_URL_INVALID",
    );
  }
  let method = (init.method ?? "GET").toUpperCase();
  let headers = headersToRecord(init.headers);
  let body = encodeBody(init.body);
  const origin = current.origin;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    try {
      requireHttpsUnlessAtlasInternal(current, env);
    } catch (err) {
      throw new SafeOutboundHttpError(
        err instanceof Error ? err.message : "OUTBOUND_HTTPS_REQUIRED",
      );
    }
    let addresses: readonly string[];
    try {
      addresses = await resolve(current.hostname);
    } catch (err) {
      throw new SafeOutboundHttpError(
        "OUTBOUND_DNS_FAILED",
        err instanceof Error ? err.message : "DNS lookup failed",
      );
    }

    const verdict = verdictForResolvedAddresses(current, addresses, env);
    if (verdict.verdict === "deny" || !verdict.pin) {
      throw new SafeOutboundHttpError(verdict.reason);
    }

    const result = await connect({
      url: current,
      pin: verdict.pin,
      method,
      headers,
      ...(body ? { body } : {}),
      ...(init.signal ? { signal: init.signal } : {}),
    });

    const isRedirect = result.status >= 300 && result.status < 400;
    const location = headerValue(result.headers, "location");
    if (!isRedirect || !location) {
      return attachUrl(
        new Response(result.body, {
          status: result.status,
          headers: toFetchHeaders(result.headers),
        }),
        current.toString(),
      );
    }
    if (redirectMode === "manual") {
      return attachUrl(
        new Response(result.body, {
          status: result.status,
          headers: toFetchHeaders(result.headers),
        }),
        current.toString(),
      );
    }
    if (redirectMode === "error") {
      throw new SafeOutboundHttpError("OUTBOUND_REDIRECT_ERROR");
    }
    if (hop === maxRedirects) {
      throw new SafeOutboundHttpError("OUTBOUND_REDIRECT_LIMIT");
    }

    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      throw new SafeOutboundHttpError("OUTBOUND_REDIRECT_INVALID");
    }
    if (next.protocol !== "http:" && next.protocol !== "https:") {
      throw new SafeOutboundHttpError("OUTBOUND_REDIRECT_SCHEME");
    }

    current = parseOutboundHttpUrl(next.toString());
    method = redirectMethod(result.status, method);
    if (current.origin !== origin) {
      const stripped = { ...headers };
      delete stripped.authorization;
      delete stripped.Authorization;
      delete stripped.cookie;
      delete stripped.Cookie;
      headers = stripped;
    }
    if (method === "GET" || method === "HEAD") {
      body = undefined;
    }
  }

  throw new SafeOutboundHttpError("OUTBOUND_REDIRECT_LIMIT");
}
