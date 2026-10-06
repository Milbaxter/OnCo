import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSemanticIndex, encodeSemanticIndex } from "./semantic";

const wire = encodeSemanticIndex(buildSemanticIndex([{ id: "fixture", kind: "term", text: "alpha fixture" }], { minDf: 1 }));
const good = (url: string) => new Response(url.endsWith(".json") ? JSON.stringify(wire.meta) : Uint8Array.from(wire.bin).buffer);
let load: typeof import("./semantic-client").loadSemantic;
const fetcher = vi.fn<typeof fetch>();
beforeEach(async () => {
  vi.resetModules(); fetcher.mockReset(); vi.stubGlobal("fetch", fetcher);
  load = (await import("./semantic-client")).loadSemantic;
});
afterEach(() => vi.unstubAllGlobals());

describe("concept index cache", () => {
  it("shares pending requests and retains a decoded index", async () => {
    const pending: Array<() => void> = [];
    fetcher.mockImplementation((url) => new Promise((resolve) => pending.push(() => resolve(good(String(url))))));
    const first = load(); expect(load()).toBe(first); expect(fetcher).toHaveBeenCalledTimes(2);
    pending.forEach((resolve) => resolve());
    expect((await first)?.ids).toEqual(["fixture"]); expect(load()).toBe(first);
  });

  it.each([[404, 200], [200, 404], [404, 404]])("caches absent files (%i, %i)", async (meta, bin) => {
    fetcher.mockImplementation(async (url) => {
      const status = String(url).endsWith(".json") ? meta : bin;
      return status === 200 ? good(String(url)) : new Response("not built", { status });
    });
    const first = load(); expect(await first).toBeNull(); expect(load()).toBe(first);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([[503, 200], [200, 503], [404, 503], [503, 404], [429, 200]])("retries operational responses (%i, %i), even beside a missing file", async (meta, bin) => {
    fetcher.mockImplementationOnce(async () => new Response("fixture", { status: meta }))
      .mockImplementationOnce(async () => new Response("fixture", { status: bin }));
    expect(await load()).toBeNull();
    fetcher.mockImplementation(async (url) => good(String(url)));
    expect((await load())?.ids).toEqual(["fixture"]); expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it.each(["network", "json", "binary"])("evicts a %s failure without rejecting callers", async (failure) => {
    fetcher.mockImplementation(async (url) => {
      if (String(url).endsWith(".json")) {
        if (failure === "network") throw new Error("Offline fixture");
        if (failure === "json") return new Response("{broken");
      } else if (failure === "binary") return new Response(new Uint8Array([1]));
      return good(String(url));
    });
    expect(await load()).toBeNull();
    fetcher.mockImplementation(async (url) => good(String(url)));
    expect((await load())?.ids).toEqual(["fixture"]); expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("does not let a late failed sibling disturb the successful retry cache", async () => {
    let rejectOld!: (error: Error) => void;
    fetcher.mockRejectedValueOnce(new Error("First endpoint failed"))
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; }))
      .mockImplementation(async (url) => good(String(url)));
    expect(await load()).toBeNull();
    const retry = load(); expect((await retry)?.ids).toEqual(["fixture"]);
    rejectOld(new Error("Old sibling failed later")); await Promise.resolve();
    expect(load()).toBe(retry); expect(fetcher).toHaveBeenCalledTimes(4);
  });
});
