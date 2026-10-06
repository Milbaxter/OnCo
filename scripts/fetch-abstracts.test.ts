import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";
import type { AbstractsSnapshot } from "./fetch-abstracts";

type ResponseFixture = { status?: number; body?: unknown; raw?: string; network?: boolean };
const previous = JSON.stringify({ fetched: "2026-09-01", congress: { id: "asco", year: 2026 }, items: [{ doi: "10.0000/retained", title: "Retained synthetic abstract", lba: true }], errors: [] }, null, 2) + "\n";
const work = (i: number, accepted = true) => ({ DOI: `10.0000/fixture-${i}`, title: [accepted ? `Fixturemed synthetic abstract ${i}` : `Unmatched regular paper ${i}`], issue: accepted ? "16_suppl" : "1" });
const firstPage = (accepted = 25): ResponseFixture => ({ body: { message: { "total-results": 1001, "next-cursor": "page-two", items: Array.from({ length: 1000 }, (_, i) => work(i, i < accepted)) } } });
const lastPage: ResponseFixture = { body: { message: { "total-results": 1001, items: [{ ...work(1000), title: ["LBA99 Fixturemed later-page abstract"] }] } } };
const empty: ResponseFixture = { body: { message: { "total-results": 0, items: [] } } };
let root: string, cwd: string, script: string, output: string;
let sequence = 0;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "onco-abstracts-command-")); script = join(root, "fetch-abstracts.cjs");
  // Run the real command, request helpers and matcher with a small graph and offline cursor responses.
  await build({ entryPoints: [resolve("scripts/fetch-abstracts.ts")], outfile: script, bundle: true, platform: "node", format: "cjs", logLevel: "silent",
    banner: { js: `
const fixtureFs = require('node:fs');
const fixtureResponses = JSON.parse(fixtureFs.readFileSync('responses.json', 'utf8'));
const fixtureRequests = [];
const OriginalDate = Date;
global.Date = class extends OriginalDate { constructor(...args) { super(...(args.length ? args : ['2026-10-06T12:00:00Z'])); } };
const originalTimeout = global.setTimeout;
global.setTimeout = (f, ms, ...args) => originalTimeout(f, 0, ...args);
global.fetch = async (url) => {
  const u = new URL(url);
  if (u.origin !== 'https://api.crossref.org' || !u.pathname.endsWith('/works')) throw Error('Unexpected fixture URL: ' + url);
  const response = fixtureResponses[fixtureRequests.length];
  fixtureRequests.push({ cursor: u.searchParams.get('cursor'), filter: u.searchParams.get('filter'), rows: u.searchParams.get('rows') });
  fixtureFs.writeFileSync('requests.json', JSON.stringify(fixtureRequests));
  if (!response) throw Error('Unexpected extra fixture request');
  if (response.network) throw Error('Synthetic network failure');
  return new Response(response.raw ?? JSON.stringify(response.body ?? {}), { status: response.status ?? 200 });
};` },
    plugins: [{ name: "synthetic-graph", setup(builder) {
      builder.onResolve({ filter: /^\.\.\/src\/lib\/graph$/ }, () => ({ path: "graph", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "js", contents: `const entity = { id: 'fixturemed', kind: 'drug', name: 'Fixturemed', aka: [] }; export const graph = () => ({ entities: [entity], get: id => id === entity.id ? entity : undefined });` }));
    } }],
  });
});
beforeEach(() => {
  cwd = join(root, String(sequence++)); mkdirSync(join(cwd, "public/digests"), { recursive: true });
  output = join(cwd, "public/digests/candidates.json"); writeFileSync(output, previous);
});
afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

