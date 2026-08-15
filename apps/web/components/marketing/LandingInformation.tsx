import type { CSSProperties } from "react";
import { getTranslations } from "next-intl/server";

const LOOP = ["discover", "understand", "verify", "act"] as const;
const FAQ = ["q1", "q2", "q3", "q4", "q5"] as const;

const wrap: CSSProperties = {
  maxWidth: 720,
  margin: "0 auto",
  padding: "0 1.25rem 4.5rem",
  color: "#DCDDE1",
  textAlign: "start",
  lineHeight: 1.65,
};

const rule: CSSProperties = {
  border: 0,
  borderTop: "1px solid rgba(154, 158, 168, 0.18)",
  margin: "3rem 0 2.5rem",
};

/**
 * Indexable definition + process + FAQ. Facts only — not a sales pitch.
 * Server-rendered so crawlers get the full article without the promo video.
 */
export async function LandingInformation() {
  const t = await getTranslations("landing.info");

  return (
    <article
      style={{
        borderTop: "1px solid rgba(154, 158, 168, 0.14)",
        background:
          "linear-gradient(180deg, #12141A 0%, #16191F 48%, #12141A 100%)",
        paddingTop: "3.5rem",
      }}
    >
      <div style={wrap}>
        <p
          style={{
            color: "#9A9EA8",
            fontWeight: 650,
            letterSpacing: "0.04em",
            fontSize: "0.8rem",
            textTransform: "uppercase",
            margin: "0 0 0.75rem",
          }}
        >
          {t("kicker")}
        </p>
        <h2
          style={{
            fontFamily: '"Syne", "Rubik", sans-serif',
            fontWeight: 700,
            fontSize: "clamp(1.45rem, 3vw, 1.9rem)",
            letterSpacing: "-0.03em",
            lineHeight: 1.25,
            margin: "0 0 1rem",
            color: "#EEEEF0",
          }}
        >
          {t("title")}
        </h2>
        <p style={{ fontSize: "1.08rem", color: "rgba(220,221,225,0.92)", margin: "0 0 2rem" }}>
          {t("lead")}
        </p>

        <h3 style={h3}>{t("definitionTitle")}</h3>
        <p style={p}>{t("definition")}</p>

        <h3 style={h3}>{t("notTitle")}</h3>
        <p style={p}>{t("notBody")}</p>

        <h3 style={h3}>{t("loopTitle")}</h3>
        <p style={p}>{t("loopLead")}</p>
        <ol style={{ paddingInlineStart: "1.25rem", margin: "0 0 1.5rem" }}>
          {LOOP.map((step) => (
            <li key={step} style={{ marginBottom: "0.85rem" }}>
              <strong style={{ color: "#C8CBD2" }}>{t(`loop.${step}.title`)}</strong>
              {" — "}
              {t(`loop.${step}.body`)}
            </li>
          ))}
        </ol>

        <h3 style={h3}>{t("evidenceTitle")}</h3>
        <p style={p}>{t("evidenceBody")}</p>

        <h3 style={h3}>{t("selfTitle")}</h3>
        <p style={p}>{t("selfBody")}</p>

        <hr style={rule} />

        <h2
          style={{
            fontFamily: '"Syne", "Rubik", sans-serif',
            fontWeight: 700,
            fontSize: "clamp(1.3rem, 2.6vw, 1.65rem)",
            letterSpacing: "-0.03em",
            margin: "0 0 1.25rem",
            color: "#EEEEF0",
          }}
        >
          {t("faqTitle")}
        </h2>
        {FAQ.map((id) => (
          <section key={id} style={{ marginBottom: "1.5rem" }}>
            <h3 style={{ ...h3, marginTop: 0 }}>{t(`faq.${id}.q`)}</h3>
            <p style={{ ...p, marginBottom: 0 }}>{t(`faq.${id}.a`)}</p>
          </section>
        ))}
      </div>
    </article>
  );
}

const h3: CSSProperties = {
  fontFamily: '"Syne", "Rubik", sans-serif',
  fontWeight: 650,
  fontSize: "1.12rem",
  color: "#9A9EA8",
  margin: "1.75rem 0 0.5rem",
};

const p: CSSProperties = {
  margin: "0 0 0.75rem",
  color: "rgba(180, 183, 190, 0.95)",
  fontSize: "1.02rem",
};
