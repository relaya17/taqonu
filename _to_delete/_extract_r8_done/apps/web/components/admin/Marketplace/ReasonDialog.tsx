"use client";

import { useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
} from "@mui/material";

interface ReasonDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  confirmColor?: "primary" | "error" | "success";
  submitting?: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}

/**
 * Small reusable "type a reason, confirm" dialog for the approve/reject
 * actions — both require a non-empty `reason` server-side
 * (`approvePlugin`/`rejectPlugin` in plugin-lifecycle.ts), so this validates
 * the same non-empty rule client-side before enabling the confirm button.
 */
export function ReasonDialog({
  open,
  title,
  description,
  confirmLabel,
  confirmColor = "primary",
  submitting = false,
  onClose,
  onConfirm,
}: ReasonDialogProps) {
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();

  const handleClose = () => {
    setReason("");
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>{description}</DialogContentText>
        <TextField
          autoFocus
          fullWidth
          multiline
          minRows={2}
          label="נימוק"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="נדרש נימוק לצורך תיעוד ההחלטה"
        />
        {trimmed.length === 0 ? (
          <Alert severity="info" sx={{ mt: 1.5 }}>
            נדרש נימוק לא ריק כדי לאשר את הפעולה.
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={submitting}>
          ביטול
        </Button>
        <Button
          variant="contained"
          color={confirmColor}
          disabled={trimmed.length === 0 || submitting}
          onClick={() => onConfirm(trimmed)}
        >
          {submitting ? "שולח…" : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
