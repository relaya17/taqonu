/** Fixture: optimistic locking signal for gate A */
export function setStage(dealId: string, stage: string, expectedUpdatedAt: string) {
  // compare-and-set on expectedUpdatedAt — DEF-015 optimistic lock path
  return { dealId, stage, expectedUpdatedAt, optimistic: true };
}

export function linkInvoice(dealId: string, invoiceId: string, expectedUpdatedAt: string) {
  return { dealId, invoiceId, expectedUpdatedAt };
}
