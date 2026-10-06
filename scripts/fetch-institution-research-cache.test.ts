import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const buildDir = mkdtempSync(join(tmpdir(), "onco-research-cache-build-"));
const command = join(buildDir, "fetch.cjs");
const roots: string[] = [];
const snapshot = "public/openalex/research/fixture-institute.json";
const index = "public/openalex/research-index.json";
const entity = { id: "fixture-institute", kind: "institution", name: "Synthetic Institute", aka: [], country: "US" };

beforeAll(async () => {
  await build({ entryPoints: [join(process.cwd(), "scripts/fetch-institution-research.ts")], outfile: command,
    bundle: true, platform: "node", format: "cjs", logLevel: "silent", plugins: [{ name: "fixture-graph", setup(b) {
      b.onResolve({ filter: /\/src\/lib\/graph$/ }, () => ({ path: "graph", namespace: "fixture" }));
      b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "js", contents: `export const graph=()=>({kind:k=>k==='institution'?[${JSON.stringify(entity)}]:[]});` }));
    } }], banner: { js: `
const fs=require('node:fs'),path=require('node:path'),mode=process.env.FIXTURE_MODE,requests=[];
// Isolate the command's real cache; fake Date does not change native filesystem write timestamps.
for(const fn of ['existsSync','mkdirSync','readFileSync','writeFileSync','statSync']){const original=fs[fn];fs[fn]=(p,...args)=>original(typeof p==='string'&&p.startsWith('/tmp/onco-openalex-research')?path.join(process.cwd(),'cache',p.slice('/tmp/onco-openalex-research'.length)):p,...args);}
const NativeDate=Date,now=process.env.FIXTURE_NOW;global.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return NativeDate.parse(now);}};
const timeout=global.setTimeout;global.setTimeout=(fn,ms,...args)=>timeout(fn,0,...args);
global.fetch=async url=>{const u=new URL(url);if(u.origin!=='https://api.openalex.org'||u.pathname!=='/works')throw Error('Unexpected URL');
const group=u.searchParams.get('group_by'),kind=group==='publication_year'?'year':group==='type'?'type':group==='open_access.is_oa'?'oa':group==='authorships.author.id'?'authors':u.searchParams.has('sort')?'top':'trials';requests.push(kind);fs.writeFileSync('requests.json',JSON.stringify(requests));
if(mode==='failed'||(mode==='retry'&&requests.length===1))return new Response('temporary',{status:503});
const count=mode==='zero'?0:mode==='seed'?100:200;
const data={year:{meta:{count},group_by:count?[2022,2023,2024,2025,2026].map(y=>({key:String(y),key_display_name:String(y),count:count/5})):[]},type:{meta:{count},group_by:count?[{key:'review',key_display_name:'review',count:20}]:[]},oa:{meta:{count},group_by:count?[{key:'true',key_display_name:'true',count:60}]:[]},authors:{meta:{count},group_by:[]},trials:{meta:{count:count?10:0},results:[]},top:{meta:{count,cited_by_count_sum:count?500:0},results:count?[{id:'https://openalex.org/W0000000',doi:null,title:'Synthetic paper',publication_year:2026,cited_by_count:50,type:'article'}]:[]}};
return Response.json(data[kind]);};` } });
});
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
afterAll(() => rmSync(buildDir, { recursive: true, force: true }));

