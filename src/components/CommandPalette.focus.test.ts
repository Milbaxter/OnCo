import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";

// Model React's commit order: attach refs and apply autoFocus before passive effects. Native
// focus and keyboard behaviour are checked separately in an actual mounted browser fixture.
const host = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as Array<() => void> }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: <T,>(initial: T) => {
    const i = host.cursor++;
    if (!(i in host.slots)) host.slots[i] = typeof initial === "function" ? (initial as () => T)() : initial;
    return [host.slots[i], (next: T | ((value: T) => T)) => { host.slots[i] = typeof next === "function" ? (next as (value: T) => T)(host.slots[i] as T) : next; }];
  },
  useRef: <T,>(initial: T) => { const i = host.cursor++; return host.slots[i] ??= { current: initial }; },
  useMemo: <T,>(fn: () => T) => { host.cursor++; return fn(); },
  useCallback: <T,>(fn: T, deps: unknown[]) => {
    const i = host.cursor++;
    const previous = host.slots[i] as { deps: unknown[]; fn: T } | undefined;
    if (!previous || deps.some((d, j) => !Object.is(d, previous.deps[j]))) host.slots[i] = { deps, fn };
    return (host.slots[i] as { fn: T }).fn;
  },
  useEffect: (fn: () => void | (() => void), deps: unknown[]) => {
    const i = host.cursor++;
    const previous = host.slots[i] as { deps: unknown[]; cleanup?: () => void } | undefined;
    if (!previous || deps.some((d, j) => !Object.is(d, previous.deps[j]))) {
      host.effects.push(() => { previous?.cleanup?.(); host.slots[i] = { deps, cleanup: fn() }; });
    }
  },
}));
vi.mock("react-dom", () => ({ flushSync: (fn: () => void) => fn() }));
vi.mock("next/navigation", () => { const router = { push: vi.fn() }; return { useRouter: () => router }; });
vi.mock("next/link", () => ({ default: "a" }));
vi.mock("next/dynamic", () => ({ default: () => "molecule" }));
vi.mock("./KindGroupHeader", () => ({ KindGroupHeader: "group-header" }));
vi.mock("@/lib/i18n/ui", () => ({ useT: () => ({ kind: (name: string) => name, status: (name: string) => name }) }));
vi.mock("@/lib/search-client", () => ({ loadSearch: vi.fn(() => new Promise(() => {})) }));

