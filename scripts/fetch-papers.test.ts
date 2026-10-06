import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";

const counts = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [String(2019 + i), 100]));
const summary = { kind: "drug", name: "Fixturemed", counts, last12: 60, prior12: 30, growth: 1, total: 800 };
const previous = JSON.stringify({ id: "fixturemed", kind: "drug", name: "Fixturemed", query: "prior query", fetched: "2026-09-01", counts, last12: 60, prior12: 30, recent: [{ title: "Retained synthetic paper", source: "MED" }] }, null, 2) + "\n";
const paper = { id: "fixture-paper", title: "New synthetic paper", source: "MED" };
const healthy = { hitCount: 40, resultList: { result: [paper] } };
let root: string, cwd: string, script: string, entityPath: string, indexPath: string;
let sequence = 0;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "onco-papers-command-")); script = join(root, "fetch-papers.cjs");
  // Exercise the real command and query builder without importing the production graph or using the network.
  await build({ entryPoints: [resolve("scripts/fetch-papers.ts")], outfile: script, bundle: true, platform: "node", format: "cjs", logLevel: "silent",
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
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "js", contents: `export const graph = () => ({ entities: [{ id: 'fixturemed', kind: 'drug', name: 'Fixturemed', aka: [] }] });` }));
    } }],
  });
});
beforeEach(() => {
  cwd = join(root, String(sequence++)); mkdirSync(join(cwd, "public/papers"), { recursive: true });
  entityPath = join(cwd, "public/papers/fixturemed.json"); indexPath = join(cwd, "public/papers/index.json");
  writeFileSync(entityPath, previous);
  writeFileSync(indexPath, JSON.stringify({ fetched: "2026-09-01", source: "Europe PMC REST API", entities: { fixturemed: summary } }));
});
afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

function run(responses = Array.from({ length: 11 }, () => JSON.stringify(healthy))) {
  writeFileSync(join(cwd, "responses.json"), JSON.stringify(responses));
  return spawnSync(process.execPath, [script, "--force"], { cwd, encoding: "utf8", timeout: 10_000 });
}
function withResponse(at: number, body: unknown) {
  const responses = Array.from({ length: 11 }, () => JSON.stringify(healthy)); responses[at] = JSON.stringify(body); return responses;
}
function expectPreserved(result: ReturnType<typeof run>) {
  // The command continues other entities and updates the index-wide run date even after a failed entity.
  expect(result.status).toBe(0); expect(result.stdout).toContain("0 fetched, 0 cached, 1 failed");
  expect(result.stderr).toContain("failed fixturemed:");
  expect(readFileSync(entityPath, "utf8")).toBe(previous);
  expect(JSON.parse(readFileSync(indexPath, "utf8")).entities.fixturemed).toEqual(summary);
}

describe("paper snapshot response validation", () => {
  it.each([
    ["version-only response", { version: "6.9" }],
    ["null count", { hitCount: null }],
    ["string count", { hitCount: "40" }],
    ["negative count", { hitCount: -1 }],
    ["fractional count", { hitCount: 0.5 }],
  ])("preserves an existing entity and summary after %s", (_label, body) => {
    expectPreserved(run(withResponse(0, body)));
  });

  it("rejects a non-finite JSON number", () => {
    const responses = withResponse(0, {}); responses[0] = '{"hitCount":1e400}';
    expectPreserved(run(responses));
  });

  it.each([[7, "later year"], [8, "last twelve months"], [9, "prior twelve months"], [10, "recent papers"]])("keeps prior data when request %i (%s) has no count", (at) => {
    expectPreserved(run(withResponse(at as number, { resultList: { result: [paper] } })));
    expect(JSON.parse(readFileSync(join(cwd, "calls.json"), "utf8"))).toBe((at as number) + 1);
  });

  it.each([
    ["missing list", { hitCount: 40 }],
    ["missing results", { hitCount: 40, resultList: {} }],
    ["null results", { hitCount: 40, resultList: { result: null } }],
    ["non-array results", { hitCount: 40, resultList: { result: {} } }],
  ])("keeps prior data when the recent response has %s", (_label, body) => {
    expectPreserved(run(withResponse(10, body)));
  });

  it("does not publish an entity or summary on a malformed first refresh", () => {
    rmSync(entityPath); rmSync(indexPath);
    const result = run(withResponse(0, { version: "6.9" }));
    expect(result.status).toBe(0); expect(result.stdout).toContain("0 fetched, 0 cached, 1 failed");
    expect(existsSync(entityPath)).toBe(false);
    expect(JSON.parse(readFileSync(indexPath, "utf8")).entities).toEqual({});
  });

  it("publishes genuine zero results", () => {
    const result = run(Array.from({ length: 11 }, () => JSON.stringify({ hitCount: 0, resultList: { result: [] } })));
    expect(result.status).toBe(0); expect(result.stdout).toContain("1 fetched, 0 cached, 0 failed");
    expect(JSON.parse(readFileSync(entityPath, "utf8"))).toMatchObject({ last12: 0, prior12: 0, recent: [] });
    expect(JSON.parse(readFileSync(indexPath, "utf8")).entities.fixturemed).toMatchObject({ total: 0, growth: null });
  });

  it("publishes healthy counts with optional bibliographic fields absent", () => {
    const result = run();
    expect(result.status).toBe(0); expect(result.stdout).toContain("1 fetched, 0 cached, 0 failed");
    expect(JSON.parse(readFileSync(entityPath, "utf8"))).toMatchObject({ last12: 40, prior12: 40, recent: [{ title: paper.title, source: paper.source }] });
    expect(JSON.parse(readFileSync(indexPath, "utf8")).entities.fixturemed).toMatchObject({ total: 320, growth: 0 });
  });
});
