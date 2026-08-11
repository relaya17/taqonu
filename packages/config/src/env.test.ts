import { describe, expect, it } from "vitest";
import { loadServerEnv } from "./env.js";

describe("loadServerEnv", () => {
  it("fails fast when required secrets are missing", () => {
    expect(() =>
      loadServerEnv({ NODE_ENV: "development" }, { loadEnvFile: false }),
    ).toThrow(/Invalid server environment/);
  });

  it("loads a valid development env", () => {
    const env = loadServerEnv(
      {
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://localhost:5432/atlas",
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_ANON_KEY: "anon-key",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
        ENCRYPTION_KEY: "12345678901234567890123456789012",
        COOKIE_SECRET: "12345678901234567890123456789012",
      },
      { loadEnvFile: false },
    );

    expect(env.APP_NAME).toBe("ArletOS");
    expect(env.PRODUCT_CODENAME).toBe("Atlas");
    expect(env.API_PORT).toBe(4000);
  });
});
