import { describe, expect, it } from "vitest";
import { createLogger } from "./logger.js";
import { redactSecrets } from "./redact.js";

describe("log egress redaction", () => {
  it("redacts api keys in strings", () => {
    const text = "api_key=sk_live_abcdefghijklmnopqrstuvwxyz";
    expect(redactSecrets(text)).toContain("[REDACTED_SECRET]");
    expect(redactSecrets(text)).not.toContain("sk_live");
  });

  it("redacts github tokens and never prints raw secret via logger", () => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (line: string) => {
      lines.push(String(line));
    };
    try {
      const logger = createLogger({ service: "test", level: "info" });
      logger.info("token ghp_abcdefghijklmnopqrstuvwxyz1234 leaked", {
        note: "Authorization: ghp_abcdefghijklmnopqrstuvwxyz1234",
      });
    } finally {
      console.log = original;
    }
    const joined = lines.join("\n");
    expect(joined).toContain("[REDACTED_SECRET]");
    expect(joined).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz1234");
  });
});
