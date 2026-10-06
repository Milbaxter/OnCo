import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";
import type { RegionalSnapshot } from "./fetch-ema";

const headers = ["Category", "Name of medicine", "Medicine status", "International non-proprietary name", "ATC code (human)", "Generic", "Biosimilar", "Conditional approval", "Marketing authorisation date", "Medicine URL"];
const products = [{ id: "alpha-fixture", kind: "drug", name: "Alphafixture" }, { id: "beta-fixture", kind: "drug", name: "Betafixture" }];
const source = (id: string) => `https://www.ema.europa.eu/en/medicines/human/EPAR/${id}`;
const regions = Object.fromEntries(products.map((p) => [p.id, { EU: { status: "approved", year: 2020, source: source(p.id) } }]));
const before = 'export const EPAR_CHECKED = "2000-01-01";\n';

/** A small valid ZIP containing inline-string cells; the real command still reads/parses the workbook. */
function workbook(rows: string[][]): Buffer {
  const escape = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  const xml = `<worksheet><sheetData>${rows.map((row, i) => `<row r="${i + 1}">${row.map((v, j) => `<c r="${String.fromCharCode(65 + j)}${i + 1}" t="inlineStr"><is><t>${escape(v)}</t></is></c>`).join("")}</row>`).join("")}</sheetData></worksheet>`;
  const name = Buffer.from("xl/worksheets/sheet1.xml"), data = Buffer.from(xml);
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  crc = (crc ^ 0xffffffff) >>> 0;
  const local = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + data.length, 16);
  return Buffer.concat([local, name, data, central, name, end]);
}

let root: string, cwd: string, script: string, dataPath: string;
let sequence = 0;
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "onco-ema-stamp-")); script = join(root, "fetch-ema.cjs");
  await build({ entryPoints: [resolve("scripts/fetch-ema.ts")], outfile: script, bundle: true, platform: "node", format: "cjs", logLevel: "silent",
    banner: { js: `global.fetch = async (url) => { if (url !== 'https://www.ema.europa.eu/en/documents/report/medicines-output-medicines-report_en.xlsx') throw Error('Unexpected fixture URL: '+url); return new Response(require('node:fs').readFileSync('response.xlsx')); };` },
    plugins: [{ name: "synthetic-medicines", setup(builder) {
      builder.onResolve({ filter: /^\.\.\/src\/lib\/graph$/ }, () => ({ path: "graph", namespace: "fixture" }));
      builder.onResolve({ filter: /^\.\.\/src\/data\/regional-approvals$/ }, () => ({ path: "regional", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "js", contents: path === "graph"
        ? `export const graph = () => ({ kind: () => ${JSON.stringify(products)} });`
        : `export const REGION_META = { UK: { url: 'https://example.invalid/uk' }, JP: { url: 'https://example.invalid/jp' } }; export const regionalApprovals = ${JSON.stringify(regions)};` }));
    } }],
  });
});
beforeEach(() => {
  cwd = join(root, String(sequence++));
  dataPath = join(cwd, "src/data/regional-approvals.ts");
  mkdirSync(join(cwd, "src/data"), { recursive: true }); writeFileSync(dataPath, before);
});
afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

function run(statuses: Array<string | null>, args: string[] = []) {
  const rows = statuses.flatMap((status, i) => status === null ? [] : [["Human", products[i].name, status, products[i].name, "L01XX00", "No", "No", "No", "01/01/2020", source(products[i].id)]]);
  writeFileSync(join(cwd, "response.xlsx"), workbook([headers, ...rows]));
  const result = spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8", timeout: 10_000 });
  expect(result.status, result.stderr).toBe(0);
  const snapshot = JSON.parse(readFileSync(join(cwd, "public/regional/candidates.json"), "utf8")) as RegionalSnapshot;
  const verified = JSON.parse(readFileSync(join(cwd, "public/regional/verified.json"), "utf8")) as { fetched: string; EU: Record<string, string> };
  expect(verified.fetched).toBe(snapshot.fetched);
  expect(verified.EU).toEqual(Object.fromEntries(snapshot.verified.map((v) => [v.drugId, snapshot.fetched])));
  return { snapshot, stdout: result.stdout, stamp: readFileSync(dataPath, "utf8") };
}

describe("EMA verification stamp", () => {
  it("holds the stamp when the only checked status is unsupported", () => {
    const { snapshot, stdout, stamp } = run([null, "Unsupported fixture status"]);
    expect(snapshot.verified).toEqual([]); expect(snapshot.candidates).toEqual([]);
    expect(stamp).toBe(before);
    expect(stdout).toContain("1 unverified checked rows");
    expect(stdout).not.toContain("EU rows agree");
  });

  it("publishes verified rows but holds the stamp when another checked status is unsupported", () => {
    const { snapshot, stdout, stamp } = run(["Authorised", "Unsupported fixture status"]);
    expect(snapshot.verified.map((v) => v.drugId)).toEqual(["alpha-fixture"]);
    expect(snapshot.candidates).toEqual([]);
    expect(stamp).toBe(before);
    expect(stdout).toContain("1 unverified checked rows");
    expect(stdout).not.toContain("EU rows agree");
  });

  it("advances the stamp when every checked product is verified", () => {
    const { snapshot, stdout, stamp } = run(["Authorised", "Authorised"]);
    expect(snapshot.verified.map((v) => v.drugId)).toEqual(["alpha-fixture", "beta-fixture"]);
    expect(snapshot.candidates).toEqual([]);
    expect(stamp).toBe(`export const EPAR_CHECKED = "${snapshot.fetched}";\n`);
    expect(stdout).toContain("2 EU rows agree with the register");
  });

  it("keeps a recognised disagreement as a candidate and holds the stamp", () => {
    const { snapshot, stamp } = run(["Authorised", "Withdrawn"]);
    expect(snapshot.verified.map((v) => v.drugId)).toEqual(["alpha-fixture"]);
    expect(snapshot.candidates).toHaveLength(1);
    expect(snapshot.candidates[0]).toMatchObject({ drugId: "beta-fixture", reason: "status-mismatch", register: "Withdrawn" });
    expect(stamp).toBe(before);
  });

  it("honours no-stamp even when all checked products verify", () => {
    const { snapshot, stamp } = run(["Authorised", "Authorised"], ["--no-stamp"]);
    expect(snapshot.verified).toHaveLength(2); expect(snapshot.candidates).toEqual([]);
    expect(stamp).toBe(before);
  });
});
