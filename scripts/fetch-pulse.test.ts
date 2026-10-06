import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";

const feed = { id: "nejm", name: "New England Journal of Medicine", homepage: "https://www.nejm.org/", url: "https://www.nejm.org/action/showFeed?type=etoc&feed=rss&jc=nejm", kind: "journal", ok: true, count: 1 };
const ago = (days: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10); };
const priorDate = ago(7), itemDate = ago(5);
const retained = { feedId: feed.id, title: "Retained Fixturemed cancer news", url: "https://example.invalid/prior", date: itemDate, refs: ["fixturemed"] };
const newTitle = "New Fixturemed cancer report";
const item = (title = newTitle, date = itemDate) => `<item><title>${title}</title><link>https://example.invalid/new</link><pubDate>${date}</pubDate></item>`;
const rss = (items = "") => `<rss version="2.0"><channel><title>Fixture feed</title><link>https://example.invalid/</link><description>Synthetic feed</description>${items}</channel></rss>`;
const atom = (items = "", prefix = "") => `<${prefix}feed xmlns="http://www.w3.org/2005/Atom" xmlns:a="http://www.w3.org/2005/Atom"><id>urn:fixture:feed</id><title>Fixture feed</title><updated>${itemDate}T00:00:00Z</updated><author><name>Fixture</name></author>${items}</${prefix}feed>`;
const entry = `<entry><id>urn:fixture:entry</id><title>${newTitle}</title><link href="https://example.invalid/new"/><updated>${itemDate}T00:00:00Z</updated></entry>`;
const rdf = (prefix = "rdf", channelPrefix = "") => `<${prefix}:RDF xmlns:${prefix}="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:r="http://purl.org/rss/1.0/"><${channelPrefix}channel ${prefix}:about="https://example.invalid/feed"><title>Fixture feed</title><link>https://example.invalid/</link><description>Synthetic feed</description><items><${prefix}:Seq><${prefix}:li ${prefix}:resource="https://example.invalid/new"/></${prefix}:Seq></items></${channelPrefix}channel>${item()}</${prefix}:RDF>`;
let root: string, cwd: string, script: string, snapshotPath: string;
let sequence = 0;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "onco-pulse-command-")); script = join(root, "fetch-pulse.cjs");
  await build({ entryPoints: [resolve("scripts/fetch-pulse.ts")], outfile: script, bundle: true, platform: "node", format: "cjs", logLevel: "silent",
    banner: { js: `
const fixtureFs = require('node:fs');
const fixture = JSON.parse(fixtureFs.readFileSync('response.json', 'utf8'));
const originalTimeout = global.setTimeout;
global.setTimeout = (fn, ms, ...args) => originalTimeout(fn, 0, ...args);
global.fetch = async (url) => {
  if (url.startsWith('https://www.fda.gov/')) return new Response('FDA branch excluded from this fixture', { status: 503 });
  if (url === ${JSON.stringify(feed.url)}) return new Response(fixture.body, { status: fixture.status });
  if (!['https://www.thelancet.com/', 'https://ascopubs.org/', 'https://www.nature.com/', 'https://endpts.com/', 'https://www.statnews.com/'].some(prefix => url.startsWith(prefix))) throw Error('Unexpected fixture URL: '+url);
  return new Response(${JSON.stringify(rss())}, { status: 200 });
};` },
    plugins: [{ name: "synthetic-graph", setup(builder) {
      builder.onResolve({ filter: /^\.\.\/src\/lib\/graph$/ }, () => ({ path: "graph", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "js", contents: `export const graph = () => ({ entities: [{ id: 'fixturemed', kind: 'drug', name: 'Fixturemed', aka: [] }] });` }));
    } }],
  });
});
beforeEach(() => {
  cwd = join(root, String(sequence++)); mkdirSync(join(cwd, "public/pulse"), { recursive: true });
  snapshotPath = join(cwd, "public/pulse/auto.json");
  writeFileSync(snapshotPath, JSON.stringify({ fetched: priorDate, feeds: [feed], items: [retained] }));
});
afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

