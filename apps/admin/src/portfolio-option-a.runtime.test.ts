import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createRequestHandler } from "../../control-plane/src/http.js";
import { handleAdminRequest } from "./server.js";

function listen(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(handler);
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("no listen address"));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
  });
}

describe("Phase 11.9 Option A runtime path (Admin → Control Plane)", () => {
  const token = "phase-11-9-runtime-token";
  let previousToken: string | undefined;
  let previousControl: string | undefined;
  let previousOwner: string | undefined;
  let control: { url: string; close: () => Promise<void> } | undefined;
  let admin: { url: string; close: () => Promise<void> } | undefined;

  beforeEach(async () => {
    previousToken = process.env["ATLAS_CONTROL_PLANE_TOKEN"];
    previousControl = process.env["ATLAS_CONTROL_PLANE_URL"];
    previousOwner = process.env["ATLAS_CONTROL_PLANE_OWNER_TOKEN"];
    process.env["ATLAS_CONTROL_PLANE_TOKEN"] = token;
    delete process.env["ATLAS_CONTROL_PLANE_OWNER_TOKEN"];
    control = await listen(createRequestHandler());
    process.env["ATLAS_CONTROL_PLANE_URL"] = control.url;
    admin = await listen(handleAdminRequest);
  });

  afterEach(async () => {
    if (admin) await admin.close();
    if (control) await control.close();
    if (previousToken === undefined) delete process.env["ATLAS_CONTROL_PLANE_TOKEN"];
    else process.env["ATLAS_CONTROL_PLANE_TOKEN"] = previousToken;
    if (previousControl === undefined) delete process.env["ATLAS_CONTROL_PLANE_URL"];
    else process.env["ATLAS_CONTROL_PLANE_URL"] = previousControl;
    if (previousOwner === undefined) delete process.env["ATLAS_CONTROL_PLANE_OWNER_TOKEN"];
    else process.env["ATLAS_CONTROL_PLANE_OWNER_TOKEN"] = previousOwner;
  });

  it("authorized Admin read reaches a live Control Plane projection", async () => {
    const unauthAdmin = await fetch(`${admin!.url}/portfolio`);
    expect(unauthAdmin.status).toBe(401);

    const badAdmin = await fetch(`${admin!.url}/portfolio`, {
      headers: { Authorization: "Bearer wrong" },
    });
    expect(badAdmin.status).toBe(401);

    const unauthCp = await fetch(`${control!.url}/api/v1/portfolio-governance`);
    expect(unauthCp.status).toBe(401);

    const ok = await fetch(`${admin!.url}/portfolio`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(ok.status).toBe(200);
    const html = await ok.text();
    expect(html).toContain("Portfolio governance");
    expect(html).toContain("atlas");
    expect(html).not.toContain(token);
    expect(html).not.toContain("localhost:4000");

    const json = await fetch(`${admin!.url}/api/v1/portfolio-governance`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(json.status).toBe(200);
    const body = (await json.json()) as {
      reachability: string;
      snapshot: { applications: { slug: string }[] } | null;
    };
    expect(body.reachability).toBe("REACHABLE");
    expect(body.snapshot?.applications.some((app) => app.slug === "atlas")).toBe(true);

    const cpDirect = await fetch(`${control!.url}/api/v1/portfolio-governance`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(cpDirect.status).toBe(200);
    const cpBody = (await cpDirect.json()) as { writeAuthority: string };
    expect(cpBody.writeAuthority).toBe("ATLAS_API");
  });
});
