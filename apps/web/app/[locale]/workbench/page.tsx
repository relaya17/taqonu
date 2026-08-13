"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
  useTheme,
} from "@mui/material";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { apiGet, apiPost } from "@/lib/api";
import { OnboardingPath } from "@/components/onboarding/OnboardingPath";

interface Project {
  id: string;
  name: string;
  workspaceRoot?: string | null;
}

interface TreeNode {
  name: string;
  path: string;
  kind: "dir" | "file";
  children?: TreeNode[];
}

interface TreeResponse {
  tree: TreeNode;
  truncated: boolean;
  note: string;
}

interface FileResponse {
  path: string;
  content: string;
  truncated: boolean;
}

interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

type CenterTab = "code" | "visualStudio" | "cloud" | "cursor";

const CLOUD_SERVICES = [
  {
    id: "cloudflare",
    label: "Cloudflare",
    placeholder: "https://dash.cloudflare.com/...",
    defaultUrl: "https://dash.cloudflare.com/",
  },
  {
    id: "vercel",
    label: "Vercel",
    placeholder: "https://vercel.com/...",
    defaultUrl: "https://vercel.com/dashboard",
  },
  {
    id: "netlify",
    label: "Netlify",
    placeholder: "https://app.netlify.com/...",
    defaultUrl: "https://app.netlify.com/",
  },
  {
    id: "render",
    label: "Render",
    placeholder: "https://dashboard.render.com/...",
    defaultUrl: "https://dashboard.render.com/",
  },
  {
    id: "supabase",
    label: "Supabase",
    placeholder: "https://supabase.com/dashboard/...",
    defaultUrl: "https://supabase.com/dashboard",
  },
  {
    id: "mongodb",
    label: "MongoDB Atlas",
    placeholder: "https://cloud.mongodb.com/...",
    defaultUrl: "https://cloud.mongodb.com/",
  },
  {
    id: "aws",
    label: "AWS",
    placeholder: "https://console.aws.amazon.com/...",
    defaultUrl: "https://console.aws.amazon.com/",
  },
  {
    id: "azure",
    label: "Azure",
    placeholder: "https://portal.azure.com/...",
    defaultUrl: "https://portal.azure.com/",
  },
  {
    id: "gcp",
    label: "Google Cloud",
    placeholder: "https://console.cloud.google.com/...",
    defaultUrl: "https://console.cloud.google.com/",
  },
  {
    id: "sentry",
    label: "Sentry",
    placeholder: "https://sentry.io/...",
    defaultUrl: "https://sentry.io/",
  },
  {
    id: "stripe",
    label: "Stripe",
    placeholder: "https://dashboard.stripe.com/...",
    defaultUrl: "https://dashboard.stripe.com/",
  },
  {
    id: "github",
    label: "GitHub",
    placeholder: "https://github.com/...",
    defaultUrl: "https://github.com/",
  },
] as const;

type CloudServiceId = (typeof CLOUD_SERVICES)[number]["id"];