function run(body: string, status = 200) {
  writeFileSync(join(cwd, "response.json"), JSON.stringify({ body, status }));
  const result = spawnSync(process.execPath, [script], { cwd, encoding: "utf8", timeout: 10_000 });
  expect(result.status).toBe(0); // The existing command publishes healthy sources even when another fails.
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
  return { result, snapshot, source: snapshot.feeds.find((f: { id: string }) => f.id === feed.id) };
}

describe("pulse feed envelopes", () => {
  it.each([
    ["HTML challenge", "<!doctype html><html><body>Checking your browser</body></html>"],
    ["login page", "<html><body><form>Sign in to continue</form></body></html>"],
    ["arbitrary text", "Temporary response: please try again later."],
    ["HTML with a nested feed example", `<html><body>${rss(item())}</body></html>`],
    ["unclosed RSS envelope", rss().replace("</rss>", "")],
    ["RSS without a channel", '<rss version="2.0"><title>Fixture</title></rss>'],
    ["RSS with an unbound prefix", rss().replaceAll("rss", "unbound:rss")],
    ["foreign Atom namespace", atom().replaceAll("http://www.w3.org/2005/Atom", "https://example.invalid/not-atom")],
    ["foreign RDF namespace", rdf().replace("http://www.w3.org/1999/02/22-rdf-syntax-ns#", "https://example.invalid/not-rdf")],
    ["RDF without an RSS channel", '<r:RDF xmlns:r="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><channel xmlns="https://example.invalid/not-rss"/></r:RDF>'],
  ])("retains the prior source items after %s", (_name, body) => {
    const { result, snapshot, source } = run(body);
    expect(source).toMatchObject({ ok: false, count: 1 });
    expect(source.error).toContain(`showing 1 items from ${priorDate}`);
    expect(snapshot.items).toEqual([retained]);
    expect(result.stderr).toContain("pulse: nejm failed");
  });

  it("still retains items after an HTTP failure", () => {
    const { snapshot, source } = run("Unavailable", 503);
    expect(source).toMatchObject({ ok: false, count: 1 }); expect(snapshot.items).toEqual([retained]);
  });

  it("records a failed first refresh without manufacturing an empty successful source", () => {
    rmSync(snapshotPath);
    const { snapshot, source } = run("<html>Sign in</html>");
    expect(source).toMatchObject({ ok: false, count: 0 }); expect(snapshot.items).toEqual([]);
  });

  it.each([
    ["RSS2", rss(item())], ["Atom", atom(entry)], ["RDF", rdf()],
    ["aliased Atom root", atom(entry, "a:")], ["aliased RDF and RSS namespaces", rdf("graph", "r:")],
    ["BOM, declaration, comment and processing instruction", `\uFEFF<?xml version="1.0"?>\n<!-- feed --><?fixture ready?>${rss(item())}<!-- end -->`],
    ["external DOCTYPE", `<!DOCTYPE rss SYSTEM "https://example.invalid/feed.dtd">${rss(item())}`],
    ["DOCTYPE internal subset with quoted delimiters", `<!DOCTYPE rss [<!ENTITY unused "] >">]>${rss(item())}`],
    ["DOCTYPE internal comments", `<!DOCTYPE rss [<!-- [ > --> <!ENTITY unused "fixture">]>${rss(item())}<?after fixture?>`],
  ])("publishes a healthy %s feed", (_name, body) => {
    const { snapshot, source } = run(body);
    expect(source).toMatchObject({ ok: true, count: 1 });
    expect(snapshot.items).toEqual([{ feedId: feed.id, title: newTitle, url: "https://example.invalid/new", date: itemDate, refs: ["fixturemed"] }]);
  });

  it.each([
    ["empty RSS2", rss()], ["empty Atom", atom()],
    ["non-oncology items", rss(item("Synthetic weather report"))],
    ["items outside the age window", rss(item(newTitle, ago(90)))],
  ])("accepts a successful feed with %s", (_name, body) => {
    const { snapshot, source } = run(body);
    expect(source).toMatchObject({ ok: true, count: 0 }); expect(snapshot.items).toEqual([]);
  });
});
