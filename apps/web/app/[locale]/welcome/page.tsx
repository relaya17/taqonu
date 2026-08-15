import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { WelcomeLanding } from "@/components/marketing/WelcomeLanding";
import { LandingInformation } from "@/components/marketing/LandingInformation";
import { absoluteUrl, getSiteUrl } from "@/lib/site-url";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "landing" });
  const path = `/${locale}/welcome`;
  const url = absoluteUrl(path);
  const title = t("seoTitle");
  const description = t("seoDescription");

  return {
    metadataBase: new URL(getSiteUrl()),
    title: { absolute: title },
    description,
    keywords: t("seoKeywords")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean),
    alternates: {
      canonical: url,
      languages: {
        he: absoluteUrl("/he/welcome"),
        en: absoluteUrl("/en/welcome"),
        ar: absoluteUrl("/ar/welcome"),
        "x-default": absoluteUrl("/he/welcome"),
      },
    },
    openGraph: {
      type: "article",
      locale,
      url,
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
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
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
  const url = absoluteUrl(`/${locale}/welcome`);

  const faqIds = ["q1", "q2", "q3", "q4", "q5"] as const;
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      "@id": `${url}#page`,
      url,
      name: t("seoTitle"),
      description: t("seoDescription"),
      inLanguage: locale,
      isPartOf: {
        "@type": "WebSite",
        name: "ArletOS",
        url: getSiteUrl(),
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "TechArticle",
      headline: t("info.title"),
      description: t("info.lead"),
      inLanguage: locale,
      author: { "@type": "Organization", name: "ArletOS" },
      about: ["software readiness", "evidence", "AI governance", "Atlas"],
      mainEntityOfPage: url,
    },
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "ArletOS",
      alternateName: "Atlas",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web",
      description: t("seoDescription"),
      url,
      offers: [
        {
          "@type": "Offer",
          name: t("freeName"),
          price: "0",
          priceCurrency: "USD",
          description: t("freeDetail"),
        },
        {
          "@type": "Offer",
          name: t("proName"),
          priceCurrency: "USD",
          description: t("proDetail"),
        },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqIds.map((id) => ({
        "@type": "Question",
        name: t(`info.faq.${id}.q`),
        acceptedAnswer: {
          "@type": "Answer",
          text: t(`info.faq.${id}.a`),
        },
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "ArletOS",
          item: getSiteUrl(),
        },
        {
          "@type": "ListItem",
          position: 2,
          name: t("info.title"),
          item: url,
        },
      ],
    },
  ];

  return (
    <>
      {jsonLd.map((block, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(block) }}
        />
      ))}
      <WelcomeLanding>
        <LandingInformation />
      </WelcomeLanding>
    </>
  );
}
