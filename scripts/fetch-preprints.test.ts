import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";

const preprint = { id: "PPRFIXTURE", source: "PPR", title: "Synthetic preprint" };
const publication = { id: "MEDFIXTURE", source: "MED", title: "Synthetic journal version", commentCorrectionList: { commentCorrection: [{ id: preprint.id, source: "PPR", type: "Preprint in" }] } };
const healthy = [{ hitCount: 1, resultList: { result: [preprint] } }, { resultList: { result: [publication] } }];
const oldPublication = { pprId: preprint.id, title: "Retained journal version" };
const oldPreprint = { id: preprint.id, title: "Retained preprint", published: { title: oldPublication.title } };
const summary = { kind: "target", name: "Fixture topic", count: 1, published: 1 };
const previous = JSON.stringify({ id: "fixturetopic", kind: summary.kind, name: summary.name, query: "prior query", fetched: "2026-09-01", windowDays: 90, count: 1, preprints: [oldPreprint], nowPublished: [oldPublication] }, null, 2) + "\n";
let root: string, cwd: string, script: string, entityPath: string, indexPath: string;
let sequence = 0;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "onco-preprints-command-")); script = join(root, "fetch-preprints.cjs");
  // Run the real command/query builder with one synthetic topic, controlled responses and no network.
  await build({ entryPoints: [resolve("scripts/fetch-preprints.ts")], outfile: script, bundle: true, platform: "node", format: "cjs", logLevel: "silent",
    banner: { js: `
const fixtureFs = require('node:fs');
const fixtureResponses = JSON.parse(fixtureFs.readFileSync('responses.json', 'utf8'));
let fixtureCall = 0;
const originalTimeout = global.setTimeout;
global.setTimeout = (f, ms, ...args) => originalTimeout(f, 0, ...args);
global.fetch = async (url) => {
  const u = new URL(url);
  if (u.origin !== 'https://www.ebi.ac.uk' || u.pathname !== '/europepmc/webservices/rest/search') throw Error('Unexpected fixture URL: '+url);
  const body = fixtureResponses[fixtureCall++];
  fixtureFs.writeFileSync('calls.json', JSON.stringify(fixtureCall));
  if (body === undefined) throw Error('Unexpected extra fixture request');
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
};` },
    plugins: [{ name: "synthetic-graph", setup(builder) {
      builder.onResolve({ filter: /^\.\.\/src\/lib\/graph$/ }, () => ({ path: "graph", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "js", contents: `export const graph = () => ({ entities: [{ id: 'fixturetopic', kind: 'target', name: 'Fixture topic', aka: [] }] });` }));
    } }],
  });
});
beforeEach(() => {
  cwd = join(root, String(sequence++)); mkdirSync(join(cwd, "public/preprints"), { recursive: true });
  entityPath = join(cwd, "public/preprints/fixturetopic.json"); indexPath = join(cwd, "public/preprints/index.json");
  writeFileSync(entityPath, previous);
  writeFileSync(indexPath, JSON.stringify({ fetched: "2026-09-01", windowDays: 90, source: "Synthetic fixture", entities: { fixturetopic: summary }, items: [{ ...oldPreprint, entityIds: ["fixturetopic"] }], published: [{ ...oldPublication, entityIds: ["fixturetopic"] }] }));
});
afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

function run(responses = healthy.map((body) => JSON.stringify(body))) {
  writeFileSync(join(cwd, "responses.json"), JSON.stringify(responses));
  return spawnSync(process.execPath, [script, "--force"], { cwd, encoding: "utf8", timeout: 10_000 });
}
function withResponse(at: number, body: unknown) {
  const responses = healthy.map((body) => JSON.stringify(body)); responses[at] = JSON.stringify(body); return responses;
}
function expectPreserved(result: ReturnType<typeof run>) {
  // Existing partial-failure semantics remain: exit zero, retain the entity, regenerate the aggregate run date.
  expect(result.status).toBe(0); expect(result.stdout).toContain("0 fetched, 0 cached, 1 failed");
  expect(result.stderr).toContain("failed fixturetopic:");
  expect(readFileSync(entityPath, "utf8")).toBe(previous);
  const index = JSON.parse(readFileSync(indexPath, "utf8"));
  expect(index.entities.fixturetopic).toEqual(summary);
  expect(index.items).toEqual([{ ...oldPreprint, entityIds: ["fixturetopic"] }]);
  expect(index.published).toEqual([{ ...oldPublication, entityIds: ["fixturetopic"] }]);
}

