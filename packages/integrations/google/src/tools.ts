/** Scoped Google tools — never a blanket "Google access". */
export const GOOGLE_TOOLS = {
  "google.drive.read": { risk: "READ_ONLY", requiresApproval: false },
  "google.docs.read": { risk: "READ_ONLY", requiresApproval: false },
  "google.sheets.read": { risk: "READ_ONLY", requiresApproval: false },
  "google.gmail.read": { risk: "READ_ONLY", requiresApproval: false },
  "google.calendar.read": { risk: "READ_ONLY", requiresApproval: false },
  "google.drive.write": { risk: "LOW_RISK_WRITE", requiresApproval: true },
  "google.docs.write": { risk: "LOW_RISK_WRITE", requiresApproval: true },
  "google.sheets.write": { risk: "LOW_RISK_WRITE", requiresApproval: true },
  "google.gmail.send": { risk: "HIGH_RISK_WRITE", requiresApproval: true },
  "google.calendar.write": { risk: "HIGH_RISK_WRITE", requiresApproval: true },
} as const;
