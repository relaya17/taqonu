"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Link as MuiLink,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  ATLAS_SELF_APPLICATION_ID,
  ATLAS_SELF_PROJECT_ID,
  ATLAS_SELF_TENANT_ID,
} from "@atlas/shared";
import { apiGet, apiPost, resolveApiUrl } from "@/lib/api";

/* ── Response shapes (mirrors apps/api handlers) ───────────────────────── */

interface KnowledgeOverview {
  policy: string;
  verifiedSources: string;
  download: { json: string; markdown: string };
  counts: { tech: number; legal: number; refreshTargets: number };
  sources: {
    id: string;
    domain: string;
    organization: string;
    sourceType: string;
    url: string;
    allowed: boolean;
  }[];
}

interface KnowledgeHit {
  id: string;
  title: string;
  sourceClass: string;
  authority: number;
  url: string | null;
  retrievedAt: string;
  sourceUpdatedAt: string | null;
  freshness: "CURRENT" | "STALE" | "UNKNOWN";
  excerpt: string;
  contentHash: string;
  epistemicState: string;
}

interface KnowledgeSearchResult {
  query: string;
  hits: KnowledgeHit[];
  filteredOut: number;
  plainLanguage: string;
  retrievalBackend?: "pgvector" | "local";
}

interface CorpusDoc {
  id: string;
  title: string;
  sourceClass: string;
  url: string | null;
  excerpt: string;
  sourceUpdatedAt: string | null;
  projectScoped: boolean;
  contentHash: string;
}

interface CorpusResponse {
  items: CorpusDoc[];
  corpus: string;
  path: string | null;
  note: string;
}

interface RefreshStatus {
  due: boolean;
  intervalHours: number;
  lastFinishedAt: string | null;
  lastOk: number;
  lastFailed: number;
  policy: string;
}

interface Lesson {
  id: string;
  pattern: string;
  title: string;
  evidenceProjectSlug: string | null;
  applicableDomains: string[];
  summary: string;
  createdAt: string;
  epistemicState: string;
}

interface IngestResponse {
  document: CorpusDoc;
  corpus: string;
  pgvector: boolean;
  note: string;
}

interface ResearchCitation {
  claim: string;
  source: string;
  sourceType: string;
  authorityLevel: string;
  retrievedAt: string;
  excerpt: string | null;
  confidence: number;
  epistemicState: string;
}

interface ResearchResult {
  question: string;
  answer: string;
  citations: ResearchCitation[];
  conflicts: { claimA: string; claimB: string; resolution: string | null }[];
  epistemicState: string;
}

const CORPUS_PAGE = 20;
const INGEST_SOURCE_CLASSES = ["OFFICIAL_VENDOR_DOCS", "GOVERNMENT_OR_STANDARDS"] as const;

function apiHref(path: string): string {
  return /^https?:\/\//.test(path) ? path : `${resolveApiUrl()}${path}`;
}

function formatDate(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <MuiLink href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </MuiLink>
  );
}

function Section({
  id,
  title,
  description,
  defaultExpanded = false,
  onExpand,
  children,
}: {
  id: string;
  title: string;
  description: string;
  defaultExpanded?: boolean;
  onExpand?: () => void;
  children: ReactNode;
}) {
  return (
    <Accordion
      defaultExpanded={defaultExpanded}
      disableGutters
      onChange={(_e, expanded) => {
        if (expanded && onExpand) onExpand();
      }}
    >
      <AccordionSummary
        expandIcon={<ExpandMoreIcon />}
        aria-controls={`${id}-content`}
        id={`${id}-header`}
      >
        <Box>
          <Typography variant="h2" component="h2" sx={{ fontSize: "1.15rem" }}>
            {title}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {description}
          </Typography>
        </Box>
      </AccordionSummary>
      <AccordionDetails id={`${id}-content`}>{children}</AccordionDetails>
    </Accordion>
  );
}

/* ── Sections ──────────────────────────────────────────────────────────── */

