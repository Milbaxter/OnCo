import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";
import { FEEDS, feedStatus } from "../src/lib/feed-meta";

const headers = ["Category", "Name of medicine", "Medicine status", "International non-proprietary name", "ATC code (human)", "Generic", "Biosimilar", "Conditional approval", "Marketing authorisation date", "Medicine URL"];
const medicine = ["Human", "Fixturemed", "Authorised", "Fixturemed", "L01XX00", "No", "No", "No", "01/01/2020", "https://www.ema.europa.eu/en/medicines/human/EPAR/fixturemed"];
const xmlEscape = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
const sheet = (rows: string[][]) => `<worksheet><sheetData>${rows.map((row, i) => `<row r="${i + 1}">${row.map((v, j) => `<c r="${String.fromCharCode(65 + j)}${i + 1}" t="inlineStr"><is><t>${xmlEscape(v)}</t></is></c>`).join("")}</row>`).join("")}</sheetData></worksheet>`;

/** A real, uncompressed ZIP, so command tests exercise the production XLSX reader too. */
function workbook(entries: Record<string, string>): Buffer {
  const local: Buffer[] = [], directory: Buffer[] = [];
  let offset = 0;
  for (const [name, contents] of Object.entries(entries)) {
    const filename = Buffer.from(name), data = Buffer.from(contents);
    let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42);
    directory.push(central, filename); offset += header.length + filename.length + data.length;
  }
  const central = Buffer.concat(directory), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, central, end]);
}
const xlsx = (xml: string) => workbook({ "xl/worksheets/sheet1.xml": xml });
const previous = JSON.stringify({ fetched: "2026-09-01", candidates: [{ product: "Retained fixture", reason: "not-in-corpus" }], verified: [{ drugId: "fixturemed", verifiedOn: "2026-09-01" }], errors: [] }, null, 2) + "\n";
const verified = JSON.stringify({ fetched: "2026-09-01", EU: { fixturemed: "2026-09-01" } }, null, 2) + "\n";
const data = 'export const EPAR_CHECKED = "2026-09-01";\n';
let root: string, cwd: string, script: string, paths: string[];
let sequence = 0;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "onco-ema-command-")); script = join(root, "fetch-ema.cjs");
  await build({ entryPoints: [resolve("scripts/fetch-ema.ts")], outfile: script, bundle: true, platform: "node", format: "cjs", logLevel: "silent",
    banner: { js: `
const fixtureFs = require('node:fs');
const fixtureMode = process.env.EMA_FIXTURE;
const originalTimeout = global.setTimeout;
global.setTimeout = (f, ms, ...args) => originalTimeout(f, 0, ...args);
global.fetch = async (url) => {
  if (url !== 'https://www.ema.europa.eu/en/documents/report/medicines-output-medicines-report_en.xlsx') throw Error('Unexpected fixture URL: '+url);
  if (fixtureMode === 'network-error') throw Error('offline fixture connection error');
  if (fixtureMode.startsWith('http-')) return new Response('offline fixture error', { status: Number(fixtureMode.slice(5)) });
  return new Response(fixtureFs.readFileSync('response.xlsx'));
};` },
    plugins: [{ name: "synthetic-corpus", setup(builder) {
      builder.onResolve({ filter: /^\.\.\/src\/lib\/graph$/ }, () => ({ path: "graph", namespace: "fixture" }));
      builder.onResolve({ filter: /^\.\.\/src\/data\/regional-approvals$/ }, () => ({ path: "regional", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "js", contents: path === "graph"
        ? `export const graph = () => ({ kind: () => [{ id: 'fixturemed', kind: 'drug', name: 'Fixturemed' }] });`
        : `export const REGION_META = { UK: { url: 'https://example.invalid/uk' }, JP: { url: 'https://example.invalid/jp' } }; export const regionalApprovals = { fixturemed: { EU: { status: 'approved', year: 2020, source: '${medicine[9]}' } } };` }));
    } }],
  });
});
beforeEach(() => {
  cwd = join(root, String(sequence++));
  mkdirSync(join(cwd, "public/regional"), { recursive: true }); mkdirSync(join(cwd, "src/data"), { recursive: true });
  paths = ["public/regional/candidates.json", "public/regional/verified.json", "src/data/regional-approvals.ts"].map((p) => join(cwd, p));
  [previous, verified, data].forEach((text, i) => writeFileSync(paths[i], text));
});
afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