function TreeBranch({
  node,
  depth,
  selectedPath,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string, kind: "dir" | "file") => void;
}): ReactNode {
  const [open, setOpen] = useState(depth < 2);
  if (node.kind === "file") {
    return (
      <ListItemButton
        dense
        selected={selectedPath === node.path}
        onClick={() => onSelect(node.path, "file")}
        sx={{ pl: 1 + depth * 1.1, borderRadius: 1, mx: 0.25 }}
      >
        <ListItemText
          primary={node.name}
          primaryTypographyProps={{ fontSize: 12.5, noWrap: true }}
        />
      </ListItemButton>
    );
  }
  return (
    <Box>
      <ListItemButton
        dense
        onClick={() => setOpen((v) => !v)}
        sx={{ pl: 1 + depth * 1.1, borderRadius: 1, mx: 0.25 }}
      >
        <ListItemText
          primary={`${open ? "▾" : "▸"} ${node.name || "/"}`}
          primaryTypographyProps={{ fontSize: 12.5, fontWeight: 650, noWrap: true }}
        />
      </ListItemButton>
      <Collapse in={open} unmountOnExit>
        <List dense disablePadding>
          {(node.children ?? []).map((child) => (
            <TreeBranch
              key={child.path || child.name}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
        </List>
      </Collapse>
    </Box>
  );
}

export default function WorkbenchPage() {
  const t = useTranslations("workbench");
  const theme = useTheme();
  const dark = theme.palette.mode === "dark";

  const [projectId, setProjectId] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [centerTab, setCenterTab] = useState<CenterTab>("code");
  const [cloudService, setCloudService] = useState<CloudServiceId>("cloudflare");
  const [cloudUrl, setCloudUrl] = useState("");
  const [message, setMessage] = useState("");
  const [thread, setThread] = useState<ChatTurn[]>([]);

  const border = dark
    ? "1px solid rgba(232,240,240,0.12)"
    : "1px solid rgba(20,32,34,0.12)";
  const panelBg = dark ? "rgba(19,32,34,0.95)" : "rgba(247,250,248,0.96)";

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiGet<{ items: Project[] }>("/api/v1/projects"),
  });
  const projects = useMemo(
    () => projectsQuery.data?.items ?? [],
    [projectsQuery.data],
  );
  const selected = projects.find((p) => p.id === projectId) ?? null;
  const hasRoot = Boolean(selected?.workspaceRoot);

  const treeQuery = useQuery({
    queryKey: ["workbench-tree", projectId],
    enabled: Boolean(projectId) && hasRoot,
    queryFn: () =>
      apiGet<TreeResponse>(
        `/api/v1/studio/tree?projectId=${encodeURIComponent(projectId)}`,
      ),
  });

  const fileQuery = useQuery({
    queryKey: ["workbench-file", projectId, selectedPath],
    enabled: Boolean(projectId) && Boolean(selectedPath) && hasRoot,
    queryFn: () =>
      apiGet<FileResponse>(
        `/api/v1/studio/file?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(selectedPath!)}`,
      ),
  });

  const adaptersQuery = useQuery({
    queryKey: ["provider-adapters"],
    queryFn: () =>
      apiGet<{
        items: Array<{ id: string; status: string; note: string }>;
      }>("/api/v1/providers/adapters"),
    staleTime: 5 * 60_000,
  });

  const adapterStatus = useMemo(() => {
    const map = new Map(
      (adaptersQuery.data?.items ?? []).map((i) => [i.id, i] as const),
    );
    return map;
  }, [adaptersQuery.data]);

  const activeCloud = CLOUD_SERVICES.find((s) => s.id === cloudService)!;

  const chat = useMutation({
    mutationFn: async () => {
      const focus = selectedPath
        ? `\n\n[Workbench focus file: ${selectedPath}]`
        : "";
      const res = await apiPost<{ answer: string }>(
        "/api/v1/conversation/message",
        {
          message: `${message.trim()}${focus}`,
          projectId: projectId || null,
        },
      );
      return res.answer || t("agentFallback");
    },
    onSuccess: (reply) => {
      setThread((prev) => [
        ...prev,
        { role: "user", text: message.trim() },
        { role: "assistant", text: reply },
      ]);
      setMessage("");
    },
  });

  return (
    <Stack
      spacing={1.5}
      sx={{
        width: "100%",
        minWidth: 0,
        height: { xs: "auto", md: "calc(100vh - 140px)" },
        maxHeight: { md: "calc(100vh - 140px)" },
      }}
    >
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        alignItems={{ sm: "center" }}
        justifyContent="space-between"
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h1" sx={{ fontSize: { xs: "1.5rem", md: "1.85rem" } }}>
            {t("title")}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("subtitle")}
          </Typography>
        </Box>
        <TextField
          select
          size="small"
          label={t("project")}
          value={projectId}
          onChange={(e) => {
            setProjectId(e.target.value);
            setSelectedPath(null);
            setThread([]);
          }}
          sx={{ minWidth: 220 }}
        >
          {projects.map((p) => (
            <MenuItem key={p.id} value={p.id}>
              {p.name}
              {p.workspaceRoot ? "" : ` (${t("noRoot")})`}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      {projectId && !hasRoot ? (
        <Stack spacing={1.5}>
          <Alert severity="warning">
            {t("needRoot")} <Link href="/projects">{t("goProjects")}</Link>
          </Alert>
          <OnboardingPath missingRootCount={1} />
        </Stack>
      ) : null}

      <Box
        sx={{
          flex: 1,
          minHeight: { xs: 520, md: 0 },
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            md: "220px minmax(0, 1fr) 300px",
          },
          gap: 1.25,
        }}
      >
        {/* LEFT — project nav / files */}
        <Box
          sx={{
            border,
            borderRadius: 2,
            bgcolor: panelBg,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            minHeight: 240,
          }}
        >
          <Typography
            variant="overline"
            sx={{ px: 1.5, py: 1, borderBottom: border }}
          >
            {t("files")}
          </Typography>
          <Box sx={{ flex: 1, overflow: "auto" }}>
            {treeQuery.data?.tree ? (
              <List dense disablePadding sx={{ py: 0.5 }}>
                <TreeBranch
                  node={treeQuery.data.tree}
                  depth={0}
                  selectedPath={selectedPath}
                  onSelect={(path, kind) => {
                    if (kind === "file") {
                      setSelectedPath(path);
                      setCenterTab("code");
                    }
                  }}
                />
              </List>
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ p: 1.5 }}>
                {treeQuery.isLoading ? t("loadingTree") : t("emptyTree")}
              </Typography>
            )}
          </Box>
          <Chip
            size="small"
            label={t("readOnly")}
            sx={{ m: 1, alignSelf: "flex-start" }}
          />
        </Box>

        {/* CENTER — code / Visual Studio / vercel / render / cursor */}
        <Box
          sx={{
            border,
            borderRadius: 2,
            bgcolor: panelBg,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            minHeight: 280,
          }}
        >
          <Tabs
            value={centerTab}
            onChange={(_, v: CenterTab) => setCenterTab(v)}
            variant="scrollable"
            sx={{ borderBottom: border, minHeight: 40 }}
          >
            <Tab value="code" label={t("tabCode")} sx={{ minHeight: 40 }} />
            <Tab
              value="visualStudio"
              label={t("tabVisualStudio")}
              sx={{ minHeight: 40 }}
            />
            <Tab value="cloud" label={t("tabCloud")} sx={{ minHeight: 40 }} />
            <Tab value="cursor" label="Cursor" sx={{ minHeight: 40 }} />
          </Tabs>

          <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
            {centerTab === "code" ? (
              fileQuery.data ? (
                <Box
                  component="pre"
                  aria-readonly="true"
                  sx={{
                    m: 0,
                    p: 1.5,
                    fontSize: 12.5,
                    lineHeight: 1.5,
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                    bgcolor: dark
                      ? "rgba(8,16,17,0.9)"
                      : "rgba(15,61,62,0.05)",
                    borderRadius: 1.5,
                    overflow: "auto",
                    maxHeight: "100%",
                  }}
                >
                  {fileQuery.data.content}
                  {fileQuery.data.truncated ? `\n\n… ${t("truncated")}` : ""}
                </Box>
              ) : (
                <Typography color="text.secondary" variant="body2">
                  {selectedPath
                    ? fileQuery.isLoading
                      ? t("loadingFile")
                      : t("fileError")
                    : t("pickFile")}
                </Typography>
              )
            ) : null}

            {centerTab === "visualStudio" ? (
              <Stack spacing={1.5}>
                <Typography variant="body2">{t("vsHelp")}</Typography>
                <Alert severity="info">{t("vsNote")}</Alert>
                <Typography variant="body2" color="text.secondary">
                  {t("vsPathHint")}
                </Typography>
                {selected?.workspaceRoot ? (
                  <Box
                    component="pre"
                    sx={{
                      m: 0,
                      p: 1.25,
                      fontSize: 12,
                      borderRadius: 1.5,
                      bgcolor: dark
                        ? "rgba(8,16,17,0.9)"
                        : "rgba(15,61,62,0.05)",
                      overflow: "auto",
                    }}
                  >
                    {selected.workspaceRoot}
                  </Box>
                ) : (
                  <Alert severity="warning">{t("needRoot")}</Alert>
                )}
                <Button component={Link} href="/studio" variant="outlined">
                  {t("openStudio")}
                </Button>
              </Stack>
            ) : null}

            {centerTab === "cloud" ? (
              <Stack spacing={1.5}>
                <Typography variant="body2" color="text.secondary">
                  {t("cloudHelp")}
                </Typography>
                <Stack
                  direction="row"
                  flexWrap="wrap"
                  useFlexGap
                  spacing={1}
                  sx={{ gap: 1 }}
                >
                  {CLOUD_SERVICES.map((svc) => {
                    const meta = adapterStatus.get(svc.id);
                    const status = meta?.status ?? "external";
                    return (
                      <Chip
                        key={svc.id}
                        clickable
                        size="small"
                        color={cloudService === svc.id ? "primary" : "default"}
                        variant={cloudService === svc.id ? "filled" : "outlined"}
                        label={`${svc.label}${meta ? ` · ${status}` : ""}`}
                        onClick={() => {
                          setCloudService(svc.id);
                          setCloudUrl("");
                        }}
                      />
                    );
                  })}
                </Stack>
                {adapterStatus.get(cloudService)?.note ? (
                  <Typography variant="caption" color="text.secondary">
                    Atlas: {adapterStatus.get(cloudService)!.note}
                  </Typography>
                ) : (
                  <Typography variant="caption" color="text.secondary">
                    {t("cloudExternal")}
                  </Typography>
                )}
                <TextField
                  size="small"
                  fullWidth
                  label={`${activeCloud.label} URL`}
                  value={cloudUrl}
                  onChange={(e) => setCloudUrl(e.target.value)}
                  placeholder={activeCloud.placeholder}
                />
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                  <Button
                    variant="contained"
                    href={cloudUrl.trim() || activeCloud.defaultUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    component="a"
                  >
                    {t("openExternal")}
                  </Button>
                  <Button
                    variant="outlined"
                    component={Link}
                    href="/integrations"
                  >
                    {t("openIntegrations")}
                  </Button>
                </Stack>
                <Alert severity="info">{t("embedNote")}</Alert>
              </Stack>
            ) : null}

            {centerTab === "cursor" ? (
              <Stack spacing={1.5}>
                <Typography variant="body2">{t("cursorHelp")}</Typography>
                <Alert severity="info">{t("cursorNote")}</Alert>
                <Button component={Link} href="/studio" variant="outlined">
                  {t("openStudio")}
                </Button>
              </Stack>
            ) : null}
          </Box>
        </Box>

        {/* RIGHT — agent chat */}
        <Box
          sx={{
            border,
            borderRadius: 2,
            bgcolor: panelBg,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            minHeight: 280,
          }}
        >
          <Typography
            variant="overline"
            sx={{ px: 1.5, py: 1, borderBottom: border }}
          >
            {t("agentChat")}
          </Typography>
          <Box sx={{ flex: 1, overflow: "auto", p: 1.25 }}>
            {thread.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {t("chatEmpty")}
              </Typography>
            ) : (
              <Stack spacing={1.25}>
                {thread.map((turn, i) => (
                  <Box
                    key={`${turn.role}-${i}`}
                    sx={{
                      p: 1,
                      borderRadius: 1.5,
                      bgcolor:
                        turn.role === "user"
                          ? dark
                            ? "rgba(126,184,185,0.12)"
                            : "rgba(15,61,62,0.06)"
                          : "transparent",
                      border: turn.role === "assistant" ? border : "none",
                    }}
                  >
                    <Typography
                      variant="caption"
                      fontWeight={700}
                      color="text.secondary"
                    >
                      {turn.role === "user" ? t("you") : t("agent")}
                    </Typography>
                    <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                      {turn.text}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            )}
          </Box>
          <Stack spacing={1} sx={{ p: 1.25, borderTop: border }}>
            <TextField
              size="small"
              fullWidth
              multiline
              minRows={2}
              maxRows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t("chatPlaceholder")}
              disabled={!projectId}
            />
            <Button
              variant="contained"
              disabled={
                !projectId || !message.trim() || chat.isPending
              }
              onClick={() => chat.mutate()}
            >
              {chat.isPending ? t("sending") : t("send")}
            </Button>
            {chat.isError ? (
              <Alert severity="error">{(chat.error as Error).message}</Alert>
            ) : null}
          </Stack>
        </Box>
      </Box>
    </Stack>
  );
}
