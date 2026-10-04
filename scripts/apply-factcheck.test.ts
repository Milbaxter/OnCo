import { describe, expect, it } from "vitest";
import { appendCorrection, applyPatchToSource, findRecord } from "./apply-factcheck";
import { phaseFromRegistry, proposeStatus } from "./factcheck";
import { diffRecords, extractRecords, parseFields } from "./history";

const SRC = `const t = (x) => ({ kind: "trial", asOf, ...x });
export const trials = [
  t({ id: "alpha-1", name: "ALPHA-1", phase: "3", status: "recruiting", asOf: "2026-01-05", setting: "First line", tldr: "A trial, with a {brace} in text.",
    outcomes: [{ endpoint: "OS", arms: [{ name: "A", value: 1 }] }] }),
  { id: "beta-2", kind: "trial", name: "BETA-2", phase: "2", status: "positive", asOf: "2026-02-02", setting: "Later", tldr: "Another." },
];
`;

describe("record location and field parsing", () => {
  it("finds a record by id and returns its outer braces", () => {
    const r = findRecord(SRC, "alpha-1")!;
    expect(SRC.slice(r.start, r.start + 15)).toBe('{ id: "alpha-1"');
    expect(SRC.slice(r.end - 3, r.end)).toBe("] }");
    expect(findRecord(SRC, "gamma-3")).toBeNull();
  });

  it("splits a record into top-level fields, ignoring braces inside strings and nested arrays", () => {
    const recs = extractRecords(SRC);
    expect([...recs.keys()]).toEqual(["alpha-1", "beta-2"]);
    const f = parseFields(recs.get("alpha-1")!);
    expect(f.get("status")).toBe('"recruiting"');
    expect(f.get("tldr")).toBe('"A trial, with a {brace} in text."');
    expect(f.get("outcomes")).toMatch(/^\[\{ endpoint/);
    expect([...f.keys()]).toEqual(["id", "name", "phase", "status", "asOf", "setting", "tldr", "outcomes"]);
  });

  it("diffs two versions of a record field by field", () => {
    const before = extractRecords(SRC).get("alpha-1")!;
    const after = before.replace('status: "recruiting"', 'status: "completed"').replace("First line", "First line, PD-L1 high");
    const d = diffRecords(before, after);
    expect(d).toEqual([
      { field: "status", before: '"recruiting"', after: '"completed"' },
      { field: "setting", before: '"First line"', after: '"First line, PD-L1 high"' },
    ]);
    expect(diffRecords(before, before)).toEqual([]);
  });
});

describe("applying fact-check patches", () => {
  it("only changes the record's own fields, never nested values or quoted examples", () => {
    const source = `export const trials = [
      { id: "alpha", name: "Alpha", notes: 'status: "recruiting"',
        history: [{ status: "recruiting", asOf: "2020-01-01" }],
        status: "recruiting", asOf: "2026-01-01" }
    ];`;
    const result = applyPatchToSource(source, { id: "alpha", field: "status", current: "recruiting", proposed: "completed" }, "2026-10-05");
    expect(result.applied).toBe(true);
    expect(result.source).toBe(source.replace('status: "recruiting", asOf: "2026-01-01"', 'status: "completed", asOf: "2026-10-05"'));
  });

  it("refuses a nested field when the record gets its own field from a helper", () => {
    const source = `t({ id: "alpha", name: "Alpha", history: [{ status: "recruiting" }] })`;
    const result = applyPatchToSource(source, { id: "alpha", field: "status", current: "recruiting", proposed: "completed" }, "2026-10-05");
    expect(result.applied).toBe(false);
    expect(result.source).toBe(source);
  });

  it("finds multiline records and ignores fake records in comments", () => {
    const source = `// { id: "alpha", name: "Fake", status: "recruiting" }
      t({
        id: 'alpha',
        name: "Alpha",
        status: 'recruiting',
        enrolled: 20,
      })`;
    const result = applyPatchToSource(source, { id: "alpha", field: "enrolled", current: "20", proposed: "24" }, "2026-10-05");
    expect(result.applied).toBe(true);
    expect(result.source).toBe(source.replace("enrolled: 20", "enrolled: 24"));
  });

  it("refuses a field that a later spread could override", () => {
    const source = `t({ id: "alpha", name: "Alpha", status: "recruiting", ...overrides })`;
    const result = applyPatchToSource(source, { id: "alpha", field: "status", current: "recruiting", proposed: "completed" }, "2026-10-05");
    expect(result.applied).toBe(false);
    expect(result.source).toBe(source);
  });

  it("does not accept an old nested value when the own field has changed", () => {
    const source = `t({ id: "alpha", name: "Alpha", history: [{ status: "recruiting" }], status: "positive" })`;
    const result = applyPatchToSource(source, { id: "alpha", field: "status", current: "recruiting", proposed: "completed" }, "2026-10-05");
    expect(result.applied).toBe(false);
    expect(result.source).toBe(source);
    expect(result.reason).toContain('field is "positive"');
  });

  it("refuses duplicate record ids and duplicate own fields", () => {
    const record = `t({ id: "alpha", name: "Alpha", status: "recruiting" })`;
    for (const source of [`[${record}, ${record}]`, record.replace('status: "recruiting"', 'status: "recruiting", status: "positive"')]) {
      const result = applyPatchToSource(source, { id: "alpha", field: "status", current: "recruiting", proposed: "completed" }, "2026-10-05");
      expect(result.applied).toBe(false);
      expect(result.source).toBe(source);
    }
  });

  it("replaces the field inside the right record and bumps its asOf", () => {
    const r = applyPatchToSource(SRC, { id: "alpha-1", field: "status", current: "recruiting", proposed: "completed" }, "2026-09-09");
    expect(r.applied).toBe(true);
    expect(r.source).toContain('id: "alpha-1", name: "ALPHA-1", phase: "3", status: "completed", asOf: "2026-09-09"');
    expect(r.source).toContain('id: "beta-2", kind: "trial", name: "BETA-2", phase: "2", status: "positive", asOf: "2026-02-02"');
  });

  it("refuses when the current value no longer matches or the field is not inline", () => {
    const stale = applyPatchToSource(SRC, { id: "alpha-1", field: "status", current: "planned", proposed: "recruiting" }, "2026-09-09");
    expect(stale.applied).toBe(false);
    expect(stale.reason).toContain('field is "recruiting"');
    const noField = applyPatchToSource(SRC.replace('status: "recruiting", ', ""), { id: "alpha-1", field: "status", current: "recruiting", proposed: "completed" }, "2026-09-09");
    expect(noField.applied).toBe(false);
    expect(noField.reason).toContain("not written inline");
  });

  it("appends a corrections row under today's heading, creating the day if needed", () => {
    const md = "# Corrections\n\nIntro.\n\n## 2026-09-07\n\n| Date | Entity | What was wrong | How found | Fix |\n|---|---|---|---|---|\n| 2026-09-07 | x | y | z | w |\n\n## How corrections are logged\n\n- text\n";
    const once = appendCorrection(md, "2026-09-09", "| 2026-09-09 | a | b | c | d |");
    expect(once.indexOf("## 2026-09-09")).toBeLessThan(once.indexOf("## 2026-09-07"));
    expect(once).toContain("|---|---|---|---|---|\n| 2026-09-09 | a | b | c | d |\n\n## 2026-09-07");
    const twice = appendCorrection(once, "2026-09-09", "| 2026-09-09 | e | f | g | h |");
    expect(twice.match(/## 2026-09-09/g)).toHaveLength(1);
    expect(twice).toContain("| 2026-09-09 | a | b | c | d |\n| 2026-09-09 | e | f | g | h |\n\n## 2026-09-07");
  });
});

describe("registry mapping", () => {
  it("proposes a status only where the registry maps unambiguously", () => {
    expect(proposeStatus("recruiting", "COMPLETED")).toBe("completed");
    expect(proposeStatus("recruiting", "WITHDRAWN")).toBe("withdrawn");
    expect(proposeStatus("positive", "COMPLETED")).toBeNull(); // editorial result statuses are not overridden
    expect(proposeStatus("planned", "RECRUITING")).toBe("recruiting");
    expect(proposeStatus("recruiting", "TERMINATED")).toBeNull(); // terminated is not necessarily negative
    expect(proposeStatus(undefined, "COMPLETED")).toBeNull();
  });

  it("maps ClinicalTrials.gov phase arrays onto the phase enum", () => {
    expect(phaseFromRegistry(["PHASE3"])).toBe("3");
    expect(phaseFromRegistry(["PHASE2", "PHASE3"])).toBe("2/3");
    expect(phaseFromRegistry(["PHASE1", "PHASE2"])).toBe("1/2");
    expect(phaseFromRegistry(["NA"])).toBeNull();
    expect(phaseFromRegistry(["EARLY_PHASE1"])).toBeNull();
    expect(phaseFromRegistry(undefined)).toBeNull();
  });
});
