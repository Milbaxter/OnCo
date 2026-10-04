import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ATTRIBUTION } from "./client";
import { run } from "./onco";
import { writeFixture } from "./test-fixture";

let api = "";
let cleanup = async () => {};

beforeAll(async () => { const f = await writeFixture(); api = f.dir; cleanup = f.cleanup; });
afterAll(() => cleanup());

/** Runs the CLI against the fixture and captures both streams. */
async function cli(...argv: string[]) {
  const out: string[] = [], err: string[] = [];
  const code = await run(argv, { out: (s) => out.push(s), err: (s) => err.push(s) }, { ONCO_API: api });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("onco CLI against a local API copy", () => {
  it("prints help and exits 2 without a command", async () => {
    const r = await cli();
    expect(r.code).toBe(2);
    expect(r.out).toContain("Usage");
    expect((await cli("--help")).code).toBe(0);
  });

  it("get prints the record and ends with the attribution line", async () => {
    const r = await cli("get", "/drugs/sacituzumab-govitecan/");
    expect(r.code).toBe(0);
    expect(r.out).toContain("Sacituzumab govitecan  [approved]");
    expect(r.out).toContain("TL;DR");
    expect(r.out).toContain("Cancers: Triple-negative breast cancer (TNBC) (tnbc)");
    expect(r.out.trimEnd().endsWith(ATTRIBUTION)).toBe(true);
    expect(r.out.split(ATTRIBUTION).length).toBe(2);
  });

  it("--json puts the attribution on stderr and valid JSON on stdout", async () => {
    const r = await cli("get", "tnbc", "--json");
    const data = JSON.parse(r.out) as { entity: { id: string }; url: string };
    expect(data.entity.id).toBe("tnbc");
    expect(data.url).toBe("https://onco.cc/cancers/tnbc/");
    expect(r.err).toBe(ATTRIBUTION);
  });

  it("get and context accept copied page links with queries and section anchors", async () => {
    const r = await cli("get", "https://onco.cc/cancers/tnbc/?region=UK#sources", "--json");
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out).entity.id).toBe("tnbc");
    const context = await cli("context", "https://onco.cc/api/v1/context/tnbc.md?download=1#sources", "--quiet");
    expect(context.code).toBe(0);
    expect(context.out.startsWith("# Triple-negative breast cancer")).toBe(true);
  });

  it("list filters and limits", async () => {
    const r = await cli("list", "drugs", "--filter", "status=approved", "--limit", "1", "--json");
    const data = JSON.parse(r.out) as { total: number; shown: number; results: Array<{ id: string }> };
    expect(data.total).toBe(2);
    expect(data.shown).toBe(1);
    const none = await cli("list", "drug", "--filter", "payload=Nothing");
    expect(none.out).toContain("(no rows)");
  });

  it("search finds by word when the concept index is absent", async () => {
    const r = await cli("search", "trodelvy", "--kind", "drug");
    expect(r.code).toBe(0);
    expect(r.out).toContain("Sacituzumab govitecan");
    expect(r.out).toContain("matched: words");
  });

  it("kinds, meta, context and export work and honour --quiet", async () => {
    expect((await cli("kinds")).out).toContain("key papers");
    expect((await cli("meta", "--json")).out).toContain('"total": 3');
    const ctx = await cli("context", "tnbc", "--quiet");
    expect(ctx.out.startsWith("# Triple-negative breast cancer")).toBe(true);
    expect(ctx.out).not.toContain(ATTRIBUTION);
    const csv = await cli("export", "drug", "--csv");
    expect(csv.out.split("\n")[1]).toBe("id,name,status");
    expect(csv.err).toBe(ATTRIBUTION);
    expect((await cli("export", "drug")).code).toBe(2);
  });

  it("ask answers from the fixture records with citations", async () => {
    const r = await cli("ask", "What is sacituzumab govitecan?", "--json");
    expect(r.code).toBe(0);
    const data = JSON.parse(r.out) as { sources: Array<{ id: string; url: string }>; sentences: unknown[]; analysis: { intent: string } };
    expect(data.sources.map((s) => s.id)).toContain("sacituzumab-govitecan");
    expect(data.sources[0].url).toMatch(/^https:\/\/onco\.cc\//);
    expect(data.sentences.length).toBeGreaterThan(0);
    const plain = await cli("ask", "What is sacituzumab govitecan?");
    expect(plain.out).toContain("Sources");
    expect(plain.out).toContain("not medical advice");
  });

  it("reports unknown ids, kinds and commands with distinct exit codes", async () => {
    const missing = await cli("get", "nope");
    expect(missing.code).toBe(1);
    expect(missing.err).toContain('No record with id "nope"');
    expect((await cli("list", "widgets")).code).toBe(2);
    expect((await cli("frobnicate")).code).toBe(2);
  });
});
