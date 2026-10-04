import { describe, expect, it } from "vitest";
import { parseCriteria, profileBiomarkers, profileTherapies, score, tagCriterion } from "./eligibility";

const TEXT = `Inclusion Criteria:

* Histologically confirmed HER2-positive (IHC 3+ or ISH amplified) breast cancer that is unresectable or metastatic.
* Documented progression on or after trastuzumab and a taxane.
* No more than 2 prior lines of systemic therapy in the metastatic setting.
* Eastern Cooperative Oncology Group (ECOG) performance status 0-1.
* Measurable disease per RECIST 1.1.
* Age ≥ 18 years at the time of consent.

Exclusion Criteria:

* Untreated or symptomatic brain metastases, or leptomeningeal disease.
* Prior treatment with trastuzumab deruxtecan.
* Clinically significant cardiac disease.
`;

const LABELS = { "her2-3plus": "HER2 IHC 3+ / amplified", "her2-low": "HER2-low (IHC 1+ or 2+/ISH−)", "egfr-mut": "EGFR activating mutation (ex19del / L858R)", "pdl1-cps10": "PD-L1 CPS ≥ 10 (22C3)" };
const NAMES = { trastuzumab: "Trastuzumab", "trastuzumab-deruxtecan": "Trastuzumab deruxtecan", paclitaxel: "Paclitaxel", pembrolizumab: "Pembrolizumab" };

describe("parseCriteria", () => {
  const cs = parseCriteria(TEXT);
  it("splits inclusion and exclusion items", () => {
    expect(cs.filter((c) => c.kind === "inclusion")).toHaveLength(6);
    expect(cs.filter((c) => c.kind === "exclusion")).toHaveLength(3);
  });
  it("tags ECOG, prior lines, brain metastases, measurable disease, biomarker and age", () => {
    expect(cs[0].tags.biomarkers).toEqual(["HER2"]);
    expect(cs[1].tags.priorTherapyRequired).toEqual(expect.arrayContaining(["trastuzumab", "taxane"]));
    expect(cs[2].tags.priorLinesMax).toBe(2);
    expect(cs[3].tags.ecog).toEqual([0, 1]);
    expect(cs[4].tags.measurableDisease).toBe(true);
    expect(cs[5].tags.age).toEqual({ min: 18 });
    const ex = cs.filter((c) => c.kind === "exclusion");
    expect(ex[0].tags.brainMets).toBe("allowed-if-treated");
    expect(ex[1].tags.priorTherapyExcluded).toEqual(["trastuzumab deruxtecan"]);
    expect(ex[2].tags).toEqual({});
  });
  it("handles numbered items and continuation lines", () => {
    const cs2 = parseCriteria("Inclusion Criteria:\n1. ECOG 0 or 1.\n2. At least one prior line of\n   platinum chemotherapy.\nExclusion Criteria:\n1. Known brain metastases.");
    expect(cs2).toHaveLength(3);
    expect(cs2[0].tags.ecog).toEqual([0, 1]);
    expect(cs2[1].tags.priorLinesMin).toBe(1);
    expect(cs2[1].tags.priorTherapyRequired).toContain("platinum");
    expect(cs2[2].tags.brainMets).toBe("excluded");
  });
  it("returns nothing for empty text", () => {
    expect(parseCriteria("")).toEqual([]);
  });
});

describe("tagCriterion edge cases", () => {
  it("reads first-line as zero prior lines", () => {
    expect(tagCriterion("No prior systemic therapy for metastatic disease (first-line).", "inclusion").priorLinesMax).toBe(0);
  });
  it("reads 'more than N' in exclusions as a maximum", () => {
    expect(tagCriterion("More than 3 prior lines of therapy.", "exclusion").priorLinesMax).toBe(3);
  });
  it("marks excluded biomarkers in exclusion criteria", () => {
    expect(tagCriterion("Known EGFR mutation or ALK rearrangement.", "exclusion").biomarkersExcluded).toEqual(expect.arrayContaining(["EGFR", "ALK"]));
  });
  it("treats a negative inclusion phrasing as excluded", () => {
    expect(tagCriterion("HER2-negative disease (IHC 0, 1+ or 2+/ISH-).", "inclusion").biomarkersExcluded).toEqual(["HER2"]);
  });
  it("prefers the most specific biomarker name", () => {
    expect(tagCriterion("KRAS G12C mutation confirmed by local testing.", "inclusion").biomarkers).toEqual(["KRAS G12C"]);
  });
  it("does not tag prior lines from unrelated numbers", () => {
    expect(tagCriterion("Adequate organ function within 14 days.", "inclusion").priorLinesMax).toBeUndefined();
  });
});

