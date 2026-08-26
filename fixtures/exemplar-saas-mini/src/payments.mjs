const checkouts = new Map();
const seenWebhookIds = new Set();
const credits = new Map();

export function createCheckout(userId, amountCents) {
  if (!Number.isInteger(amountCents) || amountCents < 1) {
    throw new Error("amountCents must be a positive integer");
  }
  const id = `cs_${checkouts.size + 1}`;
  checkouts.set(id, { id, userId, amountCents, status: "open" });
  return { id, amountCents, status: "open" };
}

export function applyWebhook(eventId, checkoutId) {
  if (!eventId || !checkoutId) throw new Error("eventId and checkoutId required");
  if (seenWebhookIds.has(eventId)) {
    return { duplicate: true, credited: false };
  }
  seenWebhookIds.add(eventId);
  const checkout = checkouts.get(checkoutId);
  if (!checkout) throw new Error("Unknown checkout");
  checkout.status = "paid";
  credits.set(checkout.userId, (credits.get(checkout.userId) ?? 0) + checkout.amountCents);
  return { duplicate: false, credited: true, balance: credits.get(checkout.userId) };
}

export function getCreditBalance(userId) {
  return credits.get(userId) ?? 0;
}

export function resetPaymentsForTests() {
  checkouts.clear();
  seenWebhookIds.clear();
  credits.clear();
}
