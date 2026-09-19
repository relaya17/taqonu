export const PTY_COPY = {
  en: {
    help: "Interactive human terminal in the linked workspace. This is a real process/PTY, not governed commandId execution.",
    notAgent: "The Agent cannot use this terminal. Agent execution stays allowlisted commandId + SoD.",
    shell: "Shell",
    new: "New terminal",
    opening: "Opening…",
    interrupt: "Ctrl+C",
    clear: "Clear",
    close: "Close terminal",
    closed: "session closed",
    status: "Status",
    sessions: "Terminal sessions",
    session: "Session",
    cwd: "Working directory",
    empty: "Open a terminal to start an interactive shell in the project workspace.",
    terminal: "Interactive terminal",
    error: "Terminal failed",
    streamError: "Terminal stream failed",
  },
  he: {
    help: "מסוף אינטראקטיבי אנושי בתיקיית הפרויקט. זה תהליך/PTY אמיתי, לא הרצת commandId ממשלת.",
    notAgent: "הסוכן לא יכול להשתמש במסוף הזה. הרצת הסוכן נשארת commandId מרשימת היתר ו-SoD.",
    shell: "מעטפת",
    new: "מסוף חדש",
    opening: "פותח…",
    interrupt: "Ctrl+C",
    clear: "נקה",
    close: "סגור מסוף",
    closed: "הסשן נסגר",
    status: "מצב",
    sessions: "סשני מסוף",
    session: "סשן",
    cwd: "תיקיית עבודה",
    empty: "פתחו מסוף כדי להתחיל מעטפת אינטראקטיבית בתיקיית הפרויקט.",
    terminal: "מסוף אינטראקטיבי",
    error: "המסוף נכשל",
    streamError: "זרם המסוף נכשל",
  },
  ar: {
    help: "طرفية تفاعلية للإنسان داخل مساحة العمل المرتبطة. هذه عملية/PTY حقيقية وليست تنفيذ commandId محكوم.",
    notAgent: "لا يمكن للوكيل استخدام هذه الطرفية. تنفيذ الوكيل يبقى أوامر مدرجة وSoD.",
    shell: "الصدفة",
    new: "طرفية جديدة",
    opening: "جارٍ الفتح…",
    interrupt: "Ctrl+C",
    clear: "مسح",
    close: "إغلاق الطرفية",
    closed: "أُغلق الجلسة",
    status: "الحالة",
    sessions: "جلسات الطرفية",
    session: "جلسة",
    cwd: "دليل العمل",
    empty: "افتح طرفية لبدء صدفة تفاعلية في مساحة عمل المشروع.",
    terminal: "طرفية تفاعلية",
    error: "فشلت الطرفية",
    streamError: "فشل بث الطرفية",
  },
} as const;

export type PtyCopyKey = keyof (typeof PTY_COPY)["en"];

export function ptyCopyFor(locale: string): (typeof PTY_COPY)["en"] {
  if (locale === "he") return PTY_COPY.he;
  if (locale === "ar") return PTY_COPY.ar;
  return PTY_COPY.en;
}