describe("preprint snapshot response guards", () => {
  it.each([
    ["missing", undefined], ["null", null], ["string", "1"], ["negative", -1], ["fractional", 0.5],
  ])("retains prior counts and publication links after a %s preprint count", (_label, hitCount) => {
    expectPreserved(run(withResponse(0, { hitCount, resultList: { result: [preprint] } })));
    expect(JSON.parse(readFileSync(join(cwd, "calls.json"), "utf8"))).toBe(1);
  });
  it("rejects a non-finite count before requesting published versions", () => {
    const responses = withResponse(0, {}); responses[0] = '{"hitCount":1e400,"resultList":{"result":[]}}';
    expectPreserved(run(responses));
    expect(JSON.parse(readFileSync(join(cwd, "calls.json"), "utf8"))).toBe(1);
  });

  describe.each([[0, "preprints"], [1, "published versions"]] as const)("request %i (%s)", (at) => {
    it.each([
      ["version-only body", { version: "6.9" }], ["null body", null], ["array body", []],
      ["missing list", { hitCount: 1 }], ["missing results", { hitCount: 1, resultList: {} }],
      ["null results", { hitCount: 1, resultList: { result: null } }], ["non-array results", { hitCount: 1, resultList: { result: {} } }],
    ])("preserves the full snapshot after %s", (_label, body) => {
      expectPreserved(run(withResponse(at, body)));
    });
    it("publishes no entity on a malformed first refresh", () => {
      rmSync(entityPath); rmSync(indexPath);
      const result = run(withResponse(at, { version: "6.9" }));
      expect(result.status).toBe(0); expect(result.stdout).toContain("0 fetched, 0 cached, 1 failed");
      expect(existsSync(entityPath)).toBe(false);
      expect(JSON.parse(readFileSync(indexPath, "utf8"))).toMatchObject({ entities: {}, items: [], published: [] });
    });
  });

  it("publishes genuine zero results for both requests", () => {
    const result = run([JSON.stringify({ hitCount: 0, resultList: { result: [] } }), JSON.stringify({ resultList: { result: [] } })]);
    expect(result.status).toBe(0); expect(result.stdout).toContain("1 fetched, 0 cached, 0 failed");
    expect(JSON.parse(readFileSync(entityPath, "utf8"))).toMatchObject({ count: 0, preprints: [], nowPublished: [] });
    expect(JSON.parse(readFileSync(indexPath, "utf8")).entities.fixturetopic).toMatchObject({ count: 0, published: 0 });
  });
  it("publishes healthy results with publication links and optional bibliographic metadata absent", () => {
    const result = run(); expect(result.status).toBe(0); expect(result.stdout).toContain("1 fetched, 0 cached, 0 failed");
    expect(JSON.parse(readFileSync(entityPath, "utf8"))).toMatchObject({ count: 1, preprints: [{ id: preprint.id, title: preprint.title, published: { title: publication.title } }], nowPublished: [{ pprId: preprint.id, title: publication.title }] });
    expect(JSON.parse(readFileSync(indexPath, "utf8")).entities.fixturetopic).toEqual(summary);
  });
  it("accepts published records without optional preprint relationships", () => {
    const result = run(withResponse(1, { resultList: { result: [{ id: "OTHER", source: "MED", title: "Synthetic journal article" }] } }));
    expect(result.status).toBe(0); expect(result.stdout).toContain("1 fetched, 0 cached, 0 failed");
    expect(JSON.parse(readFileSync(entityPath, "utf8"))).toMatchObject({ count: 1, preprints: [{ id: preprint.id }], nowPublished: [] });
  });
});
