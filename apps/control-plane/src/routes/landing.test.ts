import { describe, expect, it } from "vitest";
import { getLandingHtml } from "./landing.js";

describe("Control Plane public promo", () => {
  it("renders promo media and routes authentication without exposing demo credentials by default", () => {
    const html = getLandingHtml({ webOrigin: "https://atlas.example" });

    expect(html).toContain("<video autoplay muted loop");
    expect(html).toContain('window.location.href = "/login"');
    expect(html).toContain('function atlasWeb() { return "https://atlas.example"; }');
    expect(html).toContain('atlasWeb() + "/he/auth/register"');
    expect(html).not.toContain("AtlasDev1!");
  });

  it("includes demo credentials only when explicitly supplied", () => {
    const html = getLandingHtml({
      demoEmail: "dev@atlas.local",
      demoPassword: "AtlasDev1!",
    });

    expect(html).toContain("dev@atlas.local");
    expect(html).toContain("AtlasDev1!");
  });
});
