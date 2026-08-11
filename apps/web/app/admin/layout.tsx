import type { ReactNode } from "react";
import { Suspense } from "react";
import { AdminProviders } from "@/components/admin/AdminProviders";
import { AdminShell } from "@/components/admin/AdminShell";

export const metadata = {
  title: "ArletOS Admin",
  description: "ArletOS administration console",
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Frank+Ruhl+Libre:wght@600;700&family=Rubik:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <AdminProviders>
          <Suspense fallback={null}>
            <AdminShell>{children}</AdminShell>
          </Suspense>
        </AdminProviders>
      </body>
    </html>
  );
}
