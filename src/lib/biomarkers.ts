import { graph } from "./graph";
import { GENOME_WIDE_MEASUREMENTS, type Biomarker, type Drug, type Entity, type Measurement, type Target, type Trial } from "./schema";

/**
 * Derived views over biomarker readouts (kind "biomarker"): the parent target and sibling readouts, the trials whose
 * text names a readout, the readouts a drug's label requires, and the readouts a tumour test reports. Pure functions
 * over the graph so the target page, the drug page, the tumour-testing table and the browser agree by construction.
 */

/** Label and glyph for each measurement pill. Glyphs are plain characters so the pill needs no icon component. */
export const MEASUREMENT_META: Record<Measurement, { label: string; glyph: string; tip: string }> = {
  "ihc-score": { label: "IHC score", glyph: "◧", tip: "Immunohistochemistry: staining intensity and the share of cells stained, read by a pathologist." },
  "combined-positive-score": { label: "CPS", glyph: "Σ", tip: "Combined positive score: PD-L1-stained tumour and immune cells divided by tumour cells, times 100." },
  "tumour-proportion-score": { label: "TPS", glyph: "%", tip: "Tumour proportion score: percentage of tumour cells with PD-L1 membrane staining." },
  "immune-cell-score": { label: "IC score", glyph: "◌", tip: "Immune-cell score: share of the tumour area covered by PD-L1-stained immune cells (SP142)." },
  "tumour-cell-score": { label: "TC score", glyph: "◍", tip: "Tumour-cell score: percentage of tumour cells stained on the SP263 or 28-8 assays." },
  "fish-ratio": { label: "ISH / FISH", glyph: "⊙", tip: "In situ hybridisation: gene copies per cell and the ratio to a control probe." },
  "sequencing-variant": { label: "Sequencing", glyph: "⟨⟩", tip: "A DNA or RNA sequence change: mutation, fusion or rearrangement, by PCR or sequencing." },
  "msi-status": { label: "MSI status", glyph: "≋", tip: "Microsatellite instability by PCR or sequencing of repeat loci." },
  "tmb-threshold": { label: "TMB", glyph: "#", tip: "Tumour mutational burden: mutations per megabase on a validated panel." },
  methylation: { label: "Methylation", glyph: "m", tip: "Promoter methylation by methylation-specific PCR or pyrosequencing." },
  "pet-tracer-expression": { label: "PET", glyph: "☢", tip: "Target expression read as tracer uptake on a PET scan." },
  "copy-number": { label: "Copy number", glyph: "×n", tip: "Gene or arm copy-number change by FISH, array or sequencing." },
  "hla-typing": { label: "HLA typing", glyph: "◈", tip: "The patient's inherited HLA alleles by sequencing of blood." },
  "ctdna-detection": { label: "ctDNA", glyph: "∿", tip: "Tumour DNA detected in blood above the assay's calling threshold." },
  "genomic-instability-score": { label: "GIS", glyph: "≠", tip: "Genomic instability score: loss of heterozygosity, telomeric imbalance and large-scale transitions." },
};

export const isGenomeWide = (m: Measurement): boolean => GENOME_WIDE_MEASUREMENTS.includes(m);

/** The parent target of a readout, when it has one (genome-wide readouts have none). */
export function parentTarget(bm: Biomarker): Target | undefined {
  const t = bm.target ? graph().get(bm.target) : undefined;
  return t && t.kind === "target" ? t : undefined;
}

/** Readouts that hang off a target, in name order. */
export function readoutsForTarget(targetId: string): Biomarker[] {
  return graph().kind("biomarker").filter((b) => b.target === targetId);
}

/** Sibling readouts: other readouts of the same target, or, for genome-wide readouts, the other genome-wide ones. */
export function siblingReadouts(bm: Biomarker): Biomarker[] {
  const all = graph().kind("biomarker");
  const sibs = bm.target ? all.filter((b) => b.target === bm.target) : all.filter((b) => !b.target);
  return sibs.filter((b) => b.id !== bm.id);
}

/** Readouts whose thresholds name the drug, or that list it in `drugs`. Threshold-named first. */
export function readoutsForDrug(drugId: string): Array<{ biomarker: Biomarker; required: boolean }> {
  const out: Array<{ biomarker: Biomarker; required: boolean }> = [];
  for (const b of graph().kind("biomarker")) {
    const required = b.thresholds.some((t) => t.drugId === drugId && t.status === "current");
    if (required || b.drugs.includes(drugId) || b.companionDiagnostics.some((c) => c.drugs.includes(drugId))) out.push({ biomarker: b, required });
  }
  return out.sort((a, b) => Number(b.required) - Number(a.required) || a.biomarker.name.localeCompare(b.biomarker.name));
}

/** Readouts that a tumour test (src/data/tumour-tests.ts id) reports. */
export function readoutsForTest(testId: string): Biomarker[] {
  return graph().kind("biomarker").filter((b) => b.tests.includes(testId));
}

/** Readouts that point at a glossary term, so the term page can send readers to the readout. */
export function readoutsForTerm(termId: string): Biomarker[] {
  return graph().kind("biomarker").filter((b) => b.terms.includes(termId));
}

/** Escape a string for use inside a RegExp. */
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Aliases short enough to be ambiguous in trial text ("CPS", "TPS", "MSS", "IC score") are only matched with a gene or context word nearby. */
const MIN_ALIAS = 5;

/**
 * Trials whose name, setting, summary or TL;DR names the readout or one of its aliases (whole-word, case-insensitive).
 * Aliases shorter than MIN_ALIAS characters are skipped unless they contain a digit or a symbol (G12C, V600E, T790M),
 * which are specific enough on their own.
 */
export function trialsNaming(bm: Biomarker, limit = 40): Trial[] {
  // An internal parenthesis can precede the defining qualifier: "HER2 (ERBB2) activating mutation".
  // Only omit a final explanatory annotation, keeping useful short names such as "HER2-low".
  const shortName = bm.name.replace(/\s+\([^()]*\)\s*$/, "");
  const names = [bm.name, shortName, ...bm.aka].filter((a) => a.length >= MIN_ALIAS || /[\d≥>=+]/.test(a));
  if (!names.length) return [];
  const re = new RegExp(`(^|[^A-Za-z0-9])(${names.map(esc).join("|")})(?=$|[^A-Za-z0-9])`, "i");
  const out: Trial[] = [];
  for (const t of graph().kind("trial")) {
    if (re.test(`${t.name} ${t.setting} ${t.tldr} ${t.summary}`)) { out.push(t); if (out.length >= limit) break; }
  }
  return out.sort((a, b) => (b.yearReported ?? 0) - (a.yearReported ?? 0) || a.name.localeCompare(b.name));
}

/** Drugs the readout's thresholds name, resolved, de-duplicated, threshold order kept. */
export function thresholdDrugs(bm: Biomarker): Drug[] {
  const seen = new Set<string>();
  const out: Drug[] = [];
  for (const t of bm.thresholds) {
    if (seen.has(t.drugId)) continue;
    seen.add(t.drugId);
    const d = graph().get(t.drugId);
    if (d && d.kind === "drug") out.push(d);
  }
  return out;
}

/** True when at least one current threshold exists. */
export const hasApproval = (bm: Biomarker): boolean => bm.thresholds.some((t) => t.status === "current");

/** Type guard for browser rows and detail tabs. */
export const isBiomarker = (e: Entity): e is Biomarker => e.kind === "biomarker";
