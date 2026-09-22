import { listApprovalRequests } from "./approvals.js";
import { osStore } from "../store/os-store.js";

export const INBOX_KINDS = [
  "memory.pending",
  "approval.waiting",
  "patch.ready",
] as const;

export type InboxKind = (typeof INBOX_KINDS)[number];

export interface InboxItem {
  readonly id: string;
  readonly kind: InboxKind;
  readonly title: string;
  readonly href: string;
  readonly createdAt: string;
  readonly dismissed: boolean;
}

const PENDING_MEMORY = new Set([
  "PROPOSED",
  "INFERRED",
  "UNVERIFIED",
  "ASSUMED",
]);

/**
 * In-app inbox only (G-P1-05). No email/SMS. Items are derived from the
 * caller's own pending memories, approvals they requested, and patches they
 * created that are ready to apply. Dismiss is owner-scoped metadata.
 */
export async function listInboxItems(ownerId: string): Promise<InboxItem[]> {
  const dismissed = new Set(osStore.listInboxDismissed(ownerId));
  const items: InboxItem[] = [];

  for (const memory of [...osStore.memories.values()].flat()) {
    if (
      memory.ownerId !== ownerId ||
      memory.status !== "ACTIVE" ||
      !PENDING_MEMORY.has(memory.epistemicState)
    ) {
      continue;
    }
    items.push({
      id: memory.id,
      kind: "memory.pending",
      title: memory.statement.slice(0, 180),
      href: "/?desk=memory",
      createdAt: memory.createdAt,
      dismissed: dismissed.has(memory.id),
    });
  }

  try {
    const approvals = await listApprovalRequests("PENDING");
    for (const approval of approvals) {
      if (approval.requestedBy !== ownerId) continue;
      items.push({
        id: approval.id,
        kind: "approval.waiting",
        title: approval.reason.slice(0, 180),
        href: "/?desk=patches",
        createdAt: approval.requestedAt,
        dismissed: dismissed.has(approval.id),
      });
    }
  } catch {
    // Approval store outage must not hide memory/patch inbox rows.
  }

  for (const patch of osStore.listPatches()) {
    if (patch.createdBy !== ownerId || patch.status !== "APPROVED") continue;
    items.push({
      id: patch.id,
      kind: "patch.ready",
      title: patch.title.slice(0, 180),
      href: "/?desk=patches",
      createdAt: patch.createdAt,
      dismissed: dismissed.has(patch.id),
    });
  }

  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return items.slice(0, 40);
}

export function dismissInboxItem(ownerId: string, id: string): boolean {
  const dismissed = new Set(osStore.listInboxDismissed(ownerId));
  if (dismissed.has(id)) return true;
  osStore.dismissInboxItem(ownerId, id);
  return true;
}