function run(body = xlsx(sheet([headers, medicine])), mode = "ok", args: string[] = []) {
  writeFileSync(join(cwd, "response.xlsx"), body);
  return spawnSync(process.execPath, [script, ...args], { cwd, env: { ...process.env, EMA_FIXTURE: mode }, encoding: "utf8", timeout: 10_000 });
}
function expectPreserved() {
  expect(paths.map((p) => readFileSync(p, "utf8"))).toEqual([previous, verified, data]);
  expect(feedStatus(FEEDS.find((f) => f.id === "regional")!, new Date("2026-10-06T12:00:00Z"), cwd)).toMatchObject({ fetched: "2026-09-01", count: 1, stale: true });
}

describe("EMA refresh input failures", () => {
  it.each(["http-403", "http-503", "network-error"])("keeps prior files and dates after %s", (mode) => {
    const result = run(undefined, mode);
    expect(result.status).toBe(1); expect(result.stderr).toMatch(/EMA spreadsheet unreachable/);
    expectPreserved();
  });

  it.each([
    ["invalid ZIP", Buffer.from("Temporarily unavailable")],
    ["missing worksheet", workbook({ "xl/worksheets/sheet2.xml": sheet([headers, medicine]) })],
    ["missing header", xlsx(sheet([["Temporary unavailable"]]))],
    ["missing status column", xlsx(sheet([headers.filter((_, i) => i !== 2), medicine.filter((_, i) => i !== 2)]))],
    ["header only", xlsx(sheet([headers]))],
    ["human row without name", xlsx(sheet([headers, medicine.map((v, i) => i === 1 ? "" : v)]))],
    ["human row without status", xlsx(sheet([headers, medicine.map((v, i) => i === 2 ? "" : v)]))],
  ] as const)("rejects unusable input: %s", (_label, body) => {
    const result = run(body);
    expect(result.status).toBe(1); expect(result.stderr).not.toBe("");
    expectPreserved();
  });

  it("does not create snapshots on a failed first run", () => {
    rmSync(paths[0]); rmSync(paths[1]);
    expect(run(undefined, "http-403").status).toBe(1);
    expect(paths.slice(0, 2).map(existsSync)).toEqual([false, false]);
    expect(readFileSync(paths[2], "utf8")).toBe(data);
  });

  it("publishes a complete matched workbook with zero candidates", () => {
    const result = run();
    expect(result.status).toBe(0);
    const next = JSON.parse(readFileSync(paths[0], "utf8"));
    expect(next).toMatchObject({ register: { rows: 1, human: 1, oncology: 1 }, candidates: [], errors: [] });
    expect(next.verified).toEqual([{ drugId: "fixturemed", region: "EU", status: "approved", year: 2020, url: medicine[9], verifiedOn: next.fetched }]);
    expect(JSON.parse(readFileSync(paths[1], "utf8"))).toMatchObject({ fetched: next.fetched, EU: { fixturemed: next.fetched } });
    expect(readFileSync(paths[2], "utf8")).toBe(`export const EPAR_CHECKED = "${next.fetched}";\n`);
  });

  it("preserves the no-stamp option on a valid refresh", () => {
    expect(run(undefined, "ok", ["--no-stamp"]).status).toBe(0);
    expect(JSON.parse(readFileSync(paths[0], "utf8")).verified).toHaveLength(1);
    expect(readFileSync(paths[2], "utf8")).toBe(data);
  });

  it("allows a readable register with no matching oncology medicines", () => {
    expect(run(xlsx(sheet([headers, medicine.map((v, i) => i === 4 ? "A01AA00" : v)]))).status).toBe(0);
    expect(JSON.parse(readFileSync(paths[0], "utf8"))).toMatchObject({ register: { human: 1, oncology: 0 }, candidates: [], verified: [], errors: [] });
    expect(readFileSync(paths[2], "utf8")).toBe(data);
  });

  it("still records a status disagreement without advancing the source stamp", () => {
    expect(run(xlsx(sheet([headers, medicine.map((v, i) => i === 2 ? "Withdrawn" : v)]))).status).toBe(0);
    const next = JSON.parse(readFileSync(paths[0], "utf8"));
    expect(next.candidates).toHaveLength(1); expect(next.candidates[0]).toMatchObject({ drugId: "fixturemed", reason: "status-mismatch", register: "Withdrawn" });
    expect(next.verified).toEqual([]); expect(readFileSync(paths[2], "utf8")).toBe(data);
  });
});