describe("profile helpers", () => {
  it("derives biomarkers from OnCo labels", () => {
    const bm = profileBiomarkers(["her2-3plus", "pdl1-cps10"], LABELS);
    expect(bm.present.has("HER2")).toBe(true);
    expect(bm.present.has("PD-L1")).toBe(true);
    const low = profileBiomarkers(["her2-low"], LABELS);
    expect(low.present.has("HER2-low")).toBe(true);
    expect(low.absent.has("HER2")).toBe(true);
  });
  it("derives therapy classes from drug names or ids", () => {
    const rx = profileTherapies(["trastuzumab", "paclitaxel"], NAMES);
    expect(rx.has("trastuzumab")).toBe(true);
    expect(rx.has("taxane")).toBe(true);
    expect(profileTherapies(["sacituzumab-govitecan"], {}).has("sacituzumab govitecan")).toBe(true);
  });
});

describe("biomarker polarity belongs to its own marker", () => {
  const labels = {
    mixed: "HR-positive, HER2-negative",
    hr: "HR-positive",
    low: "HER2-low (IHC 1+ or 2+/ISH−)",
  };

  it.each([
    "HR-positive, HER2-negative breast cancer.",
    "HER2-negative and HR-positive breast cancer.",
    "HR-positive HER2-negative breast cancer.",
    // ClinicalTrials.gov NCT05514054, inclusion criteria (retrieved 5 October 2026).
    "Have a diagnosis of ER+, HER2- early-stage, resected, invasive breast cancer without evidence of distant metastasis.",
  ])("keeps mixed positive and negative requirements separate: %s", (text) => {
    const tags = tagCriterion(text, "inclusion");
    expect(tags.biomarkers).toEqual(["HR-positive"]);
    expect(tags.biomarkersExcluded).toEqual(["HER2"]);
  });

  it("does not interpret exclusion of a negative result as exclusion of a positive result", () => {
    const tags = tagCriterion("HER2-negative disease.", "exclusion");
    expect(tags.biomarkers).toEqual(["HER2"]);
    expect(tags.biomarkersExcluded).toBeUndefined();
  });

  it("keeps a negative fusion result separate from another positive marker", () => {
    const tags = tagCriterion("ALK fusion-negative and HER2-positive disease.", "inclusion");
    expect(tags.biomarkers).toEqual(["HER2"]);
    expect(tags.biomarkersExcluded).toEqual(["ALK"]);
  });

  it("reads each result in a mixed profile label independently", () => {
    const bm = profileBiomarkers(["mixed"], labels);
    expect([...bm.present]).toEqual(["HR-positive"]);
    expect([...bm.absent]).toEqual(["HER2"]);
  });

  it("does not turn HER2-low into HER2-positive because another marker is positive", () => {
    const bm = profileBiomarkers(["low", "hr"], labels);
    expect(bm.present.has("HER2-low")).toBe(true);
    expect(bm.present.has("HER2")).toBe(false);
    expect(bm.absent.has("HER2")).toBe(true);
  });

  it("does not reject a profile that meets both receptor requirements", () => {
    const result = score(parseCriteria("Inclusion Criteria:\n* HR-positive, HER2-negative breast cancer."),
      { stage: "unknown", biomarkers: ["mixed"], priorLines: [] },
      { biomarkerLabels: labels, drugNames: {} });
    expect(result.verdict).toBe("likely");
    expect(result.checklist[0].status).toBe("met");
  });

  it.each([
    "HER2-positive or HER2-negative disease.",
    "EGFR-mutated or ALK-positive disease.",
  ])("leaves alternative biomarker requirements for the trial team: %s", (text) => {
    const criteria = parseCriteria(`Inclusion Criteria:\n* ${text}\n* HR-positive disease.`);
    const result = score(criteria, { stage: "unknown", biomarkers: ["mixed"], priorLines: [] },
      { biomarkerLabels: labels, drugNames: {} });
    expect(criteria[0].tags.biomarkers).toBeUndefined();
    expect(criteria[0].tags.biomarkersExcluded).toBeUndefined();
    expect(result.checklist[0].status).toBe("unknown");
    expect(result.verdict).toBe("unclear");
  });

  it("does not treat alternative results in a profile label as confirmed results", () => {
    const bm = profileBiomarkers(["alternative"], { alternative: "HER2-positive or HER2-negative" });
    expect(bm.present.size).toBe(0);
    expect(bm.absent.size).toBe(0);
  });

  it.each([
    "HR-positive and HER2-negative breast cancer.",
    "HR-positive, HER2-negative breast cancer.",
  ])("does not negate a combined exclusion one marker at a time: %s", (text) => {
    const result = score(parseCriteria(`Exclusion Criteria:\n* ${text}`),
      { stage: "unknown", biomarkers: ["tnbc"], priorLines: [] },
      { biomarkerLabels: { tnbc: "Triple-negative" }, drugNames: {} });
    expect(result.verdict).toBe("unclear");
    expect(result.checklist[0].status).toBe("unknown");
  });
});

