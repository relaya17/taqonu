import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  applyWebhook,
  createCheckout,
  getCreditBalance,
  resetPaymentsForTests,
} from "./payments.mjs";

describe("payments webhook idempotency", () => {
  beforeEach(() => resetPaymentsForTests());

  it("credits once for a repeated event id", () => {
    const checkout = createCheckout("user-1", 1500);
    const first = applyWebhook("evt_1", checkout.id);
    const second = applyWebhook("evt_1", checkout.id);
    assert.equal(first.credited, true);
    assert.equal(second.duplicate, true);
    assert.equal(getCreditBalance("user-1"), 1500);
  });
});
