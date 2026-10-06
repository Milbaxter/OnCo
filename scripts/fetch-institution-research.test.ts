import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";
import type { InstitutionResearch, ResearchIndex, ResearchIndexRow } from "../src/lib/research";

const previous: InstitutionResearch = { institutionId: "fixture-institution", openalexId: "I0000000", openalexName: "Synthetic Research Institute", ror: null, confidence: "override", fetched: "2026-09-01", years: [2022, 2026], works: 100, cited: 500, byYear: { 2022: 20, 2023: 20, 2024: 20, 2025: 20, 2026: 20 }, openAccess: 60, clinicalTrials: 10, reviews: 20, topWorks: [{ id: "W0000000", title: "Retained synthetic research paper", doi: null, year: 2025, journal: null, cited: 50, type: "article", oaUrl: null }], topAuthors: [{ id: "A0000000", name: "Synthetic Author", works: 20 }] };
const previousBytes = JSON.stringify(previous, null, 2) + "\n";
const previousRow: ResearchIndexRow = { openalexId: previous.openalexId, openalexName: previous.openalexName, confidence: previous.confidence, works: previous.works, cited: previous.cited, byYear: previous.byYear, openAccess: previous.openAccess, clinicalTrials: previous.clinicalTrials, reviews: previous.reviews };
const required = ["year", "review", "oa", "authors", "trials", "top"];
const secondary = ["review", "oa", "authors", "trials"];
let root: string, cwd: string, script: string, output: string, indexPath: string;
let sequence = 0;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "onco-institution-research-command-")); script = join(root, "fetch-research.cjs");
  // Run the real command with a tiny graph, offline responses and its /tmp cache confined to each fixture.
  await build({ entryPoints: [resolve("scripts/fetch-institution-research.ts")], outfile: script, bundle: true, platform: "node", format: "cjs", logLevel: "silent",
    banner: { js: `
const fixtureFs = require('node:fs'), fixturePath = require('node:path');
const fixture = JSON.parse(fixtureFs.readFileSync('fixture.json', 'utf8')), fixtureRequests = [];
for (const fn of ['existsSync', 'mkdirSync', 'readFileSync', 'writeFileSync']) {
  const native = fixtureFs[fn];
  fixtureFs[fn] = (p, ...args) => native(typeof p === 'string' && p.startsWith('/tmp/onco-openalex-research') ? fixturePath.join(process.cwd(), 'cache', p.slice('/tmp/onco-openalex-research'.length)) : p, ...args);
}
const OriginalDate = Date;
global.Date = class extends OriginalDate { constructor(...args) { super(...(args.length ? args : ['2026-10-06T12:00:00Z'])); } static now() { return OriginalDate.parse('2026-10-06T12:00:00Z'); } };
const originalTimeout = global.setTimeout;
global.setTimeout = (f, ms, ...args) => originalTimeout(f, 0, ...args);
global.fetch = async (url) => {
  const u = new URL(url);
  if (u.origin !== 'https://api.openalex.org' || u.pathname !== '/works') throw Error('Unexpected fixture URL: ' + url);
  const group = u.searchParams.get('group_by');
  const kind = group === 'publication_year' ? 'year' : group === 'type' ? 'review' : group === 'open_access.is_oa' ? 'oa' : group === 'authorships.author.id' ? 'authors' : u.searchParams.has('sort') ? 'top' : 'trials';
  fixtureRequests.push(kind); fixtureFs.writeFileSync('requests.json', JSON.stringify(fixtureRequests));
  if (fixture.failed === kind && (!fixture.once || fixtureRequests.filter(k => k === kind).length === 1)) {
    if (fixture.network) throw Error('Synthetic network failure');
    return new Response('temporary', { status: fixture.status ?? 503, headers: fixture.headers });
  }
  const zero = fixture.zero;
  const responses = {
    year: { meta: { count: zero ? 0 : 100 }, group_by: zero ? [] : [2022, 2023, 2024, 2025, 2026].map(y => ({ key: String(y), key_display_name: String(y), count: 20 })) },
    review: { meta: { count: zero ? 0 : 100 }, group_by: zero ? [] : [{ key: 'review', key_display_name: 'review', count: 20 }] },
    oa: { meta: { count: zero ? 0 : 100 }, group_by: zero ? [] : [{ key: 'true', key_display_name: 'true', count: 60 }] },
    authors: { meta: { count: zero ? 0 : 100 }, group_by: zero ? [] : [{ key: 'https://openalex.org/A0000000', key_display_name: 'Synthetic Author', count: 20 }] },
    trials: { meta: { count: zero ? 0 : 10 }, results: zero ? [] : [{ id: 'https://openalex.org/W0000000' }] },
    top: { meta: { count: zero ? 0 : 100, cited_by_count_sum: zero ? 0 : 500 }, results: zero ? [] : [{ id: 'https://openalex.org/W0000000', doi: null, title: 'New synthetic research paper', publication_year: 2026, cited_by_count: 50, type: 'article' }] },
  };
  return Response.json(responses[kind]);
};` },
    plugins: [{ name: "synthetic-graph", setup(builder) {
      builder.onResolve({ filter: /^\.\.\/src\/lib\/graph$/ }, () => ({ path: "graph", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "js", contents: `const entity = { id: 'fixture-institution', kind: 'institution', name: 'Synthetic Research Institute', aka: [], country: 'US' }; export const graph = () => ({ kind: kind => kind === 'institution' ? [entity] : [] });` }));
    } }],
  });
});
beforeEach(() => {
  cwd = join(root, String(sequence++)); mkdirSync(join(cwd, "public/openalex/research"), { recursive: true });
  output = join(cwd, "public/openalex/research/fixture-institution.json"); indexPath = join(cwd, "public/openalex/research-index.json");
  writeFileSync(output, previousBytes);
  writeFileSync(indexPath, JSON.stringify({ fetched: "2026-09-01", source: "https://openalex.org", license: "CC0", subfield: 2730, years: [2022, 2026], institutions: { "fixture-institution": previousRow }, unresolved: {} }));
  writeFileSync(join(cwd, "public/openalex/institutions.json"), JSON.stringify({ institutions: { "fixture-institution": { openalexId: previous.openalexId, openalexName: previous.openalexName } } }));
});
afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

