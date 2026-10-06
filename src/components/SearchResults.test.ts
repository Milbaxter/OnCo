import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import type { SearchDoc } from "@/lib/search-index";
import type { AskResult } from "@/lib/ask-pipeline";
import { buildSemanticIndex, type SemanticIndex } from "@/lib/semantic";

// Exercise the component's handlers/effects with real loaders, ranking and answer composition.
// Native events/layout are checked separately in a real browser; no DOM dependency is added here.
const host = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, dirty: false, effects: [] as Array<() => void>, semantic: vi.fn(), answer: vi.fn() }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: <T,>(initial: T) => {
    const i = host.cursor++;
    if (!(i in host.slots)) host.slots[i] = initial;
    return [host.slots[i], (next: T | ((value: T) => T)) => {
      const value = typeof next === "function" ? (next as (value: T) => T)(host.slots[i] as T) : next;
      if (!Object.is(value, host.slots[i])) { host.slots[i] = value; host.dirty = true; }
    }];
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
    if (!previous || deps.some((d, j) => !Object.is(d, previous.deps[j]))) host.effects.push(() => {
      previous?.cleanup?.(); host.slots[i] = { deps, cleanup: fn() };
    });
  },
}));
vi.mock("next/link", () => ({ default: "a" }));
vi.mock("./MoleculeSlot", () => ({ MoleculeSlot: "molecule-slot" }));
vi.mock("@/lib/use-my-cancer", () => ({ useMyCancer: () => ({}), pickMyCancer: () => undefined, shortCancerName: (s: string) => s }));
vi.mock("@/lib/use-my-cancer-list", () => ({ useMyCancerList: () => [] }));
vi.mock("@/lib/semantic-client", () => ({ loadSemantic: host.semantic }));
vi.mock("@/lib/ask-pipeline", () => ({ answerQuestion: host.answer }));

type Props = { children?: ReactNode; [key: string]: unknown };
type Node = ReactElement<Props>;
const docs: SearchDoc[] = ["alpha", "beta"].flatMap((word) => [1, 2, 3].map((n) => ({
  id: `${word}-${n}`, kind: "term", name: `${word} ${n}`, tldr: `${word} ${n} is a synthetic recovery fixture.`, aka: "", tags: "", route: `/terms/${word}-${n}/`,
})));
const conceptIndex = buildSemanticIndex([{ id: "beta-1", kind: "term", text: "alpha concept fixture" }], { minDf: 1 });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
let Component: typeof import("./SearchResults").SearchResults;
let tree: ReactNode;
let requests: ReturnType<typeof deferred<Response>>[];
let indexStatus: number;
const draw = () => {
  do {
    host.dirty = false; host.cursor = 0; tree = Component();
    host.effects.splice(0).forEach((effect) => effect());
  } while (host.dirty);
};
const nodes = (node: ReactNode): Array<Node | string> => {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (typeof node === "string") return [node];
  return isValidElement<Props>(node) ? [node, ...nodes(node.props.children)] : [];
};
const elements = () => nodes(tree).filter((node): node is Node => typeof node !== "string");
const input = () => elements().find((node) => node.type === "input")!;
const text = (node = tree) => nodes(node).filter((n) => typeof n === "string").join(" ");
const askText = () => text(elements().find((node) => node.props["aria-labelledby"] === "search-ask"));
const resultIds = () => nodes(elements().find((node) => node.props["aria-label"] === "Search results")).filter((node): node is Node => typeof node !== "string" && node.type === "a").map((node) => node.props.href);
const event = (node: Node, name: string, value?: unknown) => { (node.props[name] as (value: unknown) => void)(value); draw(); };
const submit = (value: string) => {
  event(input(), "onChange", { target: { value } });
  event(elements().find((node) => node.type === "form")!, "onSubmit", { preventDefault() {} });
};
const retry = () => event(elements().find((node) => node.type === "form")!, "onSubmit", { preventDefault() {} });
const settle = async () => { for (let i = 0; i < 6; i++) { await new Promise((resolve) => setImmediate(resolve)); if (host.dirty) draw(); } };
const succeed = async () => {
  requests.at(-1)!.resolve(new Response(JSON.stringify(docs)));
  await (await import("@/lib/search-client")).loadSearch();
  await settle();
};
const fail = async () => { requests.at(-1)!.resolve(new Response("Offline fixture", { status: 503 })); await settle(); };
const unmount = () => { for (const slot of host.slots) (slot as { cleanup?: () => void } | undefined)?.cleanup?.(); };

