import { denyRealExternal, type SandboxControlName } from "./policy.js";
import type { SyntheticEventStream } from "./events.js";

export type SimulatedChannel =
  | "payment"
  | "email"
  | "sms"
  | "whatsapp"
  | "signature"
  | "external_api"
  | "external_write";

const CHANNEL_CONTROL: Readonly<Record<SimulatedChannel, SandboxControlName>> = {
  payment: "REAL_PAYMENTS",
  email: "REAL_EMAIL",
  sms: "REAL_SMS",
  whatsapp: "REAL_WHATSAPP",
  signature: "EXTERNAL_WRITE",
  external_api: "EXTERNAL_WRITE",
  external_write: "EXTERNAL_WRITE",
};

export interface SimulationResult {
  readonly channel: SimulatedChannel;
  readonly realExecuted: false;
  readonly simulated: true;
  readonly message: string;
}

/**
 * Intercepts every external channel. Never performs network I/O.
 */
export function simulateExternal(input: {
  readonly channel: SimulatedChannel;
  readonly tenantId: string;
  readonly runId: string;
  readonly events: SyntheticEventStream;
  readonly entityId?: string | null;
}): SimulationResult {
  const control = CHANNEL_CONTROL[input.channel];
  if (control) {
    // Presence of the mapping is the deny. Real side-effects are unreachable.
    void denyRealExternal(control);
  }
  const eventName =
    input.channel === "payment"
      ? "PaymentSimulationStarted"
      : input.channel === "whatsapp"
        ? "WhatsAppSimulated"
        : input.channel === "email"
          ? "EmailSimulated"
          : input.channel === "sms"
            ? "SmsSimulated"
            : "ExternalWriteSimulated";
  input.events.emit({
    name: eventName,
    tenantId: input.tenantId,
    runId: input.runId,
    entityId: input.entityId ?? null,
    payload: {
      channel: input.channel,
      realExecuted: false,
      simulated: true,
    },
  });
  return {
    channel: input.channel,
    realExecuted: false,
    simulated: true,
    message: `${label(input.channel)} simulated successfully`,
  };
}

export function attemptRealExternal(channel: SimulatedChannel): never {
  throw denyRealExternal(CHANNEL_CONTROL[channel]);
}

function label(channel: SimulatedChannel): string {
  switch (channel) {
    case "whatsapp":
      return "WhatsApp";
    case "payment":
      return "Payment";
    case "email":
      return "Email";
    case "sms":
      return "SMS";
    default:
      return "External write";
  }
}