describe("score", () => {
  const cs = parseCriteria(TEXT);
  const ctx = { biomarkerLabels: LABELS, drugNames: NAMES };

  it("is likely for a HER2 profile with one prior line", () => {
    const s = score(cs, { stage: "metastatic-later", biomarkers: ["her2-3plus"], priorLines: ["trastuzumab"] }, ctx);
    expect(s.verdict).toBe("likely");
    expect(s.checklist.find((c) => c.criterion.tags.biomarkers)?.status).toBe("met");
    expect(s.checklist.find((c) => c.criterion.tags.priorLinesMax !== undefined)?.status).toBe("met");
    expect(s.checklist.find((c) => c.criterion.tags.ecog)?.status).toBe("unknown");
    expect(s.unassessed).toBe(1);
  });

  it("is unlikely with three prior lines", () => {
    const s = score(cs, { stage: "metastatic-later", biomarkers: ["her2-3plus"], priorLines: ["trastuzumab", "paclitaxel", "pembrolizumab"] }, ctx);
    expect(s.verdict).toBe("unlikely");
    expect(s.reasons[0]).toContain("at most 2");
  });

  it("is unlikely when an excluded prior therapy was received", () => {
    const s = score(cs, { stage: "metastatic-later", biomarkers: ["her2-3plus"], priorLines: ["trastuzumab-deruxtecan"] }, ctx);
    expect(s.verdict).toBe("unlikely");
    expect(s.reasons.some((r) => r.includes("trastuzumab deruxtecan"))).toBe(true);
  });

  it("is unlikely when the profile contradicts a required biomarker", () => {
    const s = score(cs, { stage: "metastatic-later", biomarkers: ["her2-low"], priorLines: ["trastuzumab"] }, ctx);
    expect(s.verdict).toBe("unlikely");
  });

  it("is unclear for an empty profile", () => {
    const s = score(cs, { stage: "unknown", biomarkers: [], priorLines: [] }, ctx);
    expect(s.verdict).toBe("unclear");
    expect(s.checklist.every((c) => c.status === "unknown")).toBe(true);
  });

  it("does not become unlikely from stage alone when brain metastases are excluded", () => {
    const s = score(parseCriteria("Exclusion Criteria:\n* Brain metastases."), { stage: "metastatic-later", biomarkers: [], priorLines: [] }, ctx);
    expect(s.verdict).toBe("unclear");
  });
});
