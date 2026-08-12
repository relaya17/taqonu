import type { ReactNode } from "react";
import { InvestorsProviders } from "@/components/investors/InvestorsProviders";

export const metadata = {
  title: "ArletOS — Atlas · Marketing & investors",
  description:
    "The Engineering Truth Layer for AI-native teams. Evidence Graph, Release Verdict, Design Partners.",
};

export default function InvestorsLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Frank+Ruhl+Libre:wght@600;700&family=Rubik:wght@400;500;600;700&family=Source+Sans+3:wght@400;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body style={{ margin: 0 }}>
        <InvestorsProviders>{children}</InvestorsProviders>
      </body>
    </html>
  );
}
