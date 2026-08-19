"use client";

import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  ListItemText,
  MenuItem,
  OutlinedInput,
  Select,
  type SelectChangeEvent,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { PluginManifest } from "./types";
import { PLUGIN_CAPABILITIES, PLUGIN_RISK_LEVELS } from "./types";

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

export interface NewPluginManifestInput {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  declaredTools: string[];
  declaredCapabilities: PluginManifest["declaredCapabilities"];
  declaredEntityActions: PluginManifest["declaredEntityActions"];
  riskLevel: PluginManifest["riskLevel"];
}

interface RegisterPluginDialogProps {
  open: boolean;
  submitting?: boolean;
  submitError?: string | null;
  onClose: () => void;
  onSubmit: (manifest: NewPluginManifestInput) => void;
}

const EMPTY_FORM = {
  id: "",
  name: "",
  version: "1.0.0",
  description: "",
  author: "",
  declaredToolsText: "",
  declaredCapabilities: [] as string[],
  declaredEntityActionsText: "",
  riskLevel: "LOW" as PluginManifest["riskLevel"],
};

/**
 * Client-side validation mirrors `pluginManifestSchema` shape rules
 * (kebab-case id, semver version, non-empty name/description/author) so a
 * malformed submission is caught before it ever reaches the server's
 * `validatePluginManifest`.
 */
function validate(form: typeof EMPTY_FORM): string[] {
  const errors: string[] = [];
  if (!ID_PATTERN.test(form.id)) {
    errors.push("מזהה (id) חייב להיות kebab-case, 3-64 תווים, לדוגמה my-plugin-id");
  }
  if (form.name.trim().length === 0) {
    errors.push("שם נדרש");
  }
  if (!VERSION_PATTERN.test(form.version)) {
    errors.push("גרסה חייבת להיות בפורמט semver, לדוגמה 1.0.0");
  }
  if (form.description.trim().length === 0) {
    errors.push("תיאור נדרש");
  }
  if (form.author.trim().length === 0) {
    errors.push("יוצר נדרש");
  }
  return errors;
}

/** Parses `entityType.action` pairs, one per line, e.g. "invoice.approve". */
function parseEntityActions(text: string): PluginManifest["declaredEntityActions"] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [entityType, action] = line.split(".").map((s) => s.trim());
      return { entityType: entityType ?? line, action: action ?? "" };
    })
    .filter((ea) => ea.entityType.length > 0 && ea.action.length > 0);
}

export function RegisterPluginDialog({
  open,
  submitting = false,
  submitError = null,
  onClose,
  onSubmit,
}: RegisterPluginDialogProps) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [touched, setTouched] = useState(false);

  const handleClose = () => {
    setForm(EMPTY_FORM);
    setTouched(false);
    onClose();
  };

  const errors = validate(form);

  const handleSubmit = () => {
    setTouched(true);
    if (errors.length > 0) return;
    onSubmit({
      id: form.id.trim(),
      name: form.name.trim(),
      version: form.version.trim(),
      description: form.description.trim(),
      author: form.author.trim(),
      declaredTools: form.declaredToolsText
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
      declaredCapabilities:
        form.declaredCapabilities as PluginManifest["declaredCapabilities"],
      declaredEntityActions: parseEntityActions(form.declaredEntityActionsText),
      riskLevel: form.riskLevel,
    });
  };

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle>רישום פלאגין חדש</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <TextField
            label="מזהה (id)"
            placeholder="my-plugin-id"
            value={form.id}
            onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
            helperText="kebab-case, 3-64 תווים"
            fullWidth
          />
          <TextField
            label="שם"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            fullWidth
          />
          <TextField
            label="גרסה"
            placeholder="1.0.0"
            value={form.version}
            onChange={(e) => setForm((f) => ({ ...f, version: e.target.value }))}
            helperText="semver, לדוגמה 1.0.0"
            fullWidth
          />
          <TextField
            label="תיאור"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            multiline
            minRows={2}
            fullWidth
          />
          <TextField
            label="יוצר"
            value={form.author}
            onChange={(e) => setForm((f) => ({ ...f, author: e.target.value }))}
            fullWidth
          />
          <TextField
            select
            label="רמת סיכון"
            value={form.riskLevel}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                riskLevel: e.target.value as PluginManifest["riskLevel"],
              }))
            }
            fullWidth
          >
            {PLUGIN_RISK_LEVELS.map((r) => (
              <MenuItem key={r} value={r}>
                {r}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="כלים מוצהרים"
            placeholder="tool-a, tool-b"
            value={form.declaredToolsText}
            onChange={(e) => setForm((f) => ({ ...f, declaredToolsText: e.target.value }))}
            helperText="רשימה מופרדת בפסיקים — כל כלי חייב להתאים למדיניות כלים קיימת בשרת"
            fullWidth
          />
          <FormControl fullWidth>
            <InputLabel id="plugin-capabilities-label">יכולות מוצהרות</InputLabel>
            <Select
              labelId="plugin-capabilities-label"
              multiple
              value={form.declaredCapabilities}
              onChange={(e: SelectChangeEvent<string[]>) => {
                const value = e.target.value;
                setForm((f) => ({
                  ...f,
                  declaredCapabilities: typeof value === "string" ? value.split(",") : value,
                }));
              }}
              input={<OutlinedInput label="יכולות מוצהרות" />}
              renderValue={(selected) => (
                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                  {selected.map((val) => (
                    <Chip key={val} size="small" label={val} />
                  ))}
                </Stack>
              )}
            >
              {PLUGIN_CAPABILITIES.map((cap) => (
                <MenuItem key={cap} value={cap}>
                  <Checkbox checked={form.declaredCapabilities.includes(cap)} />
                  <ListItemText primary={cap} />
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            label="פעולות ישות מוצהרות"
            placeholder={"invoice.approve\ncontract.review"}
            value={form.declaredEntityActionsText}
            onChange={(e) =>
              setForm((f) => ({ ...f, declaredEntityActionsText: e.target.value }))
            }
            helperText="שורה לכל פעולה, בפורמט entityType.action"
            multiline
            minRows={2}
            fullWidth
          />
          {touched && errors.length > 0 ? (
            <Alert severity="warning">
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                {errors.map((err) => (
                  <li key={err}>
                    <Typography variant="body2">{err}</Typography>
                  </li>
                ))}
              </Box>
            </Alert>
          ) : null}
          {submitError ? <Alert severity="error">{submitError}</Alert> : null}
          <Alert severity="info">
            הפלאגין יירשם במצב &quot;ממתין לבדיקה&quot; — אישור/דחייה נדרשים בנפרד.
          </Alert>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={submitting}>
          ביטול
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={submitting}>
          {submitting ? "רושם…" : "רישום"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
