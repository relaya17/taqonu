import PptxGenJS from "pptxgenjs";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "Atlas-Technology-Briefing.pptx");
const pptx = new PptxGenJS();
pptx.defineLayout({ name: "ATLAS", width: 13.333, height: 7.5 });
pptx.layout = "ATLAS";
pptx.author = "Atlas";
pptx.title = "Atlas — Technology briefing";

const INK = "0B0D10";
const PAPER = "E8E4DC";
const GOLD = "C4A574";
const MUTED = "9A9488";
const PANEL = "12151B";

function slide() {
  const s = pptx.addSlide();
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 7.5, fill: { color: INK } });
  s.addText("ATLAS  ·  TECHNOLOGY BRIEFING", {
    x: 0.55, y: 0.22, w: 10, h: 0.28,
    fontSize: 10, color: GOLD, fontFace: "Calibri", margin: 0,
  });
  s.addText("Local path verified. Production is not proven.", {
    x: 7.4, y: 7.12, w: 5.4, h: 0.22,
    fontSize: 10, color: MUTED, fontFace: "Calibri", align: "right", margin: 0,
  });
  return s;
}

function cards(s, items, y = 2.15) {
  const n = items.length;
  const gap = 0.18;
  const w = (12.2 - gap * (n - 1)) / n;
  items.forEach((item, i) => {
    const x = 0.55 + i * (w + gap);
    s.addShape(pptx.ShapeType.roundRect, {
      x, y, w, h: 2.55, fill: { color: PANEL }, rectRadius: 0.06,
    });
    s.addText(item.title, {
      x: x + 0.16, y: y + 0.14, w: w - 0.32, h: 0.32,
      fontSize: 12, color: PAPER, bold: true, fontFace: "Calibri", margin: 0,
    });
    s.addText(item.body, {
      x: x + 0.16, y: y + 0.5, w: w - 0.32, h: 1.9,
      fontSize: 13, color: MUTED, fontFace: "Calibri", margin: 0,
    });
  });
}

{
  const s = slide();
  s.addText("External technology briefing", { x: 0.55, y: 1.1, w: 10, h: 0.3, fontSize: 12, color: GOLD, fontFace: "Calibri" });
  s.addText("Atlas", { x: 0.55, y: 1.5, w: 12, h: 1.1, fontSize: 60, color: PAPER, fontFace: "Georgia" });
  s.addText("The truth and control layer for AI-native software.", { x: 0.55, y: 2.7, w: 11, h: 0.45, fontSize: 20, color: PAPER, fontFace: "Calibri" });
  cards(s, [
    { title: "Truth", body: "What is known, proven, and still unverified." },
    { title: "Governance", body: "What may happen next, and under whose authority." },
    { title: "Control", body: "Human oversight of agents, change, and automation." },
  ], 3.5);
}

{
  const s = slide();
  s.addText("The problem", { x: 0.55, y: 0.7, w: 12, h: 0.5, fontSize: 32, color: PAPER, fontFace: "Georgia" });
  s.addText("What is actually true about this software right now?", { x: 0.55, y: 1.4, w: 12, h: 0.4, fontSize: 18, color: GOLD, fontFace: "Calibri" });
  s.addText("Most tools generate, test, deploy, or scan. Few bind claim to evidence, evidence to time, and action to approval.", { x: 0.55, y: 1.9, w: 12, h: 0.6, fontSize: 16, color: MUTED, fontFace: "Calibri" });
  cards(s, [
    { title: "What teams hear", body: "We think we are ready. The tests passed. The model suggested a patch. Someone will review it." },
    { title: "What is missing", body: "A durable record of what was observed, verified, drifted, still unknown, and allowed to change." },
  ], 3.0);
}

{
  const s = slide();
  s.addText("What Atlas is", { x: 0.55, y: 0.7, w: 12, h: 0.5, fontSize: 32, color: PAPER, fontFace: "Georgia" });
  s.addText("Not an IDE, chatbot, coding assistant, generic agent framework, or memory database.", { x: 0.55, y: 1.3, w: 12, h: 0.4, fontSize: 16, color: MUTED, fontFace: "Calibri" });
  cards(s, [
    { title: "Atlas is", body: "System model. Evidence graph. Governance over agents. A human-gated path from recommendation to action." },
    { title: "Atlas is not", body: "A replacement for coding tools or CI. An agent inside every product. A host for customer source. A claim that a model finished the work." },
  ], 2.1);
}

{
  const s = slide();
  s.addText("Why it exists", { x: 0.55, y: 0.7, w: 12, h: 0.5, fontSize: 32, color: PAPER, fontFace: "Georgia" });
  cards(s, [
    { title: "Understand", body: "Treat each connected product as a managed system: structure, dependencies, contracts, expected behavior." },
    { title: "Detect", body: "Continuous audit against evidence — without mistaking a score for proof." },
    { title: "Act, gated", body: "Recommendation, risk, policy, approval, execution, and verification are separate steps." },
  ], 1.7);
}

{
  const s = slide();
  s.addText("How Atlas thinks", { x: 0.55, y: 0.7, w: 12, h: 0.5, fontSize: 32, color: PAPER, fontFace: "Georgia" });
  s.addText("Truth · Evidence · Governance · Intelligence · Control. Observed from the outside through connectors.", { x: 0.55, y: 1.35, w: 12, h: 0.45, fontSize: 16, color: MUTED, fontFace: "Calibri" });
  s.addText("Discover  →  Understand  →  Verify  →  Act, only when gated", { x: 0.55, y: 2.0, w: 12, h: 0.4, fontSize: 18, color: GOLD, fontFace: "Calibri" });
  s.addText("A successful command is not a successful repair until verification and evidence say so.", { x: 0.55, y: 2.6, w: 12, h: 0.4, fontSize: 16, color: MUTED, fontFace: "Calibri" });
}

