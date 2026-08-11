import { createHmac, timingSafeEqual } from "node:crypto";
import { AtlasError } from "@atlas/shared";

export function verifyGitHubWebhookSignature(input: {
  payload: string;
  signatureHeader: string | undefined;
  secret: string;
}): void {
  if (!input.signatureHeader?.startsWith("sha256=")) {
    throw new AtlasError("WEBHOOK_INVALID", "Missing GitHub signature header");
  }

  const expected = createHmac("sha256", input.secret)
    .update(input.payload, "utf8")
    .digest("hex");
  const provided = input.signatureHeader.slice("sha256=".length);

  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(provided, "utf8");

  if (
    expectedBuffer.length !== providedBuffer.length ||
    !timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    throw new AtlasError("WEBHOOK_INVALID", "Invalid GitHub webhook signature");
  }
}
