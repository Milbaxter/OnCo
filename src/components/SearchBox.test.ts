import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import type { SearchDoc } from "@/lib/search-index";
import { buildSemanticIndex, type SemanticIndex } from "@/lib/semantic";

// A small hook host exercises the actual component's event handlers and JSX without adding a DOM dependency.
// Browser focus/layout are verified separately; loader, ranking, grouping and promise handling run unchanged.
const host = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as Array<() => void>, push: vi.fn(), semantic: vi.fn() }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: <T,>(initial: T) => {
    const i = host.cursor++;
    if (!(i in host.slots)) host.slots[i] = initial;
    return [host.slots[i], (next: T | ((value: T) => T)) => { host.slots[i] = typeof next === "function" ? (next as (value: T) => T)(host.slots[i] as T) : next; }];
  },
  useRef: <T,>(initial: T) => { const i = host.cursor++; return host.slots[i] ??= { current: initial }; },
  useMemo: <T,>(fn: () => T) => { host.cursor++; return fn(); },
  useEffect: (fn: () => void | (() => void), deps: unknown[]) => {
    const i = host.cursor++;
    const previous = host.slots[i] as { deps: unknown[]; cleanup?: () => void } | undefined;
    if (!previous || deps.some((d, j) => !Object.is(d, previous.deps[j]))) {
      host.effects.push(() => { previous?.cleanup?.(); host.slots[i] = { deps, cleanup: fn() }; });
    }
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: host.push }) }));
vi.mock("next/link", () => ({ default: "a" }));
vi.mock("./KindGroupHeader", () => ({ KindGroupHeader: "group-header" }));
vi.mock("@/lib/semantic-client", () => ({ loadSemantic: host.semantic }));

type Props = { children?: ReactNode; [key: string]: unknown };
type Node = ReactElement<Props>;
const docs: SearchDoc[] = ["alpha", "beta"].flatMap((word) => [1, 2, 3].map((n) => ({
  id: `${word}-${n}`, kind: "term", name: `${word} ${n}`, tldr: "Synthetic search fixture", aka: "", tags: "", route: `/terms/${word}-${n}/`,
})));
const conceptIndex = buildSemanticIndex([
  { id: "beta-1", kind: "term", text: "alpha related fixture" },
  { id: "alpha-1", kind: "term", text: "unrelated fixture" },
], { minDf: 1 });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
let Component: typeof import("./SearchBox").SearchBox;
let tree: ReactNode;
let requests: ReturnType<typeof deferred<Response>>[];
const draw = () => {
  host.cursor = 0;
  tree = Component({});
  const pending = host.effects.splice(0);
  pending.forEach((effect) => effect());
};
const nodes = (node: ReactNode): Array<Node | string> => {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (typeof node === "string") return [node];
  return isValidElement<Props>(node) ? [node, ...nodes(node.props.children)] : [];
};
const elements = () => nodes(tree).filter((node): node is Node => typeof node !== "string");
const input = () => elements().find((node) => node.type === "input")!;
const text = () => nodes(tree).filter((node) => typeof node === "string").join(" ");
const options = () => elements().filter((node) => node.props.role === "option");
const event = (node: Node, name: string, value?: unknown) => { (node.props[name] as (value: unknown) => void)(value); draw(); };
const focus = () => event(input(), "onFocus");
const type = (value: string) => event(input(), "onChange", { target: { value } });
const key = (key: string) => event(input(), "onKeyDown", { key, preventDefault() {} });
const settle = async () => { for (let i = 0; i < 3; i++) await new Promise((resolve) => setImmediate(resolve)); draw(); };
const succeed = async (values = docs) => { requests.at(-1)!.resolve(new Response(JSON.stringify(values))); await settle(); };
const fail = async () => { requests.at(-1)!.reject(new Error("Offline fixture")); await settle(); };

beforeEach(async () => {
  vi.resetModules();
  host.slots = []; host.cursor = 0; host.effects = [];
  host.push.mockReset(); host.semantic.mockReset().mockResolvedValue(null);
  requests = [];
  vi.stubGlobal("fetch", vi.fn(() => { const request = deferred<Response>(); requests.push(request); return request.promise; }));
  vi.stubGlobal("document", { addEventListener() {}, removeEventListener() {} });
  Component = (await import("./SearchBox")).SearchBox;
  draw();
});
afterEach(() => vi.unstubAllGlobals());

