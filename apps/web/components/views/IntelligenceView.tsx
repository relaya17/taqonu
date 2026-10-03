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
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiGet, apiPatch, apiPost, resolveApiUrl } from "@/lib/api";

/* ── Response shapes (mirrors apps/api/src/services/*) ─────────────────── */

type Epistemic = "OBSERVED" | "INSUFFICIENT_EVIDENCE";

interface MarketplaceEntry {
  agentId: string;
  displayName: string;
  description: string;
  category: string;
  effectivenessScore: number;
  reliabilityScore: number;
  specializationScore: number;
  costTier: "LOW" | "MEDIUM" | "HIGH";
  strengths: string[];
  limitations: string[];
  bestFor: string[];
  sampleSize: number;
  epistemicState: Epistemic;
}

interface ReputationSummary {
  mode: string;
  totalRuns: number;
  sampleSize: number;
  succeededCount: number;
  failedCount: number;
  pendingCount: number;
  successRate: number | null;
  avgCostUsd: number | null;
  avgDurationMs: number | null;
  epistemicState: Epistemic;
  generatedAt: string;
}

interface BattleMetrics {
  agentId: string;
  expertiseScore: number;
  evidenceScore: number;
  predictionAccuracy: number | null;
  resolutionRate: number;
  verificationSuccessRate: number;
  challengesIssued: number;
  challengesReceived: number;
  challengeWinRate: number | null;
  overturnRate: number;
  sampleSize: number;
  epistemicState: Epistemic;
}

interface AgentRanking {
  agentId: string;
  domain: string;
  score: number;
  confidence: number;
  strengths: string[];
  weaknesses: string[];
}

const HYPOTHESIS_STATUSES = [
  "PROPOSED",
  "TESTING",
  "SUPPORTED",
  "REFUTED",
  "INCONCLUSIVE",
  "SUPERSEDED",
] as const;
type HypothesisStatus = (typeof HYPOTHESIS_STATUSES)[number];

const HYPOTHESIS_DOMAINS = [
  "PERFORMANCE",
  "RELIABILITY",
  "SECURITY",
  "CORRECTNESS",
  "ARCHITECTURE",
  "INTEGRATION",
] as const;
type HypothesisDomain = (typeof HYPOTHESIS_DOMAINS)[number];

interface Hypothesis {
  id: string;
  projectId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  status: HypothesisStatus;
  statement: string;
  domain: HypothesisDomain;
  verificationCriteria: string[];
  supportingEvidenceIds: string[];
  contradictingEvidenceIds: string[];
  confidence: number;
  tags: string[];
}

const GOLDEN_DOMAINS = [
  "API_DESIGN",
  "DATABASE_SCHEMA",
  "SECURITY",
  "TESTING",
  "DOCUMENTATION",
  "PERFORMANCE",
  "ARCHITECTURE",
  "ERROR_HANDLING",
] as const;

interface GoldenProject {
  id: string;
  name: string;
  description: string;
  rootPath: string;
  status: "CANDIDATE" | "VERIFIED" | "GRADUATED" | "SUSPENDED";
  goldenReason: string;
  domains: string[];
  qualityScores: {
    codeQuality: number;
    testCoverage: number;
    documentation: number;
    security: number;
    maintainability: number;
  };
  lastAnalyzedAt: string | null;
}

interface VerificationLessonsReport {
  generatedAt: string;
  inspected: number;
  failedVerification: number;
  regressionFailed: number;
  lessons: { title: string; evidence: string; recommendation: string }[];
}

interface OutcomeSignalsReport {
  generatedAt: string;
  inspected: number;
  executedSuccess: number;
  deniedOrFailed: number;
  verified: number;
  successRate: number | null;
  confidence: number;
  byAgent: { agentId: string; count: number }[];
  recommendation: string;
}

/**
 * Admin-only GET: resolves to null on 401/403 so the section can hide itself
 * instead of surfacing an error to non-admin viewers.
 */
async function adminGet<T>(path: string): Promise<T | null> {
  const response = await fetch(`${resolveApiUrl()}${path}`, {
    credentials: "include",
    cache: "no-store",
  });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Error(`API ${path} failed with ${response.status}`);
  return (await response.json()) as T;
}

