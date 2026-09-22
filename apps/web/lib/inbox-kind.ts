const KIND_MESSAGE_KEY = {
  "memory.pending": "memoryPending",
  "approval.waiting": "approvalWaiting",
  "patch.ready": "patchReady",
} as const;

export type InboxKind = keyof typeof KIND_MESSAGE_KEY;

export function inboxKindMessageKey(kind: string): string {
  return KIND_MESSAGE_KEY[kind as InboxKind] ?? "memoryPending";
}
