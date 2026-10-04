import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { refreshTrials } from "./fetch-trials";

// Refresh behavior does not depend on the corpus and tests must never start a live fetch.
vi.mock("../src/lib/graph", () => ({ graph: vi.fn(() => { throw new Error("unexpected graph access"); }) }));

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const oldEntry = { query: "Alpha", total: 2, byPhase: { PHASE3: 2 }, byStatus: { RECRUITING: 2 }, recruiting: 2, fetched: "2026-09-01" };
const products = [{ id: "alpha", name: "Alpha" }, { id: "beta", name: "Beta" }];
const emptyResponse = { totalCount: 0, studies: [] };
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "onco-trial-refresh-"));
  directories.push(directory);
  writeFileSync(join(directory, "index.json"), JSON.stringify({ alpha: oldEntry, beta: { ...oldEntry, query: "Beta" }, retired: oldEntry }));
  writeFileSync(join(directory, "alpha.json"), JSON.stringify({ drugId: "alpha", query: "Alpha", fetched: oldEntry.fetched, total: 2, studies: [] }));
  return directory;
}
const readIndex = (directory: string) => JSON.parse(readFileSync(join(directory, "index.json"), "utf8"));
const pause = async () => {};

describe("trial refresh preserves the last successful snapshot", () => {
  it("retains an unavailable product in a full refresh while replacing successful entries", async () => {
    const directory = fixture();
    const snapshot = readFileSync(join(directory, "alpha.json"), "utf8");
    await refreshTrials(products, { directory, pause, request: async (url) => url.includes("Alpha") ? null : emptyResponse });
    const index = readIndex(directory);
    expect(index.alpha).toEqual(oldEntry);
    expect(readFileSync(join(directory, "alpha.json"), "utf8")).toBe(snapshot);
    expect(index.beta.total).toBe(0); // a successful empty result really does replace the old data
    expect(index.beta.fetched).not.toBe(oldEntry.fetched);
    expect(index.retired).toBeUndefined(); // removed corpus products do not survive a full refresh
  });

  it("does not discard any available product when every request fails", async () => {
    const directory = fixture();
    await refreshTrials(products, { directory, pause, request: async () => null });
    expect(readIndex(directory)).toEqual({ alpha: oldEntry, beta: { ...oldEntry, query: "Beta" } });
  });

  it("leaves other products alone for a targeted refresh", async () => {
    const directory = fixture();
    const request = vi.fn(async () => emptyResponse);
    await refreshTrials(products, { directory, only: "beta", pause, request });
    expect(request).toHaveBeenCalledTimes(1);
    expect(readIndex(directory).alpha).toEqual(oldEntry);
    expect(readIndex(directory).retired).toEqual(oldEntry);
    expect(readIndex(directory).beta.total).toBe(0);
  });
});