function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function formatDate(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

function Loading() {
  const t = useTranslations("intelligenceView");
  return <CircularProgress size={20} aria-label={t("loading")} />;
}

function Section({
  id,
  title,
  description,
  defaultExpanded = false,
  children,
}: {
  id: string;
  title: string;
  description: string;
  defaultExpanded?: boolean;
  children: ReactNode;
}) {
  return (
    <Accordion defaultExpanded={defaultExpanded} disableGutters slotProps={{ transition: { unmountOnExit: true } }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />} aria-controls={`${id}-content`} id={`${id}-header`}>
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

function useMarketplace() {
  return useQuery({
    queryKey: ["intelligence", "marketplace"],
    queryFn: () => apiGet<MarketplaceEntry[]>("/api/v1/intelligence/marketplace"),
  });
}

function AgentCard({ entry }: { entry: MarketplaceEntry }) {
  const t = useTranslations("intelligenceView");
  return (
    <Box sx={{ py: 1.5, borderBottom: 1, borderColor: "divider" }}>
      <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
        <Typography component="h3" fontWeight={700}>
          {entry.displayName}
        </Typography>
        <Chip size="small" label={entry.category} />
        <Chip size="small" label={t("market.cost", { tier: t(`costTier.${entry.costTier}`) })} />
        <Chip
          size="small"
          variant="outlined"
          color={entry.epistemicState === "OBSERVED" ? "success" : "default"}
          label={t(`epistemic.${entry.epistemicState}`)}
        />
      </Stack>
      <Typography variant="body2" sx={{ mt: 0.5 }}>
        {entry.description}
      </Typography>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
        {t("market.scores", {
          effectiveness: percent(entry.effectivenessScore),
          reliability: percent(entry.reliabilityScore),
          specialization: percent(entry.specializationScore),
          samples: entry.sampleSize,
        })}
      </Typography>
      {entry.bestFor.length > 0 ? (
        <Typography variant="caption" color="text.secondary" component="p">
          {t("market.bestFor", { items: entry.bestFor.join(", ") })}
        </Typography>
      ) : null}
      {entry.strengths.length > 0 ? (
        <Typography variant="caption" color="text.secondary" component="p">
          {t("market.strengths", { items: entry.strengths.join(", ") })}
        </Typography>
      ) : null}
      {entry.limitations.length > 0 ? (
        <Typography variant="caption" color="text.secondary" component="p">
          {t("market.limitations", { items: entry.limitations.join(", ") })}
        </Typography>
      ) : null}
    </Box>
  );
}

/* ── Sections ──────────────────────────────────────────────────────────── */

function RecommendSection() {
  const t = useTranslations("intelligenceView");
  const market = useMarketplace();
  const [task, setTask] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  const recommend = useMutation({
    mutationFn: (q: string) =>
      apiGet<MarketplaceEntry[]>(
        `/api/v1/intelligence/marketplace/recommend?task=${encodeURIComponent(q)}`,
      ),
  });
  const compare = useMutation({
    mutationFn: (ids: string[]) =>
      apiGet<MarketplaceEntry[]>(
        `/api/v1/intelligence/marketplace/compare?agents=${encodeURIComponent(ids.join(","))}`,
      ),
  });

  const metricRows: { key: string; get: (e: MarketplaceEntry) => string }[] = [
    { key: "category", get: (e) => e.category },
    { key: "effectiveness", get: (e) => percent(e.effectivenessScore) },
    { key: "reliability", get: (e) => percent(e.reliabilityScore) },
    { key: "specialization", get: (e) => percent(e.specializationScore) },
    { key: "costTier", get: (e) => t(`costTier.${e.costTier}`) },
    { key: "sampleSize", get: (e) => String(e.sampleSize) },
    { key: "epistemicState", get: (e) => t(`epistemic.${e.epistemicState}`) },
    { key: "bestFor", get: (e) => e.bestFor.join(", ") },
  ];

  return (
    <Stack spacing={3}>
      <Stack spacing={1.5}>
        <Typography component="h3" fontWeight={700}>
          {t("recommend.heading")}
        </Typography>
        <Stack
          component="form"
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            const q = task.trim();
            if (q) recommend.mutate(q);
          }}
        >
          <TextField
            fullWidth
            size="small"
            label={t("recommend.label")}
            helperText={t("recommend.helper")}
            value={task}
            onChange={(e) => setTask(e.target.value)}
          />
          <Button
            type="submit"
            variant="contained"
            disabled={recommend.isPending || !task.trim()}
            sx={{ alignSelf: { sm: "flex-start" } }}
          >
            {t("recommend.submit")}
          </Button>
        </Stack>
        {recommend.isError ? <Alert severity="error">{recommend.error.message}</Alert> : null}
        {recommend.data ? (
          recommend.data.length === 0 ? (
            <Alert severity="info">{t("recommend.empty")}</Alert>
          ) : (
            <Box>
              {recommend.data.map((entry) => (
                <AgentCard key={entry.agentId} entry={entry} />
              ))}
            </Box>
          )
        ) : null}
      </Stack>

      <Stack spacing={1.5}>
        <Typography component="h3" fontWeight={700}>
          {t("compare.heading")}
        </Typography>
        {market.isError ? <Alert severity="error">{market.error.message}</Alert> : null}
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
          <TextField
            select
            fullWidth
            size="small"
            label={t("compare.label")}
            value={selected}
            disabled={!market.data}
            SelectProps={{
              multiple: true,
              renderValue: (value) =>
                (value as string[])
                  .map((id) => market.data?.find((m) => m.agentId === id)?.displayName ?? id)
                  .join(", "),
            }}
            onChange={(e) => {
              const v = e.target.value as unknown;
              setSelected(typeof v === "string" ? v.split(",") : (v as string[]));
            }}
          >
            {(market.data ?? []).map((m) => (
              <MenuItem key={m.agentId} value={m.agentId}>
                {m.displayName}
              </MenuItem>
            ))}
          </TextField>
          <Button
            variant="contained"
            disabled={compare.isPending || selected.length < 2}
            onClick={() => compare.mutate(selected)}
          >
            {t("compare.submit")}
          </Button>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {t("compare.helper")}
        </Typography>
        {compare.isError ? <Alert severity="error">{compare.error.message}</Alert> : null}
        {compare.data ? (
          compare.data.length === 0 ? (
            <Alert severity="info">{t("compare.empty")}</Alert>
          ) : (
            <TableContainer sx={{ overflowX: "auto" }}>
              <Table size="small" aria-label={t("compare.tableLabel")}>
                <TableHead>
                  <TableRow>
                    <TableCell component="th" scope="col">
                      {t("compare.metric")}
                    </TableCell>
                    {compare.data.map((e) => (
                      <TableCell key={e.agentId} component="th" scope="col">
                        {e.displayName}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {metricRows.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell component="th" scope="row">
                        {t(`compare.rows.${row.key}`)}
                      </TableCell>
                      {compare.data.map((e) => (
                        <TableCell key={e.agentId}>{row.get(e)}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )
        ) : null}
      </Stack>
    </Stack>
  );
}

function MarketplaceSection() {
  const t = useTranslations("intelligenceView");
  const market = useMarketplace();
  if (market.isPending) return <Loading />;
  if (market.isError) return <Alert severity="error">{market.error.message}</Alert>;
  if (market.data.length === 0) return <Alert severity="info">{t("market.empty")}</Alert>;
  return (
    <Box>
      {market.data.map((entry) => (
        <AgentCard key={entry.agentId} entry={entry} />
      ))}
    </Box>
  );
}

function ReputationSection() {
  const t = useTranslations("intelligenceView");
  const [domain, setDomain] = useState<string>(GOLDEN_DOMAINS[0]);
  const reputation = useQuery({
    queryKey: ["intelligence", "reputation"],
    queryFn: () => apiGet<ReputationSummary[]>("/api/v1/intelligence/reputation"),
  });
  const battle = useQuery({
    queryKey: ["intelligence", "battle-metrics"],
    queryFn: () =>
      apiGet<BattleMetrics[]>("/api/v1/intelligence/reputation/battle-metrics"),
  });
  const rankings = useQuery({
    queryKey: ["intelligence", "rankings", domain],
    queryFn: () =>
      apiGet<AgentRanking[]>(
        `/api/v1/intelligence/reputation/rankings/${encodeURIComponent(domain)}`,
      ),
  });

  const battleObserved = (battle.data ?? []).filter((b) => b.sampleSize > 0);
  const sortedRankings = [...(rankings.data ?? [])].sort((a, b) => b.score - a.score);

  return (
    <Stack spacing={3}>
      <Stack spacing={1}>
        <Typography component="h3" fontWeight={700}>
          {t("reputation.byModeHeading")}
        </Typography>
        {reputation.isPending ? (
          <Loading />
        ) : reputation.isError ? (
          <Alert severity="error">{reputation.error.message}</Alert>
        ) : reputation.data.every((r) => r.totalRuns === 0) ? (
          <Alert severity="info">{t("reputation.noRuns")}</Alert>
        ) : (
          <TableContainer sx={{ overflowX: "auto" }}>
            <Table size="small" aria-label={t("reputation.byModeHeading")}>
              <TableHead>
                <TableRow>
                  <TableCell component="th" scope="col">{t("reputation.mode")}</TableCell>
                  <TableCell component="th" scope="col">{t("reputation.runs")}</TableCell>
                  <TableCell component="th" scope="col">{t("reputation.succeeded")}</TableCell>
                  <TableCell component="th" scope="col">{t("reputation.failed")}</TableCell>
                  <TableCell component="th" scope="col">{t("reputation.pending")}</TableCell>
                  <TableCell component="th" scope="col">{t("reputation.successRate")}</TableCell>
                  <TableCell component="th" scope="col">{t("reputation.state")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {reputation.data.map((r) => (
                  <TableRow key={r.mode}>
                    <TableCell component="th" scope="row">{r.mode}</TableCell>
                    <TableCell>{r.totalRuns}</TableCell>
                    <TableCell>{r.succeededCount}</TableCell>
                    <TableCell>{r.failedCount}</TableCell>
                    <TableCell>{r.pendingCount}</TableCell>
                    <TableCell>{percent(r.successRate)}</TableCell>
                    <TableCell>{t(`epistemic.${r.epistemicState}`)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Stack>

      <Stack spacing={1}>
        <Typography component="h3" fontWeight={700}>
          {t("reputation.battleHeading")}
        </Typography>
        {battle.isPending ? (
          <Loading />
        ) : battle.isError ? (
          <Alert severity="error">{battle.error.message}</Alert>
        ) : battleObserved.length === 0 ? (
          <Alert severity="info">{t("reputation.noBattle")}</Alert>
        ) : (
          <TableContainer sx={{ overflowX: "auto" }}>
            <Table size="small" aria-label={t("reputation.battleHeading")}>
              <TableHead>
                <TableRow>
                  <TableCell component="th" scope="col">{t("reputation.agent")}</TableCell>
                  <TableCell component="th" scope="col">{t("reputation.expertise")}</TableCell>
                  <TableCell component="th" scope="col">{t("reputation.evidence")}</TableCell>
                  <TableCell component="th" scope="col">{t("reputation.verification")}</TableCell>
                  <TableCell component="th" scope="col">{t("reputation.winRate")}</TableCell>
                  <TableCell component="th" scope="col">{t("reputation.samples")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {battleObserved.map((b) => (
                  <TableRow key={b.agentId}>
                    <TableCell component="th" scope="row">{b.agentId}</TableCell>
                    <TableCell>{percent(b.expertiseScore)}</TableCell>
                    <TableCell>{percent(b.evidenceScore)}</TableCell>
                    <TableCell>{percent(b.verificationSuccessRate)}</TableCell>
                    <TableCell>{percent(b.challengeWinRate)}</TableCell>
                    <TableCell>{b.sampleSize}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Stack>

      <Stack spacing={1}>
        <Typography component="h3" fontWeight={700}>
          {t("reputation.rankingsHeading")}
        </Typography>
        <TextField
          select
          size="small"
          label={t("reputation.domain")}
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          sx={{ maxWidth: 320 }}
        >
          {GOLDEN_DOMAINS.map((d) => (
            <MenuItem key={d} value={d}>
              {t(`goldenDomain.${d}`)}
            </MenuItem>
          ))}
        </TextField>
        {rankings.isPending ? (
          <Loading />
        ) : rankings.isError ? (
          <Alert severity="error">{rankings.error.message}</Alert>
        ) : sortedRankings.length === 0 ? (
          <Alert severity="info">{t("reputation.noRankings")}</Alert>
        ) : (
          <>
            {sortedRankings.every((r) => r.confidence <= 0.2) ? (
              <Alert severity="warning">{t("reputation.lowConfidence")}</Alert>
            ) : null}
            <TableContainer sx={{ overflowX: "auto" }}>
              <Table size="small" aria-label={t("reputation.rankingsHeading")}>
                <TableHead>
                  <TableRow>
                    <TableCell component="th" scope="col">#</TableCell>
                    <TableCell component="th" scope="col">{t("reputation.agent")}</TableCell>
                    <TableCell component="th" scope="col">{t("reputation.score")}</TableCell>
                    <TableCell component="th" scope="col">{t("reputation.confidence")}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sortedRankings.map((r, i) => (
                    <TableRow key={r.agentId}>
                      <TableCell>{i + 1}</TableCell>
                      <TableCell component="th" scope="row">{r.agentId}</TableCell>
                      <TableCell>{percent(r.score)}</TableCell>
                      <TableCell>{percent(r.confidence)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </>
        )}
      </Stack>
    </Stack>
  );
}

function HypothesesSection() {
  const t = useTranslations("intelligenceView");
  const queryClient = useQueryClient();
  const [statement, setStatement] = useState("");
  const [domain, setDomain] = useState<HypothesisDomain>(HYPOTHESIS_DOMAINS[0]);
  const [criteria, setCriteria] = useState("");

  const list = useQuery({
    queryKey: ["intelligence", "hypotheses"],
    queryFn: () => apiGet<Hypothesis[]>("/api/v1/intelligence/hypotheses"),
  });
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["intelligence", "hypotheses"] });

  const create = useMutation({
    mutationFn: () =>
      apiPost<Hypothesis>("/api/v1/intelligence/hypotheses", {
        statement: statement.trim(),
        domain,
        verificationCriteria: criteria
          .split("\n")
          .map((c) => c.trim())
          .filter(Boolean),
      }),
    onSuccess: async () => {
      setStatement("");
      setCriteria("");
      await invalidate();
    },
  });
  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: HypothesisStatus }) =>
      apiPatch<Hypothesis>(`/api/v1/intelligence/hypotheses/${id}/status`, { status }),
    onSuccess: invalidate,
  });

  const criteriaCount = criteria.split("\n").filter((c) => c.trim()).length;
  const canCreate = statement.trim().length >= 10 && criteriaCount > 0;

  return (
    <Stack spacing={3}>
      <Stack
        component="form"
        spacing={1.5}
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (canCreate) create.mutate();
        }}
      >
        <Typography component="h3" fontWeight={700}>
          {t("hypotheses.newHeading")}
        </Typography>
        <TextField
          size="small"
          required
          multiline
          minRows={2}
          label={t("hypotheses.statement")}
          helperText={t("hypotheses.statementHelper")}
          value={statement}
          onChange={(e) => setStatement(e.target.value)}
          inputProps={{ maxLength: 1000 }}
        />
        <TextField
          select
          size="small"
          label={t("hypotheses.domain")}
          value={domain}
          onChange={(e) => setDomain(e.target.value as HypothesisDomain)}
          sx={{ maxWidth: 320 }}
        >
          {HYPOTHESIS_DOMAINS.map((d) => (
            <MenuItem key={d} value={d}>
              {t(`hypothesisDomain.${d}`)}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          required
          multiline
          minRows={2}
          label={t("hypotheses.criteria")}
          helperText={t("hypotheses.criteriaHelper")}
          value={criteria}
          onChange={(e) => setCriteria(e.target.value)}
        />
        <Button
          type="submit"
          variant="contained"
          sx={{ alignSelf: "flex-start" }}
          disabled={!canCreate || create.isPending}
        >
          {t("hypotheses.create")}
        </Button>
        {create.isError ? <Alert severity="error">{create.error.message}</Alert> : null}
      </Stack>

      <Stack spacing={1}>
        <Typography component="h3" fontWeight={700}>
          {t("hypotheses.listHeading")}
        </Typography>
        {updateStatus.isError ? (
          <Alert severity="error">{updateStatus.error.message}</Alert>
        ) : null}
        {list.isPending ? (
          <Loading />
        ) : list.isError ? (
          <Alert severity="error">{list.error.message}</Alert>
        ) : list.data.length === 0 ? (
          <Alert severity="info">{t("hypotheses.empty")}</Alert>
        ) : (
          list.data.map((h) => (
            <Box key={h.id} sx={{ py: 1.5, borderBottom: 1, borderColor: "divider" }}>
              <Typography>{h.statement}</Typography>
              <Stack direction="row" spacing={1} sx={{ mt: 0.5 }} useFlexGap flexWrap="wrap">
                <Chip size="small" label={t(`hypothesisDomain.${h.domain}`)} />
                <Chip size="small" label={t("hypotheses.confidence", { value: percent(h.confidence) })} />
                <Chip
                  size="small"
                  variant="outlined"
                  label={t("hypotheses.evidence", {
                    supporting: h.supportingEvidenceIds.length,
                    contradicting: h.contradictingEvidenceIds.length,
                  })}
                />
              </Stack>
              {h.verificationCriteria.length > 0 ? (
                <Box component="ul" sx={{ my: 0.5, pl: 3 }}>
                  {h.verificationCriteria.map((c, i) => (
                    <Typography component="li" variant="body2" key={i}>
                      {c}
                    </Typography>
                  ))}
                </Box>
              ) : null}
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
                <TextField
                  select
                  size="small"
                  label={t("hypotheses.status")}
                  value={h.status}
                  disabled={updateStatus.isPending}
                  onChange={(e) =>
                    updateStatus.mutate({ id: h.id, status: e.target.value as HypothesisStatus })
                  }
                  sx={{ minWidth: 200 }}
                >
                  {HYPOTHESIS_STATUSES.map((s) => (
                    <MenuItem key={s} value={s}>
                      {t(`hypothesisStatus.${s}`)}
                    </MenuItem>
                  ))}
                </TextField>
                <Typography variant="caption" color="text.secondary">
                  {t("hypotheses.updated", { date: formatDate(h.updatedAt) })}
                </Typography>
              </Stack>
            </Box>
          ))
        )}
      </Stack>
    </Stack>
  );
}

function GoldenProjectsSection() {
  const t = useTranslations("intelligenceView");
  const [domain, setDomain] = useState<string>(GOLDEN_DOMAINS[0]);
  const list = useQuery({
    queryKey: ["intelligence", "golden-projects"],
    queryFn: () => apiGet<GoldenProject[]>("/api/v1/intelligence/golden-projects"),
  });
  const exemplars = useQuery({
    queryKey: ["intelligence", "golden-exemplars", domain],
    queryFn: () =>
      apiGet<GoldenProject[]>(
        `/api/v1/intelligence/golden-projects/exemplars/${encodeURIComponent(domain)}`,
      ),
  });

  return (
    <Stack spacing={3}>
      <Alert severity="info">{t("golden.readOnly")}</Alert>
      <Stack spacing={1}>
        {list.isPending ? (
          <Loading />
        ) : list.isError ? (
          <Alert severity="error">{list.error.message}</Alert>
        ) : list.data.length === 0 ? (
          <Alert severity="info">{t("golden.empty")}</Alert>
        ) : (
          list.data.map((p) => (
            <Box key={p.id} sx={{ py: 1.5, borderBottom: 1, borderColor: "divider" }}>
              <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
                <Typography component="h3" fontWeight={700}>
                  {p.name}
                </Typography>
                <Chip size="small" label={t(`goldenStatus.${p.status}`)} />
                {p.domains.map((d) => (
                  <Chip key={d} size="small" variant="outlined" label={t(`goldenDomain.${d}`)} />
                ))}
              </Stack>
              {p.description ? (
                <Typography variant="body2" sx={{ mt: 0.5 }}>
                  {p.description}
                </Typography>
              ) : null}
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {t("golden.reason", { reason: p.goldenReason })}
              </Typography>
              <Typography variant="caption" color="text.secondary" component="p">
                {t("golden.scores", {
                  code: percent(p.qualityScores.codeQuality),
                  tests: percent(p.qualityScores.testCoverage),
                  docs: percent(p.qualityScores.documentation),
                  security: percent(p.qualityScores.security),
                  maintainability: percent(p.qualityScores.maintainability),
                })}
              </Typography>
              <Typography variant="caption" color="text.secondary" component="p">
                {p.lastAnalyzedAt
                  ? t("golden.analyzed", { date: formatDate(p.lastAnalyzedAt) })
                  : t("golden.neverAnalyzed")}
              </Typography>
            </Box>
          ))
        )}
      </Stack>

      <Stack spacing={1}>
        <Typography component="h3" fontWeight={700}>
          {t("golden.exemplarsHeading")}
        </Typography>
        <TextField
          select
          size="small"
          label={t("golden.domain")}
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          sx={{ maxWidth: 320 }}
        >
          {GOLDEN_DOMAINS.map((d) => (
            <MenuItem key={d} value={d}>
              {t(`goldenDomain.${d}`)}
            </MenuItem>
          ))}
        </TextField>
        {exemplars.isPending ? (
          <Loading />
        ) : exemplars.isError ? (
          <Alert severity="error">{exemplars.error.message}</Alert>
        ) : exemplars.data.length === 0 ? (
          <Alert severity="info">{t("golden.noExemplars")}</Alert>
        ) : (
          <Box component="ol" sx={{ m: 0, pl: 3 }}>
            {exemplars.data.map((p) => (
              <Typography component="li" key={p.id}>
                {p.name}
              </Typography>
            ))}
          </Box>
        )}
      </Stack>
    </Stack>
  );
}

function AdminSignals() {
  const t = useTranslations("intelligenceView");
  const lessons = useQuery({
    queryKey: ["intelligence", "verification-lessons"],
    queryFn: () =>
      adminGet<VerificationLessonsReport>("/api/v1/intelligence/verification-lessons"),
    retry: false,
  });
  const outcomes = useQuery({
    queryKey: ["intelligence", "outcome-signals"],
    queryFn: () => adminGet<OutcomeSignalsReport>("/api/v1/intelligence/outcome-signals"),
    retry: false,
  });

  // Hidden entirely for non-admins (401/403 → null) or while loading.
  if (!lessons.data && !outcomes.data) return null;

  return (
    <Section
      id="intelligence-admin"
      title={t("admin.title")}
      description={t("admin.description")}
    >
      <Stack spacing={3}>
        {lessons.data ? (
          <Stack spacing={1}>
            <Typography component="h3" fontWeight={700}>
              {t("admin.lessonsHeading")}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t("admin.lessonsSummary", {
                inspected: lessons.data.inspected,
                failed: lessons.data.failedVerification,
                regression: lessons.data.regressionFailed,
              })}
            </Typography>
            {lessons.data.lessons.map((l) => (
              <Box key={l.title} sx={{ py: 1, borderBottom: 1, borderColor: "divider" }}>
                <Typography fontWeight={700}>{l.title}</Typography>
                <Typography variant="body2">{l.recommendation}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {l.evidence}
                </Typography>
              </Box>
            ))}
          </Stack>
        ) : null}
        {outcomes.data ? (
          <Stack spacing={1}>
            <Typography component="h3" fontWeight={700}>
              {t("admin.outcomesHeading")}
            </Typography>
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              <Chip label={t("admin.inspected", { count: outcomes.data.inspected })} />
              <Chip label={t("admin.succeeded", { count: outcomes.data.executedSuccess })} />
              <Chip label={t("admin.deniedOrFailed", { count: outcomes.data.deniedOrFailed })} />
              <Chip label={t("admin.verified", { count: outcomes.data.verified })} />
              <Chip label={t("admin.successRate", { value: percent(outcomes.data.successRate) })} />
              <Chip label={t("admin.confidence", { value: percent(outcomes.data.confidence) })} />
            </Stack>
            <Typography variant="body2">{outcomes.data.recommendation}</Typography>
            {outcomes.data.byAgent.length > 0 ? (
              <Box component="ul" sx={{ m: 0, pl: 3 }}>
                {outcomes.data.byAgent.map((a) => (
                  <Typography component="li" variant="body2" key={a.agentId}>
                    {t("admin.byAgent", { agent: a.agentId, count: a.count })}
                  </Typography>
                ))}
              </Box>
            ) : null}
          </Stack>
        ) : null}
      </Stack>
    </Section>
  );
}

/* ── View ──────────────────────────────────────────────────────────────── */

export function IntelligenceView() {
  const t = useTranslations("intelligenceView");
  return (
    <Stack spacing={3} sx={{ maxWidth: 1040 }}>
      <Box>
        <Typography variant="h1">{t("title")}</Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {t("subtitle")}
        </Typography>
      </Box>
      <Box>
        <Section
          id="intelligence-recommend"
          title={t("recommend.title")}
          description={t("recommend.description")}
          defaultExpanded
        >
          <RecommendSection />
        </Section>
        <Section
          id="intelligence-market"
          title={t("market.title")}
          description={t("market.description")}
        >
          <MarketplaceSection />
        </Section>
        <Section
          id="intelligence-reputation"
          title={t("reputation.title")}
          description={t("reputation.description")}
        >
          <ReputationSection />
        </Section>
        <Section
          id="intelligence-hypotheses"
          title={t("hypotheses.title")}
          description={t("hypotheses.description")}
        >
          <HypothesesSection />
        </Section>
        <Section
          id="intelligence-golden"
          title={t("golden.title")}
          description={t("golden.description")}
        >
          <GoldenProjectsSection />
        </Section>
        <AdminSignals />
      </Box>
    </Stack>
  );
}
