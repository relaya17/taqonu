"use client";

import { Alert, Box, Stack, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { apiGet } from "@/lib/api";

interface Lead {
  id: string;
  name: string;
  email: string;
  company: string | null;
  role: string | null;
  message: string;
  source: string;
  createdAt: string;
}

export default function AdminLeadsPage() {
  const leads = useQuery({
    queryKey: ["admin-leads"],
    queryFn: () => apiGet<{ items: Lead[] }>("/api/v1/admin/leads"),
    retry: false,
  });

  if (leads.isError) {
    return (
      <Alert severity="warning">
        נדרש אדמין. <Link href="/admin/login">התחברות</Link>
      </Alert>
    );
  }

  const items = leads.data?.items ?? [];

  return (
    <Stack spacing={3} sx={{ maxWidth: 900 }}>
      <Box>
        <Typography variant="h1">לידים — משקיעים / יצירת קשר</Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {items.length} פניות מ־/investors וטפסי יצירת קשר
        </Typography>
      </Box>
      {items.length === 0 ? (
        <Alert severity="info">עדיין אין פניות.</Alert>
      ) : (
        items.map((lead) => (
          <Box
            key={lead.id}
            sx={{
              py: 2,
              borderBottom: "1px solid rgba(20,32,34,0.12)",
            }}
          >
            <Typography fontWeight={700}>
              {lead.name} · {lead.email}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {[lead.company, lead.role, lead.source, new Date(lead.createdAt).toLocaleString("he-IL")]
                .filter(Boolean)
                .join(" · ")}
            </Typography>
            <Typography sx={{ mt: 1 }}>{lead.message}</Typography>
          </Box>
        ))
      )}
    </Stack>
  );
}
