import { describe, expect, it, vi } from "vitest";
import { TrialSchema } from "../src/lib/schema";
import { checkRegistryTrial, type TrialProtocol } from "./factcheck";

vi.mock("../src/lib/graph", () => ({ graph: vi.fn(() => { throw new Error("unexpected graph access"); }) }));

const trial = TrialSchema.parse({
  id: "alpha-123", kind: "trial", name: "ALPHA-123", nct: "NCT00000123",
  tldr: "Fixture trial.", summary: "Fixture for registry comparisons.", asOf: "2026-09-01",
  phase: "3", status: "recruiting", enrolled: 432, setting: "Fixture setting",
});
const registry: TrialProtocol = {
  identificationModule: { briefTitle: "BETA-456 pharmacokinetics", acronym: "BETA-456" },
  statusModule: { overallStatus: "COMPLETED", primaryCompletionDateStruct: { date: "2025-01-01", type: "ACTUAL" } },
  designModule: { phases: ["PHASE1"], enrollmentInfo: { count: 59, type: "ACTUAL" } },
};

describe("registry identity gates patch proposals", () => {
  it("retains an identity warning but proposes no values from a differently named study", () => {
    const result = checkRegistryTrial(trial, registry, [], "2026-10-05");
    expect(result.mismatches.map((m) => m.check)).toContain("nct-title-mismatch");
    expect(result.patches).toEqual([]);
  });

  it("does not propose the primary-completion fallback while identity is unresolved", () => {
    const result = checkRegistryTrial(trial, { ...registry, statusModule: { ...registry.statusModule, overallStatus: "UNKNOWN" } }, [], "2026-10-05");
    expect(result.mismatches.map((m) => m.check)).toContain("nct-title-mismatch");
    expect(result.patches).toEqual([]);
  });

  it("still produces all supported patches once the registry identifies the same study", () => {
    const matched = { ...registry, identificationModule: { acronym: "ALPHA 123", briefTitle: "ALPHA 123 trial" } };
    const result = checkRegistryTrial(trial, matched, [], "2026-10-05");
    expect(result.mismatches.map((m) => m.check)).not.toContain("nct-title-mismatch");
    expect(result.patches.map((p) => [p.field, p.proposed])).toEqual([["status", "completed"], ["phase", "1"], ["enrolled", "59"]]);
  });

  it("continues using aliases and protocol ids to resolve identity", () => {
    const matched = { ...registry, identificationModule: { orgStudyIdInfo: { id: "ALPHA-123" } } };
    expect(checkRegistryTrial(trial, matched, [], "2026-10-05").patches).toHaveLength(3);
    const alias = { ...registry, identificationModule: { briefTitle: "Betacompound pharmacokinetics" } };
    expect(checkRegistryTrial(trial, alias, ["Betacompound"], "2026-10-05").patches).toHaveLength(3);
  });

  it("withholds patches when a response provides no identity evidence", () => {
    const result = checkRegistryTrial(trial, { ...registry, identificationModule: undefined }, [], "2026-10-05");
    expect(result.patches).toEqual([]);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0].registry).toBe("registry returned no study title or identifier");
  });

  it("holds the HORRAD phase and enrolment proposals seen in the checked-in September 28 report", () => {
    const horrad = { ...trial, id: "horrad", name: "HORRAD", nct: "NCT01053676", status: "completed" as const };
    const response = { ...registry, identificationModule: { briefTitle: "Bioequivalence Study of BAY77-1931 Granule" } };
    const result = checkRegistryTrial(horrad, response, [], "2026-09-28");
    expect(result.mismatches.map((m) => m.check)).toEqual(["nct-title-mismatch"]);
    expect(result.patches).toEqual([]);
  });
});
