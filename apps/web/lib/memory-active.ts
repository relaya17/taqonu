export function isActiveMemory(item: { status: string }): boolean {
  return item.status === "ACTIVE";
}
