"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useLocale, useTranslations } from "next-intl";
import { apiGet, apiPost, resolveApiUrl } from "@/lib/api";
import { ptyCopyFor, type PtyCopyKey } from "@/lib/studio-pty-copy";
import {
  consumePtySseBuffer,
  studioPtyEventsUrl,
  type StudioPtyCreated,
  type StudioPtySnapshot,
} from "@/lib/studio-pty-client";
import {
  createPtySessionTerminalRegistry,
  type PtySessionTerminalRegistry,
} from "@/lib/studio-pty-session-registry";

interface Catalog {
  surface: string;
  agentAccess: boolean;
  persistTranscript: boolean;
  shells: Array<"powershell" | "cmd">;
  sessions: StudioPtySnapshot[];
}

interface SessionHandle {
  snapshot: StudioPtySnapshot;
  ticket: string;
  streamPath: string;
  eventsPath: string;
}

/**
 * Real xterm.js + ConPTY/PTY stream. Not a textarea. Not Agent execution.
 * Each session owns an independent Terminal, SSE stream, and scrollback.
 */
export function StudioPtyTerminal({ projectId }: { projectId: string }) {
  const locale = useLocale();
  const copy = ptyCopyFor(locale);
  const tIntl = useTranslations("studio.ptyTerminal");
  const t = (key: PtyCopyKey): string => {
    try {
      const value = tIntl(key);
      if (typeof value === "string" && value.length > 0 && !value.includes("studio.ptyTerminal") && value !== key) {
        return value;
      }
    } catch {
      /* next-intl catalog may omit this nested namespace until a full reload */
    }
    return copy[key];
  };
  const hostRef = useRef<HTMLDivElement | null>(null);
  const registryRef = useRef<PtySessionTerminalRegistry | null>(null);
  const sendInputRef = useRef<(sessionId: string, data: string) => Promise<void>>(async () => {});
  const activeIdRef = useRef<string | null>(null);
  const [shell, setShell] = useState<"powershell" | "cmd">("powershell");
  const [sessions, setSessions] = useState<SessionHandle[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [termHeight, setTermHeight] = useState(360);
  const reconnectingRef = useRef(new Set<string>());
  const failedReconnectRef = useRef(new Set<string>());
  const dragRef = useRef<{ y: number; h: number } | null>(null);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  const applyEvent = useCallback((sessionId: string, msg: Record<string, unknown>) => {
    if (msg.type === "data" && typeof msg.data === "string") {
      registryRef.current?.write(sessionId, msg.data);
    }
    if (msg.type === "ready" && msg.session && typeof msg.session === "object") {
      const session = msg.session as StudioPtySnapshot;
      setSessions((rows) =>
        rows.map((row) =>
          row.snapshot.sessionId === session.sessionId ? { ...row, snapshot: session } : row,
        ),
      );
    }
    if (msg.type === "exit" && activeIdRef.current === sessionId) {
      setStatus(`exit ${typeof msg.exitCode === "number" ? msg.exitCode : "?"}`);
    }
    if (msg.type === "error" && typeof msg.message === "string" && activeIdRef.current === sessionId) {
      setError(msg.message);
    }
  }, []);

  const attachStream = useCallback(
    (created: SessionHandle) => {
      const registry = registryRef.current;
      const sessionId = created.snapshot.sessionId;
      if (!registry) return;
      if (!created.ticket) {
        setError(t("streamError"));
        return;
      }
      if (!registry.shouldAttach(sessionId)) {
        registry.activate(sessionId);
        return;
      }
      const runtime = registry.get(sessionId);
      if (!runtime) return;
      registry.markAttached(sessionId);
      const ac = runtime.abort;
      const eventsPath =
        created.eventsPath || created.streamPath.replace(/\/stream$/, "/events");
      void (async () => {
        try {
          const response = await fetch(
            studioPtyEventsUrl(resolveApiUrl(), eventsPath, created.ticket),
            {
              credentials: "include",
              cache: "no-store",
              signal: ac.signal,
              headers: { Accept: "text/event-stream" },
            },
          );
          if (!response.ok || !response.body) {
            setError(t("streamError"));
            return;
          }
          if (activeIdRef.current === sessionId) setStatus("connected");
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (!ac.signal.aborted) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const consumed = consumePtySseBuffer(buffer);
            buffer = consumed.buffer;
            for (const msg of consumed.events) applyEvent(sessionId, msg);
          }
        } catch (err) {
          if (ac.signal.aborted) return;
          if (activeIdRef.current === sessionId) {
            setError(err instanceof Error ? err.message : t("streamError"));
          }
        }
      })();
    },
    [applyEvent, t],
  );

  async function sendInput(sessionId: string, data: string): Promise<void> {
    if (!sessionId) return;
    const base = `/api/v1/projects/${encodeURIComponent(projectId)}/studio/pty/sessions/${sessionId}`;
    if (data === "\u0003") {
      await apiPost(`${base}/interrupt`, {});
      return;
    }
    if (data === "\u0004") {
      await apiPost(`${base}/eof`, {});
      return;
    }
    await apiPost(`${base}/input`, { data });
  }
  sendInputRef.current = sendInput;

  useEffect(() => {
    let disposed = false;
    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      await import("@xterm/xterm/css/xterm.css");
      if (disposed || !hostRef.current) return;
      hostRef.current.replaceChildren();
      registryRef.current?.disposeAll();
      registryRef.current = createPtySessionTerminalRegistry({
        parent: hostRef.current,
        sendInput: (sessionId, data) => sendInputRef.current(sessionId, data),
        onCopy: (text) => {
          void navigator.clipboard.writeText(text).catch(() => {
            setError(t("clipboardDenied"));
          });
        },
        onPaste: (sessionId) => {
          void navigator.clipboard
            .readText()
            .then((text) => {
              if (text) void sendInputRef.current(sessionId, text);
            })
            .catch(() => {
              setError(t("clipboardDenied"));
            });
        },
        factory: {
          create() {
            const term = new Terminal({
              cursorBlink: true,
              fontSize: 13,
              fontFamily: "Consolas, 'Cascadia Mono', 'Courier New', monospace",
              theme: {
                background: "#0E1014",
                foreground: "#DCDDE1",
                cursor: "#EEEEF0",
              },
              scrollback: 5000,
              convertEol: false,
            });
            const fit = new FitAddon();
            term.loadAddon(fit);
            return { term, fit };
          },
        },
      });
      setReady(true);
    })();
    return () => {
      disposed = true;
      setReady(false);
      registryRef.current?.disposeAll();
      registryRef.current = null;
    };
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    void apiGet<Catalog>(`/api/v1/projects/${encodeURIComponent(projectId)}/studio/pty`)
      .then((catalog) => {
        setSessions((existing) => {
          if (existing.length > 0) {
            const have = new Set(existing.map((row) => row.snapshot.sessionId));
            const extras = catalog.sessions
              .filter((snapshot) => !have.has(snapshot.sessionId))
              .map((snapshot) => ({
                snapshot,
                ticket: "",
                streamPath: `/api/v1/projects/${projectId}/studio/pty/sessions/${snapshot.sessionId}/stream`,
                eventsPath: `/api/v1/projects/${projectId}/studio/pty/sessions/${snapshot.sessionId}/events`,
              }));
            return extras.length > 0 ? [...existing, ...extras] : existing;
          }
          return catalog.sessions.map((snapshot) => ({
            snapshot,
            ticket: "",
            streamPath: `/api/v1/projects/${projectId}/studio/pty/sessions/${snapshot.sessionId}/stream`,
            eventsPath: `/api/v1/projects/${projectId}/studio/pty/sessions/${snapshot.sessionId}/events`,
          }));
        });
      })
      .catch((err: Error) => setError(err.message));
  }, [projectId]);

  useEffect(() => {
    if (!ready) return;
    for (const row of sessions) {
      if (
        row.ticket ||
        row.snapshot.status !== "running" ||
        reconnectingRef.current.has(row.snapshot.sessionId) ||
        failedReconnectRef.current.has(row.snapshot.sessionId)
      ) {
        continue;
      }
      void reconnectAndAttach(row);
    }
  }, [ready, sessions]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const size = registryRef.current?.fitActive();
      const sessionId = activeIdRef.current;
      if (!size || !sessionId) return;
      void apiPost(
        `/api/v1/projects/${encodeURIComponent(projectId)}/studio/pty/sessions/${sessionId}/resize`,
        { cols: size.cols, rows: size.rows },
      ).catch(() => {
        /* resize is best-effort while the session is connecting */
      });
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [activeId, projectId, ready]);

  async function newSession() {
    const registry = registryRef.current;
    if (!registry) return;
    setBusy(true);
    setError(null);
    try {
      const size = registry.fitActive();
      const created = await apiPost<StudioPtyCreated>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/studio/pty/sessions`,
        { shell, cols: size?.cols ?? 120, rows: size?.rows ?? 32 },
      );
      const handle: SessionHandle = {
        snapshot: created.session,
        ticket: created.ticket,
        streamPath: created.streamPath,
        eventsPath:
          created.eventsPath ||
          created.streamPath.replace(/\/stream$/, "/events"),
      };
      setSessions((rows) => [...rows, handle]);
      setActiveId(created.session.sessionId);
      registry.create(created.session.sessionId);
      attachStream(handle);
      setStatus("running");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error"));
    } finally {
      setBusy(false);
    }
  }

  async function closeActive() {
    if (!activeId) return;
    const closingId = activeId;
    setBusy(true);
    try {
      await apiPost(
        `/api/v1/projects/${encodeURIComponent(projectId)}/studio/pty/sessions/${closingId}/close`,
        {},
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error"));
    } finally {
      registryRef.current?.close(closingId);
      setSessions((rows) => {
        const remaining = rows.filter((row) => row.snapshot.sessionId !== closingId);
        const nextId = remaining[0]?.snapshot.sessionId ?? null;
        setActiveId(nextId);
        if (nextId) {
          registryRef.current?.activate(nextId);
          setStatus("running");
        } else {
          setStatus("closed");
        }
        return remaining;
      });
      setBusy(false);
    }
  }

  function interrupt() {
    const sessionId = activeIdRef.current;
    if (!sessionId) return;
    void sendInput(sessionId, "\u0003").catch((err: Error) => setError(err.message));
  }

  function sendEof() {
    const sessionId = activeIdRef.current;
    if (!sessionId) return;
    void sendInput(sessionId, "\u0004").catch((err: Error) => setError(err.message));
  }

  function clearScreen() {
    if (activeId) registryRef.current?.clear(activeId);
  }

  async function reconnectAndAttach(row: SessionHandle) {
    const sessionId = row.snapshot.sessionId;
    const registry = registryRef.current;
    if (!registry) return;
    registry.create(sessionId);
    registry.activate(sessionId);
    setActiveId(sessionId);
    if (row.ticket) {
      attachStream(row);
      return;
    }
    if (reconnectingRef.current.has(sessionId)) return;
    reconnectingRef.current.add(sessionId);
    setBusy(true);
    try {
      const result = await apiPost<StudioPtyCreated>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/studio/pty/sessions/${sessionId}/reconnect`,
        {},
      );
      const handle: SessionHandle = {
        snapshot: result.session,
        ticket: result.ticket,
        streamPath: result.streamPath,
        eventsPath:
          result.eventsPath || result.streamPath.replace(/\/stream$/, "/events"),
      };
      setSessions((rows) =>
        rows.map((current) => (current.snapshot.sessionId === sessionId ? handle : current)),
      );
      attachStream(handle);
      setStatus("running");
      failedReconnectRef.current.delete(sessionId);
    } catch (err) {
      failedReconnectRef.current.add(sessionId);
      setError(err instanceof Error ? err.message : t("error"));
    } finally {
      reconnectingRef.current.delete(sessionId);
      setBusy(false);
    }
  }

  async function copySelection() {
    const text = registryRef.current?.get(activeId ?? "")?.term.getSelection?.() ?? "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setError(t("clipboardDenied"));
    }
  }

  async function pasteClipboard() {
    const sessionId = activeIdRef.current;
    if (!sessionId) return;
    try {
      const text = await navigator.clipboard.readText();
      if (text) await sendInput(sessionId, text);
    } catch {
      setError(t("clipboardDenied"));
    }
  }

  function selectSession(row: SessionHandle) {
    failedReconnectRef.current.delete(row.snapshot.sessionId);
    void reconnectAndAttach(row);
  }

  function onResizePointerDown(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { y: event.clientY, h: termHeight };
  }

  function onResizePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    const next = Math.min(720, Math.max(160, dragRef.current.h + (event.clientY - dragRef.current.y)));
    setTermHeight(next);
  }

  function onResizePointerUp() {
    dragRef.current = null;
  }

  function onResizeKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setTermHeight((height) => Math.max(160, height - 24));
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setTermHeight((height) => Math.min(720, height + 24));
    }
  }

  const active = sessions.find((row) => row.snapshot.sessionId === activeId);

  return (
    <Stack
      spacing={1.5}
      sx={{
        minHeight: 420,
        "@media (prefers-reduced-motion: reduce)": {
          "& *": { animation: "none !important", transition: "none !important" },
        },
      }}
    >
      <Typography variant="body2" sx={{ color: "#8B9099" }}>
        {t("help")}
      </Typography>
      <Alert severity="info">{t("notAgent")}</Alert>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }} flexWrap="wrap" useFlexGap>
        <TextField
          select
          size="small"
          label={t("shell")}
          value={shell}
          onChange={(event) => setShell(event.target.value as "powershell" | "cmd")}
          sx={{ minWidth: 160 }}
          inputProps={{ "aria-label": t("shell") }}
        >
          <MenuItem value="powershell">PowerShell</MenuItem>
          <MenuItem value="cmd">cmd.exe</MenuItem>
        </TextField>
        <Button variant="contained" disabled={!projectId || busy || !ready} onClick={() => void newSession()} aria-label={t("new")}>
          {busy ? t("opening") : t("new")}
        </Button>
        <Button variant="outlined" disabled={!activeId} onClick={interrupt} aria-label={t("interrupt")}>
          {t("interrupt")}
        </Button>
        <Button variant="outlined" disabled={!activeId} onClick={sendEof} aria-label={t("eof")}>
          {t("eof")}
        </Button>
        <Button variant="outlined" disabled={!activeId} onClick={() => void copySelection()} aria-label={t("copy")}>
          {t("copy")}
        </Button>
        <Button variant="outlined" disabled={!activeId} onClick={() => void pasteClipboard()} aria-label={t("paste")}>
          {t("paste")}
        </Button>
        <Button variant="outlined" onClick={clearScreen} aria-label={t("clear")}>
          {t("clear")}
        </Button>
        <Button color="warning" disabled={!activeId || busy} onClick={() => void closeActive()} aria-label={t("close")}>
          {t("close")}
        </Button>
        <Chip size="small" label={`${t("status")}: ${status}`} />
        {active ? (
          <Chip size="small" variant="outlined" label={`pid ${active.snapshot.pid}`} />
        ) : null}
      </Stack>

      {sessions.length > 0 ? (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap role="tablist" aria-label={t("sessions")}>
          {sessions.map((row, index) => (
            <Button
              key={row.snapshot.sessionId}
              size="small"
              variant={row.snapshot.sessionId === activeId ? "contained" : "outlined"}
              onClick={() => selectSession(row)}
              aria-label={`${t("session")} ${index + 1}`}
            >
              {t("session")} {index + 1}
            </Button>
          ))}
        </Stack>
      ) : null}

      {error ? <Alert severity="error">{error}</Alert> : null}

      {active ? (
        <Typography variant="caption" sx={{ color: "#8B9099" }}>
          {t("cwd")}: {active.snapshot.cwd}
        </Typography>
      ) : (
        <Typography variant="caption" sx={{ color: "#8B9099" }}>
          {t("empty")}
        </Typography>
      )}

      <Box
        ref={hostRef}
        dir="ltr"
        role="application"
        aria-label={t("terminal")}
        tabIndex={0}
        onClick={() => registryRef.current?.focusActive()}
        sx={{
          height: { xs: Math.min(termHeight, 280), md: termHeight },
          bgcolor: "#0E1014",
          border: "1px solid rgba(232,234,238,0.12)",
          borderRadius: "8px 8px 0 0",
          overflow: "hidden",
          p: 0.5,
          position: "relative",
          "& .xterm": { height: "100%" },
          "& .xterm-viewport": { overflowY: "auto" },
        }}
      />
      <Box
        role="separator"
        aria-orientation="horizontal"
        aria-label={t("resize")}
        aria-valuemin={160}
        aria-valuemax={720}
        aria-valuenow={termHeight}
        tabIndex={0}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        onKeyDown={onResizeKeyDown}
        sx={{
          height: 10,
          cursor: "ns-resize",
          bgcolor: "rgba(232,234,238,0.12)",
          borderRadius: "0 0 8px 8px",
          border: "1px solid rgba(232,234,238,0.12)",
          borderTop: "none",
          "&:focus-visible": {
            outline: "2px solid #7C5CFF",
            outlineOffset: 2,
          },
        }}
      />
    </Stack>
  );
}
