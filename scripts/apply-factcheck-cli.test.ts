import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Patch } from "./factcheck";

const tsx = createRequire(import.meta.url).resolve("tsx/cli");
const script = fileURLToPath(new URL("./apply-factcheck.ts", import.meta.url));
const proposal: Patch = {
  id: "alpha", kind: "trial", name: "Alpha", route: "/trials/alpha/", field: "status",
  current: "recruiting", proposed: "completed", reason: "Synthetic registry response",
  source: "https://example.org/registry", registryValue: "COMPLETED", proposedOn: "2026-10-05",
};
const record = `t({ id: "alpha", name: "Alpha", status: "recruiting", asOf: "2026-01-01" })`;

/** Run the real command against an isolated, offline corpus and return every file it could change. */
function runApply(data: Record<string, string>, patches = [proposal], args = ["alpha.status"]) {
  const dir = mkdtempSync(join(tmpdir(), "onco-apply-factcheck-"));
  const before: Record<string, string> = {
    ...Object.fromEntries(Object.entries(data).map(([name, source]) => [`src/data/${name}`, source])),
    "CORRECTIONS.md": "# Corrections\n\nFixture history.\n",
    "public/factcheck-patches.json": JSON.stringify({ generated: "2026-10-05", patches }, null, 2) + "\n",
  };
  try {
    for (const [name, source] of Object.entries(before)) {
      const path = join(dir, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, source);
    }
    const result = spawnSync(process.execPath, [tsx, script, ...args], { cwd: dir, encoding: "utf8", timeout: 30_000 });
    if (result.error) throw result.error;
    const after = Object.fromEntries(Object.keys(before).map((name) => [name, readFileSync(join(dir, name), "utf8")]));
    return { before, after, status: result.status, output: result.stdout + result.stderr };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe("apply-factcheck command identity preflight", () => {
  it.each([
    { name: "both copies have the field", first: record, second: record },
    { name: "only the first copy has the field", first: record, second: `t({ id: "alpha", name: "Alpha" })` },
    { name: "only the second copy has the field", first: `t({ id: "alpha", name: "Alpha" })`, second: record },
    { name: "another copy has a stale value", first: record, second: record.replace('"recruiting"', '"positive"') },
    { name: "a file already has duplicate copies", first: `[${record}, ${record}]`, second: record },
    { name: "a helper copy inherits its name and kind from a spread", first: record, second: `const baseTrial = { kind: "trial", name: "Second Alpha" }; t({ ...baseTrial, id: "alpha", status: "recruiting" })` },
    { name: "a helper supplies the name and kind", first: record, second: `const t = (x) => ({ kind: "trial", name: "Second Alpha", ...x }); t({ id: "alpha", status: "recruiting" })` },
    { name: "a typed helper argument inherits the name and kind", first: record, second: `t(({ id: "alpha", status: "recruiting" } satisfies TrialFields))` },
    { name: "a standalone copy inherits its name and kind", first: record, second: `const baseTrial = { kind: "trial", name: "Second Alpha" }; export const trials = [{ ...baseTrial, id: "alpha", status: "recruiting" }];` },
    { name: "the inherited copy comes first", first: `t({ ...baseTrial, id: "alpha" })`, second: record },
    { name: "a spread-backed copy is in the same file", first: `[${record}, t({ ...baseTrial, id: "alpha" })]`, second: "" },
  ])("refuses an ambiguous id when $name", ({ first, second }) => {
    const result = runApply({ "a.ts": first, "nested/b.ts": second });
    expect(result.status).toBe(0);
    expect(result.after).toEqual(result.before);
    expect(result.output).toMatch(/alpha\.status.*ambiguous/i);
  });

  it("keeps ambiguous proposals while applying an unrelated unique record in a batch", () => {
    const beta: Patch = { ...proposal, id: "beta", name: "Beta", route: "/trials/beta/" };
    const result = runApply({ "a.ts": record, "b.ts": record, "c.ts": record.replace('id: "alpha"', 'id: "beta"') }, [beta, proposal], ["--all"]);
    expect(result.status).toBe(0);
    expect(result.after["src/data/a.ts"]).toBe(result.before["src/data/a.ts"]);
    expect(result.after["src/data/b.ts"]).toBe(result.before["src/data/b.ts"]);
    expect(result.after["src/data/c.ts"]).toContain('status: "completed"');
    expect(result.after["CORRECTIONS.md"]).toContain("[beta]");
    expect(result.after["CORRECTIONS.md"]).not.toContain("[alpha]");
    expect(JSON.parse(result.after["public/factcheck-patches.json"]).patches).toEqual([proposal]);
  });

  it("ignores comment and string decoys and patches a unique multiline literal id", () => {
    const source = `t({\n  'id': 'alpha',\n  name: "Alpha",\n  status: "recruiting"\n})`;
    const decoys = `// ${record}\nconst example = ${JSON.stringify(record)};\nconst supplement = { id: "alpha", phase: "3" };`;
    const result = runApply({ "a.ts": decoys, "b.ts": source });
    expect(result.status).toBe(0);
    expect(result.after["src/data/a.ts"]).toBe(decoys);
    expect(result.after["src/data/b.ts"]).toBe(source.replace('status: "recruiting"', 'status: "completed"'));
    expect(JSON.parse(result.after["public/factcheck-patches.json"]).patches).toEqual([]);
  });

  it("applies multiple selected fields on one unique record without confusing proposals with identities", () => {
    const source = record.replace('status: "recruiting",', 'status: "recruiting", enrolled: 20,');
    const enrolment: Patch = { ...proposal, field: "enrolled", current: "20", proposed: "24" };
    const result = runApply({ "a.ts": source }, [proposal, enrolment], ["alpha"]);
    expect(result.status).toBe(0);
    expect(result.after["src/data/a.ts"]).toContain('status: "completed", enrolled: 24,');
    expect(result.after["CORRECTIONS.md"].match(/\[alpha\]/g)).toHaveLength(2);
    expect(JSON.parse(result.after["public/factcheck-patches.json"]).patches).toEqual([]);
  });

  it("keeps every file unchanged during a dry run with an ambiguous and a unique id", () => {
    const beta: Patch = { ...proposal, id: "beta", name: "Beta", route: "/trials/beta/" };
    const result = runApply({ "a.ts": record, "b.ts": record, "c.ts": record.replace('id: "alpha"', 'id: "beta"') }, [proposal, beta], ["--all", "--dry-run"]);
    expect(result.status).toBe(0);
    expect(result.after).toEqual(result.before);
    expect(result.output).toContain("dry run: 1 patches would be applied");
    expect(result.output).toMatch(/alpha\.status.*ambiguous/i);
  });

  it("does not apply or rewrite proposals when the unique record is stale", () => {
    const result = runApply({ "a.ts": record.replace('"recruiting"', '"positive"') });
    expect(result.status).toBe(0);
    expect(result.after).toEqual(result.before);
    expect(result.output).toContain('field is "positive"');
  });

  it("does not broaden patchable records to an unresolved helper or spread identity", () => {
    const result = runApply({ "a.ts": `t({ ...baseTrial, id: "alpha", status: "recruiting" })` });
    expect(result.status).toBe(0);
    expect(result.after).toEqual(result.before);
    expect(result.output).toContain("not applied alpha.status");
  });
});
