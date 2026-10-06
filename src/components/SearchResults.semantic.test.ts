import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { buildSemanticIndex } from "@/lib/semantic";

// Only handler-driven state is needed here; native events and actual loaders are checked in the browser.
const host = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, semantic: vi.fn() }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: <T,>(initial: T) => {
    const i = host.cursor++; if (!(i in host.slots)) host.slots[i] = initial;
    return [host.slots[i], (next: T | ((value: T) => T)) => { host.slots[i] = typeof next === "function" ? (next as (value: T) => T)(host.slots[i] as T) : next; }];
  },
  useRef: <T,>(initial: T) => { const i = host.cursor++; return host.slots[i] ??= { current: initial }; },
  useMemo: <T,>(fn: () => T) => { host.cursor++; return fn(); },
  useCallback: <T,>(fn: T) => { host.cursor++; return fn; },
  useEffect: () => { host.cursor++; },
}));
vi.mock("next/link", () => ({ default: "a" }));
vi.mock("./MoleculeSlot", () => ({ MoleculeSlot: "molecule-slot" }));
vi.mock("@/lib/use-my-cancer", () => ({ useMyCancer: () => ({}), pickMyCancer: () => undefined, shortCancerName: (s: string) => s }));
vi.mock("@/lib/use-my-cancer-list", () => ({ useMyCancerList: () => [] }));
vi.mock("@/lib/semantic-client", () => ({ loadSemantic: host.semantic }));
vi.mock("@/lib/search-client", () => ({
  loadSearch: async () => ({ ms: { autoSuggest: () => [] }, byId: new Map(["alpha", "beta"].map((id) => [id, { id, name: id, kind: "term", route: `/terms/${id}/`, tldr: "Synthetic fixture" }])) }),
  searchRanked: () => [{ id: "alpha", match: { alpha: ["name"] } }], askLexical: () => [],
}));

type Props = { children?: ReactNode; [key: string]: unknown };
type Node = ReactElement<Props>;
const nodes = (node: ReactNode): Array<Node | string> => {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (typeof node === "string") return [node];
  return isValidElement<Props>(node) ? [node, ...nodes(node.props.children)] : [];
};
let Component: typeof import("./SearchResults").SearchResults;
let tree: ReactNode;
const draw = () => { host.cursor = 0; tree = Component(); };
const element = (type: string) => nodes(tree).find((n): n is Node => typeof n !== "string" && n.type === type)!;
const search = async () => {
  (element("input").props.onChange as (e: unknown) => void)({ target: { value: "alpha" } }); draw();
  (element("form").props.onSubmit as (e: unknown) => void)({ preventDefault() {} });
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setImmediate(resolve));
  draw();
};
const resultIds = () => {
  const list = nodes(tree).find((n): n is Node => typeof n !== "string" && n.props["aria-label"] === "Search results");
  return nodes(list).filter((n): n is Node => typeof n !== "string" && n.type === "a").map((n) => n.props.href);
};
const index = buildSemanticIndex([{ id: "beta", kind: "term", text: "alpha connection" }], { minDf: 1 });
beforeEach(async () => {
  vi.resetModules(); host.slots = []; host.cursor = 0; host.semantic.mockReset();
  Component = (await import("./SearchResults")).SearchResults; draw();
});
describe("concept fallback recovery on the search page", () => {
  it("retries a null concept result on unchanged-query submit and retains a successful index", async () => {
    host.semantic.mockResolvedValueOnce(null).mockResolvedValueOnce(index);
    await search(); expect(resultIds()).toEqual(["/terms/alpha/"]);
    await search(); expect(resultIds()).toEqual(["/terms/alpha/", "/terms/beta/"]);
    await search(); expect(host.semantic).toHaveBeenCalledTimes(2);
  });
  it("describes unavailable concepts without claiming that the deployment was not built", async () => {
    host.semantic.mockResolvedValue(null); await search();
    const text = nodes(tree).filter((n) => typeof n === "string").join(" ");
    expect(text).toContain("Concept search is unavailable; showing word matches only.");
    expect(text).not.toContain("not built");
  });
});