function run(fixture: { failed?: string; status?: number; network?: boolean; once?: boolean; zero?: boolean; headers?: Record<string, string> } = {}, args = ["--force", "--budget=100"]) {
  writeFileSync(join(cwd, "fixture.json"), JSON.stringify(fixture)); writeFileSync(join(cwd, "requests.json"), "[]");
  return spawnSync(process.execPath, [script, "--only=fixture-institution", ...args], { cwd, encoding: "utf8", timeout: 10_000, env: { ...process.env, OPENALEX_API_KEY: "" } });
}
const snapshot = () => JSON.parse(readFileSync(output, "utf8")) as InstitutionResearch;
const index = () => JSON.parse(readFileSync(indexPath, "utf8")) as ResearchIndex;
const requests = () => JSON.parse(readFileSync(join(cwd, "requests.json"), "utf8")) as string[];
function expectRetained(result: ReturnType<typeof run>) {
  // Retention does not alter the existing aggregate run date or successful-process exit policy.
  expect(result.status).toBe(0); expect(result.stdout).toContain("0 written this run");
  expect(readFileSync(output, "utf8")).toBe(previousBytes);
  expect(index().institutions["fixture-institution"]).toEqual(previousRow); expect(index().fetched).toBe("2026-10-06");
}

describe("institution research request retention", () => {
  it.each(required)("retains the entire institution after %s exhausts HTTP retries", (failed) => {
    const result = run({ failed }); expectRetained(result); expect(result.stdout).toContain("works query failed");
    expect(requests().filter((k) => k === failed)).toHaveLength(6);
  });
  it.each(secondary)("retains the entire institution after %s exhausts network retries", (failed) => {
    expectRetained(run({ failed, network: true })); expect(requests().filter((k) => k === failed)).toHaveLength(6);
  });
  it.each(secondary)("creates no first institution snapshot when %s fails", (failed) => {
    rmSync(output); const result = run({ failed, status: 403 });
    expect(result.status).toBe(0); expect(existsSync(output)).toBe(false); expect(index().institutions).toEqual({});
    expect(index().unresolved["fixture-institution"]).toBe("works query failed (checked 2026-10-06)");
  });
  it("publishes a healthy complete snapshot with optional work metadata absent", () => {
    expect(run().status).toBe(0); expect(requests()).toEqual(required);
    expect(snapshot()).toMatchObject({ fetched: "2026-10-06", works: 100, openAccess: 60, clinicalTrials: 10, reviews: 20, topAuthors: previous.topAuthors, topWorks: [{ title: "New synthetic research paper", journal: null, doi: null }] });
  });
  it("publishes genuine empty groups and zero counts", () => {
    expect(run({ zero: true }).status).toBe(0);
    expect(snapshot()).toMatchObject({ fetched: "2026-10-06", works: 0, cited: 0, openAccess: 0, clinicalTrials: 0, reviews: 0, topWorks: [], topAuthors: [] });
  });
  it("publishes after a temporary secondary request failure recovers within retries", () => {
    expect(run({ failed: "oa", once: true }).status).toBe(0); expect(snapshot().openAccess).toBe(60);
    expect(snapshot().fetched).toBe("2026-10-06"); expect(requests().filter((k) => k === "oa")).toHaveLength(2);
  });
  it("reuses healthy cached responses and retries only the previously failed request", () => {
    expectRetained(run({ failed: "oa" }));
    expect(run({}, ["--budget=100"]).status).toBe(0); expect(requests()).toEqual(["oa"]); expect(snapshot().openAccess).toBe(60);
    expect(run({}, ["--budget=100"]).status).toBe(0); expect(requests()).toEqual([]);
  });
  it("retains the prior institution when the run budget stops an incomplete pull", () => {
    const result = run({}, ["--force", "--budget=2"]); expectRetained(result);
    expect(result.stdout).toContain("run cap of 2 credits reached"); expect(requests()).toEqual(["year", "review"]);
  });
  it("retains the prior institution when OpenAlex reports exhausted daily credits", () => {
    const result = run({ failed: "oa", status: 429, headers: { "x-ratelimit-remaining": "0", "retry-after": "600" } });
    expectRetained(result); expect(result.stdout).toContain("OpenAlex daily budget spent"); expect(requests()).toEqual(["year", "review", "oa"]);
  });
});
