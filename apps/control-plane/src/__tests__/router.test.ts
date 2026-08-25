import { describe, expect, it } from "vitest";
import { Router, json, html, notFound } from "../routes/router.js";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";

// ── Mock helpers ─────────────────────────────────────────────────────────

interface MockResponseData {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

function createMockReq(
  method: string,
  url: string,
): IncomingMessage {
  const readable = new Readable({ read() { /* noop */ } }) as IncomingMessage;
  readable.method = method;
  readable.url = url;
  readable.headers = { host: "localhost:3100" };
  return readable;
}

function createMockRes(): ServerResponse & { _mock: MockResponseData } {
  const data: MockResponseData = { statusCode: 200, headers: {}, body: "" };
  const mock = {
    _mock: data,
    writeHead(status: number, headers?: Record<string, string>) {
      data.statusCode = status;
      if (headers) {
        for (const [k, v] of Object.entries(headers)) {
          data.headers[k] = v;
        }
      }
      return mock;
    },
    setHeader(name: string, value: string) {
      data.headers[name] = value;
      return mock;
    },
    end(body?: string) {
      if (body) data.body = body;
      return mock;
    },
    headersSent: false,
  } as unknown as ServerResponse & { _mock: MockResponseData };
  return mock;
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("Control Plane — Router", () => {
  describe("route matching", () => {
    it("matches exact path", async () => {
      const router = new Router();
      let called = false;
      router.get("/test", () => { called = true; });
      const handled = await router.handle(createMockReq("GET", "/test"), createMockRes());
      expect(handled).toBe(true);
      expect(called).toBe(true);
    });

    it("returns false for unmatched path", async () => {
      const router = new Router();
      router.get("/test", () => { /* noop */ });
      const handled = await router.handle(createMockReq("GET", "/other"), createMockRes());
      expect(handled).toBe(false);
    });

    it("returns false for wrong method", async () => {
      const router = new Router();
      router.get("/test", () => { /* noop */ });
      const handled = await router.handle(createMockReq("POST", "/test"), createMockRes());
      expect(handled).toBe(false);
    });

    it("extracts path parameters", async () => {
      const router = new Router();
      let capturedParams: Record<string, string> = {};
      router.get("/agents/:id", (_req, _res, params) => { capturedParams = params; });
      await router.handle(createMockReq("GET", "/agents/CODE_ENGINEER"), createMockRes());
      expect(capturedParams["id"]).toBe("CODE_ENGINEER");
    });

    it("extracts multiple path parameters", async () => {
      const router = new Router();
      let capturedParams: Record<string, string> = {};
      router.get("/policies/:entity/:action", (_req, _res, params) => { capturedParams = params; });
      await router.handle(createMockReq("GET", "/policies/RECORD/CREATE"), createMockRes());
      expect(capturedParams["entity"]).toBe("RECORD");
      expect(capturedParams["action"]).toBe("CREATE");
    });

    it("supports POST method", async () => {
      const router = new Router();
      let called = false;
      router.post("/test", () => { called = true; });
      const handled = await router.handle(createMockReq("POST", "/test"), createMockRes());
      expect(handled).toBe(true);
      expect(called).toBe(true);
    });
  });

  describe("response helpers", () => {
    it("json() sets correct headers and body", () => {
      const res = createMockRes();
      json(res, { key: "value" });
      expect(res._mock.statusCode).toBe(200);
      expect(res._mock.headers["Content-Type"]).toBe("application/json");
      expect(JSON.parse(res._mock.body)).toEqual({ key: "value" });
    });

    it("json() supports custom status code", () => {
      const res = createMockRes();
      json(res, { error: "not found" }, 404);
      expect(res._mock.statusCode).toBe(404);
    });

    it("html() sets correct content type", () => {
      const res = createMockRes();
      html(res, "<h1>Test</h1>");
      expect(res._mock.headers["Content-Type"]).toBe("text/html; charset=utf-8");
      expect(res._mock.body).toBe("<h1>Test</h1>");
    });

    it("notFound() returns 404 JSON", () => {
      const res = createMockRes();
      notFound(res);
      expect(res._mock.statusCode).toBe(404);
      expect(JSON.parse(res._mock.body)).toEqual({ error: "Not found" });
    });
  });

  describe("async handlers", () => {
    it("handles async route handlers", async () => {
      const router = new Router();
      router.get("/async", async (_req, res) => {
        await Promise.resolve();
        json(res, { async: true });
      });
      const res = createMockRes();
      const handled = await router.handle(createMockReq("GET", "/async"), res);
      expect(handled).toBe(true);
      expect(JSON.parse(res._mock.body)).toEqual({ async: true });
    });
  });
});
