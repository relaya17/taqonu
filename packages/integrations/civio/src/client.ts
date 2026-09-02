import {
  CIVIO_CONNECTOR_INGRESS_PATH,
  civioEventEnvelopeSchema,
  type CivioEventEnvelope,
} from "@atlas/shared";
import { signCivioConnectorRequest } from "./hmac.js";

export interface CivioControlIngestResponse {
  readonly accepted: boolean;
  readonly disposition:
    | "ACCEPTED"
    | "DUPLICATE"
    | "REJECTED"
    | "UNSUPPORTED_EVENT"
    | "UNCONFIGURED";
  readonly reason: string;
  readonly eventId?: string;
  readonly evaluation?: {
    readonly decision: string;
    readonly blockedAt: string | null;
    readonly reason: string;
    readonly stagesPassed: readonly string[];
    readonly executed: false;
  };
  readonly process?: { readonly processId: string } | null;
  readonly audit?: { readonly type: string; readonly inMemory: true };
  readonly execution?: "NOT_IMPLEMENTED";
}

export interface EmitCivioEventToControlInput {
  readonly controlBaseUrl: string;
  readonly secret: string;
  readonly event: CivioEventEnvelope;
  readonly fetch?: typeof fetch;
}

/**
 * Production caller: Civio runtime (or a drop-in adapter) signs and POSTs
 * a Civio event to Atlas Control. This is the real HTTP path, not a mock.
 */
export async function emitCivioEventToControl(
  input: EmitCivioEventToControlInput,
): Promise<{
  readonly status: number;
  readonly body: CivioControlIngestResponse;
}> {
  const event = civioEventEnvelopeSchema.parse(input.event);
  const rawBody = JSON.stringify(event);
  const signed = signCivioConnectorRequest({
    secret: input.secret,
    rawBody,
  });
  const base = input.controlBaseUrl.replace(/\/+$/, "");
  const url = `${base}${CIVIO_CONNECTOR_INGRESS_PATH}`;
  const fetchImpl = input.fetch ?? fetch;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...signed.headers,
    },
    body: rawBody,
  });
  const body = (await response.json()) as CivioControlIngestResponse;
  return { status: response.status, body };
}
