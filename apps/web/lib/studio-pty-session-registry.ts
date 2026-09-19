/**
 * Per-session xterm instances for Studio PTY.
 *
 * One Terminal + SSE abort controller per sessionId. Switching sessions
 * shows/hides hosts; it does not share, clear, or mix scrollback.
 * Closing one session disposes only that session's terminal.
 *
 * Reconnect is intentionally out of scope here: ticketless listed sessions
 * are not attached. start-cwd is not a filesystem jail.
 */

export interface PtyTerminalSurface {
  readonly cols: number;
  readonly rows: number;
  write(data: string, callback?: () => void): void;
  clear(): void;
  focus(): void;
  dispose(): void;
  open(element: HTMLElement): void;
  onData(listener: (data: string) => void): { dispose(): void } | void;
  attachCustomKeyEventHandler?(handler: (event: KeyboardEvent) => boolean): void;
  hasSelection?(): boolean;
  getSelection?(): string;
}

export interface PtyFitSurface {
  fit(): void;
}

export interface PtyTerminalFactory {
  create(): { term: PtyTerminalSurface; fit: PtyFitSurface };
}

export interface PtySessionRuntime {
  readonly sessionId: string;
  readonly abort: AbortController;
  readonly term: PtyTerminalSurface;
  readonly fit: PtyFitSurface;
  readonly host: HTMLElement;
  attached: boolean;
}

export interface PtySessionInspect {
  readonly sessionId: string;
  readonly buffer: string;
  readonly visible: boolean;
  readonly attached: boolean;
  readonly disposed: boolean;
}

type HostLike = HTMLElement & { dataset: DOMStringMap };

function defaultCreateHost(sessionId: string): HTMLElement {
  const host = document.createElement("div");
  host.dataset.ptySessionId = sessionId;
  host.style.position = "absolute";
  host.style.inset = "0";
  host.style.height = "100%";
  host.style.width = "100%";
  host.style.visibility = "hidden";
  host.style.pointerEvents = "none";
  host.style.zIndex = "0";
  return host;
}

function bufferOf(term: PtyTerminalSurface): string {
  const candidate = term as PtyTerminalSurface & { bufferText?: string };
  return typeof candidate.bufferText === "string" ? candidate.bufferText : "";
}

export class PtySessionTerminalRegistry {
  private readonly runtimes = new Map<string, PtySessionRuntime>();
  private readonly recorded = new Map<string, string>();
  private activeId: string | null = null;
  private readonly parent: HTMLElement;
  private readonly factory: PtyTerminalFactory;
  private readonly sendInput: (sessionId: string, data: string) => void | Promise<void>;
  private readonly createHost: (sessionId: string) => HTMLElement;
  private readonly onCopy: ((text: string) => void) | undefined;
  private readonly onPaste: ((sessionId: string) => void) | undefined;

  constructor(options: {
    parent: HTMLElement;
    factory: PtyTerminalFactory;
    sendInput: (sessionId: string, data: string) => void | Promise<void>;
    createHost?: (sessionId: string) => HTMLElement;
    onCopy?: (text: string) => void;
    onPaste?: (sessionId: string) => void;
  }) {
    this.parent = options.parent;
    this.factory = options.factory;
    this.sendInput = options.sendInput;
    this.createHost = options.createHost ?? defaultCreateHost;
    this.onCopy = options.onCopy;
    this.onPaste = options.onPaste;
  }

  create(sessionId: string): PtySessionRuntime {
    const existing = this.runtimes.get(sessionId);
    if (existing) {
      this.activate(sessionId);
      return existing;
    }
    const host = this.createHost(sessionId);
    if ("dataset" in host) {
      (host as HostLike).dataset.ptySessionId = sessionId;
    }
    this.parent.appendChild(host);
    host.style.visibility = "visible";
    host.style.pointerEvents = "auto";
    host.style.zIndex = "1";
    const { term, fit } = this.factory.create();
    term.open(host);
    term.onData((data) => {
      void this.sendInput(sessionId, data);
    });
    if (typeof term.attachCustomKeyEventHandler === "function") {
      term.attachCustomKeyEventHandler((event) => this.handleKeys(sessionId, term, event));
    }
    const runtime: PtySessionRuntime = {
      sessionId,
      abort: new AbortController(),
      term,
      fit,
      host,
      attached: false,
    };
    this.runtimes.set(sessionId, runtime);
    this.recorded.set(sessionId, "");
    this.activate(sessionId);
    return runtime;
  }

