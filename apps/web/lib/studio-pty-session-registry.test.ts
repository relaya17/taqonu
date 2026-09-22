import { describe, expect, it } from "vitest";
import {
  createPtySessionTerminalRegistry,
  type PtyTerminalSurface,
} from "./studio-pty-session-registry";

class MemoryTerm implements PtyTerminalSurface {
  cols = 80;
  rows = 24;
  bufferText = "";
  disposed = false;
  focused = false;
  opened = false;
  input: ((data: string) => void) | undefined;
  selection = "";
  keyHandler: ((event: KeyboardEvent) => boolean) | undefined;

  write(data: string): void {
    this.bufferText += data;
  }
  clear(): void {
    this.bufferText = "";
  }
  focus(): void {
    this.focused = true;
  }
  dispose(): void {
    this.disposed = true;
  }
  open(): void {
    this.opened = true;
  }
  onData(listener: (data: string) => void): { dispose(): void } {
    this.input = listener;
    return {
      dispose: () => {
        this.input = undefined;
      },
    };
  }
  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void {
    this.keyHandler = handler;
  }
  hasSelection(): boolean {
    return this.selection.length > 0;
  }
  getSelection(): string {
    return this.selection;
  }
  type(data: string): void {
    this.input?.(data);
  }
}

function fakeHost(sessionId: string): HTMLElement {
  const attrs: Record<string, string> = {};
  const host = {
    dataset: { ptySessionId: sessionId },
    style: {
      height: "100%",
      width: "100%",
      display: "block",
      visibility: "hidden",
      pointerEvents: "none",
      zIndex: "0",
      position: "absolute",
      inset: "0",
    },
    hidden: false,
    removed: false,
    setAttribute(name: string, value: string) {
      attrs[name] = value;
    },
    getAttribute(name: string) {
      return attrs[name];
    },
    remove() {
      this.removed = true;
    },
    appendChild() {
      return host;
    },
  };
  return host as unknown as HTMLElement;
}

function fakeParent(): HTMLElement & { children: HTMLElement[] } {
  const children: HTMLElement[] = [];
  return {
    children,
    appendChild(node: HTMLElement) {
      children.push(node);
      return node;
    },
  } as unknown as HTMLElement & { children: HTMLElement[] };
}

function makeRegistry() {
  const terms = new Map<string, MemoryTerm>();
  const created: MemoryTerm[] = [];
  const inputs: Array<{ sessionId: string; data: string }> = [];
  const parent = fakeParent();
  const registry = createPtySessionTerminalRegistry({
    parent,
    createHost: (sessionId) => fakeHost(sessionId),
    sendInput: (sessionId, data) => {
      inputs.push({ sessionId, data });
    },
    factory: {
      create() {
        const term = new MemoryTerm();
        created.push(term);
        return { term, fit: { fit() {} } };
      },
    },
  });
  return { registry, terms, created, inputs, parent };
}

