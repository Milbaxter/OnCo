import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ATTRIBUTION, OncoClient } from "../../onco-cli/src/client";
import { writeFixture } from "../../onco-cli/src/test-fixture";
import { compareRecords, createServer } from "./server";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

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
    expect((r.sharedNeighbours as Array<{ id: string }>).map((n) => n.id)).toEqual(["tnbc"]);
    const [a, b] = await Promise.all([api.entity("sacituzumab-govitecan"), api.entity("tnbc")]);
    expect(compareRecords(a, b).note).toMatch(/Different kinds/);
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

  it("ask returns an attributed isError result when a record is corrupt", async () => {
    const f = await writeFixture();
    const connection = new Client({ name: "failure-test", version: "0" });
    const server = createServer(new OncoClient({ base: f.dir, local: true }));
    try {
      await writeFile(join(f.dir, "entities/sacituzumab-govitecan.json"), "{broken");
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(serverSide), connection.connect(clientSide)]);
      const r = await connection.callTool({ name: "ask", arguments: { question: "What is sacituzumab govitecan?" } });
      expect(r.isError).toBe(true);
      expect(json(r).error).toContain("entities/sacituzumab-govitecan.json is not valid JSON");
      expect(json(r).attribution).toBe(ATTRIBUTION);
      expect(json(r)).not.toHaveProperty("answer");
    } finally { await connection.close(); await server.close(); await f.cleanup(); }
  });
});