  write(sessionId: string, data: string): void {
    const next = (this.recorded.get(sessionId) ?? "") + data;
    this.recorded.set(sessionId, next);
    const runtime = this.runtimes.get(sessionId);
    if (!runtime) return;
    if ("dataset" in runtime.host) {
      const host = runtime.host as HTMLElement & { dataset: DOMStringMap };
      host.dataset.ptyBytes = String(next.length);
    }
    runtime.term.write(data, () => {
      if ("dataset" in runtime.host) {
        (runtime.host as HTMLElement & { dataset: DOMStringMap }).dataset.ptyFlushed = String(
          (this.recorded.get(sessionId) ?? "").length,
        );
      }
    });
  }

  clear(sessionId: string): void {
    this.recorded.set(sessionId, "");
    this.runtimes.get(sessionId)?.term.clear();
  }

  activate(sessionId: string): void {
    if (!this.runtimes.has(sessionId)) return;
    this.activeId = sessionId;
    this.applyVisibility();
    const runtime = this.runtimes.get(sessionId);
    if (!runtime) return;
    try {
      runtime.fit.fit();
    } catch {
      /* host may not have layout yet */
    }
    if ("dataset" in runtime.host) {
      const host = runtime.host as HTMLElement & { dataset: DOMStringMap };
      host.dataset.ptyCols = String(runtime.term.cols);
      host.dataset.ptyRows = String(runtime.term.rows);
    }
    if (typeof runtime.host.scrollIntoView === "function") {
      runtime.host.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    runtime.term.focus();
  }

  shouldAttach(sessionId: string): boolean {
    const runtime = this.runtimes.get(sessionId);
    return Boolean(runtime && !runtime.attached && !runtime.abort.signal.aborted);
  }

  markAttached(sessionId: string): void {
    const runtime = this.runtimes.get(sessionId);
    if (runtime) runtime.attached = true;
  }

  get(sessionId: string): PtySessionRuntime | undefined {
    return this.runtimes.get(sessionId);
  }

  getActiveId(): string | null {
    return this.activeId;
  }

  focusActive(): void {
    if (this.activeId) this.runtimes.get(this.activeId)?.term.focus();
  }

  fitActive(): { cols: number; rows: number } | null {
    if (!this.activeId) return null;
    const runtime = this.runtimes.get(this.activeId);
    if (!runtime) return null;
    try {
      runtime.fit.fit();
    } catch {
      return null;
    }
    return { cols: runtime.term.cols, rows: runtime.term.rows };
  }

  close(sessionId: string): void {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime) return;
    runtime.abort.abort();
    try {
      runtime.term.dispose();
    } catch {
      /* already disposed */
    }
    runtime.host.remove();
    this.runtimes.delete(sessionId);
    this.recorded.delete(sessionId);
    if (this.activeId === sessionId) {
      const next = this.runtimes.keys().next();
      this.activeId = next.done ? null : next.value;
      if (this.activeId) this.activate(this.activeId);
      else this.applyVisibility();
    }
  }

  disposeAll(): void {
    for (const id of [...this.runtimes.keys()]) {
      this.close(id);
    }
  }

  inspect(sessionId: string): PtySessionInspect | undefined {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime) {
      return {
        sessionId,
        buffer: "",
        visible: false,
        attached: false,
        disposed: true,
      };
    }
    return {
      sessionId,
      buffer: this.recorded.get(sessionId) ?? bufferOf(runtime.term),
      visible: this.activeId === sessionId,
      attached: runtime.attached,
      disposed: false,
    };
  }

  private applyVisibility(): void {
    for (const [id, runtime] of this.runtimes) {
      const visible = id === this.activeId;
      runtime.host.style.visibility = visible ? "visible" : "hidden";
      runtime.host.style.pointerEvents = visible ? "auto" : "none";
      runtime.host.style.zIndex = visible ? "1" : "0";
      runtime.host.style.display = "block";
      runtime.host.setAttribute("aria-hidden", visible ? "false" : "true");
    }
  }

  private handleKeys(sessionId: string, term: PtyTerminalSurface, event: KeyboardEvent): boolean {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c" && term.hasSelection?.()) {
      const text = term.getSelection?.() ?? "";
      if (text) this.onCopy?.(text);
      return false;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
      this.onPaste?.(sessionId);
      return false;
    }
    return true;
  }
}

export function createPtySessionTerminalRegistry(
  options: ConstructorParameters<typeof PtySessionTerminalRegistry>[0],
): PtySessionTerminalRegistry {
  return new PtySessionTerminalRegistry(options);
}