describe("PtySessionTerminalRegistry session isolation", () => {
  it("keeps independent visible buffers when switching Session 1 and Session 2", () => {
    const { registry, created } = makeRegistry();
    registry.create("s1");
    registry.create("s2");
    const term1 = created[0];
    const term2 = created[1];
    if (!term1 || !term2) throw new Error("expected two terminals");
    registry.write("s1", "SESSION_ONE_MARKER\n");
    registry.write("s2", "SESSION_TWO_MARKER\n");

    registry.activate("s1");
    expect(registry.inspect("s1")).toMatchObject({
      buffer: "SESSION_ONE_MARKER\n",
      visible: true,
      disposed: false,
    });
    expect(registry.inspect("s2")).toMatchObject({
      buffer: "SESSION_TWO_MARKER\n",
      visible: false,
      disposed: false,
    });

    registry.activate("s2");
    expect(registry.inspect("s2")?.visible).toBe(true);
    expect(registry.inspect("s1")?.buffer).toBe("SESSION_ONE_MARKER\n");
    expect(registry.inspect("s2")?.buffer).toBe("SESSION_TWO_MARKER\n");
    expect(term1.bufferText).toBe("SESSION_ONE_MARKER\n");
    expect(term2.bufferText).toBe("SESSION_TWO_MARKER\n");
  });

  it("does not reattach an already-streaming session (avoids mixing SSE replay)", () => {
    const { registry } = makeRegistry();
    registry.create("s1");
    expect(registry.shouldAttach("s1")).toBe(true);
    registry.markAttached("s1");
    expect(registry.shouldAttach("s1")).toBe(false);
    registry.activate("s1");
    expect(registry.shouldAttach("s1")).toBe(false);
    expect(registry.inspect("s1")?.attached).toBe(true);
  });

  it("routes stdin from each terminal instance to that session only", () => {
    const { registry, created, inputs } = makeRegistry();
    registry.create("s1");
    registry.create("s2");
    const first = created[0];
    const second = created[1];
    if (!first || !second) throw new Error("expected two terminals");
    first.type("aaa");
    second.type("bbb");
    expect(inputs).toEqual([
      { sessionId: "s1", data: "aaa" },
      { sessionId: "s2", data: "bbb" },
    ]);
  });

  it("closing Session 2 leaves Session 1 buffer and instance intact", () => {
    const { registry, created } = makeRegistry();
    registry.create("s1");
    registry.create("s2");
    registry.write("s1", "KEEP_S1");
    registry.write("s2", "DROP_S2");
    registry.close("s2");

    const first = created[0];
    const second = created[1];
    if (!first || !second) throw new Error("expected two terminals");
    expect(second.disposed).toBe(true);
    expect(first.disposed).toBe(false);
    expect(registry.inspect("s2")?.disposed).toBe(true);
    expect(registry.inspect("s1")).toMatchObject({
      buffer: "KEEP_S1",
      disposed: false,
      visible: true,
    });
    expect(registry.getActiveId()).toBe("s1");
  });

  it("keeps inactive session hosts laid out so xterm scrollback is not destroyed", () => {
    const { registry } = makeRegistry();
    registry.create("s1");
    registry.create("s2");
    const first = registry.get("s1")?.host as HTMLElement | undefined;
    const second = registry.get("s2")?.host as HTMLElement | undefined;
    if (!first || !second) throw new Error("expected two hosts");
    expect(first.style.visibility).toBe("hidden");
    expect(second.style.visibility).toBe("visible");
    expect(first.style.display).toBe("block");
    expect(second.style.display).toBe("block");
    expect(first.hidden).toBe(false);
    expect(second.hidden).toBe(false);
  });

  it("clearing one session does not wipe the other", () => {
    const { registry } = makeRegistry();
    registry.create("s1");
    registry.create("s2");
    registry.write("s1", "ONE");
    registry.write("s2", "TWO");
    registry.clear("s2");
    expect(registry.inspect("s1")?.buffer).toBe("ONE");
    expect(registry.inspect("s2")?.buffer).toBe("");
  });

  it("routes Ctrl+C copy and Ctrl+V paste without sending those chords to the PTY", () => {
    const copied: string[] = [];
    const pasted: string[] = [];
    const parent = fakeParent();
    const created: MemoryTerm[] = [];
    const inputs: Array<{ sessionId: string; data: string }> = [];
    const registry = createPtySessionTerminalRegistry({
      parent,
      createHost: (sessionId) => fakeHost(sessionId),
      sendInput: (sessionId, data) => {
        inputs.push({ sessionId, data });
      },
      onCopy: (text) => copied.push(text),
      onPaste: (sessionId) => pasted.push(sessionId),
      factory: {
        create() {
          const term = new MemoryTerm();
          created.push(term);
          return { term, fit: { fit() {} } };
        },
      },
    });
    registry.create("s1");
    const term = created[0];
    if (!term) throw new Error("expected terminal");
    term.selection = "copied-text";
    const copyConsumed = term.keyHandler?.(
      { ctrlKey: true, metaKey: false, key: "c" } as KeyboardEvent,
    );
    const pasteConsumed = term.keyHandler?.(
      { ctrlKey: true, metaKey: false, key: "v" } as KeyboardEvent,
    );
    expect(copyConsumed).toBe(false);
    expect(pasteConsumed).toBe(false);
    expect(copied).toEqual(["copied-text"]);
    expect(pasted).toEqual(["s1"]);
    expect(inputs).toEqual([]);
  });
});