function PolicySection() {
  const t = useTranslations("knowledgeView");
  const query = useQuery({
    queryKey: ["knowledge", "overview"],
    queryFn: () => apiGet<KnowledgeOverview>("/api/v1/knowledge"),
  });
  const [showAll, setShowAll] = useState(false);

  if (query.isPending) return <CircularProgress size={20} aria-label={t("loading")} />;
  if (query.isError) return <Alert severity="error">{query.error.message}</Alert>;

  const data = query.data;
  const sources = showAll ? data.sources : data.sources.slice(0, 10);
  return (
    <Stack spacing={2}>
      <Alert severity="info">{data.policy}</Alert>
      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
        <Chip label={t("policy.countTech", { count: data.counts.tech })} />
        <Chip label={t("policy.countLegal", { count: data.counts.legal })} />
        <Chip label={t("policy.countRefresh", { count: data.counts.refreshTargets })} />
      </Stack>
      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
        <Button variant="outlined" component="a" href={apiHref(data.download.json)} download>
          {t("policy.downloadJson")}
        </Button>
        <Button
          variant="outlined"
          component="a"
          href={apiHref(data.download.markdown)}
          download
        >
          {t("policy.downloadMarkdown")}
        </Button>
      </Stack>
      {data.sources.length === 0 ? (
        <Alert severity="info">{t("policy.noSources")}</Alert>
      ) : (
        <Box component="ul" sx={{ m: 0, pl: 3 }}>
          {sources.map((s) => (
            <li key={s.id}>
              <ExternalLink href={s.url}>{s.organization}</ExternalLink>{" "}
              <Typography component="span" variant="body2" color="text.secondary">
                ({s.domain} · {s.sourceType})
              </Typography>
            </li>
          ))}
        </Box>
      )}
      {data.sources.length > 10 ? (
        <Button sx={{ alignSelf: "flex-start" }} onClick={() => setShowAll((v) => !v)}>
          {showAll
            ? t("showLess")
            : t("policy.showAll", { count: data.sources.length })}
        </Button>
      ) : null}
    </Stack>
  );
}