function run(root: string, args: string[] = [], mode = "healthy", now = "2026-10-06T12:00:00Z") {
  rmSync(join(root, "requests.json"), { force: true });
  const result = spawnSync(process.execPath, [command, ...args], { cwd: root, encoding: "utf8", timeout: 10_000,
    env: { ...process.env, OPENALEX_API_KEY: "", FIXTURE_MODE: mode, FIXTURE_NOW: now } });
  expect(result.status, result.stderr).toBe(0);
  let calls: string[] = [];
  try { calls = JSON.parse(readFileSync(join(root, "requests.json"), "utf8")); } catch { /* No request. */ }
  return { ...result, calls };
}
function json(root: string, path: string) { return JSON.parse(readFileSync(join(root, path), "utf8")); }
function stamp(root: string, date: string, files = readdirSync(join(root, "cache"))) {
  for (const file of files) utimesSync(join(root, "cache", file), new Date(date), new Date(date));
}
function seed() {
  const root = mkdtempSync(join(tmpdir(), "onco-research-cache-")); roots.push(root);
  mkdirSync(join(root, "public/openalex"), { recursive: true });
  writeFileSync(join(root, "public/openalex/institutions.json"), JSON.stringify({ institutions: { [entity.id]: { openalexId: "I0000000", openalexName: entity.name } } }));
  const initial = run(root, ["--force"], "seed", "2026-09-01T12:00:00Z");
  expect(initial.calls.length).toBe(6);
  stamp(root, "2026-09-01T12:00:00Z");
  return { root, prior: readFileSync(join(root, snapshot), "utf8"), row: json(root, index).institutions[entity.id] };
}
function retained(fixture: ReturnType<typeof seed>) {
  expect(readFileSync(join(fixture.root, snapshot), "utf8")).toBe(fixture.prior);
  expect(json(fixture.root, index).institutions[entity.id]).toEqual(fixture.row);
}

describe("institution research URL cache day", () => {
  it.each(["2026-09-01T12:00:00Z", "2026-10-05T23:59:59Z", "2026-10-07T00:00:00Z"])("cannot restamp a different-day cache with zero budget: %s", (mtime) => {
    const f = seed(); stamp(f.root, mtime);
    const result = run(f.root, ["--budget=0"], "healthy", "2026-10-06T00:00:00Z");
    expect(result.calls).toEqual([]); retained(f);
    expect(result.stdout).toContain("stopped early");
  });

  it.each(["2026-10-06T00:00:00Z", "2026-10-06T00:30:00+00:00"])("reuses today's cache before checking a zero budget: %s", (mtime) => {
    const f = seed(); stamp(f.root, mtime);
    expect(run(f.root, ["--budget=0"]).calls).toEqual([]);
    expect(json(f.root, snapshot)).toMatchObject({ fetched: "2026-10-06", works: 100 });
  });

  it.each(["healthy", "zero", "retry"])("retrieves older cached responses again: %s", (mode) => {
    const f = seed();
    const result = run(f.root, ["--budget=6"], mode);
    expect(result.calls.length).toBe(mode === "retry" ? 7 : 6);
    expect(json(f.root, snapshot)).toMatchObject({ fetched: "2026-10-06", works: mode === "zero" ? 0 : 200 });
  });

  it("retains the snapshot when only part of the expired cache fits the budget", () => {
    const f = seed(); const files = readdirSync(join(f.root, "cache"));
    stamp(f.root, "2026-10-06T01:00:00Z");
    const expired = files.filter((name) => { const j = json(f.root, `cache/${name}`); return j.group_by?.some((g: { key: string }) => ["2022", "review"].includes(g.key)); });
    expect(expired.length).toBe(2); stamp(f.root, "2026-10-05T23:59:59Z", expired);
    expect(run(f.root, ["--budget=1"]).calls).toEqual(["year"]); retained(f);
  });

  it("keeps the prior snapshot when next-day requests fail", () => {
    const f = seed(); expect(run(f.root, [], "failed").calls.length).toBe(36); retained(f);
  });

  it("does not create a first institution snapshot from yesterday's cache with no budget", () => {
    const f = seed(); rmSync(join(f.root, snapshot));
    expect(run(f.root, ["--budget=0"]).calls).toEqual([]);
    expect(readdirSync(join(f.root, "public/openalex/research"))).toEqual([]);
    expect(json(f.root, index).institutions).toEqual({});
  });

  it("continues to bypass a same-day cache with --force", () => {
    const f = seed(); stamp(f.root, "2026-10-06T01:00:00Z");
    expect(run(f.root, ["--force", "--budget=0"]).calls).toEqual([]); retained(f);
  });

});
