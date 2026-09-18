import { createHmac, randomBytes } from "node:crypto";
import {
  APPLICATION_PREFLIGHT_PATH,
  APPLICATION_PREFLIGHT_SCHEMA,
  APPLICATION_PREFLIGHT_SECRET_MIN_LENGTH,
  ATLAS_CONNECTOR_NONCE_HEADER,
  ATLAS_CONNECTOR_SIGNATURE_HEADER,
  ATLAS_CONNECTOR_TIMESTAMP_HEADER,
  applicationConnectorSigningString,
  applicationPreflightResponseSchema,
  type ApplicationPreflightOperationClass,
  type ApplicationPreflightRequest,
  type ApplicationPreflightResponse,
} from "@atlas/shared";

export function signApplicationConnectorRequest(input: {
  readonly secret: string;
  readonly rawBody: string;
  readonly timestamp?: string;
  readonly nonce?: string;
}): {
  readonly timestamp: string;
  readonly nonce: string;
  readonly signature: string;
  readonly headers: Record<string, string>;
} {
  const timestamp = input.timestamp ?? String(Date.now());
  const nonce = input.nonce ?? randomBytes(16).toString("hex");
  const signature = createHmac("sha256", input.secret)
    .update(applicationConnectorSigningString(timestamp, nonce, input.rawBody), "utf8")
    .digest("hex");
  return {
    timestamp,
    nonce,
    signature,
    headers: {
      [ATLAS_CONNECTOR_TIMESTAMP_HEADER]: timestamp,
      [ATLAS_CONNECTOR_NONCE_HEADER]: nonce,
      [ATLAS_CONNECTOR_SIGNATURE_HEADER]: signature,
    },
  };
}

export async function requestApplicationPreflight(input: {
  readonly atlasApiBaseUrl: string;
  readonly secret: string;
  readonly request: Omit<ApplicationPreflightRequest, "schemaVersion"> & {
    readonly schemaVersion?: typeof APPLICATION_PREFLIGHT_SCHEMA;
  };
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}): Promise<{
  readonly status: number;
  readonly body: ApplicationPreflightResponse | { readonly error: string };
}> {
  if (input.secret.length < APPLICATION_PREFLIGHT_SECRET_MIN_LENGTH) {
    throw new Error("Application connector secret is too short");
  }
  const payload: ApplicationPreflightRequest = {
    ...input.request,
    schemaVersion: APPLICATION_PREFLIGHT_SCHEMA,
  };
  const rawBody = JSON.stringify(payload);
  const signed = signApplicationConnectorRequest({
    secret: input.secret,
    rawBody,
  });
  const base = input.atlasApiBaseUrl.replace(/\/+$/, "");
  const fetchImpl = input.fetch ?? fetch;
  const response = await fetchImpl(`${base}${APPLICATION_PREFLIGHT_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...signed.headers,
    },
    body: rawBody,
    signal: AbortSignal.timeout(input.timeoutMs ?? 5_000),
  });
  const json = (await response.json()) as unknown;
  const parsed = applicationPreflightResponseSchema.safeParse(json);
  if (!parsed.success) {
    return {
      status: response.status,
      body: { error: "Malformed Atlas preflight response" },
    };
  }
  return { status: response.status, body: parsed.data };
}

export function operationClassUnavailablePolicy(
  operationClass: ApplicationPreflightOperationClass,
): "FAIL_CLOSED" | "FAIL_OPEN" {
  return operationClass === "HIGH_RISK" || operationClass === "TOOL_ACTION"
    ? "FAIL_CLOSED"
    : "FAIL_OPEN";
}
