import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../onco-mcp/src/server";
import { OncoClient } from "./client";
import { run } from "./onco";
import { writeFixture } from "./test-fixture";

const BASE = "https://fixture.invalid/api/v1";
const QUESTION = "What is sacituzumab govitecan?";
let fixture: Awaited<ReturnType<typeof writeFixture>>;
beforeAll(async () => { fixture = await writeFixture(); });
afterAll(async () => { await fixture.cleanup(); });
afterEach(() => vi.unstubAllGlobals());

/** Keep the search and Ask indexes available while the entity endpoint fails, as in a partial outage. */
function serveWithEntityResponse(entityResponse: () => Response): OncoClient {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const path = decodeURIComponent(new URL(url).pathname.slice("/api/v1/".length));
    if (path.startsWith("entities/")) return entityResponse();
    try { return new Response(await readFile(join(fixture.dir, path), "utf8")); }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return new Response("Not found", { status: 404 });
      throw err;
    }
  }));
  return new OncoClient({ base: BASE, local: false });
}

describe("Ask API failures", () => {
  it.each([
    { name: "HTTP 503", response: () => new Response("Unavailable", { status: 503 }), message: "returned 503" },
    { name: "invalid JSON", response: () => new Response("{"), message: "not valid JSON" },
    { name: "a network failure", response: (): Response => { throw new Error("connection reset"); }, message: "connection reset" },
  ])("propagates $name instead of returning an answer without its records", async ({ response, message }) => {
    const api = serveWithEntityResponse(response);
    await expect(api.ask(QUESTION)).rejects.toMatchObject({ code: "network", message: expect.stringContaining(message) });
    const out: string[] = [], err: string[] = [];
    const code = await run(["ask", QUESTION, "--json"], { out: (s) => out.push(s), err: (s) => err.push(s) }, { ONCO_API: BASE });
    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(err.join("\n")).toContain(message);
  });

  it("still tolerates genuinely missing entity files", async () => {
    const api = serveWithEntityResponse(() => new Response("Not found", { status: 404 }));
    const answer = await api.ask(QUESTION);
    expect(answer.sources).toEqual([]);
    expect(answer.consulted).toEqual([]);
  });

  it("reports an entity outage as an MCP tool error", async () => {
    const api = serveWithEntityResponse(() => new Response("Unavailable", { status: 503 }));
    const server = createServer(api);
    const client = new Client({ name: "ask-outage-test", version: "0" });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    try {
      const result = await client.callTool({ name: "ask", arguments: { question: QUESTION } });
      expect(result.isError).toBe(true);
      expect(JSON.parse((result.content as Array<{ text: string }>)[0].text).error).toContain("returned 503");
    } finally {
      await client.close();
      await server.close();
    }
  });
});
