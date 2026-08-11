"use client";

import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  MenuItem,
  Stack,
  TextField,
  Typography,
  Chip,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiGet, apiPost } from "@/lib/api";

interface Project {
  id: string;
  name: string;
}

interface Artifact {
  id: string;
  filename: string;
  kind: string;
  mimeType: string;
  byteSize: number;
  evidenceId: string;
}

interface Credits {
  balance: number;
  lifetimeGranted: number;
  lifetimeSpent: number;
}

interface AssistRun {
  id: string;
  summary: string;
  provider: string;
  creditsCharged: number;
  findings: Array<{ title: string; detail: string; severity: string }>;
}

const EXPERTS = [
  "UI_UX",
  "VISUAL_DESIGN",
  "QA",
  "ENGINEERING",
  "ACCESSIBILITY",
  "SECURITY",
  "PRODUCT",
  "DEVOPS",
] as const;

export default function ArtifactsPage() {
  const t = useTranslations("artifacts");
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [note, setNote] = useState("");
  const [request, setRequest] = useState("");
  const [expertId, setExpertId] = useState<(typeof EXPERTS)[number]>("UI_UX");
  const [provider, setProvider] = useState<
    "local-checklist" | "gpt-4o-vision"
  >("local-checklist");
  const [selected, setSelected] = useState<string[]>([]);
  const [lastRun, setLastRun] = useState<AssistRun | null>(null);

  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiGet<{ items: Project[] }>("/api/v1/projects"),
  });
  const artifacts = useQuery({
    queryKey: ["artifacts"],
    queryFn: () => apiGet<{ items: Artifact[] }>("/api/v1/artifacts"),
  });
  const credits = useQuery({
    queryKey: ["credits"],
    queryFn: () => apiGet<Credits>("/api/v1/billing/credits"),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i]!);
      }
      const contentBase64 = btoa(binary);
      return apiPost("/api/v1/artifacts", {
        projectId: projectId || null,
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        contentBase64,
        note: note || undefined,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["artifacts"] });
    },
  });

  const assist = useMutation({
    mutationFn: () =>
      apiPost<AssistRun>("/api/v1/assists/runs", {
        projectId: projectId || null,
        artifactIds: selected,
        expertId,
        provider,
        userRequest: request.trim(),
      }),
    onSuccess: async (data) => {
      setLastRun(data);
      await queryClient.invalidateQueries({ queryKey: ["credits"] });
      await queryClient.invalidateQueries({ queryKey: ["assists"] });
    },
  });

  const purchase = useMutation({
    mutationFn: (pack: "starter" | "growth" | "scale") =>
      apiPost("/api/v1/billing/credits/purchase", { pack }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["credits"] });
    },
  });

  const items = useMemo(() => artifacts.data?.items ?? [], [artifacts.data]);

  return (
    <Stack spacing={3} sx={{ maxWidth: 920 }}>
      <Box>
        <Typography variant="h1">{t("title")}</Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {t("subtitle")}
        </Typography>
        <Typography variant="body2" sx={{ mt: 1 }}>
          {t("credits", { balance: credits.data?.balance ?? 0 })}
        </Typography>
      </Box>

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Button
          variant="outlined"
          onClick={() => purchase.mutate("starter")}
          disabled={purchase.isPending}
        >
          {t("buyStarter")}
        </Button>
        <Button
          variant="outlined"
          onClick={() => purchase.mutate("growth")}
          disabled={purchase.isPending}
        >
          {t("buyGrowth")}
        </Button>
      </Stack>

      <TextField
        select
        label={t("project")}
        value={projectId}
        onChange={(e) => setProjectId(e.target.value)}
      >
        <MenuItem value="">{t("anyProject")}</MenuItem>
        {(projects.data?.items ?? []).map((p) => (
          <MenuItem key={p.id} value={p.id}>
            {p.name}
          </MenuItem>
        ))}
      </TextField>

      <TextField
        label={t("note")}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />

      <Button variant="contained" component="label" sx={{ alignSelf: "flex-start" }}>
        {t("upload")}
        <input
          hidden
          type="file"
          accept="image/*,.pdf,.md,.txt,.doc,.docx"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload.mutate(file);
          }}
        />
      </Button>
      {upload.isError ? (
        <Alert severity="error">{(upload.error as Error).message}</Alert>
      ) : null}

      <Stack spacing={0}>
        {items.length === 0 ? (
          <Typography color="text.secondary">{t("empty")}</Typography>
        ) : (
          items.map((item) => {
            const checked = selected.includes(item.id);
            return (
              <Box
                key={item.id}
                sx={{
                  py: 1.5,
                  borderBottom: "1px solid rgba(20,32,34,0.1)",
                  display: "flex",
                  gap: 1,
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                }}
              >
                <Box>
                  <Typography fontWeight={650}>{item.filename}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {item.kind} · {item.mimeType} · {item.byteSize} B
                  </Typography>
                </Box>
                <Button
                  size="small"
                  variant={checked ? "contained" : "outlined"}
                  onClick={() =>
                    setSelected((prev) =>
                      checked
                        ? prev.filter((id) => id !== item.id)
                        : [...prev, item.id],
                    )
                  }
                >
                  {checked ? t("selected") : t("select")}
                </Button>
              </Box>
            );
          })
        )}
      </Stack>

      <Typography variant="h2" sx={{ fontSize: "1.3rem" }}>
        {t("assistTitle")}
      </Typography>
      <TextField
        select
        label={t("expert")}
        value={expertId}
        onChange={(e) => setExpertId(e.target.value as (typeof EXPERTS)[number])}
      >
        {EXPERTS.map((id) => (
          <MenuItem key={id} value={id}>
            {id}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        label={t("provider")}
        value={provider}
        onChange={(e) =>
          setProvider(e.target.value as typeof provider)
        }
        helperText={t("providerHelp")}
      >
        <MenuItem value="local-checklist">ArletOS Checklist (0)</MenuItem>
        <MenuItem value="gpt-4o-vision">GPT-4o Vision (5 credits)</MenuItem>
      </TextField>
      <TextField
        multiline
        minRows={3}
        label={t("request")}
        value={request}
        onChange={(e) => setRequest(e.target.value)}
        placeholder={t("placeholder")}
      />
      <Button
        variant="contained"
        disabled={
          assist.isPending || selected.length === 0 || request.trim().length < 3
        }
        onClick={() => assist.mutate()}
        sx={{ alignSelf: "flex-start" }}
      >
        {t("runAssist")}
      </Button>
      {assist.isError ? (
        <Alert severity="error">{(assist.error as Error).message}</Alert>
      ) : null}

      {lastRun ? (
        <Box>
          <Chip label={`${lastRun.provider} · −${lastRun.creditsCharged}`} />
          <Typography sx={{ mt: 1 }}>{lastRun.summary}</Typography>
          {lastRun.findings.map((f) => (
            <Box key={f.title} sx={{ mt: 1.5 }}>
              <Typography fontWeight={700}>
                [{f.severity}] {f.title}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {f.detail}
              </Typography>
            </Box>
          ))}
        </Box>
      ) : null}
    </Stack>
  );
}