type Props = { children?: ReactNode; ref?: { current: Element | null }; [key: string]: unknown };
type Node = ReactElement<Props>;
class Element {
  isConnected = true;
  focus = vi.fn(() => { if (this.isConnected) doc.activeElement = this; });
  closest() { return null; }
  querySelector() { return null; }
}
class Input extends Element {}
let doc: { activeElement: Element | null; body: { style: { overflow: string } } };
let Component: typeof import("./CommandPalette").CommandPalette;
let tree: ReactNode;
let childMounted: boolean;
let attached: Map<NonNullable<Props["ref"]>, Element>;
let listeners: Map<string, (event: unknown) => void>;
const nodes = (node: ReactNode): Node[] => {
  if (Array.isArray(node)) return node.flatMap(nodes);
  return isValidElement<Props>(node) ? [node, ...nodes(node.props.children)] : [];
};
const draw = () => {
  host.cursor = 0; tree = Component();
  const parentSlots = host.cursor;
  const child = isValidElement<Props>(tree) && typeof tree.type === "function" ? tree : null;
  if (child) tree = (child.type as (props: Props) => ReactNode)(child.props);
  else if (childMounted) {
    for (const slot of host.slots.splice(parentSlots)) (slot as { cleanup?: () => void } | undefined)?.cleanup?.();
  }
  childMounted = !!child;
  const next = new Map<NonNullable<Props["ref"]>, Element>();
  for (const node of nodes(tree)) {
    if (!node.props.ref) continue;
    const existing = attached.get(node.props.ref);
    const el = existing ?? (node.type === "input" ? new Input() : new Element());
    node.props.ref.current = el;
    next.set(node.props.ref, el);
    if (!existing && node.props.autoFocus) el.focus();
  }
  for (const [ref, el] of attached) if (!next.has(ref)) {
    ref.current = null; el.isConnected = false;
    if (doc.activeElement === el) doc.activeElement = null;
  }
  attached = next;
  host.effects.splice(0).forEach((effect) => effect());
  vi.runOnlyPendingTimers();
};
const open = () => { listeners.get("onco:open-palette")!({}); draw(); };
const openSheet = () => { listeners.get("onco:open-shortcuts")!({}); draw(); };
const click = (node: Node) => { (node.props.onClick as () => void)(); draw(); };
const sheetClose = () => nodes(tree).find((node) => node.props["aria-label"] === "Close")!;
const allShortcuts = () => nodes(tree).find((node) => node.type === "button" && Array.isArray(node.props.children) && node.props.children.includes("All shortcuts "))!;
const key = (key: string, modifier?: "ctrlKey" | "metaKey") => {
  listeners.get("keydown")!({ key, [modifier ?? "none"]: true, target: doc.activeElement, preventDefault() {} }); draw();
};
const dismissBackdrop = () => {
  const backdrop = tree as Node;
  const target = {};
  let prevented = false;
  (backdrop.props.onMouseDown as (event: unknown) => void)({ target, currentTarget: target, preventDefault() { prevented = true; } }); draw();
  // The browser's default mousedown focus action runs after React's synchronous close/cleanup.
  if (!prevented) doc.activeElement = null;
};
const focusOpener = (input = false) => {
  const opener = input ? new Input() : new Element();
  opener.focus(); opener.focus.mockClear();
  return opener;
};

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules(); host.slots = []; host.cursor = 0; host.effects = [];
  attached = new Map(); listeners = new Map(); childMounted = false;
  doc = { activeElement: null, body: { style: { overflow: "" } } };
  vi.stubGlobal("HTMLElement", Element);
  vi.stubGlobal("HTMLInputElement", Input);
  vi.stubGlobal("HTMLTextAreaElement", class extends Element {});
  vi.stubGlobal("HTMLSelectElement", class extends Element {});
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", { localStorage: { getItem: () => null }, addEventListener: (name: string, fn: (event: unknown) => void) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name), clearTimeout, setTimeout });
  Component = (await import("./CommandPalette")).CommandPalette;
  draw();
});
afterEach(() => {
  for (const slot of host.slots) (slot as { cleanup?: () => void } | undefined)?.cleanup?.();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("shortcuts sheet focus restoration", () => {
  it("restores the page control that opened the sheet with question mark", () => {
    const opener = focusOpener(); key("?");
    expect(doc.activeElement === sheetClose().props.ref?.current).toBe(true);
    key("Escape"); expect(tree).toBeNull();
    expect(doc.activeElement === opener).toBe(true);
  });

  it("restores the direct custom-event opener after the visible close button", () => {
    const opener = focusOpener(); openSheet(); click(sheetClose());
    expect(tree).toBeNull(); expect(doc.activeElement === opener).toBe(true);
  });

  it("restores the direct opener after backdrop dismissal", () => {
    const opener = focusOpener(); openSheet(); dismissBackdrop();
    expect(tree).toBeNull(); expect(doc.activeElement === opener).toBe(true);
  });

  it("retains the page opener on repeated sheet open events", () => {
    const opener = focusOpener(); openSheet(); openSheet(); openSheet(); key("Escape");
    expect(doc.activeElement === opener).toBe(true);
  });

  it("carries the palette's page opener through All shortcuts until both dialogs close", () => {
    const opener = focusOpener(true); open(); click(allShortcuts());
    expect(opener.focus).not.toHaveBeenCalled();
    expect(doc.activeElement === sheetClose().props.ref?.current).toBe(true);
    click(sheetClose()); expect(doc.activeElement === opener).toBe(true);
    expect(opener.focus).toHaveBeenCalledOnce();
  });

  it("keeps the page origin while toggling from shortcuts to the palette and back", () => {
    const opener = focusOpener(); openSheet(); key("k", "ctrlKey");
    expect(doc.activeElement).toBeInstanceOf(Input);
    expect(opener.focus).not.toHaveBeenCalled();
    key("k", "ctrlKey"); click(sheetClose());
    expect(doc.activeElement === opener).toBe(true);
  });

  it("does not focus a sheet opener removed before dismissal", () => {
    const opener = focusOpener(); openSheet(); opener.isConnected = false; click(sheetClose());
    expect(tree).toBeNull(); expect(opener.focus).not.toHaveBeenCalled();
    expect(doc.activeElement).toBeNull();
  });
});

describe("command palette focus restoration", () => {
  it("restores the opener captured before the palette input autofocuses", () => {
    const opener = focusOpener(); open();
    expect(doc.activeElement).toBeInstanceOf(Input);
    expect(doc.activeElement).not.toBe(opener);
    key("Escape");
    expect(tree).toBeNull(); expect(doc.activeElement === opener).toBe(true);
    expect(opener.focus).toHaveBeenCalledOnce();
  });

  it.each(["ctrlKey", "metaKey"] as const)("restores a page input after the %s shortcut toggles closed", (modifier) => {
    const opener = focusOpener(true); key("k", modifier); key("k", modifier);
    expect(tree).toBeNull(); expect(doc.activeElement === opener).toBe(true);
  });

  it("restores the control that opened the palette with slash", () => {
    const opener = focusOpener(); key("/"); key("Escape");
    expect(doc.activeElement === opener).toBe(true);
  });

  it("restores the opener when the backdrop dismisses the palette", () => {
    const opener = focusOpener(); open(); dismissBackdrop();
    expect(tree).toBeNull(); expect(doc.activeElement === opener).toBe(true);
  });

  it("does not replace the opener with the input on repeated open events", () => {
    const opener = focusOpener(); open(); open(); open(); key("Escape");
    expect(doc.activeElement === opener).toBe(true);
  });

  it.each([false, true])("preserves two queued shortcut toggles when initially open is %s", (initiallyOpen) => {
    const opener = focusOpener();
    if (initiallyOpen) open();
    const onKey = listeners.get("keydown")!;
    const event = { key: "k", ctrlKey: true, target: doc.activeElement, preventDefault() {} };
    onKey(event); onKey(event); draw();
    expect(tree !== null).toBe(initiallyOpen);
    if (initiallyOpen) key("Escape");
    expect(doc.activeElement === opener).toBe(true);
  });

  it("captures a different opener on the next opening", () => {
    const first = focusOpener(); open(); key("Escape");
    const second = focusOpener(true); open(); key("Escape");
    expect(first.focus).toHaveBeenCalledOnce(); expect(second.focus).toHaveBeenCalledOnce();
    expect(doc.activeElement === second).toBe(true);
  });

  it("does not try to focus an opener that has been removed", () => {
    const opener = focusOpener(); open(); opener.isConnected = false; key("Escape");
    expect(tree).toBeNull(); expect(opener.focus).not.toHaveBeenCalled();
    expect(doc.activeElement).toBeNull();
  });
});