describe("search box recovery", () => {
  it("shows an index failure and retries the retained query", async () => {
    focus(); type("alpha"); await fail();
    expect(text()).toContain("Search is unavailable");
    expect(text()).not.toMatch(/Loading index|No matches/);
    const retry = elements().find((node) => node.type === "button" && nodes(node).includes("Retry search"))!;
    expect(retry).toBeDefined();
    event(retry, "onClick"); await succeed();
    expect(input().props.value).toBe("alpha");
    expect(options()).toHaveLength(3);
    expect(text()).not.toMatch(/Loading index|No matches|unavailable/);
    expect(requests).toHaveLength(2);
  });

  it("reruns the retained query when reopening after a failure", async () => {
    focus(); type("alpha"); await fail();
    key("Escape"); focus(); await succeed();
    expect(options()).toHaveLength(3);
    expect(text()).not.toMatch(/Loading index|No matches|unavailable/);
  });

  it("recomputes a retained query when ArrowDown reopens a cancelled request", async () => {
    focus(); type("alpha"); key("Escape"); await succeed();
    expect(options()).toHaveLength(0);
    key("ArrowDown"); await settle();
    expect(input().props.value).toBe("alpha");
    expect(options()).toHaveLength(3);
    key("Enter");
    expect(host.push).toHaveBeenLastCalledWith("/terms/alpha-1/");
    expect(requests).toHaveLength(1);
  });

  it("finishes loading when a changed query retries successfully", async () => {
    focus(); type("alp"); await fail();
    type("alpha"); await succeed();
    expect(options()).toHaveLength(3);
    expect(text()).not.toMatch(/Loading index|No matches|unavailable/);
  });

  it("clears stale rows before accepting Enter for a new query", async () => {
    focus(); type("alpha"); await succeed();
    type("beta"); key("ArrowDown"); key("Enter");
    expect(host.push).toHaveBeenCalledWith("/search/?q=beta");
    await settle();
    expect(input().props.value).toBe("");
    expect(options()).toHaveLength(0);
  });

  it("keeps Enter navigation available after a failure and for a selected result", async () => {
    focus(); type("alpha"); await fail(); key("Enter");
    expect(host.push).toHaveBeenLastCalledWith("/search/?q=alpha");
    focus(); type("beta"); await succeed();
    key("ArrowDown"); key("Enter");
    expect(host.push).toHaveBeenLastCalledWith("/terms/beta-1/");
  });

  it("invalidates an earlier concept result even when the query changes A to B to A", async () => {
    const older = deferred<SemanticIndex | null>();
    host.semantic.mockReturnValueOnce(older.promise).mockResolvedValue(null);
    focus(); type("alpha"); await succeed([docs[0], docs[3]]);
    type("beta"); await settle(); type("alpha"); await settle();
    older.resolve(conceptIndex); await settle();
    expect(input().props.value).toBe("alpha");
    expect(options()).toHaveLength(1);
    expect(text()).not.toContain("beta 1");
  });

  it("does not restore cleared rows after an in-flight index request succeeds", async () => {
    focus(); type("alpha"); type(""); await succeed();
    key("ArrowDown"); key("Enter");
    expect(input().props.value).toBe("");
    expect(options()).toHaveLength(0);
    expect(host.push).not.toHaveBeenCalled();
  });

  it("does not restore a closed query after a late concept response", async () => {
    const older = deferred<SemanticIndex | null>();
    host.semantic.mockReturnValueOnce(older.promise);
    focus(); type("alpha"); await succeed([docs[0], docs[3]]);
    const link = elements().find((node) => node.type === "a" && node.props.href === "/terms/alpha-1/")!;
    event(link, "onClick"); older.resolve(conceptIndex); await settle();
    key("ArrowDown"); key("Enter");
    expect(input().props.value).toBe("");
    expect(options()).toHaveLength(0);
    expect(host.push).not.toHaveBeenCalled();
  });

  it("keeps lexical matches if the optional concept loader rejects", async () => {
    host.semantic.mockRejectedValue(new Error("Concept module unavailable"));
    focus(); type("alpha"); await succeed([docs[0]]);
    expect(options()).toHaveLength(1);
    expect(text()).not.toMatch(/Loading index|No matches|unavailable/);
  });
});
