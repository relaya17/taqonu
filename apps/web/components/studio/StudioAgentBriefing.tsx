"use client";

import { Alert, Box, Chip, List, ListItem, ListItemText, Stack, Typography } from "@mui/material";
import { useTranslations } from "next-intl";
import {
  studioAgentBriefing,
  type StudioAgentBriefingInput,
} from "@/lib/studio-agent-briefing";

export function StudioAgentBriefing({
  result,
  onOpenFile,
}: {
  result: StudioAgentBriefingInput;
  onOpenFile?: (path: string) => void;
}) {
  const t = useTranslations("studio.briefing");
  const view = studioAgentBriefing(result);

  return (
    <Box
      component="section"
      aria-label={t("title")}
      sx={{
        mt: 1.5,
        border: "1px solid rgba(232,234,238,0.12)",
        borderRadius: 2,
        p: 1.5,
        bgcolor: "rgba(20,22,28,0.55)",
      }}
    >
      <Typography variant="subtitle2" fontWeight={700} sx={{ color: "#DCDDE1" }}>
        {t("title")}
      </Typography>
      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
        <Chip
          size="small"
          label={`${t("intelligence")}: ${view.intelligenceKind}`}
        />
        <Chip
          size="small"
          label={view.modelInvoked ? t("modelInvoked") : t("modelNotInvoked")}
        />
        <Chip size="small" label={`${t("memoryUsed")}: ${view.memoryUsed}`} />
        {view.epistemicState ? (
          <Chip size="small" variant="outlined" label={view.epistemicState} />
        ) : null}
        {view.authorityHint ? (
          <Chip size="small" variant="outlined" label={view.authorityHint} />
        ) : null}
      </Stack>
      <Alert severity="info" sx={{ mt: 1.25 }}>
        {t("notChainOfThought")}
      </Alert>
      {view.citations.length > 0 ? (
        <Box sx={{ mt: 1 }}>
          <Typography variant="caption" sx={{ color: "#8B9099" }}>
            {t("citations")}
          </Typography>
          <List dense disablePadding>
            {view.citations.map((citation) => (
              <ListItem key={citation.id} disablePadding>
                <ListItemText
                  primary={citation.statement}
                  secondary={`${citation.epistemicState} · ${citation.type}`}
                  primaryTypographyProps={{ sx: { color: "#DCDDE1", fontSize: 13 } }}
                  secondaryTypographyProps={{ sx: { color: "#8B9099", fontSize: 11 } }}
                />
              </ListItem>
            ))}
          </List>
        </Box>
      ) : (
        <Typography variant="caption" display="block" sx={{ mt: 1, color: "#8B9099" }}>
          {t("noCitations")}
        </Typography>
      )}
      {view.evaluationSummary ? (
        <Typography variant="body2" sx={{ mt: 1, color: "#DCDDE1" }}>
          {view.evaluationSummary}
        </Typography>
      ) : null}
      {view.files.length > 0 ? (
        <Box sx={{ mt: 1 }}>
          <Typography variant="caption" sx={{ color: "#8B9099" }}>
            {t("files")}
          </Typography>
          <List dense disablePadding>
            {view.files.map((file) => (
              <ListItem key={`${file.action}:${file.path}`} disablePadding>
                <ListItemText
                  primary={file.path}
                  secondary={`${file.action}${file.summary ? ` · ${file.summary}` : ""}`}
                  primaryTypographyProps={{
                    component: onOpenFile ? "button" : "span",
                    onClick: onOpenFile ? () => onOpenFile(file.path) : undefined,
                    sx: {
                      color: "#DCDDE1",
                      fontSize: 13,
                      textAlign: "inherit",
                      background: "none",
                      border: 0,
                      cursor: onOpenFile ? "pointer" : "default",
                      p: 0,
                    },
                  }}
                  secondaryTypographyProps={{ sx: { color: "#8B9099", fontSize: 11 } }}
                />
              </ListItem>
            ))}
          </List>
        </Box>
      ) : null}
      {view.findingRemediation ? (
        <Typography variant="caption" display="block" sx={{ mt: 1, color: "#8B9099" }}>
          {`REMEDIATION: ${view.findingRemediation.result} · FINDING: ${view.findingRemediation.findingPresence}`}
        </Typography>
      ) : null}
    </Box>
  );
}