beforeEach(async () => {
  vi.resetModules();
  host.slots = []; host.cursor = 0; host.dirty = false; host.effects = [];
  host.semantic.mockReset().mockResolvedValue(null);
  const actual = await vi.importActual<typeof import("@/lib/ask-pipeline")>("@/lib/ask-pipeline");
  host.answer.mockReset().mockImplementation(actual.answerQuestion);
  requests = []; indexStatus = 200;
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (url === "/api/v1/search.json") { const request = deferred<Response>(); requests.push(request); return request.promise; }
    if (url === "/api/v1/ask-index.json") return Promise.resolve(new Response(JSON.stringify({ version: 1, kinds: ["term"], rows: docs.map((d) => [d.id, 0, d.name, []]), pairs: [] }), { status: indexStatus }));
    const doc = docs.find((d) => url === `/api/v1/entities/${d.id}.json`);
    if (!doc) throw new Error(`Unexpected fixture URL: ${url}`);
    return Promise.resolve(new Response(JSON.stringify({ entity: { ...doc, aka: [], tags: [], summary: doc.tldr, links: [] }, route: doc.route, neighbours: {} })));
  }));
  vi.stubGlobal("window", { location: { search: "", pathname: "/search/" }, history: { replaceState: vi.fn() } });
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  Component = (await import("./SearchResults")).SearchResults;
  draw();
});
afterEach(() => { unmount(); vi.unstubAllGlobals(); });

describe("search results recovery", () => {
  it("ends a failed lexical load and retries the unchanged question and Ask preview", async () => {
    submit("What is alpha 1?"); await fail();
    expect(text()).toContain("Search is unavailable");
    expect(text()).not.toContain("Loading the search index");
    retry(); await succeed();
    expect(text()).not.toMatch(/Search is unavailable|Loading the search index/);
    expect(askText()).toContain(docs[0].tldr);
    expect(askText()).not.toContain("Reading the records");
    expect(requests).toHaveLength(2);
  });

  it("recovers a non-question and keeps its kind filter", async () => {
    submit("alpha"); await fail(); retry(); await succeed();
    const filter = elements().find((node) => node.type === "button" && node.props.title === "Only term results")!;
    event(filter, "onClick"); retry(); await settle();
    expect(elements().find((node) => node.type === "button" && node.props.title === "Show every kind")?.props["aria-pressed"]).toBe(true);
    expect(resultIds()).toHaveLength(3);
    expect(text()).not.toMatch(/Search is unavailable|Loading the search index/);
  });

  it("restarts Ask when the same question recovers after an index failure", async () => {
    submit("What is alpha 1?"); await fail(); retry(); await succeed();
    expect(askText()).toContain(docs[0].tldr);
    expect(askText()).not.toContain("Reading the records");
  });

  it("hides the prior same-query answer while retrying", async () => {
    submit("What is alpha 1?"); await succeed();
    expect(askText()).toContain(docs[0].tldr);
    const next = deferred<AskResult>(); host.answer.mockReturnValueOnce(next.promise);
    retry(); await settle();
    expect(askText()).toContain("Reading the records");
    expect(askText()).not.toContain(docs[0].tldr);
    next.resolve(await host.answer.mock.results[0].value); await settle();
    expect(askText()).toContain(docs[0].tldr);
  });

  it("does not replace an A to B to A retry with the first A answer", async () => {
    const first = deferred<AskResult>(); host.answer.mockReturnValueOnce(first.promise);
    submit("What is alpha 1?"); await succeed();
    submit("What is beta 1?"); await settle();
    submit("What is alpha 1?"); await settle();
    expect(askText()).toContain(docs[0].tldr);
    const old = await host.answer.mock.results[1].value as AskResult;
    first.resolve({ ...old, sentences: [{ text: "Obsolete answer", cite: 1, field: "tldr", score: 1 }] }); await settle();
    expect(askText()).toContain(docs[0].tldr);
    expect(askText()).not.toContain("Obsolete answer");
  });

  it("ignores an obsolete concept result when the query returns to A", async () => {
    const first = deferred<SemanticIndex | null>(); host.semantic.mockReturnValueOnce(first.promise);
    submit("alpha"); await succeed();
    submit("beta"); await settle(); submit("alpha"); await settle();
    first.resolve(conceptIndex); await settle();
    expect(resultIds()).toHaveLength(3);
    expect(resultIds()).not.toContain("/terms/beta-1/");
  });

  it.each(["success", "failure"])("keeps a cleared query idle after late index %s", async (outcome) => {
    submit("What is alpha 1?"); submit("");
    if (outcome === "success") await succeed(); else await fail();
    expect(input().props.value).toBe("");
    expect(text()).not.toMatch(/Search is unavailable|Loading the search index|Reading the records/);
    expect(resultIds()).toHaveLength(0);
  });

  it("keeps word matches and settles Ask when optional indexes are unavailable", async () => {
    indexStatus = 503; host.semantic.mockResolvedValue(null);
    submit("What is alpha 1?"); await succeed();
    expect(askText()).toContain("That reads like a question");
    expect(askText()).not.toContain("Reading the records");
    expect(resultIds()).toHaveLength(6);
    expect(text()).toContain("showing word matches only");
  });

  it("settles an answer composition failure without losing word matches", async () => {
    host.answer.mockRejectedValueOnce(new Error("Answer fixture failure"));
    submit("What is alpha 1?"); await succeed();
    expect(askText()).toContain("That reads like a question");
    expect(resultIds()).toHaveLength(6);
    retry(); await settle();
    expect(askText()).toContain(docs[0].tldr);
  });
});
