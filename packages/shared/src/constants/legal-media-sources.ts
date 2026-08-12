/**
 * Verified / authorized reference sources for media & communications legal readiness.
 * Atlas cites these for counsel prep — it does NOT scrape unofficial blogs or invent law.
 * Not legal advice.
 */

export const LEGAL_SOURCE_KINDS = [
  "GOVERNMENT",
  "UNIVERSITY",
  "TREATY_OR_OFFICIAL_BODY",
] as const;

export type LegalSourceKind = (typeof LEGAL_SOURCE_KINDS)[number];

export interface VerifiedLegalMediaSource {
  readonly id: string;
  readonly kind: LegalSourceKind;
  readonly region: "IL" | "EU" | "US" | "INTL";
  readonly titleEn: string;
  readonly titleHe: string;
  readonly url: string;
  readonly topics: readonly string[];
}

/** Curated allow-list — expand carefully; prefer .gov / .ac.il / .edu / official bodies. */
export const VERIFIED_LEGAL_MEDIA_SOURCES: readonly VerifiedLegalMediaSource[] = [
  {
    id: "il-justice",
    kind: "GOVERNMENT",
    region: "IL",
    titleEn: "Israel Ministry of Justice",
    titleHe: "משרד המשפטים",
    url: "https://www.gov.il/he/departments/ministry_of_justice",
    topics: ["privacy", "defamation", "consumer", "media"],
  },
  {
    id: "il-privacy-protection",
    kind: "GOVERNMENT",
    region: "IL",
    titleEn: "Privacy Protection Authority (Israel)",
    titleHe: "הרשות להגנת הפרטיות",
    url: "https://www.gov.il/he/departments/the_privacy_protection_authority",
    topics: ["privacy", "databases", "cookies", "data-subject-rights"],
  },
  {
    id: "il-communications",
    kind: "GOVERNMENT",
    region: "IL",
    titleEn: "Ministry of Communications",
    titleHe: "משרד התקשורת",
    url: "https://www.gov.il/he/departments/ministry_of_communications",
    topics: ["broadcast", "telecom", "spectrum", "media"],
  },
  {
    id: "il-second-authority",
    kind: "GOVERNMENT",
    region: "IL",
    titleEn: "Second Authority for Television and Radio",
    titleHe: "הרשות השנייה לטלוויזיה ולרדיו",
    url: "https://www.rashut2.org.il/",
    topics: ["broadcast", "advertising", "content-standards"],
  },
  {
    id: "tau-law",
    kind: "UNIVERSITY",
    region: "IL",
    titleEn: "Tel Aviv University — Buchmann Faculty of Law",
    titleHe: "אוניברסיטת תל אביב — הפקולטה למשפטים",
    url: "https://en-law.tau.ac.il/",
    topics: ["media-law", "research", "privacy"],
  },
  {
    id: "huji-law",
    kind: "UNIVERSITY",
    region: "IL",
    titleEn: "Hebrew University — Faculty of Law",
    titleHe: "האוניברסיטה העברית — הפקולטה למשפטים",
    url: "https://en.law.huji.ac.il/",
    topics: ["media-law", "research"],
  },
  {
    id: "eu-gdpr",
    kind: "TREATY_OR_OFFICIAL_BODY",
    region: "EU",
    titleEn: "EU GDPR official text",
    titleHe: "GDPR — טקסט רשמי של האיחוד האירופי",
    url: "https://eur-lex.europa.eu/eli/reg/2016/679/oj",
    topics: ["privacy", "consent", "export", "erasure", "controller"],
  },
  {
    id: "edpb",
    kind: "TREATY_OR_OFFICIAL_BODY",
    region: "EU",
    titleEn: "European Data Protection Board",
    titleHe: "המועצה האירופית להגנת מידע (EDPB)",
    url: "https://www.edpb.europa.eu/",
    topics: ["privacy", "guidelines", "cookies"],
  },
  {
    id: "us-ftc",
    kind: "GOVERNMENT",
    region: "US",
    titleEn: "U.S. Federal Trade Commission — privacy & advertising",
    titleHe: "FTC — פרטיות ופרסום",
    url: "https://www.ftc.gov/business-guidance/privacy-security",
    topics: ["advertising", "endorsements", "privacy", "children"],
  },
  {
    id: "us-fcc",
    kind: "GOVERNMENT",
    region: "US",
    titleEn: "U.S. Federal Communications Commission",
    titleHe: "FCC — תקשורת",
    url: "https://www.fcc.gov/",
    topics: ["broadcast", "telecom", "media"],
  },
  {
    id: "unesco-media",
    kind: "TREATY_OR_OFFICIAL_BODY",
    region: "INTL",
    titleEn: "UNESCO — Freedom of expression & media",
    titleHe: "אונסק\"ו — חופש ביטוי ומדיה",
    url: "https://www.unesco.org/en/communication-information",
    topics: ["press", "expression", "media-ethics"],
  },
];

export const LEGAL_MEDIA_DISCLAIMER_EN =
  "NOT LEGAL ADVICE. Atlas Legal Media Comms is an engineering readiness indicator for counsel — it does not replace a licensed attorney in Israel or any other jurisdiction.";

export const LEGAL_MEDIA_DISCLAIMER_HE =
  "אין זו ייעוץ משפטי. מסלול משפט מדיה/תקשורת ב־Atlas הוא אינדיקציה הנדסית למוכנות לעורך דין — אינו מחליף עורך דין מורשה בישראל או בכל מדינה אחרת.";

export const LEGAL_MEDIA_DISCLAIMER_AR =
  "ليس استشارة قانونية. مسار قانون الإعلام/الاتصالات في Atlas مؤشر هندسي لجاهزية العرض على محامٍ — ولا يحل محل محامٍ مرخّص في إسرائيل أو أي ولاية أخرى.";
