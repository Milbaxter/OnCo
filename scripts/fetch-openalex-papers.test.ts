import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const papers = Array.from({ length: 52 }, (_, i) => ({ id: `fixture-paper-${i}`, doi: `10.0000/fixture${i}` }));
const previous = JSON.stringify({ fetched: "2026-09-01", source: "https://api.openalex.org/works", license: "CC0", papers: Object.fromEntries(papers.map((p) => [p.id, { doi: p.doi, openalexId: `W${p.id}`, cited: 700, byYear: { "2025": 20 } }])), missing: [] });
let root: string, script: string, cwd: string, output: string, sequence = 0;
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "onco-citation-refresh-")); script = join(root, "fetch.cjs");
  await build({
    entryPoints: [join(process.cwd(), "scripts/fetch-openalex-papers.ts")], outfile: script, bundle: true, platform: "node", format: "cjs",
    banner: { js: `const fixtureFs=require('node:fs'); const fixture=JSON.parse(fixtureFs.readFileSync('fixture.json','utf8')); const originalTimer=global.setTimeout;
      global.setTimeout=(fn,ms,...args)=>originalTimer(fn,0,...args);
      global.fetch=async(url)=>{
        const u=new URL(url); if(u.origin!=='https://api.openalex.org'||u.pathname!=='/works')throw Error('Unexpected fixture URL');
        const ids=u.searchParams.get('filter').slice(4).split('|').map(d=>Number(d.slice(d.lastIndexOf('fixture')+7)));
        const fails=fixture.at==='first'?ids[0]===0:ids[0]>=50;
        if(fails&&fixture.status)return new Response('unavailable',{status:fixture.status});
        if(fails&&fixture.invalidJson)return new Response('invalid JSON',{status:200});
        if(fails&&'body' in fixture)return Response.json(fixture.body);
        return Response.json({results:fixture.empty?[]:ids.map(i=>({id:'https://openalex.org/W'+i,doi:'https://doi.org/10.0000/fixture'+i,cited_by_count:100+i,counts_by_year:[{year:2025,cited_by_count:10}]}))});
      };` },
    plugins: [{ name: "synthetic-papers", setup(builder) {
      builder.onResolve({ filter: /^\.\.\/src\/lib\/graph$/ }, () => ({ path: "graph", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "js", contents: `export const graph=()=>({kind:()=>${JSON.stringify(papers)}});` }));
    } }],
  });
});
beforeEach(() => {
  cwd=join(root,String(sequence++)); mkdirSync(join(cwd,"public/openalex"),{recursive:true});
  output=join(cwd,"public/openalex/papers.json"); writeFileSync(output,previous);
});
afterAll(() => { if(root)rmSync(root,{recursive:true,force:true}); });
const run=(fixture: Record<string, unknown>) => {
  writeFileSync(join(cwd,"fixture.json"),JSON.stringify(fixture));
  return spawnSync(process.execPath,[script],{cwd,encoding:"utf8",timeout:10000});
};
const invalidCases: Array<[string,Record<string,unknown>]> = [
  ["HTTP403",{status:403}], ["exhausted HTTP503",{status:503}], ["invalid JSON",{invalidJson:true}],
  ["missing results",{body:{meta:{count:52}}}], ["null results",{body:{results:null}}], ["non-array results",{body:{results:{}}}],
];
describe("key-paper citation refresh recovery", () => {
  it.each(invalidCases)("preserves a complete snapshot after %s in the first batch",(_name,fixture)=>{
    const result=run({...fixture,at:"first"}); expect(result.status).toBe(1);
    expect(result.stderr).toContain("batch 1"); expect(readFileSync(output,"utf8")).toBe(previous);
  });
  it.each(invalidCases)("preserves a complete snapshot after %s in a later batch",(_name,fixture)=>{
    const result=run({...fixture,at:"later"}); expect(result.status).toBe(1);
    expect(result.stderr).toContain("batch 2"); expect(readFileSync(output,"utf8")).toBe(previous);
  });
  it("publishes no snapshot on a failed first refresh",()=>{
    rmSync(output); const result=run({at:"first",status:403});
    expect(result.status).toBe(1); expect(existsSync(output)).toBe(false);
  });
  it("allows successful empty DOI lookups",()=>{
    const result=run({empty:true}); expect(result.status).toBe(0);
    expect(JSON.parse(readFileSync(output,"utf8"))).toMatchObject({papers:{},missing:papers.map(p=>p.id)});
  });
  it("replaces an old snapshot after a complete healthy refresh",()=>{
    const result=run({}); expect(result.status).toBe(0); const snap=JSON.parse(readFileSync(output,"utf8"));
    expect(Object.keys(snap.papers)).toHaveLength(52); expect(snap.missing).toEqual([]);
    expect(snap.papers["fixture-paper-51"]).toMatchObject({openalexId:"W51",cited:151,byYear:{"2025":10}});
    expect(snap.fetched).not.toBe("2026-09-01");
  });
  it("recovers in a later run after failure",()=>{
    expect(run({at:"later",status:503}).status).toBe(1); expect(readFileSync(output,"utf8")).toBe(previous);
    expect(run({}).status).toBe(0); expect(Object.keys(JSON.parse(readFileSync(output,"utf8")).papers)).toHaveLength(52);
  });
});
