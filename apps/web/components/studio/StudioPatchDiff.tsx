"use client";

import { Box, Chip, Stack, Typography } from "@mui/material";
import { useTranslations } from "next-intl";
import {
  studioPatchChangeSet,
  type PatchFileChangeLike,
} from "@/lib/studio-patch-diff";

const LINE_COLOR: Record<string, string> = {
  add: "#C3E88D",
  del: "#F07178",
  ctx: "#8B9099",
  hunk: "#7EB8FF",
  meta: "#6B7280",
};

export function StudioPatchDiff({
  filesChanged,
}: {
  filesChanged: readonly PatchFileChangeLike[];
}) {
  const t = useTranslations("studio.diff");
  const set = studioPatchChangeSet(filesChanged);

  return (
    <Box dir="ltr" sx={{ unicodeBidi: "isolate" }}>
      <Typography variant="overline" sx={{ display: "block", mt: 1.25, color: "#8B9099" }}>
        {t("title")}
      </Typography>
      <Typography variant="caption" sx={{ color: "#8B9099" }}>
        {t("summary", {
          files: set.files.length,
          adds: set.additions,
          dels: set.deletions,
        })}
      </Typography>
      <Stack spacing={1.25} sx={{ mt: 1 }}>
        {set.files.map((file) => (
          <Box
            key={`${file.action}:${file.path}`}
            sx={{
              border: "1px solid rgba(232,234,238,0.12)",
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{ px: 1.25, py: 0.75, bgcolor: "rgba(14,17,22,0.85)" }}
            >
              <Chip size="small" label={t(`action.${file.action}`)} />
              <Typography variant="body2" sx={{ color: "#DCDDE1" }}>
                {file.path}
              </Typography>
              {file.summary ? (
                <Typography variant="caption" sx={{ color: "#8B9099" }}>
                  {file.summary}
                </Typography>
              ) : null}
            </Stack>
            {file.action === "delete" && file.lines.length === 0 ? (
              <Typography variant="caption" sx={{ display: "block", px: 1.25, py: 1, color: "#8B9099" }}>
                {t("deleteNotApplied")}
              </Typography>
            ) : file.lines.length === 0 ? (
              <Typography variant="caption" sx={{ display: "block", px: 1.25, py: 1, color: "#8B9099" }}>
                {t("noDiff")}
              </Typography>
            ) : (
              <Box
                component="pre"
                sx={{
                  m: 0,
                  p: 1.25,
                  overflow: "auto",
                  maxHeight: 280,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                  fontSize: 12,
                  lineHeight: 1.5,
                  bgcolor: "rgba(14,17,22,0.9)",
                }}
              >
                {file.lines.map((line, index) => (
                  <Box
                    key={`${file.path}:${index}`}
                    component="div"
                    sx={{ color: LINE_COLOR[line.kind] ?? "#DCDDE1" }}
                  >
                    {line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}
                    {line.text}
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        ))}
      </Stack>
    </Box>
  );
}