function SearchSection() {
  const t = useTranslations("knowledgeView");
  const [text, setText] = useState("");
  const search = useMutation({
    mutationFn: (q: string) =>
      apiPost<KnowledgeSearchResult>("/api/v1/knowledge/search", {
        query: q,
        tenantId: ATLAS_SELF_TENANT_ID,
        projectId: ATLAS_SELF_PROJECT_ID,
        applicationId: ATLAS_SELF_APPLICATION_ID,
        requestingAgentId: "RESEARCHER",
        maxResults: 20,
      }),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const q = text.trim();
    if (q) search.mutate(q);
  };

  return (
    <Stack spacing={2}>
      <Stack component="form" direction={{ xs: "column", sm: "row" }} spacing={1} onSubmit={onSubmit}>
        <TextField
          fullWidth
          size="small"
          label={t("search.label")}
          value={text}
          onChange={(e) => setText(e.target.value)}
          inputProps={{ maxLength: 2000 }}
        />
        <Button type="submit" variant="contained" disabled={search.isPending || !text.trim()}>
          {t("search.submit")}
        </Button>
      </Stack>
      <Typography variant="body2" color="text.secondary">
        {t("search.signInHint")}
      </Typography>
      {search.isError ? <Alert severity="error">{search.error.message}</Alert> : null}
      {search.data ? (
        <Stack spacing={1.5}>
          <Alert severity={search.data.hits.length > 0 ? "success" : "info"}>
            {search.data.plainLanguage}
          </Alert>
          <Typography variant="body2" color="text.secondary">
            {t("search.summary", {
              count: search.data.hits.length,
              filtered: search.data.filteredOut,
            })}
            {search.data.retrievalBackend
              ? ` · ${t("search.backend", { backend: search.data.retrievalBackend })}`
              : ""}
          </Typography>
          {search.data.hits.length === 0 ? (
            <Alert severity="info">{t("search.empty")}</Alert>
          ) : (
            search.data.hits.map((hit) => (
              <Box key={hit.id} sx={{ py: 1, borderBottom: 1, borderColor: "divider" }}>
                <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
                  {hit.url ? (
                    <ExternalLink href={hit.url}>{hit.title}</ExternalLink>
                  ) : (
                    <Typography fontWeight={700}>{hit.title}</Typography>
                  )}
                  <Chip size="small" label={hit.sourceClass} />
                  <Chip size="small" label={t("search.authority", { value: percent(hit.authority) })} />
                  <Chip
                    size="small"
                    color={hit.freshness === "STALE" ? "warning" : "default"}
                    label={t(`freshness.${hit.freshness}`)}
                  />
                  <Chip size="small" variant="outlined" label={hit.epistemicState} />
                </Stack>
                <Typography variant="body2" sx={{ mt: 0.5 }}>
                  {hit.excerpt}
                </Typography>
              </Box>
            ))
          )}
        </Stack>
      ) : null}
    </Stack>
  );
}

function CorpusSection({ enabled }: { enabled: boolean }) {
  const t = useTranslations("knowledgeView");
  const [limit, setLimit] = useState(CORPUS_PAGE);
  const query = useQuery({
    queryKey: ["knowledge", "corpus"],
    queryFn: () => apiGet<CorpusResponse>("/api/v1/knowledge/corpus"),
    enabled,
  });

  if (!enabled) return null;
  if (query.isPending) return <CircularProgress size={20} aria-label={t("loading")} />;
  if (query.isError) {
    return <Alert severity="info">{t("corpus.unavailable", { reason: query.error.message })}</Alert>;
  }
  const items = query.data.items;
  return (
    <Stack spacing={1.5}>
      <Typography variant="body2" color="text.secondary">
        {t("corpus.summary", { count: items.length, corpus: query.data.corpus })}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {query.data.note}
      </Typography>
      {items.length === 0 ? (
        <Alert severity="info">{t("corpus.empty")}</Alert>
      ) : (
        items.slice(0, limit).map((doc) => (
          <Box key={doc.id} sx={{ py: 1, borderBottom: 1, borderColor: "divider" }}>
            <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
              {doc.url ? (
                <ExternalLink href={doc.url}>{doc.title}</ExternalLink>
              ) : (
                <Typography fontWeight={700}>{doc.title}</Typography>
              )}
              <Chip size="small" label={doc.sourceClass} />
              {doc.projectScoped ? (
                <Chip size="small" variant="outlined" label={t("corpus.projectScoped")} />
              ) : null}
            </Stack>
            {doc.sourceUpdatedAt ? (
              <Typography variant="caption" color="text.secondary">
                {t("corpus.updated", { date: formatDate(doc.sourceUpdatedAt) })}
              </Typography>
            ) : null}
          </Box>
        ))
      )}
      {items.length > limit ? (
        <Button sx={{ alignSelf: "flex-start" }} onClick={() => setLimit((l) => l + CORPUS_PAGE)}>
          {t("corpus.showMore", { shown: limit, total: items.length })}
        </Button>
      ) : null}
    </Stack>
  );
}

function RefreshSection() {
  const t = useTranslations("knowledgeView");
  const query = useQuery({
    queryKey: ["knowledge", "refresh-status"],
    queryFn: () => apiGet<RefreshStatus>("/api/v1/knowledge/refresh/status"),
  });
  if (query.isPending) return <CircularProgress size={20} aria-label={t("loading")} />;
  if (query.isError) return <Alert severity="error">{query.error.message}</Alert>;
  const s = query.data;
  return (
    <Stack spacing={1.5}>
      <Typography>
        {s.lastFinishedAt
          ? t("refresh.lastRun", { date: formatDate(s.lastFinishedAt) })
          : t("refresh.never")}
      </Typography>
      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
        <Chip
          color={s.due ? "warning" : "success"}
          label={s.due ? t("refresh.due") : t("refresh.notDue")}
        />
        <Chip label={t("refresh.interval", { hours: s.intervalHours })} />
        <Chip label={t("refresh.ok", { count: s.lastOk })} />
        <Chip
          color={s.lastFailed > 0 ? "error" : "default"}
          label={t("refresh.failed", { count: s.lastFailed })}
        />
      </Stack>
      <Typography variant="body2" color="text.secondary">
        {s.policy}
      </Typography>
    </Stack>
  );
}

function LessonsSection() {
  const t = useTranslations("knowledgeView");
  const query = useQuery({
    queryKey: ["knowledge", "lessons"],
    queryFn: () => apiGet<{ items: Lesson[]; note: string }>("/api/v1/knowledge/lessons"),
  });
  if (query.isPending) return <CircularProgress size={20} aria-label={t("loading")} />;
  if (query.isError) return <Alert severity="error">{query.error.message}</Alert>;
  const items = query.data.items;
  return (
    <Stack spacing={1.5}>
      <Typography variant="body2" color="text.secondary">
        {query.data.note}
      </Typography>
      {items.length === 0 ? (
        <Alert severity="info">{t("lessons.empty")}</Alert>
      ) : (
        items.map((l) => (
          <Box key={l.id} sx={{ py: 1, borderBottom: 1, borderColor: "divider" }}>
            <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
              <Typography fontWeight={700}>{l.title}</Typography>
              <Chip size="small" label={l.pattern} />
              <Chip size="small" variant="outlined" label={l.epistemicState} />
            </Stack>
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              {l.summary}
            </Typography>
            {l.applicableDomains.length > 0 ? (
              <Typography variant="caption" color="text.secondary">
                {t("lessons.domains", { domains: l.applicableDomains.join(", ") })}
              </Typography>
            ) : null}
          </Box>
        ))
      )}
    </Stack>
  );
}

function IngestSection() {
  const t = useTranslations("knowledgeView");
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [sourceClass, setSourceClass] = useState<string>(INGEST_SOURCE_CLASSES[0]);

  const ingest = useMutation({
    mutationFn: () =>
      apiPost<IngestResponse>("/api/v1/knowledge/ingest", {
        url: url.trim(),
        title: title.trim(),
        excerpt: excerpt.trim(),
        sourceClass,
      }),
    onSuccess: async () => {
      setUrl("");
      setTitle("");
      setExcerpt("");
      await queryClient.invalidateQueries({ queryKey: ["knowledge", "corpus"] });
    },
  });

  const canSubmit =
    url.trim().length > 0 && title.trim().length > 0 && excerpt.trim().length > 0;

  return (
    <Stack
      component="form"
      spacing={1.5}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (canSubmit) ingest.mutate();
      }}
    >
      <Alert severity="info">{t("ingest.hint")}</Alert>
      <TextField
        size="small"
        type="url"
        required
        label={t("ingest.url")}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://"
      />
      <TextField
        size="small"
        required
        label={t("ingest.docTitle")}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        inputProps={{ maxLength: 300 }}
      />
      <TextField
        size="small"
        required
        multiline
        minRows={2}
        label={t("ingest.excerpt")}
        value={excerpt}
        onChange={(e) => setExcerpt(e.target.value)}
        inputProps={{ maxLength: 4000 }}
      />
      <TextField
        select
        size="small"
        label={t("ingest.sourceClass")}
        value={sourceClass}
        onChange={(e) => setSourceClass(e.target.value)}
      >
        {INGEST_SOURCE_CLASSES.map((c) => (
          <MenuItem key={c} value={c}>
            {t(`ingest.class.${c}`)}
          </MenuItem>
        ))}
      </TextField>
      <Button
        type="submit"
        variant="contained"
        sx={{ alignSelf: "flex-start" }}
        disabled={!canSubmit || ingest.isPending}
      >
        {t("ingest.submit")}
      </Button>
      {ingest.isError ? (
        <Alert severity="error">{t("ingest.refused", { reason: ingest.error.message })}</Alert>
      ) : null}
      {ingest.data ? (
        <Alert severity="success">
          {t("ingest.added", { title: ingest.data.document.title })} {ingest.data.note}
        </Alert>
      ) : null}
    </Stack>
  );
}

