import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";
import type { SurvivalSnapshot } from "./fetch-survival";

// Invented fixture-only figures: these tests exercise retrieval integrity, not clinical statistics.
const overall = (value = 50) => `<title>Cancer Stat Facts: Synthetic site - NCI</title><p>5-Year<br/> Relative Survival</p><strong>${value}%</strong><span>2010-2015</span>`;
const stageOnly = "<h2>Percent of Cases and 5-Year Relative Survival by Stage at Diagnosis</h2><table><tr><th><strong>Localized</strong>Fixture stage</th><td>20%</td><td>50%</td></tr></table>";
const previous = JSON.stringify({ fetched: "2026-01-01", sites: { "fixture-alpha": { fetched: "2026-01-01", overall: { pct: 50, period: "2010-2015" }, byStage: [] }, "fixture-beta": { fetched: "2026-01-01", overall: { pct: 50, period: "2010-2015" }, byStage: [] } }, failed: [] }, null, 2) + "\n";
type ResponseFixture = { status?: number; body?: string; network?: boolean };
let root: string, cwd: string, script: string, output: string;
let sequence = 0;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "onco-survival-command-")); script = join(root, "fetch-survival.cjs");
  // Keep the real command, parser and HTTP helpers; only the site map and source responses are fixtures.
  await build({ entryPoints: [resolve("scripts/fetch-survival.ts")], outfile: script, bundle: true, platform: "node", format: "cjs", logLevel: "silent",
    banner: { js: `
const fixtureFs = require('node:fs');
const fixtureResponses = JSON.parse(fixtureFs.readFileSync('responses.json', 'utf8')), fixtureRequests = [];
const OriginalDate = Date;
global.Date = class extends OriginalDate { constructor(...args) { super(...(args.length ? args : ['2026-10-06T12:00:00Z'])); } };
const originalTimeout = global.setTimeout;
global.setTimeout = (fn, ms, ...args) => originalTimeout(fn, 0, ...args);
global.fetch = async (url) => {
  const u = new URL(url);
  if (u.origin !== 'https://seer.cancer.gov' || !['/statfacts/html/fixture-alpha.html', '/statfacts/html/fixture-beta.html'].includes(u.pathname)) throw Error('Unexpected fixture URL');
  const slug = u.pathname.split('/').at(-1).replace('.html', '');
  const response = fixtureResponses[fixtureRequests.length];
  fixtureRequests.push(slug); fixtureFs.writeFileSync('requests.json', JSON.stringify(fixtureRequests));
  if (!response) throw Error('Unexpected fixture request');
  if (response.network) throw Error('Synthetic network failure');
  return new Response(response.body ?? '', { status: response.status ?? 200 });
};` },
    plugins: [{ name: "synthetic-sites", setup(builder) {
      builder.onResolve({ filter: /^\.\.\/src\/data\/survival-map$/ }, () => ({ path: "map", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "js", contents: `export const SURVIVAL_SITES = { alpha: { slug: 'fixture-alpha' }, beta: { slug: 'fixture-beta' }, shared: { slug: 'fixture-alpha' } };` }));
    } }],
  });
});
beforeEach(() => {
  cwd = join(root, String(sequence++)); mkdirSync(join(cwd, "public/survival"), { recursive: true });
  output = join(cwd, "public/survival/index.json"); writeFileSync(output, previous);
});
afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

function run(responses: ResponseFixture[]) {
  writeFileSync(join(cwd, "responses.json"), JSON.stringify(responses));
  return spawnSync(process.execPath, [script], { cwd, encoding: "utf8", timeout: 10_000 });
}
const snapshot = () => JSON.parse(readFileSync(output, "utf8")) as SurvivalSnapshot;
const requests = () => JSON.parse(readFileSync(join(cwd, "requests.json"), "utf8")) as string[];
const healthy: ResponseFixture = { body: overall() };

describe("survival snapshot publication", () => {
  const failures: Array<[string, ResponseFixture[]]> = [
    ["exhausted HTTP retries", Array.from({ length: 3 }, () => ({ status: 503 }))],
    ["HTTP 404", [{ status: 404 }]],
    ["exhausted network retries", Array.from({ length: 3 }, () => ({ network: true }))],
    ["an empty response", [{ body: "" }]],
    ["a response with no parsed statistics", [{ body: "<title>Temporary source notice</title><p>Try again later.</p>" }]],
  ];
  describe.each(["first", "last"])("failure in the %s site", (position) => {
    it.each(failures)("preserves exact previous bytes and date after %s", (_label, failure) => {
      const first = position === "first", slug = first ? "fixture-alpha" : "fixture-beta";
      const result = run(first ? [...failure, healthy] : [healthy, ...failure]);
      expect(result.status).toBe(1); expect(result.stderr).toContain("snapshot not written"); expect(result.stderr).toContain(slug);
      expect(readFileSync(output, "utf8")).toBe(previous);
      expect(requests()).toEqual(first ? [...failure.map(() => slug), "fixture-beta"] : ["fixture-alpha", ...failure.map(() => slug)]);
    });
  });
  it.each(["request", "parsing"])("creates no file on a first refresh with a %s failure", (failure) => {
    rmSync(join(cwd, "public"), { recursive: true });
    const result = run([healthy, failure === "request" ? { status: 404 } : { body: "<p>No statistics parsed</p>" }]);
    expect(result.status).toBe(1); expect(existsSync(output)).toBe(false);
  });
  it("retains the snapshot when every site fails", () => {
    const result = run([{ status: 404 }, { status: 404 }]);
    expect(result.status).toBe(1); expect(readFileSync(output, "utf8")).toBe(previous);
    expect(result.stderr).toContain("fixture-alpha, fixture-beta");
  });
  it("publishes healthy overall-only sites without requiring a stage table", () => {
    expect(run([healthy, healthy]).status).toBe(0);
    expect(requests()).toEqual(["fixture-alpha", "fixture-beta"]);
    expect(snapshot()).toMatchObject({ fetched: "2026-10-06", failed: [], sites: { "fixture-alpha": { fetched: "2026-10-06", overall: { pct: 50, period: "2010-2015" }, byStage: [] } } });
    expect(Object.keys(snapshot().sites)).toHaveLength(2);
  });
  it("publishes genuine zero-percent values", () => {
    expect(run([{ body: overall(0) }, healthy]).status).toBe(0);
    expect(snapshot().sites["fixture-alpha"].overall?.pct).toBe(0); expect(snapshot().failed).toEqual([]);
  });
  it("preserves the existing stage-only success path", () => {
    expect(run([{ body: stageOnly }, healthy]).status).toBe(0);
    const site = snapshot().sites["fixture-alpha"];
    expect(site.overall).toBeUndefined(); expect(site.byStage).toEqual([{ stage: "Localized", description: "Fixture stage", casesPct: 20, survivalPct: 50 }]);
    expect(snapshot().failed).toEqual([]);
  });
  it("publishes when a transient error recovers within the existing retry policy", () => {
    expect(run([healthy, { status: 503 }, healthy]).status).toBe(0);
    expect(requests()).toEqual(["fixture-alpha", "fixture-beta", "fixture-beta"]);
    expect(snapshot()).toMatchObject({ fetched: "2026-10-06", failed: [] });
  });
});
