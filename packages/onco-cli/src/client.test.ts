import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OncoClient } from "./client";
import { writeFixture } from "./test-fixture";
import type { AskIndexWire } from "../../../src/lib/ask-index";

let fixture: Awaited<ReturnType<typeof writeFixture>>;
beforeEach(async () => { fixture = await writeFixture(); });
afterEach(async () => { vi.unstubAllGlobals(); await fixture.cleanup(); });

const question = "What is sacituzumab govitecan?";
const primary = "entities/sacituzumab-govitecan.json";

describe("Ask record retrieval failures", () => {
  it("rejects corrupt JSON instead of composing an answer without the named record", async () => {
    const original = await readFile(join(fixture.dir, primary), "utf8");
    await writeFile(join(fixture.dir, primary), "{broken");
    const client = new OncoClient({ base: fixture.dir, local: true });
    await expect(client.ask(question)).rejects.toMatchObject({ code: "network", message: `${primary} is not valid JSON` });

    // A failed read must not poison the cache in a long-lived MCP process.
    await writeFile(join(fixture.dir, primary), original);
    const recovered = await client.ask(question);
    expect(recovered.sources.some((s) => s.id === "sacituzumab-govitecan")).toBe(true);
  });

  it("still allows a genuinely missing record", async () => {
    await rm(join(fixture.dir, primary));
    const client = new OncoClient({ base: fixture.dir, local: true });
    const answer = await client.ask(question);
    expect(answer.sources.some((s) => s.id === "sacituzumab-govitecan")).toBe(false);
  });

  it.each(["http", "connection", "json"])("propagates a remote %s failure", async (failure) => {
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const path = new URL(input).pathname.replace("/api/v1/", "");
      if (path === primary) {
        if (failure === "connection") throw new Error("connection reset");
        return new Response(failure === "json" ? "{broken" : "unavailable", { status: failure === "http" ? 503 : 200 });
      }
      try { return new Response(await readFile(join(fixture.dir, path))); }
      catch { return new Response("missing", { status: 404 }); }
    }));
    const client = new OncoClient({ base: "https://example.org/api/v1", local: false });
    await expect(client.ask(question)).rejects.toMatchObject({ code: "network", message: expect.stringMatching(/503|connection reset|not valid JSON/) });
  });

  it("rejects failures in the linked-record wave too", async () => {
    const client = new OncoClient({ base: fixture.dir, local: true });
    const drug = await client.json<{ entity: { trials: string[] } }>(primary);
    drug.entity.trials = ["ascent"];
    await writeFile(join(fixture.dir, primary), JSON.stringify(drug));
    const index = JSON.parse(await readFile(join(fixture.dir, "ask-index.json"), "utf8")) as AskIndexWire;
    // Use the existing encoded row layout; this trial is not in the word index,
    // so the results template must fetch it in its second wave.
    index.rows.push(["ascent", index.kinds.indexOf("trial"), "ASCENT", []]);
    await writeFile(join(fixture.dir, "ask-index.json"), JSON.stringify(index));
    await writeFile(join(fixture.dir, "entities/ascent.json"), "{broken");
    await expect(client.ask("What were the results of sacituzumab govitecan?")).rejects.toMatchObject({ message: "entities/ascent.json is not valid JSON" });
  });
});