function run(responses: ResponseFixture[], args = ["--congress=asco", "--year=2026"]) {
  writeFileSync(join(cwd, "responses.json"), JSON.stringify(responses));
  return spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8", timeout: 10_000 });
}
const snapshot = () => JSON.parse(readFileSync(output, "utf8")) as AbstractsSnapshot;
const requests = () => JSON.parse(readFileSync(join(cwd, "requests.json"), "utf8")) as Array<{ cursor: string; filter: string; rows: string }>;
function expectFailure(result: ReturnType<typeof run>, page: number) {
  expect(result.status).toBe(1); expect(result.stderr).toContain(`Crossref page ${page} failed`);
  expect(readFileSync(output, "utf8")).toBe(previous);
}

describe("congress abstract harvest publication", () => {
  const failures: Array<[string, ResponseFixture[]]> = [
    ["HTTP 503 after retries", Array.from({ length: 4 }, () => ({ status: 503 }))],
    ["HTTP 404", [{ status: 404 }]],
    ["network failure after retries", Array.from({ length: 4 }, () => ({ network: true }))],
    ["undecodable response", [{ raw: "not JSON" }]],
  ];
  it.each(failures)("preserves prior bytes and date after first-page %s", (_label, failure) => {
    expectFailure(run(failure), 1); expect(requests()).toHaveLength(failure.length);
  });
  it.each(failures)("does not publish partial results after later-page %s", (_label, failure) => {
    expectFailure(run([firstPage(), ...failure]), 2);
    expect(requests().map((r) => r.cursor)).toEqual(["*", ...failure.map(() => "page-two")]);
  });
  it.each([true, false])("creates no snapshot on a failed first refresh (later page: %s)", (later) => {
    rmSync(output);
    const result = run([...(later ? [firstPage()] : []), { status: 404 }]);
    expect(result.status).toBe(1); expect(existsSync(output)).toBe(false);
  });
  it.each([25, 1])("stops default selection after failure with %i accepted abstracts", (accepted) => {
    const result = run([firstPage(accepted), { status: 404 }], []);
    expectFailure(result, 2); expect(requests()).toHaveLength(2);
    expect(requests().every((r) => r.filter.includes("2026-09-01"))).toBe(true);
  });
  it("publishes healthy cursor pages and keeps later-page late-breaking priority", () => {
    const result = run([firstPage(), lastPage]);
    expect(result.status).toBe(0); expect(snapshot()).toMatchObject({ fetched: "2026-10-06", considered: 26, matched: 26, errors: [] });
    expect(snapshot().items).toHaveLength(26); expect(snapshot().items[0].title).toBe("LBA99 Fixturemed later-page abstract");
    expect(requests().map((r) => [r.cursor, r.rows])).toEqual([["*", "1000"], ["page-two", "1000"]]);
  });
  it("publishes after a transient page failure recovers within the existing retry policy", () => {
    const result = run([firstPage(), { status: 503 }, lastPage]);
    expect(result.status).toBe(0); expect(snapshot().items).toHaveLength(26); expect(snapshot().errors).toEqual([]);
    expect(requests().map((r) => r.cursor)).toEqual(["*", "page-two", "page-two"]);
  });
  it("publishes genuine empty results for an explicit congress", () => {
    expect(run([empty]).status).toBe(0);
    expect(snapshot()).toMatchObject({ fetched: "2026-10-06", total: 0, considered: 0, matched: 0, items: [], errors: [] });
  });
  it("falls back from a healthy empty recent congress to a healthy previous congress", () => {
    expect(run([empty, firstPage(), lastPage], []).status).toBe(0);
    expect(snapshot().congress.id).toBe("asco"); expect(snapshot().items).toHaveLength(26);
    expect(requests().map((r) => r.filter)).toEqual(["from-pub-date:2026-09-01,until-pub-date:2026-11-15", "from-pub-date:2026-05-10,until-pub-date:2026-06-20", "from-pub-date:2026-05-10,until-pub-date:2026-06-20"]);
  });
  it("preserves the existing healthy empty fallback across three windows", () => {
    expect(run([empty, empty, empty], []).status).toBe(0);
    expect(requests()).toHaveLength(3); expect(snapshot()).toMatchObject({ congress: { id: "sabcs" }, items: [], errors: [] });
  });
});
