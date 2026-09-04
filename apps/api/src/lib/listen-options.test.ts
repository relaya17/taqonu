import { describe, expect, it } from "vitest";
import { apiListenOptions } from "./listen-options.js";

describe("apiListenOptions", () => {
  it("honors an explicit HOST (private-plane loopback)", () => {
    expect(apiListenOptions(4000, "127.0.0.1")).toEqual({
      port: 4000,
      host: "127.0.0.1",
    });
  });

  it("uses dual-stack when HOST is empty (Windows Chrome localhost)", () => {
    expect(apiListenOptions(4000, "")).toEqual({ port: 4000, ipv6Only: false });
  });
});
