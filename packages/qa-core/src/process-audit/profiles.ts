import type { ProcessAppProfile } from "@atlas/shared";

export interface AppJourneySpec {
  readonly id: string;
  readonly actor: string;
  readonly steps: readonly string[];
}

export interface AppProfileSpec {
  readonly id: ProcessAppProfile;
  readonly titleEn: string;
  readonly surfaces: readonly string[];
  readonly journeys: readonly AppJourneySpec[];
  readonly isolationRequired: boolean;
  readonly aiHitlLikely: boolean;
  readonly providerHints: readonly string[];
}

export const APP_PROFILE_SPECS: Readonly<
  Record<ProcessAppProfile, AppProfileSpec>
> = {
  GENERIC: {
    id: "GENERIC",
    titleEn: "Generic application",
    surfaces: ["web-app", "api", "auth"],
    journeys: [
      {
        id: "admin-entry",
        actor: "Admin",
        steps: ["Login", "Role resolve", "Dashboard", "Core CRUD", "Logout"],
      },
      {
        id: "user-entry",
        actor: "User",
        steps: ["Signup/Invite", "Login", "Primary task", "Settings"],
      },
    ],
    isolationRequired: false,
    aiHitlLikely: true,
    providerHints: ["vercel", "netlify", "render", "github"],
  },
  HOTEL: {
    id: "HOTEL",
    titleEn: "Hotel / hospitality OS",
    surfaces: ["executive", "admin", "work", "guest", "api"],
    journeys: [
      {
        id: "executive",
        actor: "Network executive",
        steps: [
          "Login",
          "Chain resolve",
          "Network dashboard",
          "Hotel A/B KPIs",
          "Briefing",
          "CIO / HITL",
        ],
      },
      {
        id: "hotel-admin",
        actor: "Hotel admin",
        steps: [
          "Login",
          "Hotel resolve",
          "Rooms",
          "Bookings",
          "Departments",
          "Audit",
        ],
      },
      {
        id: "employee",
        actor: "Employee",
        steps: [
          "Invite",
          "Accept",
          "Login",
          "Attendance",
          "Tasks",
          "HR docs",
          "Clock-out",
        ],
      },
      {
        id: "guest",
        actor: "Guest",
        steps: [
          "Public site",
          "Stay lookup",
          "Booking",
          "Legal",
          "Guest portal",
        ],
      },
    ],
    isolationRequired: true,
    aiHitlLikely: true,
    providerHints: ["vercel", "render", "mongodb", "supabase", "stripe", "sentry"],
  },
  SAAS: {
    id: "SAAS",
    titleEn: "Multi-tenant SaaS",
    surfaces: ["admin", "member", "billing", "api"],
    journeys: [
      {
        id: "owner",
        actor: "Workspace owner",
        steps: ["Signup", "Create workspace", "Invite", "Billing", "Settings"],
      },
      {
        id: "member",
        actor: "Member",
        steps: ["Accept invite", "Login", "Core feature", "No admin actions"],
      },
    ],
    isolationRequired: true,
    aiHitlLikely: true,
    providerHints: ["vercel", "netlify", "render", "supabase", "stripe"],
  },
  ECOMMERCE: {
    id: "ECOMMERCE",
    titleEn: "E-commerce",
    surfaces: ["storefront", "admin", "checkout", "fulfillment"],
    journeys: [
      {
        id: "shopper",
        actor: "Shopper",
        steps: ["Browse", "Cart", "Checkout", "Payment", "Order status"],
      },
      {
        id: "merchant",
        actor: "Merchant admin",
        steps: ["Login", "Catalog", "Orders", "Refunds", "Inventory"],
      },
    ],
    isolationRequired: true,
    aiHitlLikely: false,
    providerHints: ["vercel", "netlify", "stripe", "mongodb", "sentry"],
  },
  MARKETPLACE: {
    id: "MARKETPLACE",
    titleEn: "Marketplace",
    surfaces: ["buyer", "seller", "ops", "payments"],
    journeys: [
      {
        id: "buyer",
        actor: "Buyer",
        steps: ["Search", "Purchase", "Messaging", "Dispute"],
      },
      {
        id: "seller",
        actor: "Seller",
        steps: ["Onboard", "List", "Fulfill", "Payouts"],
      },
    ],
    isolationRequired: true,
    aiHitlLikely: true,
    providerHints: ["vercel", "render", "stripe", "mongodb", "supabase"],
  },
  CONTENT: {
    id: "CONTENT",
    titleEn: "Content / media",
    surfaces: ["public", "editor", "admin"],
    journeys: [
      {
        id: "reader",
        actor: "Reader",
        steps: ["Browse", "Search", "Consume", "Account"],
      },
      {
        id: "editor",
        actor: "Editor",
        steps: ["Login", "Draft", "Review", "Publish", "Assets"],
      },
    ],
    isolationRequired: false,
    aiHitlLikely: true,
    providerHints: ["vercel", "netlify", "supabase", "sentry"],
  },
  FINTECH: {
    id: "FINTECH",
    titleEn: "Fintech / money movement",
    surfaces: ["customer", "ops", "compliance", "api"],
    journeys: [
      {
        id: "customer",
        actor: "Customer",
        steps: ["KYC", "Fund", "Transfer", "Statement"],
      },
      {
        id: "ops",
        actor: "Ops / compliance",
        steps: ["Login", "Case review", "HITL approve", "Audit export"],
      },
    ],
    isolationRequired: true,
    aiHitlLikely: true,
    providerHints: ["vercel", "render", "stripe", "supabase", "sentry"],
  },
  HEALTH: {
    id: "HEALTH",
    titleEn: "Health / care workflows",
    surfaces: ["patient", "clinician", "admin"],
    journeys: [
      {
        id: "patient",
        actor: "Patient",
        steps: ["Identity", "Appointment", "Records access", "Consent"],
      },
      {
        id: "clinician",
        actor: "Clinician",
        steps: ["Login", "Chart", "Order", "Notes", "Audit"],
      },
    ],
    isolationRequired: true,
    aiHitlLikely: true,
    providerHints: ["vercel", "render", "mongodb", "supabase", "sentry"],
  },
  EDTECH: {
    id: "EDTECH",
    titleEn: "Education",
    surfaces: ["student", "teacher", "admin"],
    journeys: [
      {
        id: "student",
        actor: "Student",
        steps: ["Enroll", "Lesson", "Assignment", "Grade view"],
      },
      {
        id: "teacher",
        actor: "Teacher",
        steps: ["Login", "Class", "Grade", "Feedback"],
      },
    ],
    isolationRequired: true,
    aiHitlLikely: true,
    providerHints: ["vercel", "netlify", "supabase", "mongodb"],
  },
};

