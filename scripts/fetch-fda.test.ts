import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";
import { renderToStaticMarkup } from "react-dom/server";
import type { FdaSnapshot } from "./fetch-fda";

const fixture = vi.hoisted(() => ({ root: "", entity: { id: "fixturemed", kind: "drug", name: "Fixturemed", aka: [], regulatoryEvents: [] } }));
vi.mock("../src/lib/graph", () => ({ graph: () => ({ entities: [fixture.entity], get: (id: string) => id === fixture.entity.id ? fixture.entity : undefined }) }));
vi.mock("./feed-utils", async (original) => ({ ...await original<typeof import("./feed-utils")>(), publicPath: (...parts: string[]) => join(fixture.root, "public", ...parts) }));
vi.mock("../src/lib/feed-meta", async (original) => {
  const actual = await original<typeof import("../src/lib/feed-meta")>();
  return { ...actual, readPublicJson: (path: string) => actual.readPublicJson(path, fixture.root) };
});

const previous: FdaSnapshot = {
  fetched: "2026-09-01", window: { from: "2026-05-04", to: "2026-09-01" },
  sources: { oce: "https://example.invalid/oce", drugsfda: "https://example.invalid/drugsfda" }, errors: [],
  oce: [{ date: "2026-08-25", title: "Synthetic retained notice", url: "https://www.fda.gov/drugs/fixture", summary: "Fixturemed", drugIds: ["fixturemed"], cancerIds: [], firstSeen: "2026-09-01" }],
  drugsfda: [{ applicationNumber: "NDA-0", submissionType: "SUPPL", submissionNumber: "1", statusDate: "2026-08-25", classDescription: "Labeling", drugIds: ["fixturemed"], firstSeen: "2026-09-01" }],
  notInCorpus: [{ date: "2026-08-25", title: "Synthetic unmatched notice", url: "https://example.invalid/unmatched", firstSeen: "2026-09-01" }],
};
const html = (date = "09/20/2026") => `<table><tr><th>Webpage</th><th>Description</th><th>Date</th></tr><tr><td><a href="/drugs/fixture">Synthetic Fixturemed notice</a></td><td>Fixturemed fixture</td><td>${date}</td></tr></table>`;
const application = (i: number) => ({ application_number: `NDA-${i}`, products: [{ brand_name: "Fixturemed" }], submissions: [{ submission_type: "SUPPL", submission_number: "1", submission_status: "AP", submission_status_date: "20260920", submission_class_description: "Labeling" }] });
const page = (total: number, skip = 0) => ({ meta: { results: { total, skip, limit: 100 } }, results: Array.from({ length: Math.min(100, Math.max(0, total - skip)) }, (_, i) => application(skip + i)) });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const noMatches = () => json({ error: { code: "NOT_FOUND", message: "No matches found!" } }, 404);
let refresh: typeof import("./fetch-fda").refreshFda;
let output: string;
let before: string;
const requests: string[] = [];
function network(oce: () => Response = () => new Response(html()), drugs: (skip: number) => Response = () => json(page(1))) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => { requests.push(url); return url.includes("api.fda.gov") ? drugs(Number(new URL(url).searchParams.get("skip"))) : oce(); }));
}
async function run() {
  const promise = refresh();
  const outcome = promise.then(() => ({ error: undefined }), (error: Error) => ({ error }));
  await vi.runAllTimersAsync();
  return outcome;
}
const read = () => JSON.parse(readFileSync(output, "utf8")) as FdaSnapshot;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
  fixture.root = mkdtempSync(join(tmpdir(), "onco-fda-"));
  output = join(fixture.root, "public/fda/recent.json");
  mkdirSync(join(fixture.root, "public/fda"), { recursive: true });
  before = JSON.stringify(previous, null, 2) + "\n";
  writeFileSync(output, before);
  requests.length = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  refresh = (await import("./fetch-fda")).refreshFda;
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); rmSync(fixture.root, { recursive: true, force: true }); });

