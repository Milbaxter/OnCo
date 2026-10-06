import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ATTRIBUTION, OncoClient, type EntityRecord } from "../../onco-cli/src/client";
import { writeFixture } from "../../onco-cli/src/test-fixture";
import { compareRecords, createServer } from "./server";

let cleanup = async () => {};
let mcp: Client;
let api: OncoClient;

beforeAll(async () => {
  const f = await writeFixture();
  cleanup = f.cleanup;
  api = new OncoClient({ base: f.dir, local: true });
  const server = createServer(api);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  mcp = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(serverSide), mcp.connect(clientSide)]);
});
afterAll(async () => { await mcp.close(); await cleanup(); });

const text = (r: unknown) => (r as { content: Array<{ type: string; text: string }> }).content[0].text;
const json = (r: unknown) => JSON.parse(text(r)) as Record<string, unknown>;
const resourceText = (r: { contents: unknown[] }) => (r.contents[0] as { text: string }).text;

const comparisonFixture = (id: string, toxicity: unknown[]): EntityRecord => ({
  entity: { id, kind: "drug", name: id, tldr: "Comparison test fixture.", summary: "Comparison test fixture.", toxicity },
  route: `/drugs/${id}/`, neighbours: {},
});

describe("onco-mcp", () => {
  it("exposes the six tools, the kind resources and the brief prompt", async () => {
    const tools = (await mcp.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(["ask", "compare", "context", "get_entity", "list_kind", "search"]);
    const resources = (await mcp.listResources()).resources.map((r) => r.uri);
    expect(resources).toContain("onco://kinds");
    const templates = (await mcp.listResourceTemplates()).resourceTemplates.map((t) => t.uriTemplate);
    expect(templates).toContain("onco://kinds/{kind}");
    expect((await mcp.listPrompts()).prompts.map((p) => p.name)).toEqual(["onco-brief"]);
  });

  it("every tool result carries the attribution", async () => {
    const search = json(await mcp.callTool({ name: "search", arguments: { query: "trodelvy" } }));
    expect((search.results as Array<{ id: string }>)[0].id).toBe("sacituzumab-govitecan");
    expect(search.attribution).toBe(ATTRIBUTION);

    const entity = json(await mcp.callTool({ name: "get_entity", arguments: { id: "/cancers/tnbc/" } }));
    expect((entity.entity as { id: string }).id).toBe("tnbc");
    expect(entity.url).toBe("https://onco.cc/cancers/tnbc/");
    expect(entity.attribution).toBe(ATTRIBUTION);

    const list = json(await mcp.callTool({ name: "list_kind", arguments: { kind: "drug", filter: ["payload=SN-38"] } }));
    expect(list.total).toBe(1);

    const ctx = await mcp.callTool({ name: "context", arguments: { id: "tnbc" } });
    expect(text(ctx).startsWith("# Triple-negative")).toBe(true);
    expect(text(ctx).trimEnd().endsWith(ATTRIBUTION)).toBe(true);

    const ask = json(await mcp.callTool({ name: "ask", arguments: { question: "What is sacituzumab govitecan?" } }));
    expect((ask.sources as Array<{ id: string; url: string }>).some((s) => s.id === "sacituzumab-govitecan")).toBe(true);
    expect(ask.attribution).toBe(ATTRIBUTION);
    expect(String(ask.plain)).toContain("Sources");
  });

  it("compare flags differing fields and shared neighbours", async () => {
    const r = json(await mcp.callTool({ name: "compare", arguments: { a: "sacituzumab-govitecan", b: "datopotamab-deruxtecan" } }));
    expect(r.sameKind).toBe(true);
    expect(r.directlyLinked).toBe(true);
    expect(r.differing).toContain("Payload");
    expect(r.differing).not.toContain("Modality");
    expect(r.fields).toContainEqual({ field: "Payload", a: "SN-38", b: "Deruxtecan", differs: true, values: { a: "SN-38", b: "Deruxtecan" } });
    expect(r.fields).toContainEqual({ field: "Status", a: "approved", b: "approved", differs: false, values: { a: "approved", b: "approved" } });
    expect((r.sharedNeighbours as Array<{ id: string }>).map((n) => n.id)).toEqual(["tnbc"]);
    const [a, b] = await Promise.all([api.entity("sacituzumab-govitecan"), api.entity("tnbc")]);
    expect(compareRecords(a, b).note).toMatch(/Different kinds/);
  });

  it("compares every row even when the display summary truncates after six", () => {
    const common = Array.from({ length: 6 }, (_, i) => ({ event: `Fixture event ${i}`, grade3PlusPct: i }));
    const a = comparisonFixture("fixture-a", [...common, { event: "Last fixture event", grade3PlusPct: 1 }]);
    const b = comparisonFixture("fixture-b", [...common, { event: "Last fixture event", grade3PlusPct: 9 }]);
    const result = compareRecords(a, b);
    const field = result.fields.find((f) => f.field === "Toxicity");
    expect(field?.a).toBe(field?.b); // intentionally identical, abbreviated CLI summaries
    expect(field?.a).toContain("(+1 more)");
    expect(field?.differs).toBe(true);
    expect(result.differing).toContain("Toxicity");
    expect(field).toMatchObject({ values: { a: a.entity.toxicity, b: b.entity.toxicity } });
  });

  it("does not report object property order alone as a difference", () => {
    const a = comparisonFixture("fixture-a", [{ event: "Fixture event", grade3PlusPct: 1 }]);
    const b = comparisonFixture("fixture-b", [{ grade3PlusPct: 1, event: "Fixture event" }]);
    const result = compareRecords(a, b);
    expect(result.fields.find((f) => f.field === "Toxicity")?.differs).toBe(false);
    expect(result.differing).not.toContain("Toxicity");
  });

  it("exposes the complete differing values through the MCP compare tool", async () => {
    const common = Array.from({ length: 6 }, (_, i) => ({ event: `Fixture event ${i}`, grade3PlusPct: i }));
    const a = comparisonFixture("fixture-a", [...common, { event: "Last fixture event", grade3PlusPct: 1 }]);
    const b = comparisonFixture("fixture-b", [...common, { event: "Last fixture event", grade3PlusPct: 9 }]);
    const entity = vi.spyOn(api, "entity").mockImplementation(async (id) => id === a.entity.id ? a : b);
    try {
      const result = json(await mcp.callTool({ name: "compare", arguments: { a: a.entity.id, b: b.entity.id } }));
      expect(result.differing).toContain("Toxicity");
      expect(result.fields).toContainEqual(expect.objectContaining({
        field: "Toxicity", differs: true, values: { a: a.entity.toxicity, b: b.entity.toxicity },
      }));
      expect(result.attribution).toBe(ATTRIBUTION);
    } finally { entity.mockRestore(); }
  });

  it.each([
    { key: "supportive", field: "Supportive", value: false },
    { key: "brand", field: "Brand", value: "" },
    { key: "mechanismSteps", field: "Mechanism Steps", value: [] },
  ])("compares hidden $field values against absent and equal values through MCP", async ({ key, field, value }) => {
    const a = comparisonFixture("fixture-a", []);
    const b = comparisonFixture("fixture-b", []);
    a.entity[key] = value;
    const entity = vi.spyOn(api, "entity").mockImplementation(async (id) => id === a.entity.id ? a : b);
    try {
      for (const reverse of [false, true]) {
        const result = json(await mcp.callTool({ name: "compare", arguments: { a: reverse ? b.entity.id : a.entity.id, b: reverse ? a.entity.id : b.entity.id } }));
        expect(result.differing).toContain(field);
        expect(result.fields).toContainEqual({
          field, a: null, b: null, differs: true,
          values: reverse ? { a: null, b: value } : { a: value, b: null },
        });
      }

      // An explicit false or empty value is retained even when it matches on both sides.
      b.entity[key] = value;
      const equal = json(await mcp.callTool({ name: "compare", arguments: { a: a.entity.id, b: b.entity.id } }));
      expect(equal.differing).not.toContain(field);
      expect(equal.fields).toContainEqual({ field, a: null, b: null, differs: false, values: { a: value, b: value } });
      expect(equal.differing).toEqual([]);

      delete a.entity[key];
      delete b.entity[key];
      const absent = json(await mcp.callTool({ name: "compare", arguments: { a: a.entity.id, b: b.entity.id } }));
      expect(absent.fields).not.toContainEqual(expect.objectContaining({ field }));
    } finally { entity.mockRestore(); }
  });

  it("returns errors as isError results with the attribution, not exceptions", async () => {
    const r = await mcp.callTool({ name: "get_entity", arguments: { id: "nope" } });
    expect(r.isError).toBe(true);
    expect(json(r).error).toContain("nope");
    expect(json(r).attribution).toBe(ATTRIBUTION);
  });

  it("serves the kinds resource and the brief prompt", async () => {
    const kinds = await mcp.readResource({ uri: "onco://kinds" });
    expect(JSON.parse(resourceText(kinds)).kinds.length).toBe(20);
    const drugs = await mcp.readResource({ uri: "onco://kinds/drug" });
    expect(JSON.parse(resourceText(drugs)).total).toBe(2);
    const prompt = await mcp.getPrompt({ name: "onco-brief", arguments: { id: "tnbc", audience: "clinician" } });
    const body = (prompt.messages[0].content as { text: string }).text;
    expect(body).toContain('get_entity("tnbc")');
    expect(body).toContain("oncologist");
    expect(body).toContain(ATTRIBUTION);
  });
});
