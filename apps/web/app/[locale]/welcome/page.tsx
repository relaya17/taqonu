import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { WelcomeLanding } from "@/components/marketing/WelcomeLanding";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "landing" });
  const path = `/${locale}/welcome`;
  const title = t("seoTitle");
  const description = t("seoDescription");

  return {
    title,
    description,
    keywords: t("seoKeywords")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean),
    alternates: {
      canonical: path,
      languages: {
        he: "/he/welcome",
        en: "/en/welcome",
        ar: "/ar/welcome",
      },
    },
    openGraph: {
      type: "website",
      locale,
      url: path,
      title,
      description,
      siteName: "ArletOS · Atlas",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
    robots: {
      index: true,
      follow: true,
    },
  };
}

export default async function WelcomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "landing" });

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "ArletOS",
    alternateName: "Atlas",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Web",
    description: t("seoDescription"),
    offers: [
      {
        "@type": "Offer",
        name: "Free",
        price: "0",
        priceCurrency: "USD",
        description: t("freeDetail"),
      },
      {
        "@type": "Offer",
        name: "Pro",
        priceCurrency: "USD",
        description: t("proDetail"),
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <WelcomeLanding />
    </>
  );
}
