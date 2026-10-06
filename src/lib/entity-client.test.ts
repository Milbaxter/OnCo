import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { answerQuestion } from "./ask-pipeline";
import type { AskEntityRecord } from "./ask-compose";

const record: AskEntityRecord = {
  entity: { id: "alpha-fixture", kind: "term", name: "Alpha fixture", tldr: "A synthetic browser loader fixture.", summary: "A synthetic browser loader fixture." },
  route: "/terms/alpha-fixture/", neighbours: {},
};
let load: typeof import("./entity-client").loadEntityRecord;
const fetchMock = vi.fn<typeof fetch>();
beforeEach(async () => {
  vi.resetModules(); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock);
  load = (await import("./entity-client")).loadEntityRecord;
});
afterEach(() => vi.unstubAllGlobals());
const good = () => new Response(JSON.stringify(record));

describe("browser entity loading", () => {
  it.each([403, 429, 500, 503])("rejects HTTP %s and fetches again after recovery", async (status) => {
    fetchMock.mockResolvedValueOnce(new Response("Synthetic failure", { status })).mockResolvedValueOnce(good());
    await expect(load(record.entity.id)).rejects.toThrow(String(status));
    await expect(load(record.entity.id)).resolves.toEqual(record);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it.each(["network", "json"])("does not cache a %s failure as a missing record", async (mode) => {
    if (mode === "network") fetchMock.mockRejectedValueOnce(new Error("Offline fixture"));
    else fetchMock.mockResolvedValueOnce(new Response("{malformed"));
    fetchMock.mockResolvedValueOnce(good());
    await expect(load(record.entity.id)).rejects.toThrow();
    await expect(load(record.entity.id)).resolves.toEqual(record);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("keeps genuine 404s distinct and caches them", async () => {
    fetchMock.mockResolvedValue(new Response("Missing fixture", { status: 404 }));
    await expect(load("missing")).resolves.toBeNull();
    await expect(load("missing")).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("shares concurrent work and retains a successful record", async () => {
    fetchMock.mockResolvedValue(good());
    const first = load(record.entity.id); const second = load(record.entity.id);
    expect(first).toBe(second);
    await expect(first).resolves.toEqual(record);
    expect(load(record.entity.id)).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("evicts a shared rejected request so both consumers can retry", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Shared offline fixture")).mockResolvedValueOnce(good());
    const first = load(record.entity.id); const second = load(record.entity.id);
    expect(first).toBe(second);
    const results = await Promise.allSettled([first, second]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    await expect(load(record.entity.id)).resolves.toEqual(record);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("rejects the actual answer pipeline on a failed record and answers after recovery", async () => {
    const index = { version: 1 as const, entries: [{ id: record.entity.id, kind: record.entity.kind, name: record.entity.name, aliases: [record.entity.name], route: record.route }], pairs: [] };
    const deps = { index, lexical: () => [record.entity.id], concept: () => [], load };
    fetchMock.mockResolvedValueOnce(new Response("Unavailable fixture", { status: 503 })).mockResolvedValueOnce(good());
    await expect(answerQuestion("What is Alpha fixture?", deps)).rejects.toThrow("503");
    const result = await answerQuestion("What is Alpha fixture?", deps);
    expect(result.sentences.length).toBeGreaterThan(0);
    expect(result.sources.map((s) => s.id)).toContain(record.entity.id);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
