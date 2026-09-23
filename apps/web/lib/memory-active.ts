export function isActiveMemory(item: {
  status: string;
  validUntil?: string | null;
}): boolean {
  if (item.status !== "ACTIVE") return false;
  if (!item.validUntil) return true;
  const until = Date.parse(item.validUntil);
  return !Number.isFinite(until) || until > Date.now();
}