describe("complete FDA snapshot replacement", () => {
  it("retains prior bytes, rendered notices and date/status when both sources fail", async () => {
    network(() => new Response("blocked", { status: 503 }), () => new Response("blocked", { status: 503 }));
    expect((await run()).error).toBeDefined();
    expect(readFileSync(output, "utf8")).toBe(before);
    const { FdaFeed } = await import("../src/components/FdaFeed");
    const markup = renderToStaticMarkup(FdaFeed());
    expect(markup).toContain("Synthetic retained notice");
    expect(markup).toContain("2026-09-01");
    expect(markup).not.toContain("Every FDA oncology notice in the window matched");
    const { FEEDS, feedStatus } = await import("../src/lib/feed-meta");
    expect(feedStatus(FEEDS.find((f) => f.id === "fda")!, new Date(), fixture.root)).toMatchObject({ fetched: "2026-09-01", stale: true, count: 1 });
  });

  it("does not create a snapshot on a failed first run", async () => {
    rmSync(output); network(() => new Response("missing", { status: 404 }));
    expect((await run()).error).toBeDefined();
    expect(existsSync(output)).toBe(false);
  });

  it.each(["first page", "later page", "later no-match"])("retains all sources when openFDA fails on %s", async (which) => {
    network(undefined, (skip) => which === "first page" || skip > 0 ? (which === "later no-match" ? noMatches() : new Response("blocked", { status: 503 })) : json(page(101)));
    expect((await run()).error).toBeDefined();
    expect(readFileSync(output, "utf8")).toBe(before);
  });

  it.each([
    ["missing metadata", { results: [] }],
    ["missing rows", { meta: { results: { skip: 0, limit: 100, total: 1 } } }],
    ["short page", { ...page(101), results: [application(0)] }],
    ["incorrect offset", { ...page(1), meta: { results: { skip: 100, limit: 100, total: 1 } } }],
    ["invalid total", { ...page(1), meta: { results: { skip: 0, limit: 100, total: -1 } } }],
    ["page cap", page(3001)],
  ])("rejects incomplete openFDA data: %s", async (_label, body) => {
    network(undefined, () => json(body));
    expect((await run()).error).toBeDefined();
    expect(readFileSync(output, "utf8")).toBe(before);
  });

  it("rejects unparseable OCE HTML rather than declaring an empty window", async () => {
    network(() => new Response("<html>Temporarily unavailable</html>"));
    expect((await run()).error).toBeDefined();
    expect(readFileSync(output, "utf8")).toBe(before);
  });

  it.each(["changed total", "repeated application"])("rejects inconsistent pagination: %s", async (which) => {
    network(undefined, (skip) => !skip ? json(page(101)) : json(which === "changed total" ? page(102, skip) : { ...page(101, skip), results: [application(0)] }));
    expect((await run()).error).toBeDefined();
    expect(readFileSync(output, "utf8")).toBe(before);
  });

  it("replaces a complete multi-page snapshot and keeps firstSeen", async () => {
    network(undefined, (skip) => json(page(101, skip)));
    expect((await run()).error).toBeUndefined();
    expect(read()).toMatchObject({ fetched: "2026-10-06", previousFetched: previous.fetched, errors: [] });
    expect(read().drugsfda).toHaveLength(101);
    expect(read().oce[0].firstSeen).toBe("2026-09-01");
    expect(read().drugsfda.find((d) => d.applicationNumber === "NDA-0")?.firstSeen).toBe("2026-09-01");
    expect(read().drugsfda.find((d) => d.applicationNumber === "NDA-100")?.firstSeen).toBe("2026-10-06");
  });

  it.each(["200", "404 no-match"])("publishes a genuinely empty window: %s", async (response) => {
    network(() => new Response(html("01/01/2020")), () => response === "200" ? json(page(0)) : noMatches());
    expect((await run()).error).toBeUndefined();
    expect(read()).toMatchObject({ fetched: "2026-10-06", oce: [], drugsfda: [], notInCorpus: [], errors: [] });
  });

  it("creates the first snapshot only after both sources complete", async () => {
    rmSync(output); network();
    expect((await run()).error).toBeUndefined();
    expect(read().previousFetched).toBeUndefined();
    expect(read().oce).toHaveLength(1);
    expect(read().drugsfda).toHaveLength(1);
    expect(read().oce[0].firstSeen).toBe("2026-10-06");
  });

  it("does not mistake another 404 response for an empty search", async () => {
    network(undefined, () => json({ error: { code: "NOT_FOUND", message: "Unknown endpoint" } }, 404));
    expect((await run()).error).toBeDefined();
    expect(readFileSync(output, "utf8")).toBe(before);
  });

  it("exits the real CLI nonzero on failure without changing the snapshot", async () => {
    vi.useRealTimers();
    const script = join(fixture.root, "fetch-fda.ts");
    await build({ entryPoints: [resolve("scripts/fetch-fda.ts")], outfile: script, bundle: true, platform: "node", format: "cjs", logLevel: "silent",
      banner: { js: "global.fetch = async () => new Response('offline fixture', { status: 404 });" },
      plugins: [{ name: "synthetic-graph", setup(builder) {
        builder.onResolve({ filter: /^\.\.\/src\/lib\/graph$/ }, () => ({ path: "graph", namespace: "fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const graph = () => ({ entities: [], get: () => undefined });", loader: "js" }));
      } }],
    });
    const result = spawnSync(process.execPath, [script], { cwd: fixture.root, encoding: "utf8", timeout: 10_000 });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/FDA|snapshot/i);
    expect(readFileSync(output, "utf8")).toBe(before);
  });
});
