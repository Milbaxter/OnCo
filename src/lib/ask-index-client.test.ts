import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const wire = { version: 1, kinds: ["term"], rows: [["fixture", 0, "Fixture", []]], pairs: [] };
const healthy = () => new Response(JSON.stringify(wire), { status: 200, headers: { "Content-Type": "application/json" } });
let loadAskIndex: typeof import("./ask-index").loadAskIndex;

beforeEach(async () => { vi.resetModules(); loadAskIndex = (await import("./ask-index")).loadAskIndex; });
afterEach(() => { vi.unstubAllGlobals(); });

describe("browser Ask index cache", () => {
  it("shares in-flight requests and caches a successful decoded index", async () => {
    let complete!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => { complete = resolve; }));
    vi.stubGlobal("fetch", fetcher);
    const first = loadAskIndex(), second = loadAskIndex();
    expect(second).toBe(first); expect(fetcher).toHaveBeenCalledTimes(1);
    complete(healthy());
    expect(await first).toMatchObject({ entries: [{ id: "fixture", name: "Fixture", route: "/terms/fixture/" }] });
    expect(loadAskIndex()).toBe(first); expect(fetcher).toHaveBeenCalledWith("/api/v1/ask-index.json");
  });

  it("keeps genuine 404 missing-build results cached as null", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("not built", { status: 404 })).mockImplementation(async () => healthy());
    vi.stubGlobal("fetch", fetcher);
    const first = loadAskIndex();
    expect(await first).toBeNull(); expect(loadAskIndex()).toBe(first); expect(await loadAskIndex()).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([403, 429, 500, 503])("allows retry after HTTP %s without changing the null-return interface", async (status) => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("temporary failure", { status })).mockImplementation(async () => healthy());
    vi.stubGlobal("fetch", fetcher);
    const first = loadAskIndex();
    expect(loadAskIndex()).toBe(first); expect(await first).toBeNull();
    const retry = loadAskIndex();
    expect(retry).not.toBe(first); expect(await retry).toMatchObject({ entries: [{ id: "fixture" }] });
    expect(loadAskIndex()).toBe(retry); expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["network error", () => Promise.reject(new Error("offline fixture"))],
    ["malformed JSON", () => Promise.resolve(new Response("{bad", { status: 200 }))],
    ["undecodable object", () => Promise.resolve(new Response("{}", { status: 200 }))],
    ["null body", () => Promise.resolve(new Response("null", { status: 200 }))],
  ] as const)("evicts a failed load after %s", async (_label, failure) => {
    const fetcher = vi.fn().mockImplementationOnce(failure).mockImplementation(async () => healthy());
    vi.stubGlobal("fetch", fetcher);
    expect(await loadAskIndex()).toBeNull();
    expect(await loadAskIndex()).toMatchObject({ entries: [{ id: "fixture" }] });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
