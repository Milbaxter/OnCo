import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import type { AskResult } from "@/lib/ask-pipeline";

// Handler tests isolate request ordering; the actual loaders/pipeline are covered separately and in the browser.
const host = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as Array<() => void>, answer: vi.fn() }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: <T,>(initial: T) => {
    const i = host.cursor++;
    if (!(i in host.slots)) host.slots[i] = initial;
    return [host.slots[i], (next: T | ((value: T) => T)) => { host.slots[i] = typeof next === "function" ? (next as (v: T) => T)(host.slots[i] as T) : next; }];
  },
  useRef: <T,>(initial: T) => { const i = host.cursor++; return host.slots[i] ??= { current: initial }; },
  useCallback: <T,>(fn: T) => { const i = host.cursor++; return host.slots[i] ??= fn; },
  useEffect: (fn: () => void | (() => void), deps: unknown[]) => {
    const i = host.cursor++;
    const prior = host.slots[i] as { deps: unknown[]; cleanup?: () => void } | undefined;
    if (!prior || deps.some((d, j) => !Object.is(d, prior.deps[j]))) {
      host.effects.push(() => { prior?.cleanup?.(); host.slots[i] = { deps, cleanup: fn() }; });
    }
  },
}));
vi.mock("next/link", () => ({ default: "a" }));
vi.mock("@/lib/i18n/ui", () => ({ useT: () => ({ kind: () => undefined }) }));
vi.mock("@/lib/region", () => ({ useRegion: () => ({ region: null }) }));
vi.mock("@/lib/search-client", () => ({ loadSearch: async () => ({ ms: {} }), askLexical: () => [] }));
vi.mock("@/lib/semantic-client", () => ({ loadSemantic: async () => null }));
vi.mock("@/lib/ask-index", () => ({ loadAskIndex: async () => ({ version: 1, entries: [], pairs: [] }) }));
vi.mock("@/lib/ask-pipeline", () => ({ answerQuestion: host.answer }));

type Props = { children?: ReactNode; [key: string]: unknown };
type Node = ReactElement<Props>;
const deferred = () => {
  let resolve!: (value: AskResult) => void; let reject!: (error: Error) => void;
  const promise = new Promise<AskResult>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const result = (note: string) => ({ note, entities: [], sentences: [], sources: [], readMore: [], followUps: [], alternates: [], consulted: [], confidence: "low", method: "Synthetic ordering fixture" } as unknown as AskResult);
let Component: typeof import("./AskOnco").AskOnco;
let tree: ReactNode;
const draw = () => { host.cursor = 0; tree = Component({ examples: [] }); host.effects.splice(0).forEach((fn) => fn()); };
const nodes = (node: ReactNode): Array<Node | string> => {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (typeof node === "string") return [node];
  return isValidElement<Props>(node) ? [node, ...nodes(node.props.children)] : [];
};
const element = (type: string) => nodes(tree).find((n): n is Node => typeof n !== "string" && n.type === type)!;
const text = () => nodes(tree).filter((n) => typeof n === "string").join(" ");
const settle = async () => { for (let i = 0; i < 3; i++) await new Promise((resolve) => setImmediate(resolve)); draw(); };
const submit = async (q: string) => {
  (element("input").props.onChange as (e: unknown) => void)({ target: { value: q } }); draw();
  (element("form").props.onSubmit as (e: unknown) => void)({ preventDefault() {} }); draw();
  await settle();
};
beforeEach(async () => {
  vi.resetModules(); host.slots = []; host.cursor = 0; host.effects = []; host.answer.mockReset();
  vi.stubGlobal("requestAnimationFrame", () => 1); vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("window", { history: { replaceState() {} }, location: { search: "", pathname: "/ask/" } });
  Component = (await import("./AskOnco")).AskOnco; draw();
});
afterEach(() => vi.unstubAllGlobals());

describe("Ask request outcomes", () => {
  it("shows a current error and allows the same question to succeed on retry", async () => {
    host.answer.mockRejectedValueOnce(new Error("Synthetic record unavailable")).mockResolvedValueOnce(result("Recovered answer"));
    await submit("What is Alpha?"); expect(text()).toContain("Synthetic record unavailable");
    await submit("What is Alpha?"); expect(text()).toContain("Recovered answer"); expect(text()).not.toContain("unavailable");
  });
  it("does not replace a newer answer with an older failed request", async () => {
    const old = deferred(); host.answer.mockReturnValueOnce(old.promise).mockResolvedValueOnce(result("Current Beta answer"));
    await submit("What is Alpha?"); await submit("What is Beta?");
    old.reject(new Error("Old unavailable")); await settle();
    expect(text()).toContain("Current Beta answer"); expect(text()).not.toContain("Old unavailable");
  });
  it("invalidates an older failure when the question is cleared", async () => {
    const old = deferred(); host.answer.mockReturnValueOnce(old.promise);
    await submit("What is Alpha?"); await submit(""); old.reject(new Error("Old unavailable")); await settle();
    expect(text()).not.toContain("Old unavailable"); expect(text()).not.toContain("Loading indexes");
  });
  it("keeps the newest answer when queries change A to B to A", async () => {
    const old = deferred(); host.answer.mockReturnValueOnce(old.promise).mockResolvedValueOnce(result("Beta answer")).mockResolvedValueOnce(result("Current Alpha answer"));
    await submit("What is Alpha?"); await submit("What is Beta?"); await submit("What is Alpha?");
    old.resolve(result("Obsolete Alpha answer")); await settle();
    expect(text()).toContain("Current Alpha answer"); expect(text()).not.toContain("Obsolete Alpha answer");
  });
});
