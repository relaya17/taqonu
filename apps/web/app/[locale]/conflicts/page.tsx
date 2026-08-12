"use client";

import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Stack,
  TextField,
  Typography,
  Chip,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiGet, apiPost } from "@/lib/api";

interface ConflictItem {
  id: string;
  projectId: string;
  projectName: string;
  sliceKey: string;
  resolution: string | null;
  detectedAt: string;
  resolved: boolean;
}

export default function ConflictsPage() {
  const t = useTranslations("conflicts");
  const queryClient = useQueryClient();
  const [resolution, setResolution] = useState<Record<string, string>>({});

  const query = useQuery({
    queryKey: ["conflicts"],
    queryFn: () =>
      apiGet<{ items: ConflictItem[]; open: number }>("/api/v1/conflicts"),
  });

  const resolve = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) =>
      apiPost(`/api/v1/conflicts/${id}/resolve`, { resolution: text }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["conflicts"] });
    },
  });

  const items = useMemo(() => query.data?.items ?? [], [query.data]);

  return (
    <Stack spacing={3} sx={{ maxWidth: 880 }}>
      <Box>
        <Typography variant="h1">{t("title")}</Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {t("subtitle")}
        </Typography>
        <Typography variant="body2" sx={{ mt: 1 }}>
          {t("openCount", { count: query.data?.open ?? 0 })}
        </Typography>
      </Box>

      {items.length === 0 ? (
        <Alert severity="info">{t("empty")}</Alert>
      ) : (
        items.map((item) => (
          <Box
            key={item.id}
            sx={{ py: 2, borderBottom: "1px solid rgba(20,32,34,0.12)" }}
          >
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography fontWeight={700}>{item.projectName}</Typography>
              <Chip size="small" label={item.sliceKey} />
              <Chip
                size="small"
                color={item.resolved ? "success" : "warning"}
                label={item.resolved ? t("resolved") : t("open")}
              />
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {item.detectedAt}
            </Typography>
            {item.resolved ? (
              <Typography sx={{ mt: 1 }}>{item.resolution}</Typography>
            ) : (
              <Stack spacing={1} sx={{ mt: 1.5 }}>
                <TextField
                  multiline
                  minRows={2}
                  label={t("resolution")}
                  value={resolution[item.id] ?? ""}
                  onChange={(e) =>
                    setResolution((prev) => ({
                      ...prev,
                      [item.id]: e.target.value,
                    }))
                  }
                />
                <Button
                  variant="contained"
                  sx={{ alignSelf: "flex-start" }}
                  disabled={
                    resolve.isPending ||
                    (resolution[item.id] ?? "").trim().length < 3
                  }
                  onClick={() =>
                    resolve.mutate({
                      id: item.id,
                      text: (resolution[item.id] ?? "").trim(),
                    })
                  }
                >
                  {t("resolve")}
                </Button>
              </Stack>
            )}
          </Box>
        ))
      )}
    </Stack>
  );
}
