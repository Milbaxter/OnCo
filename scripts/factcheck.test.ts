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
  it("does not release patches for another trial of a linked drug", () => {
    // Synthetic comparison: conflicting values deliberately exercise every patch field.
    const source = { ...trial, name: "IMpassion130", drugs: ["atezolizumab"] };
    const other = { ...registry, identificationModule: { acronym: "IMpower110", briefTitle: "Study of Atezolizumab in Lung Cancer" } };
    const result = checkRegistryTrial(source, other, "2026-10-05");
    expect(result.mismatches.map((m) => m.check)).toEqual(["nct-title-mismatch"]);
    expect(result.patches).toEqual([]);
  });

  it("does not identify a trial by a shared family name", () => {
    const source = { ...trial, name: "KEYNOTE-522" };
    const other = { ...registry, identificationModule: { acronym: "KEYNOTE-024" } };
    const result = checkRegistryTrial(source, other, "2026-10-05");
    expect(result.mismatches.map((m) => m.check)).toEqual(["nct-title-mismatch"]);
    expect(result.patches).toEqual([]);
  });

  it.each([
    ["ASCENT", "ASCENT-03"],
    ["ASCENT", "ASCENT 03"],
    ["ALPHA-123", "ALPHA-123-2"],
    ["ALPHA-123", "ALPHA-123 - 2"],
    ["ALPHA-123", "ALPHA 123 2"],
    ["ALPHA-123", "ALPHA-123/2"],
    ["ALPHA-123", "ALPHA-123_2"],
    ["ALPHA-123", "ALPHA-123.2"],
    ["ALPHA-123", "ALPHA-123:2"],
    ["ALPHA-123", "ALPHA-123–2"],
    ["ALPHA-123", "ALPHA-123-EXT"],
    ["ALPHA-123", "PREFIX/ALPHA-123"],
  ])("holds patches when %s is only part of identifier %s", (name, acronym) => {
    const result = checkRegistryTrial({ ...trial, name }, { ...registry, identificationModule: { acronym } }, "2026-10-05");
    expect(result.patches).toEqual([]);
    expect(result.mismatches.map((m) => m.check)).toEqual(["nct-title-mismatch"]);
  });

  it("does not identify a descriptive trial title by its drug or disease alone", () => {
    const source = { ...trial, name: "Atezolizumab with nab-paclitaxel in breast cancer" };
    const other = { ...registry, identificationModule: { briefTitle: "Atezolizumab with radiotherapy in breast cancer" } };
    const result = checkRegistryTrial(source, other, "2026-10-05");
    expect(result.patches).toEqual([]);
    expect(result.mismatches.map((m) => m.check)).toEqual(["nct-title-mismatch"]);
  });

  it.each([
    { acronym: "ALPHA-1230" },
    { acronym: "XALPHA-123" },
    { acronym: "ALPHA", briefTitle: "123 participants in another study" },
  ])("does not match partial identifiers or assemble identity across fields: %j", (identificationModule) => {
    const result = checkRegistryTrial(trial, { ...registry, identificationModule }, "2026-10-05");
    expect(result.patches).toEqual([]);
    expect(result.mismatches.map((m) => m.check)).toEqual(["nct-title-mismatch"]);
  });

  it("retains an identity warning but proposes no values from a differently named study", () => {
    const result = checkRegistryTrial(trial, registry, "2026-10-05");
    expect(result.mismatches.map((m) => m.check)).toContain("nct-title-mismatch");
    expect(result.patches).toEqual([]);
  });

  it("does not propose the primary-completion fallback while identity is unresolved", () => {
    const result = checkRegistryTrial(trial, { ...registry, statusModule: { ...registry.statusModule, overallStatus: "UNKNOWN" } }, "2026-10-05");
    expect(result.mismatches.map((m) => m.check)).toContain("nct-title-mismatch");
    expect(result.patches).toEqual([]);
  });

  it("still produces all supported patches once the registry identifies the same study", () => {
    const matched = { ...registry, identificationModule: { acronym: "ALPHA 123", briefTitle: "ALPHA 123 trial" } };
    const result = checkRegistryTrial(trial, matched, "2026-10-05");
    expect(result.mismatches.map((m) => m.check)).not.toContain("nct-title-mismatch");
    expect(result.patches.map((p) => [p.field, p.proposed])).toEqual([["status", "completed"], ["phase", "1"], ["enrolled", "59"]]);
  });

  it("continues using aliases and protocol ids to resolve identity", () => {
    const matched = { ...registry, identificationModule: { orgStudyIdInfo: { id: "ALPHA-123" } } };
    expect(checkRegistryTrial(trial, matched, "2026-10-05").patches).toHaveLength(3);
    const alias = { ...registry, identificationModule: { briefTitle: "Study of pembrolizumab", secondaryIdInfos: [{ id: "STUDY-456" }] } };
    expect(checkRegistryTrial({ ...trial, aka: ["STUDY 456"] }, alias, "2026-10-05").patches).toHaveLength(3);
  });

  it("matches a complete descriptive title or a trial name with parenthetical context", () => {
    const source = { ...trial, name: "Atezolizumab with radiotherapy in breast cancer" };
    const titled = { ...registry, identificationModule: { officialTitle: "Atezolizumab With Radiotherapy in Breast Cancer" } };
    expect(checkRegistryTrial(source, titled, "2026-10-05").patches).toHaveLength(3);
    const named = { ...registry, identificationModule: { briefTitle: "Study of pembrolizumab (ALPHA 123)" } };
    expect(checkRegistryTrial({ ...trial, name: "ALPHA-123 (primary analysis)" }, named, "2026-10-05").patches).toHaveLength(3);
  });

  it("matches a complete title containing an internal parenthetical", () => {
    const name = "4SC-201 (Resminostat) and Sorafenib in Advanced Hepatocellular Carcinoma";
    const matched = { ...registry, identificationModule: { officialTitle: name } };
    const result = checkRegistryTrial({ ...trial, name }, matched, "2026-10-05");
    expect(result.patches).toHaveLength(3);
    expect(result.mismatches.map((m) => m.check)).not.toContain("nct-title-mismatch");
  });

  it.each(["(ALPHA-123)", "ALPHA-123: A study of pembrolizumab", "Study ALPHA-123.", "Trial ALPHA 123 (primary analysis)"])("retains surrounding title punctuation in %s", (briefTitle) => {
    const result = checkRegistryTrial(trial, { ...registry, identificationModule: { briefTitle } }, "2026-10-05");
    expect(result.patches).toHaveLength(3);
    expect(result.mismatches.map((m) => m.check)).not.toContain("nct-title-mismatch");
  });

  it.each(["OAK", "IoN"])("accepts the short trial name %s when it matches a complete registry field", (name) => {
    const matched = { ...registry, identificationModule: { acronym: name } };
    expect(checkRegistryTrial({ ...trial, name }, matched, "2026-10-05").patches).toHaveLength(3);
  });

  it("does not identify IoN by an isolated word in a different study title", () => {
    const other = { ...registry, identificationModule: { briefTitle: "Ion beam therapy for prostate cancer" } };
    expect(checkRegistryTrial({ ...trial, name: "IoN" }, other, "2026-10-05").patches).toEqual([]);
  });

  it("withholds patches when a response provides no identity evidence", () => {
    const result = checkRegistryTrial(trial, { ...registry, identificationModule: undefined }, "2026-10-05");
    expect(result.patches).toEqual([]);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0].registry).toBe("registry returned no study title or identifier");
  });

  it("holds the HORRAD phase and enrolment proposals seen in the checked-in September 28 report", () => {
    const horrad = { ...trial, id: "horrad", name: "HORRAD", nct: "NCT01053676", status: "completed" as const };
    const response = { ...registry, identificationModule: { briefTitle: "Bioequivalence Study of BAY77-1931 Granule" } };
    const result = checkRegistryTrial(horrad, response, "2026-09-28");
    expect(result.mismatches.map((m) => m.check)).toEqual(["nct-title-mismatch"]);
    expect(result.patches).toEqual([]);
  });
});