{
  const s = slide();
  s.addText("How the parts relate", { x: 0.55, y: 0.65, w: 12, h: 0.45, fontSize: 30, color: PAPER, fontFace: "Georgia" });
  s.addText("Implemented as separate trust planes — not one website on one port.", { x: 0.55, y: 1.15, w: 12, h: 0.3, fontSize: 15, color: MUTED, fontFace: "Calibri" });
  cards(s, [
    { title: "Atlas Core", body: "Shared API, schemas, policy, risk, memory, evidence, audit, connectors." },
    { title: "Web", body: "Personal user plane: projects, systems, truth, health, readiness, memory, Studio." },
    { title: "Studio", body: "Supervised workspace. Propose, review, approve, apply, verify on an owned project." },
  ], 1.6);
  cards(s, [
    { title: "Control", body: "Operator supervision of agents, applications, approvals, automation." },
    { title: "Admin", body: "Platform supervisor over Control and Studio. Not tenant admin." },
    { title: "Agents & apps", body: "Catalog + personal agent under policy. Connected apps stay themselves." },
  ], 4.35);
}

{
  const s = slide();
  s.addText("Governed execution", { x: 0.55, y: 0.7, w: 12, h: 0.5, fontSize: 32, color: PAPER, fontFace: "Georgia" });
  s.addText("Request  →  Policy  →  Risk  →  Approval  →  Execution  →  Result  →  Audit  →  Evidence  →  Verification", {
    x: 0.55, y: 1.4, w: 12.2, h: 0.55, fontSize: 14, color: GOLD, fontFace: "Calibri",
  });
  cards(s, [
    { title: "Locally demonstrated", body: "Guardian CONSISTENT / CONFLICT / UNKNOWN. Dual-control SoD. Claimed apply. Disk verify. Append-only audit. Owner- and project-scoped memory." },
    { title: "Not claimed", body: "Production proof. Unsupervised apply. Atlas executing CaseFlow, HotelOS, or other customer applications." },
  ], 2.3);
}

{
  const s = slide();
  s.addText("Memory, knowledge, evidence", { x: 0.55, y: 0.7, w: 12, h: 0.5, fontSize: 30, color: PAPER, fontFace: "Georgia" });
  cards(s, [
    { title: "Evidence", body: "Claims carry source, time, confidence, and status. A score without evidence is not truth." },
    { title: "Memory", body: "User → agent → user-owned memory, scoped to owner and project, with provenance. No cross-tenant training." },
    { title: "Knowledge", body: "Allow-listed public sources. Generated text stays a hypothesis until verified." },
  ], 1.7);
}

{
  const s = slide();
  s.addText("Agents and human oversight", { x: 0.55, y: 0.7, w: 12, h: 0.5, fontSize: 30, color: PAPER, fontFace: "Georgia" });
  cards(s, [
    { title: "Agents", body: "Specialists for engineering, quality, security, research. Workers under catalog, policy, and runtime control." },
    { title: "Humans", body: "Propose, Guardian, dual-control approve, apply, then verify on disk. Kill switches remain." },
  ], 1.7);
}

{
  const s = slide();
  s.addText("Product experience", { x: 0.55, y: 0.7, w: 12, h: 0.5, fontSize: 32, color: PAPER, fontFace: "Georgia" });
  cards(s, [
    { title: "What an operator sees", body: "Blocked-first systems. Verdict with evidence. Truth, health, readiness. Studio as the working home. Process and quality audits." },
    { title: "What the audit is for", body: "Connect, discover, model, verify. Executive readout. Counsel pack for licensed advisors — not legal advice. Storage is BYO." },
  ], 1.7);
}

{
  const s = slide();
  s.addText("Architecture", { x: 0.55, y: 0.7, w: 12, h: 0.5, fontSize: 32, color: PAPER, fontFace: "Georgia" });
  s.addText("Public, user (Web + Studio), Control, and Admin stay separate planes.", { x: 0.55, y: 1.3, w: 12, h: 0.35, fontSize: 16, color: MUTED, fontFace: "Calibri" });
  cards(s, [
    { title: "Observe", body: "Connectors for git, delivery, and related signals. Atlas stays outside the managed application." },
    { title: "Bind", body: "Contract, evidence, memory, and verdict are first-class. Authority is assigned by the platform." },
    { title: "Govern", body: "Policy, approval, and runtime control. Control does not run the customer’s tools." },
  ], 1.9);
}

{
  const s = slide();
  s.addText("Trust posture", { x: 0.55, y: 0.7, w: 12, h: 0.5, fontSize: 32, color: PAPER, fontFace: "Georgia" });
  cards(s, [
    { title: "Isolation", body: "Memory and evidence scoped to the owner of the work." },
    { title: "Authority", body: "Agents do not inherit unlimited authority. Write-adjacent work needs explicit approval." },
    { title: "Honesty of status", body: "Local governed path is implemented and verified. Production, paying customers, and PoV are not claimed." },
  ], 1.8);
}

{
  const s = slide();
  s.addText("Atlas exists so “the model did it” is never the last word on whether software is true, safe, or allowed to change.", {
    x: 0.7, y: 2.2, w: 12, h: 2.2, fontSize: 28, color: PAPER, fontFace: "Georgia",
  });
}

const buf = await pptx.write({ outputType: "nodebuffer" });
writeFileSync(out, buf);
console.log("wrote", out);
