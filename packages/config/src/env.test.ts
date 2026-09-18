import { describe, expect, it } from "vitest";
import { loadServerEnv } from "./env.js";
import { loadServerDotEnv } from "./load-dotenv.js";

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

  it("refuses documented example secrets in production", () => {
    expect(() =>
      loadServerEnv(
        {
          NODE_ENV: "production",
          DATABASE_URL: "postgresql://localhost:5432/atlas",
          SUPABASE_URL: "https://example.supabase.co",
          SUPABASE_ANON_KEY: "anon-key",
          SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
          ENCRYPTION_KEY: "12345678901234567890123456789012",
          COOKIE_SECRET: "12345678901234567890123456789012",
        },
        { loadEnvFile: false },
      ),
    ).toThrow(/example value/);
  });

  it("does not let apps/api/.env placeholders clobber live process SUPABASE keys", () => {
    const previous = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const live = "live-local-service-role-key-not-placeholder";
    process.env.SUPABASE_SERVICE_ROLE_KEY = live;
    try {
      loadServerDotEnv();
      expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBe(live);
    } finally {
      if (previous === undefined) {
        delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      } else {
        process.env.SUPABASE_SERVICE_ROLE_KEY = previous;
      }
    }
  });
});