function ResearchSection() {
  const t = useTranslations("knowledgeView");
  const [question, setQuestion] = useState("");
  const research = useMutation({
    mutationFn: (q: string) => apiPost<ResearchResult>("/api/v1/research", { question: q }),
  });
  const citations = research.data
    ? [...research.data.citations].sort((a, b) => b.confidence - a.confidence)
    : [];

  return (
    <Stack spacing={2}>
      <Stack
        component="form"
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          const q = question.trim();
          if (q) research.mutate(q);
        }}
      >
        <TextField
          fullWidth
          size="small"
          label={t("research.label")}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          inputProps={{ maxLength: 4000 }}
        />
        <Button type="submit" variant="contained" disabled={research.isPending || !question.trim()}>
          {t("research.submit")}
        </Button>
      </Stack>
      {research.isError ? <Alert severity="error">{research.error.message}</Alert> : null}
      {research.data ? (
        <Stack spacing={1.5}>
          <Alert severity={citations.length > 0 ? "success" : "info"}>
            {research.data.answer}
          </Alert>
          <Chip
            size="small"
            variant="outlined"
            sx={{ alignSelf: "flex-start" }}
            label={t("research.overall", { state: research.data.epistemicState })}
          />
          {citations.length > 0 ? (
            <Box component="ol" sx={{ m: 0, pl: 3 }}>
              {citations.map((c) => (
                <Box component="li" key={c.source} sx={{ mb: 1.5 }}>
                  <ExternalLink href={c.source}>{c.claim}</ExternalLink>
                  <Stack direction="row" spacing={1} sx={{ mt: 0.5 }} useFlexGap flexWrap="wrap">
                    <Chip size="small" label={c.sourceType} />
                    <Chip size="small" label={c.authorityLevel} />
                    <Chip
                      size="small"
                      label={t("research.confidence", { value: percent(c.confidence) })}
                    />
                    <Chip size="small" variant="outlined" label={c.epistemicState} />
                  </Stack>
                  {c.excerpt ? (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                      {c.excerpt}
                    </Typography>
                  ) : null}
                </Box>
              ))}
            </Box>
          ) : null}
        </Stack>
      ) : null}
    </Stack>
  );
}

