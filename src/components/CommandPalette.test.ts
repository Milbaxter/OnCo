import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import type { SearchDoc } from "@/lib/search-index";

// Exercise the component's handlers with its actual shared loader/ranking. Real-browser focus,
// native events and rendering are checked separately; this host only schedules hooks and promises.
const host = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as Array<() => void>, push: vi.fn() }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: <T,>(initial: T) => {
    const i = host.cursor++;
    if (!(i in host.slots)) host.slots[i] = initial;
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
vi.mock("next/navigation", () => { const router = { push: host.push }; return { useRouter: () => router }; });
vi.mock("next/link", () => ({ default: "a" }));
vi.mock("next/dynamic", () => ({ default: () => "molecule" }));
vi.mock("./KindGroupHeader", () => ({ KindGroupHeader: "group-header" }));
vi.mock("@/lib/i18n/ui", () => ({ useT: () => ({ kind: (name: string) => name, status: (name: string) => name }) }));

type Props = { children?: ReactNode; [key: string]: unknown };
type Node = ReactElement<Props>;
const docs: SearchDoc[] = ["alpha", "beta"].flatMap((word) => [1, 2, 3].map((n) => ({
  id: `${word}-${n}`, kind: "term", name: `${word} ${n}`, tldr: "Synthetic palette fixture", aka: "", tags: "", route: `/terms/${word}-${n}/`,
})));
let Component: typeof import("./CommandPalette").CommandPalette;
let tree: ReactNode;
let respond: (response: Response) => void;
let listeners: Map<string, (event: unknown) => void>;
const draw = () => {
  host.cursor = 0; tree = Component();
  host.effects.splice(0).forEach((effect) => effect());
};
const nodes = (node: ReactNode): Array<Node | string> => {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (typeof node === "string") return [node];
  return isValidElement<Props>(node) ? [node, ...nodes(node.props.children)] : [];
};
const elements = () => nodes(tree).filter((node): node is Node => typeof node !== "string");
const input = () => elements().find((node) => node.type === "input")!;
const options = () => elements().filter((node) => node.props.role === "option");
const names = () => options().map((node) => nodes(node).filter((child) => typeof child === "string").join(" "));
const event = (node: Node, name: string, value?: unknown) => { (node.props[name] as (value: unknown) => void)(value); draw(); };
const open = () => { listeners.get("onco:open-palette")!({}); draw(); };
const globalKey = (key: string) => { listeners.get("keydown")!({ key, preventDefault() {} }); draw(); };
const type = (value: string) => event(input(), "onChange", { target: { value } });
const key = (key: string) => event(input(), "onKeyDown", { key, preventDefault() {} });
const settle = async () => { for (let i = 0; i < 3; i++) await new Promise((resolve) => setImmediate(resolve)); draw(); };
const succeed = async () => {
  respond(new Response(JSON.stringify(docs)));
  await (await import("@/lib/search-client")).loadSearch();
  await settle();
};

beforeEach(async () => {
  vi.resetModules(); host.slots = []; host.cursor = 0; host.effects = []; host.push.mockReset();
  listeners = new Map();
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { respond = resolve; })));
  vi.stubGlobal("HTMLElement", class {});
  vi.stubGlobal("document", { activeElement: null, body: { style: { overflow: "" } } });
  vi.stubGlobal("window", { addEventListener: (name: string, fn: (event: unknown) => void) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name), clearTimeout, setTimeout });
  Component = (await import("./CommandPalette")).CommandPalette;
  draw();
});
afterEach(() => {
  for (const slot of host.slots) (slot as { cleanup?: () => void } | undefined)?.cleanup?.();
  vi.unstubAllGlobals();
});

describe("command palette current query", () => {
  it("keeps empty-query page choices when a cleared search completes", async () => {
    open(); type("alpha"); type("");
    expect(options()).toHaveLength(18);
    await succeed();
    expect(input().props.value).toBe("");
    expect(options()).toHaveLength(18);
    expect(names().some((name) => name.includes("alpha"))).toBe(false);
    key("Enter");
    expect(host.push).toHaveBeenLastCalledWith("/search/");
  });

  it("cannot restore cleared results after closing and reopening", async () => {
    open(); type("alpha"); type(""); globalKey("Escape"); await succeed(); open(); await settle();
    expect(input().props.value).toBe("");
    expect(options()).toHaveLength(18);
    key("Enter");
    expect(host.push).toHaveBeenLastCalledWith("/search/");
  });

  it("discards closed work and reruns the retained query on reopening", async () => {
    open(); type("alpha"); globalKey("Escape"); await succeed();
    expect(tree).toBeNull();
    open(); await settle();
    expect(input().props.value).toBe("alpha");
    expect(options()).toHaveLength(3);
    key("ArrowDown"); key("Enter");
    expect(host.push).toHaveBeenLastCalledWith("/terms/alpha-2/");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the latest query when typing A to B to A during the initial request", async () => {
    open(); type("alpha"); type("beta"); type("alpha"); await succeed();
    expect(options()).toHaveLength(3);
    expect(names().every((name) => name.includes("alpha"))).toBe(true);
  });

  it("does not navigate an old result before the new query completes", async () => {
    open(); type("alpha"); await succeed(); type("beta"); key("Enter");
    expect(host.push).not.toHaveBeenCalled();
    await settle(); key("Enter");
    expect(host.push).toHaveBeenLastCalledWith("/terms/beta-1/");
  });

  it("does not restore a pending query after choosing a page", async () => {
    open(); type("alpha"); type(""); key("Enter"); await succeed(); open(); await settle();
    expect(host.push).toHaveBeenLastCalledWith("/search/");
    expect(input().props.value).toBe("");
    expect(options()).toHaveLength(18);
  });

  it("keeps the first result selected when arrowing while no current rows are available", async () => {
    open(); type("alpha"); key("ArrowDown"); await succeed(); key("Enter");
    expect(host.push).toHaveBeenLastCalledWith("/terms/alpha-1/");
  });
});