export function detectAppProfile(input: {
  userRequest?: string | undefined;
  fileHints?: readonly string[] | undefined;
}): { profile: ProcessAppProfile; source: "AUTO_DETECT" | "DEFAULT" } {
  const text = `${input.userRequest ?? ""} ${(input.fileHints ?? []).join(" ")}`.toLowerCase();

  const rules: Array<{ profile: ProcessAppProfile; re: RegExp }> = [
    { profile: "HOTEL", re: /hotel|hospitality|pms|booking.?room|אורח|מלון/ },
    { profile: "ECOMMERCE", re: /ecommerce|e-commerce|shopify|cart|checkout|חנות/ },
    { profile: "MARKETPLACE", re: /marketplace|buyer.?seller|שוק/ },
    { profile: "FINTECH", re: /fintech|payment.?ledger|kyc|wallet|תשלום.?פיננס/ },
    { profile: "HEALTH", re: /health|clinic|patient|hipaa|רפוא/ },
    { profile: "EDTECH", re: /edtech|classroom|student|course|לימוד/ },
    { profile: "CONTENT", re: /cms|blog|content.?site|publisher|תוכן/ },
    { profile: "SAAS", re: /saas|multi.?tenant|workspace|tenant|דייר/ },
  ];

  for (const rule of rules) {
    if (rule.re.test(text)) {
      return { profile: rule.profile, source: "AUTO_DETECT" };
    }
  }
  return { profile: "GENERIC", source: "DEFAULT" };
}