/* ── View ──────────────────────────────────────────────────────────────── */

export function KnowledgeView() {
  const t = useTranslations("knowledgeView");
  const [corpusOpened, setCorpusOpened] = useState(false);

  return (
    <Stack spacing={3} sx={{ maxWidth: 960 }}>
      <Box>
        <Typography variant="h1">{t("title")}</Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {t("subtitle")}
        </Typography>
      </Box>
      <Box>
        <Section
          id="knowledge-policy"
          title={t("policy.title")}
          description={t("policy.description")}
          defaultExpanded
        >
          <PolicySection />
        </Section>
        <Section
          id="knowledge-search"
          title={t("search.title")}
          description={t("search.description")}
          defaultExpanded
        >
          <SearchSection />
        </Section>
        <Section
          id="knowledge-research"
          title={t("research.title")}
          description={t("research.description")}
        >
          <ResearchSection />
        </Section>
        <Section
          id="knowledge-corpus"
          title={t("corpus.title")}
          description={t("corpus.description")}
          onExpand={() => setCorpusOpened(true)}
        >
          <CorpusSection enabled={corpusOpened} />
        </Section>
        <Section
          id="knowledge-refresh"
          title={t("refresh.title")}
          description={t("refresh.description")}
        >
          <RefreshSection />
        </Section>
        <Section
          id="knowledge-lessons"
          title={t("lessons.title")}
          description={t("lessons.description")}
        >
          <LessonsSection />
        </Section>
        <Section
          id="knowledge-ingest"
          title={t("ingest.title")}
          description={t("ingest.description")}
        >
          <IngestSection />
        </Section>
      </Box>
    </Stack>
  );
}
