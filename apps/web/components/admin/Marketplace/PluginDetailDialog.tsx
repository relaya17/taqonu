"use client";

import type { ReactNode } from "react";
import {
  Box,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import type { PluginManifest } from "./types";
import { STATUS_LABELS, statusColor } from "./types";

interface PluginDetailDialogProps {
  plugin: PluginManifest | null;
  onClose: () => void;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.75 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

/** Full manifest detail view — declaredTools / declaredCapabilities / declaredEntityActions. */
export function PluginDetailDialog({ plugin, onClose }: PluginDetailDialogProps) {
  return (
    <Dialog open={plugin !== null} onClose={onClose} fullWidth maxWidth="sm">
      {plugin ? (
        <>
          <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Box>
              <Typography variant="h6" component="span">
                {plugin.name}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {plugin.id} · v{plugin.version}
              </Typography>
            </Box>
            <IconButton onClick={onClose} aria-label="סגירה">
              <CloseIcon />
            </IconButton>
          </DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2}>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip
                  size="small"
                  label={STATUS_LABELS[plugin.status]}
                  color={statusColor(plugin.status)}
                />
                <Chip size="small" variant="outlined" label={`סיכון: ${plugin.riskLevel}`} />
                <Chip size="small" variant="outlined" label={`יוצר: ${plugin.author}`} />
                {plugin.installedAt ? (
                  <Chip
                    size="small"
                    variant="outlined"
                    label={`הותקן: ${new Date(plugin.installedAt).toLocaleString("he-IL")}`}
                  />
                ) : null}
              </Stack>

              <Section title="תיאור">
                <Typography variant="body2">{plugin.description}</Typography>
              </Section>

              <Divider />

              <Section title={`כלים מוצהרים (${plugin.declaredTools.length})`}>
                {plugin.declaredTools.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    לא הוצהרו כלים.
                  </Typography>
                ) : (
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    {plugin.declaredTools.map((tool) => (
                      <Chip key={tool} size="small" label={tool} />
                    ))}
                  </Stack>
                )}
              </Section>

              <Section title={`יכולות מוצהרות (${plugin.declaredCapabilities.length})`}>
                {plugin.declaredCapabilities.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    לא הוצהרו יכולות.
                  </Typography>
                ) : (
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    {plugin.declaredCapabilities.map((cap) => (
                      <Chip key={cap} size="small" variant="outlined" color="secondary" label={cap} />
                    ))}
                  </Stack>
                )}
              </Section>

              <Section title={`פעולות ישות מוצהרות (${plugin.declaredEntityActions.length})`}>
                {plugin.declaredEntityActions.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    לא הוצהרו פעולות ישות.
                  </Typography>
                ) : (
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    {plugin.declaredEntityActions.map((ea, i) => (
                      <Chip
                        key={`${ea.entityType}.${ea.action}.${i}`}
                        size="small"
                        variant="outlined"
                        label={`${ea.entityType}.${ea.action}`}
                      />
                    ))}
                  </Stack>
                )}
              </Section>

              <Divider />

              <Section title="מניפסט מלא (JSON)">
                <Box
                  component="pre"
                  sx={{
                    m: 0,
                    p: 1.5,
                    bgcolor: "rgba(0,0,0,0.04)",
                    borderRadius: 0,
                    fontSize: "0.75rem",
                    overflowX: "auto",
                    direction: "ltr",
                    textAlign: "left",
                  }}
                >
                  {JSON.stringify(plugin, null, 2)}
                </Box>
              </Section>
            </Stack>
          </DialogContent>
        </>
      ) : null}
    </Dialog>
  );
}
