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
let requests: Array<{ resolve: (response: Response) => void; reject: (error: Error) => void }>;
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
  requests.at(-1)!.resolve(new Response(JSON.stringify(docs)));
  await (await import("@/lib/search-client")).loadSearch();
  await settle();
};

beforeEach(async () => {
  vi.resetModules(); host.slots = []; host.cursor = 0; host.effects = []; host.push.mockReset();
  listeners = new Map(); requests = [];
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve, reject) => { requests.push({ resolve, reject }); })));
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

const text = () => nodes(tree).filter((node) => typeof node === "string").join(" ");
const fail = async (mode: "http" | "network" | "json" = "http") => {
  if (mode === "network") requests.at(-1)!.reject(new Error("Offline fixture"));
  else requests.at(-1)!.resolve(new Response(mode === "json" ? "{broken" : "Unavailable", { status: mode === "http" ? 503 : 200 }));
  await settle();
};

describe("command palette index recovery", () => {
  it.each(["http", "network", "json"] as const)("settles a %s failure and completes a successful typing retry", async (mode) => {
    open(); type("alpha"); await fail(mode);
    expect(text()).toContain("Search is unavailable");
    expect(text()).not.toMatch(/Loading index|No matches/);
    type("alpha "); await succeed();
    expect(options()).toHaveLength(3);
    expect(text()).toContain("6 objects indexed");
    expect(text()).not.toMatch(/Loading index|unavailable/);
    type("zzqneverfixture"); await settle();
    expect(options()).toHaveLength(0);
    expect(text()).toContain("No matches.");
    expect(requests).toHaveLength(2);
  });

  it("retries the retained query when reopening after a failure", async () => {
    open(); type("alpha"); await fail(); globalKey("Escape"); open(); await succeed();
    expect(input().props.value).toBe("alpha");
    expect(options()).toHaveLength(3);
    expect(names().every((name) => name.includes("alpha"))).toBe(true);
    expect(text()).not.toMatch(/Loading index|unavailable|No matches/);
    key("ArrowDown"); key("Enter");
    expect(host.push).toHaveBeenLastCalledWith("/terms/alpha-2/");
  });

  it("keeps matching tool pages usable during an outage", async () => {
    open(); type("connections"); await fail();
    expect(options()).toHaveLength(1);
    expect(text()).toContain("Search is unavailable");
    key("Enter");
    expect(host.push).toHaveBeenLastCalledWith("/path/");
  });

  it("keeps empty-query pages available when the initial preload fails", async () => {
    open(); await fail();
    expect(options()).toHaveLength(18);
    expect(text()).toContain("Search is unavailable");
    expect(text()).not.toMatch(/Loading index|No matches/);
    type("alpha"); await succeed();
    expect(options()).toHaveLength(3);
    expect(text()).not.toContain("unavailable");
  });

  it("does not expose a closed failure and retries the retained query on reopening", async () => {
    open(); type("alpha"); globalKey("Escape"); await fail();
    expect(tree).toBeNull();
    open(); await succeed();
    expect(options()).toHaveLength(3);
    expect(text()).not.toMatch(/Loading index|unavailable/);
  });

  it("keeps the first keyboard target valid while retrying an empty result list", async () => {
    open(); type("alpha"); await fail(); type("alpha "); key("ArrowDown"); await succeed(); key("Enter");
    expect(host.push).toHaveBeenLastCalledWith("/terms/alpha-1/");
  });

  it("preserves healthy results, indexed counts, page choices and keyboard selection", async () => {
    open(); type("alpha"); await succeed();
    expect(options()).toHaveLength(3);
    expect(text()).toContain("6 objects indexed");
    expect(text()).not.toMatch(/Loading index|unavailable/);
    type(""); expect(options()).toHaveLength(18);
    key("Enter"); expect(host.push).toHaveBeenLastCalledWith("/search/");
  });
});
