/**
 * The open drug engine: every medicine in the corpus taken apart into its modules (target, payload, linker,
 * isotope, costimulatory domain, E3 ligase and so on, per format in src/lib/modular-formats.ts), and the
 * permutation grid of two modules per format with every cell classified from records alone.
 *
 * Rules. Nothing is inferred beyond what a field says: a part is resolved from the drug's own fields (`targets`,
 * `payload`, `linker`, `mechanism`, `modality`, `name`, `technologies`), from the ADC payload and linker registry
 * (src/data/payloads.ts), or from the INN stem of the name (`-deruxtecan` is DXd by the WHO naming scheme), and
 * every resolution says which fields it read and how sure it is. A drug whose grid row cannot be resolved is
 * listed as unresolved with the reason; it is never placed by guesswork. A cell's state comes from records that
 * are named beside it: the drug record's status, approval rows (`approvals`, src/data/regional-approvals.ts),
 * trial records linked to the drug with their statuses and, for stopped studies, the registry's own reason
 * (the "Why stopped, in the sponsor's words" note written by scripts/fetch-registry-status.ts), negative results,
 * withdrawn approvals, and the ClinicalTrials.gov index under public/trials/. "Untried" means no medicine in this
 * corpus combines the two parts; it says nothing about the world.
 */
import { graph, type Graph } from "./graph";
import { routeFor, type Drug, type Entity, type Trial } from "./schema";
import { linkers, payloads } from "@/data/payloads";
import { isotopes } from "@/data/isotopes";
import { regionalApprovals, REGION_META, type Region } from "@/data/regional-approvals";
import trialsIndex from "../../public/trials/index.json";
import { COMPONENT_LABEL, FORMATS, NOT_RECORDED, type CellState, type ComponentKey, type FormatDef, type FormatId } from "./modular-formats";

export type { CellState, ComponentKey, FormatDef, FormatId } from "./modular-formats";

type RegistryEntry = { total: number; byPhase: Record<string, number>; byStatus: Record<string, number>; recruiting: number; fetched: string };
const REGISTRY = trialsIndex as Record<string, RegistryEntry>;

export type Confidence = "high" | "medium" | "low";

/** One interchangeable part of a medicine, as a value: an id for the grid, a name for the reader, a page where one exists. */
export type Component = { key: ComponentKey; id: string; name: string; href?: string };
/** A part as resolved for one drug: the value, how sure the decomposer is, the fields it read, and any detail the fields gave beyond the value (the specific linker behind a linker type). */
export type Resolved = Component & { confidence: Confidence; from: string[]; detail?: string };

export type DrugState = Exclude<CellState, "untried">;

/** One record behind a state claim. `record` is an entity id or `registry:<drug id>` (public/trials/<drug id>.json); `field` names the part of the record read. */
export type Evidence = { record: string; field?: string; kind: "drug" | "trial" | "approval" | "regional" | "event" | "registry"; state: DrugState; label: string; href: string; quote?: string };

/** Why a stopped medicine stopped, in the words of the record that says so. */
export type StopReason = { drugId: string; drugName: string; drugRoute: string; drugState: DrugState; record: string; kind: Evidence["kind"]; label: string; href: string; quote: string };

export type DecomposedDrug = {
  id: string; name: string; route: string; format: FormatId; status?: string; modality: string;
  components: Partial<Record<ComponentKey, Resolved>>;
  confidence: Confidence; fields: string[];
  state: DrugState; evidence: Evidence[]; reasons: StopReason[];
};
export type UnresolvedDrug = { id: string; name: string; route: string; format: FormatId; modality: string; missing: ComponentKey[]; why: string };
/** A drug the engine does not try to take apart, with the reason (a chemotherapy, a test, a device, an imaging agent). */
export type OutsideDrug = { id: string; name: string; route: string; modality: string; reason: string };

export type CellDrug = { id: string; name: string; route: string; state: DrugState; status?: string };
export type Cell = {
  a: Component; b: Component; state: Exclude<CellState, "untried">;
  drugs: CellDrug[];
  counts: Record<DrugState, number>;
  /** The other parts seen in this cell (payloads, linkers, binders), for the table's filters. */
  parts: Partial<Record<ComponentKey, Component[]>>;
  evidence: Evidence[];
  reasons: StopReason[];
};
export type ComponentCount = Component & { count: number; drugIds: string[]; states: Record<DrugState, number> };

export type FormatIndex = {
  format: FormatDef;
  drugs: DecomposedDrug[];
  unresolved: UnresolvedDrug[];
  rows: Component[]; cols: Component[];
  cells: Cell[];
  counts: Record<CellState, number> & { drugs: number; partial: number; unresolved: number };
  components: Partial<Record<ComponentKey, ComponentCount[]>>;
  stopped: StopReason[];
  coverage: { total: number; full: number; partial: number; unresolved: number; pct: number };
};
export type Engine = { formats: FormatIndex[]; outside: OutsideDrug[]; outsideByReason: Array<{ reason: string; count: number }>; /** Latest contributing registry snapshot; fetchedFrom is the oldest. */ fetched: string; fetchedFrom: string; drugs: number };

/**
 * A combination proposed but not yet tried, as the format page renders it: one cell of the grid named by the ids
 * the engine uses for its two axes. The source records live in src/data/combination-ideas.ts (validated by
 * CombinationIdeaSchema in src/lib/schema.ts) and are mapped to this shape by src/lib/combination-ideas-adapter.ts,
 * which also normalises their component values to the grid's row and column ids and flags those it cannot place.
 */
export type ProposedCell = {
  id: string; format: FormatId; name: string;
  /** Grid ids after normalisation; `raw` keeps the record's own values. */
  a: string; b: string; raw: { a: string; b: string };
  /** Both components resolve to a grid row or column, or to a corpus target; otherwise the unresolved value is named. */
  matched: boolean; unmatched: string[];
  rationale: string; caveat: string;
  status: string; statusLabel: string;
  score: { total: number; burden: number; worldDeaths: number; validationA: number; validationB: number; plausibility: number };
  evidence: Array<{ label: string; url: string; quote: string; kind: string; adjacent?: boolean }>;
  refs: string[]; cancers: string[];
  proposedBy: string; on: string;
};

// ---------------------------------------------------------------------------------------------------------------
// Vocabulary the decomposer reads with: regex tables, never free interpretation.

const STOPPED_STATUS = new Set(["withdrawn", "negative", "historic"]);
const APPROVED_STATUS = new Set(["approved", "standard-of-care", "established"]);
const DEVELOPMENT_STATUS = new Set(["phase-3", "phase-2", "phase-1", "preclinical", "concept", "emerging"]);
const DEV_TRIAL = new Set(["recruiting", "active", "planned"]);

/** Aliases that are ordinary words or too generic to read from prose. */
const ALIAS_STOP = new Set(["ADA", "BET", "BH3", "HOX1", "MOP1", "MLLr", "INDO", "MUM1", "B7x", "B7-1", "B7.1", "ILA", "PRC2", "FADK", "TPOR", "JTK7", "JTK3", "MCAP", "HIF1", "F3"]);
/** Targets that are not antigens a carrier, cell or radioligand can aim at (payload targets, restriction elements). */
const NOT_ANTIGEN = new Set(["tubulin", "top1", "top2a", "tyms", "parp", "dhfr", "hla-a", "rrm1", "gart", "eef2"]);
/** Arms of a bispecific that recruit an immune cell rather than bind the tumour; they take the column axis. */
const EFFECTOR_ARMS = ["cd3", "cd28", "cd137", "cd16", "cd47"];
const CHECKPOINTS = new Set(["pd1", "pdl1", "ctla4", "tigit", "lag3", "tim3", "vista", "cd47", "cd73-adenosine"]);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type PayloadHit = { payload?: { id: string; name: string }; payloadClass: { id: string; name: string }; confidence: Confidence };
const PAYLOAD_CLASSES: Record<string, { id: string; name: string }> = {
  "Topoisomerase-I inhibitor": { id: "topoisomerase-i-payloads", name: "Topoisomerase I inhibitor" },
  "Tubulin inhibitor": { id: "tubulin-inhibitor-payloads", name: "Tubulin inhibitor" },
  "DNA crosslinker (PBD dimer)": { id: "pbd-dimer-payloads", name: "DNA crosslinker (PBD dimer)" },
  "DNA cleaver": { id: "dna-cleaver-payloads", name: "DNA cleaver (enediyne)" },
  "DNA alkylator": { id: "dna-alkylator-payloads", name: "DNA alkylator" },
  "Protein toxin": { id: "protein-toxin-payloads", name: "Protein toxin" },
  "Radionuclide": { id: "radionuclide-payloads", name: "Radionuclide" },
  "Alkylating prodrug": { id: "dna-alkylator-payloads", name: "DNA alkylator" },
};
const TOP1 = PAYLOAD_CLASSES["Topoisomerase-I inhibitor"], TUB = PAYLOAD_CLASSES["Tubulin inhibitor"], PBD = PAYLOAD_CLASSES["DNA crosslinker (PBD dimer)"], CLEAVER = PAYLOAD_CLASSES["DNA cleaver"], ALK = PAYLOAD_CLASSES["DNA alkylator"], TOXIN = PAYLOAD_CLASSES["Protein toxin"];
/** Payload words in a `payload` field or mechanism text, most specific first. */
const PAYLOAD_WORDS: Array<[RegExp, { id: string; name: string } | undefined, { id: string; name: string }]> = [
  [/\bDXd\b|deruxtecan|MAAA-1181/i, { id: "dxd", name: "DXd" }, TOP1],
  [/\bSN-?38\b|govitecan/i, { id: "sn-38", name: "SN-38" }, TOP1],
  [/\bT030\b|tirumotecan|belotecan/i, { id: "t030", name: "T030" }, TOP1],
  [/\bEd-04\b|brengitecan/i, { id: "exatecan", name: "Exatecan derivative (Ed-04)" }, TOP1],
  [/rezetecan|SHR9265/i, { id: "rezetecan", name: "Rezetecan" }, TOP1],
  [/exatecan/i, { id: "exatecan", name: "Exatecan" }, TOP1],
  [/AZ14170133|samrotecan/i, { id: "az14170133", name: "AZ14170133" }, TOP1],
  [/camptothecin|topoisomerase[- ]?I\b|TOP1|topoisomerase I inhibitor|-tecan\b/i, undefined, TOP1],
  [/\bMMAE\b|vedotin|monomethyl auristatin E/i, { id: "mmae", name: "MMAE" }, TUB],
  [/\bMMAF\b|mafodotin|monomethyl auristatin F/i, { id: "mmaf", name: "MMAF" }, TUB],
  [/\bDM1\b|emtansine|mertansine/i, { id: "dm1", name: "DM1" }, TUB],
  [/\bDM4\b|ravtansine|soravtansine/i, { id: "dm4", name: "DM4" }, TUB],
  [/hemiasterlin|tazevibulin|SC209/i, { id: "hemiasterlin", name: "Hemiasterlin (SC209)" }, TUB],
  [/AS269/i, { id: "as269", name: "AS269" }, TUB],
  [/duostatin/i, { id: "duostatin", name: "Duostatin" }, TUB],
  [/zovodotin/i, { id: "zovodotin", name: "Zovodotin (auristatin)" }, TUB],
  [/auristatin|maytansin|tubulin|microtubule|-dotin\b|zovodotin|rilsodotin|pevedotin|dolaflexin|eribulin|ecteribulin/i, undefined, TUB],
  [/\bPBD\b|pyrrolobenzodiazepine|tesirine|talirine|SG3199|SC-DR002/i, { id: "pbd-sg3199", name: "PBD dimer" }, PBD],
  [/calicheamicin|ozogamicin|enediyne/i, { id: "calicheamicin", name: "Calicheamicin" }, CLEAVER],
  [/duocarmycin|duocarmazine|seco-DUBA|\bDUBA\b/i, { id: "duocarmycin", name: "Duocarmycin (seco-DUBA)" }, ALK],
  [/indolinobenzodiazepine|\bIGN\b|sunirine/i, { id: "ign", name: "Indolinobenzodiazepine (IGN)" }, ALK],
  [/PNU-159682/i, { id: "pnu-159682", name: "PNU-159682" }, ALK],
  [/alkylat/i, undefined, ALK],
  [/exotoxin|immunotoxin|pasudotox|diphtheria|\btoxin\b/i, undefined, TOXIN],
];
const INN_PAYLOAD: Array<[RegExp, PayloadHit]> = [
  [/deruxtecan$/, { payload: { id: "dxd", name: "DXd" }, payloadClass: TOP1, confidence: "high" }],
  [/govitecan$/, { payload: { id: "sn-38", name: "SN-38" }, payloadClass: TOP1, confidence: "high" }],
  [/tirumotecan$/, { payload: { id: "t030", name: "T030" }, payloadClass: TOP1, confidence: "high" }],
  [/brengitecan$/, { payload: { id: "exatecan", name: "Exatecan derivative (Ed-04)" }, payloadClass: TOP1, confidence: "high" }],
  [/rezetecan$/, { payload: { id: "rezetecan", name: "Rezetecan" }, payloadClass: TOP1, confidence: "high" }],
  [/samrotecan$/, { payload: { id: "az14170133", name: "AZ14170133" }, payloadClass: TOP1, confidence: "high" }],
  [/tecan$/, { payloadClass: TOP1, confidence: "medium" }],
  [/vedotin$/, { payload: { id: "mmae", name: "MMAE" }, payloadClass: TUB, confidence: "high" }],
  [/mafodotin$/, { payload: { id: "mmaf", name: "MMAF" }, payloadClass: TUB, confidence: "high" }],
  [/emtansine$/, { payload: { id: "dm1", name: "DM1" }, payloadClass: TUB, confidence: "high" }],
  [/(sora|ra)vtansine$/, { payload: { id: "dm4", name: "DM4" }, payloadClass: TUB, confidence: "high" }],
  [/tazevibulin$/, { payload: { id: "hemiasterlin", name: "Hemiasterlin (SC209)" }, payloadClass: TUB, confidence: "high" }],
  [/dotin$|bulin$/, { payloadClass: TUB, confidence: "medium" }],
  [/tesirine$|talirine$/, { payload: { id: "pbd-sg3199", name: "PBD dimer" }, payloadClass: PBD, confidence: "high" }],
  [/ozogamicin$/, { payload: { id: "calicheamicin", name: "Calicheamicin" }, payloadClass: CLEAVER, confidence: "high" }],
  [/duocarmazine$/, { payload: { id: "duocarmycin", name: "Duocarmycin (seco-DUBA)" }, payloadClass: ALK, confidence: "high" }],
  [/sunirine$/, { payload: { id: "ign", name: "Indolinobenzodiazepine (IGN)" }, payloadClass: ALK, confidence: "high" }],
  [/pasudotox$|tox$/, { payloadClass: TOXIN, confidence: "medium" }],
];

type Iso = { id: string; name: string; emission: string; re: RegExp };
const ISOTOPES: Iso[] = [
  { id: "lu-177", name: "Lutetium-177", emission: "beta", re: /177\s?Lu|Lu-?177|lutetium/i },
  { id: "ac-225", name: "Actinium-225", emission: "alpha", re: /225\s?Ac|Ac-?225|actinium/i },
  { id: "pb-212", name: "Lead-212", emission: "alpha", re: /212\s?Pb|Pb-?212|lead-212/i },
  { id: "ra-223", name: "Radium-223", emission: "alpha", re: /223\s?Ra|Ra-?223|radium-?223|radium/i },
  { id: "th-227", name: "Thorium-227", emission: "alpha", re: /227\s?Th|Th-?227|thorium-227/i },
  { id: "at-211", name: "Astatine-211", emission: "alpha", re: /211\s?At|At-?211|astatine/i },
  { id: "bi-213", name: "Bismuth-213", emission: "alpha", re: /213\s?Bi|Bi-?213/i },
  { id: "i-131", name: "Iodine-131", emission: "beta", re: /131\s?I\b|I-?131|iodine-?131|radioiodine|radioactive iodine|iobenguane I-131/i },
  { id: "y-90", name: "Yttrium-90", emission: "beta", re: /\b90\s?Y\b|Y-?90|yttrium/i },
  { id: "sm-153", name: "Samarium-153", emission: "beta", re: /153\s?Sm|Sm-?153|samarium/i },
  { id: "sr-89", name: "Strontium-89", emission: "beta", re: /\b89\s?Sr|Sr-?89|strontium/i },
  { id: "p-32", name: "Phosphorus-32", emission: "beta", re: /\b32\s?P\b|P-?32|phosphorus-32|radiophosphorus/i },
  { id: "cu-67", name: "Copper-67", emission: "beta", re: /\b67\s?Cu|Cu-?67/i },
  { id: "tb-161", name: "Terbium-161", emission: "beta", re: /161\s?Tb|Tb-?161|terbium/i },
  { id: "ho-166", name: "Holmium-166", emission: "beta", re: /166\s?Ho|Ho-?166|holmium/i },
];
const EMISSION_NAME: Record<string, string> = { beta: "Beta emitter", alpha: "Alpha emitter" };

const NAMED = (id: string, name: string) => ({ id, name });
const rx = (pairs: Array<[RegExp, { id: string; name: string }]>, text: string) => pairs.find(([re]) => re.test(text))?.[1];

// ---------------------------------------------------------------------------------------------------------------
// Format classification from the free-text modality (and the INN stem of the name).

type Classified = { format: FormatId } | { outside: string };
export function classify(d: Drug): Classified {
  const m = d.modality, n = d.name, mn = `${m} ${n}`;
  const tech = new Set(d.technologies);
  if (/\bPET\b|imaging|lymphatic|SPECT|tracer|fluorescen|kit for|companion diagnostic|\btest\b|assay|classifier|profiling|screening|software|contrast/i.test(m)) return { outside: "tests, imaging agents and software" };
  if (/\bdevice\b|hydrogel|drug-eluting|wafer only/i.test(m)) return { outside: "devices" };
  if (/radioligand|radiopharm|alpha therapy|radioimmunotherapy|theranostic|beta emitter|radionuclide|iodine-131|\b131I|177Lu|225Ac|212Pb|223Ra|153Sm|\b90Y\b|yttrium-90|lutetium|actinium|radium/i.test(mn)) return { format: "radioligand" };
  if (/\bADC\b|antibody[- ]drug|drug conjugate|toxin conjugate|immunotoxin|exotoxin|cytotoxin \(fusion|nanocell/i.test(m) || tech.has("adc") || tech.has("bispecific-adc")) return { format: "adc" };
  if (/\bCAR[- ]?T\b|CAR T|CAR-?NK|chimeric antigen receptor/i.test(m) || /cabtagene/i.test(n)) return { format: "car-t" };
  if (/bispecific|bifunctional|trispecific|multispecific|engager|immtac|biparatopic|\bDART\b|\bBiTE\b|trifunctional/i.test(m) && !/mixture|combination/i.test(m)) return { format: "bispecific" };
  if (/TCR-?T|T-cell receptor|\bTAC\b/i.test(m) || /resgene/i.test(n) || tech.has("tcr-t")) return { format: "tcr-t" };
  if (/degrader|PROTAC|molecular glue|CELMoD|\bIMiD\b|cereblon/i.test(m) || tech.has("protac-degrader") || tech.has("celmods")) return { format: "degrader" };
  if (/vaccine|neoantigen|virus-like particle/i.test(m) || tech.has("neoantigen-mrna-vaccine") || tech.has("shared-antigen-vaccine") || tech.has("hpv-vaccine")) return { format: "vaccine" };
  if (/oncolytic|repvec/i.test(mn) || tech.has("oncolytic-virus")) return { format: "oncolytic-virus" };
  if (/cell therapy|\bTIL\b|tumou?r-infiltrating|cord blood|stromal cell|virus-specific T|\bNK cell|cellular immunotherapy/i.test(m) || /leucel$/i.test(n) || tech.has("til-therapy")) return { format: "cell-therapy" };
  if (/G-CSF|colony-stimulating|erythropoi|growth factor support|hepcidin|antidote|cardioprotect|cytoprotect|antiemetic|bisphosphonate|glucocorticoid|neuroprotect|platelet-lowering|anti-inflammatory|hormone replacement|radioenhancer|photosensiti|contrast/i.test(m)) return { outside: "supportive and protective medicines" };
  if ((/cytokine|interleukin|\bIL-?\d|interferon|\bTNF|superagonist|immunocytokine|aldesleukin/i.test(m) || tech.has("cytokine-therapy")) && !/monoclonal antibody|^antibody/i.test(m)) return { format: "cytokine" };
  if (/cytotoxic|chemotherap|alkylat|platinum|taxane|antimetabolite|nucleoside|anthracycl|vinca|antifolate|topoisomerase II|fluoropyrimidine|epothilone|nitrosourea|mustard|antibiotic|hypomethylating|regimen|arsenic|differentiation agent|liposomal|depsipeptide|actinomycin|asparaginase|enzyme therapy|prodrug of doxorubicin|hypoxia-activated|radiosensitiser|GnRH|somatostatin analogue|progestin|synthetic (?:androgen|oestrogen|estrogen)|bacterial immunotherapy|BCG/i.test(m)) return { outside: "chemotherapies, hormones and other established classes" };
  if (/monoclonal|antibody|biosimilar|Fc-engineered|fusion protein|\btrap\b|immune checkpoint modulator|bispecific combination|\banti-[A-Z0-9]|-mab\b/i.test(m) || /mab$/i.test(n) || tech.has("monoclonal-antibody") || tech.has("checkpoint-inhibitor")) return { format: "antibody" };
  if (/small[- ]molecule|inhibitor|\bTKI\b|kinase|SERD|SERM|antagonist|agonist|analogue|antiandrogen|aromatase|modulator|\boral\b/i.test(m) || tech.has("kinase-inhibitors") || tech.has("parp-inhibitor")) return { format: "small-molecule" };
  if (/gene therapy|antisense|oligonucleotide|siRNA|peptide|protein|not stated|registered as a drug/i.test(m)) return { outside: "other modalities the engine has no taxonomy for yet" };
  return { outside: "other modalities the engine has no taxonomy for yet" };
}

// ---------------------------------------------------------------------------------------------------------------
// Target reading: the record's own `targets`, else the names the corpus knows for its targets found in the prose.

type Alias = { re: RegExp; id: string };
function targetAliases(g: Graph): Alias[] {
  const out: Alias[] = [];
  for (const t of g.kind("target")) {
    const names = new Set<string>([t.name.replace(/\s*\(.*?\)\s*$/, ""), ...(t.symbol ? [t.symbol] : []), ...t.aka, ...[...t.name.matchAll(/\(([^)]+)\)/g)].flatMap((m) => m[1].split(/,\s*/))]);
    for (const a of names) {
      const s = a.trim();
      if (s.length < 3 || ALIAS_STOP.has(s) || /^[0-9]+$/.test(s)) continue;
      const body = esc(s).replace(/[-\s]/g, "[-\\s]?");
      out.push({ re: new RegExp(`(?<![A-Za-z0-9])${body}(?![A-Za-z0-9])`, s.length <= 4 ? "" : "i"), id: t.id });
    }
  }
  // Longest alias first so "PD-L1" wins over "PD-1" inside "PD-L1", and "HER3" is not read as part of "HER2/HER3".
  return out.sort((x, y) => y.re.source.length - x.re.source.length);
}

/** Target ids named in `text`, in order of first appearance, one per target. */
function findTargets(text: string, aliases: Alias[]): string[] {
  const t = text.replace(/×/g, " x ");
  const hits: Array<[number, string]> = [];
  const seen = new Set<string>();
  for (const a of aliases) {
    if (seen.has(a.id)) continue;
    const m = a.re.exec(t);
    if (m) { seen.add(a.id); hits.push([m.index, a.id]); }
  }
  return hits.sort((x, y) => x[0] - y[0]).map((h) => h[1]);
}

// ---------------------------------------------------------------------------------------------------------------
// The decomposer.

class Decomposer {
  private aliases: Alias[];
  private payloadByDrug = new Map<string, (typeof payloads)[number]>();
  private linkerByDrug = new Map<string, (typeof linkers)[number]>();
  private isotopeIds = new Set(isotopes.map((i) => i.id));
  constructor(private g: Graph) {
    this.aliases = targetAliases(g);
    for (const p of payloads) for (const id of p.adcs) this.payloadByDrug.set(id, p);
    for (const l of linkers) for (const id of l.adcs) this.linkerByDrug.set(id, l);
  }

  private entityHref(...ids: string[]): string | undefined {
    for (const id of ids) { const e = this.g.get(id); if (e) return routeFor(e); }
    return undefined;
  }
  private targetComponent(key: ComponentKey, id: string, confidence: Confidence, from: string[]): Resolved {
    const e = this.g.get(id);
    return { key, id, name: e?.name ?? id, href: e ? routeFor(e) : undefined, confidence, from };
  }
  private named(key: ComponentKey, v: { id: string; name: string }, confidence: Confidence, from: string[], hrefIds: string[] = [], detail?: string): Resolved {
    return { key, id: v.id, name: v.name, href: this.entityHref(...hrefIds), confidence, from, ...(detail ? { detail } : {}) };
  }
  /** Targets whose own record lists the drug (the `drugs` field on a target): the link declared from the other side. */
  private targetsNaming(drugId: string): string[] {
    return (this.g.incoming(drugId).get("target") ?? []).map((t) => t.id).filter((t) => !NOT_ANTIGEN.has(t));
  }
  /**
   * A conjugate's antibody is named by the first word of its INN (telisotuzumab vedotin and telisotuzumab adizutecan
   * share the anti-MET antibody telisotuzumab). When another corpus drug carries the same antibody word and a target,
   * that target is read across: the same molecule aims at the same antigen.
   */
  private siblingConjugateTargets(d: Drug): { ids: string[]; name: string } | undefined {
    const stem = d.id.split("-")[0];
    if (!/mab$/.test(stem) || stem.length < 8) return undefined;
    for (const other of this.g.kind("drug")) {
      if (other.id === d.id || !(other.id === stem || other.id.startsWith(`${stem}-`))) continue;
      const ids = other.targets.filter((t) => !NOT_ANTIGEN.has(t));
      if (ids.length) return { ids, name: other.name };
    }
    return undefined;
  }
  /**
   * The targets a drug's own trials record, once the targets of the other drugs in each trial are removed: a trial of
   * "X plus pembrolizumab" names PD-1 for pembrolizumab, not for X. Used only when every trial agrees on one target.
   */
  private trialTargets(d: Drug): string[] {
    const trials = new Set<Entity>();
    for (const t of this.g.incoming(d.id).get("trial") ?? []) trials.add(t);
    for (const id of d.trials) { const t = this.g.get(id); if (t) trials.add(t); }
    const agreed = new Set<string>();
    for (const t of trials) {
      if (t.kind !== "trial") continue;
      const others = new Set(t.drugs.filter((x) => x !== d.id).flatMap((x) => this.g.get(x)?.targets ?? []));
      const mine = t.targets.filter((x) => !others.has(x) && !NOT_ANTIGEN.has(x));
      for (const x of mine) agreed.add(x);
    }
    return agreed.size === 1 ? [...agreed] : [];
  }
  private text(d: Drug): string { return `${d.name} ${d.aka.join(" ")} ${d.modality} ${d.mechanism} ${d.mechanismSteps.join(" ")}`; }

  /** Antigen-like targets: the record's own first (high), else those the prose names (medium), else an "anti-X" the mechanism spells out (low, no page). */
  private antigens(d: Drug, opts: { allowProse?: boolean } = { allowProse: true }): { ids: string[]; names: string[]; confidence: Confidence; from: string[] } {
    const own = d.targets.filter((t) => !NOT_ANTIGEN.has(t));
    if (own.length) return { ids: own, names: [], confidence: "high", from: ["targets"] };
    const back = this.targetsNaming(d.id);
    if (back.length) return { ids: back, names: [], confidence: "high", from: ["target record (drugs field)"] };
    const sibling = this.siblingConjugateTargets(d);
    if (sibling) return { ids: sibling.ids, names: [], confidence: "medium", from: [`name (antibody INN shared with ${sibling.name})`] };
    const viaTrials = this.trialTargets(d);
    if (viaTrials.length) return { ids: viaTrials, names: [], confidence: "medium", from: ["trial record (targets field)"] };
    if (opts.allowProse) {
      const prose = findTargets(`${d.modality} ${d.mechanism}`, this.aliases).filter((t) => !NOT_ANTIGEN.has(t));
      if (prose.length) return { ids: prose, names: [], confidence: "medium", from: ["modality", "mechanism"] };
      const inSummary = findTargets(d.summary, this.aliases).filter((t) => !NOT_ANTIGEN.has(t));
      if (inSummary.length === 1) return { ids: inSummary, names: [], confidence: "medium", from: ["summary"] };
      const NAMED_TARGET = /(?:anti-|against |targeting |targets |directed at |directed against |its target as )([A-Z][A-Za-z0-9.-]{1,12})/;
      const anti = d.mechanism.match(NAMED_TARGET) ?? d.summary.match(NAMED_TARGET);
      if (anti) return { ids: [], names: [anti[1].replace(/[.-]$/, "")], confidence: "low", from: [d.mechanism.match(NAMED_TARGET) ? "mechanism" : "summary"] };
    }
    return { ids: [], names: [], confidence: "low", from: [] };
  }
  private joinTargets(key: ComponentKey, ids: string[], names: string[], confidence: Confidence, from: string[]): Resolved | undefined {
    if (ids.length) {
      const parts = ids.map((id) => this.targetComponent(key, id, confidence, from));
      if (parts.length === 1) return parts[0];
      return { key, id: parts.map((p) => p.id).join("+"), name: parts.map((p) => p.name.replace(/\s*\(.*?\)\s*$/, "")).join(" x "), href: parts[0].href, confidence, from, detail: "dual-target" };
    }
    if (names.length) return { key, id: names[0].toLowerCase().replace(/[^a-z0-9]+/g, "-"), name: names[0], confidence, from, detail: "named in the record; no target page" };
    return undefined;
  }

  private payload(d: Drug): { payload?: Resolved; payloadClass?: Resolved; dar?: Resolved } {
    const out: { payload?: Resolved; payloadClass?: Resolved; dar?: Resolved } = {};
    const reg = this.payloadByDrug.get(d.id);
    const classFor = (cls: keyof typeof PAYLOAD_CLASSES) => PAYLOAD_CLASSES[cls];
    if (reg) {
      out.payload = this.named("payload", { id: reg.id, name: reg.name }, "high", ["payload registry"], [reg.id]);
      out.payloadClass = this.named("payloadClass", classFor(reg.class), "high", ["payload registry"], [classFor(reg.class).id]);
    } else {
      const fieldText = d.payload ?? "";
      const hitIn = (text: string, from: string, confidence: Confidence) => {
        for (const [re, p, cls] of PAYLOAD_WORDS) if (re.test(text)) {
          if (p) out.payload = this.named("payload", p, confidence, [from], [p.id]);
          out.payloadClass = this.named("payloadClass", cls, confidence, [from], [cls.id]);
          return true;
        }
        return false;
      };
      if (!(fieldText && hitIn(fieldText, "payload", "high"))) {
        const inn = INN_PAYLOAD.find(([re]) => re.test(d.id) || re.test(d.name.toLowerCase().replace(/\s+/g, "-")));
        if (inn) {
          if (inn[1].payload) out.payload = this.named("payload", inn[1].payload, inn[1].confidence, ["name (INN stem)"], [inn[1].payload.id]);
          out.payloadClass = this.named("payloadClass", inn[1].payloadClass, inn[1].confidence, ["name (INN stem)"], [inn[1].payloadClass.id]);
        } else hitIn(`${d.mechanism} ${d.modality}`, "mechanism", "medium");
      }
    }
    const dar = (d.payload ?? "").match(/DAR\s*~?\s*(\d+(?:\.\d+)?)/i) ?? d.mechanism.match(/DAR\s*~?\s*(\d+(?:\.\d+)?)/i) ?? d.mechanism.match(/drug-to-antibody ratio[^0-9]{0,20}(\d+(?:\.\d+)?)/i);
    if (dar) out.dar = this.named("dar", { id: String(Math.round(Number(dar[1]))), name: `DAR ~${Math.round(Number(dar[1]))}` }, "high", [d.payload && /DAR/i.test(d.payload) ? "payload" : "mechanism"], ["dar"], `recorded as ${dar[1]}`);
    return out;
  }

  private linker(d: Drug): Resolved | undefined {
    const reg = this.linkerByDrug.get(d.id);
    if (reg) return this.named("linker", { id: reg.type, name: reg.type === "cleavable" ? "Cleavable" : "Non-cleavable" }, "high", ["linker registry"], ["linker"], reg.name);
    const t = d.linker ?? "";
    if (/non-cleavable|noncleavable|thioether|SMCC/i.test(t)) return this.named("linker", { id: "non-cleavable", name: "Non-cleavable" }, "high", ["linker"], ["linker"], t);
    if (/cleavable|hydrazone|disulfide|GGFG|Val-Cit|vc-PABC|dipeptide|tetrapeptide|pH-sensitive|CL2A|protease/i.test(t)) return this.named("linker", { id: "cleavable", name: "Cleavable" }, "high", ["linker"], ["linker"], t);
    if (/non-cleavable/i.test(d.mechanism)) return this.named("linker", { id: "non-cleavable", name: "Non-cleavable" }, "medium", ["mechanism"], ["linker"]);
    if (/cleavable|cathepsin|disulfide|hydrazone|protease-cleav/i.test(d.mechanism)) return this.named("linker", { id: "cleavable", name: "Cleavable" }, "medium", ["mechanism"], ["linker"]);
    return undefined;
  }

  private carrier(d: Drug): Resolved {
    const t = `${d.modality} ${d.mechanism}`;
    const hit = rx([
      [/bispecific|biparatopic|dual [A-Za-z0-9/]+ binding/i, NAMED("bispecific-antibody", "Bispecific antibody")],
      [/bicycl/i, NAMED("bicyclic-peptide", "Bicyclic peptide")],
      [/peptide-drug|peptidase-activated|peptide/i, NAMED("peptide", "Peptide")],
      [/nanocell|minicell/i, NAMED("bacterial-minicell", "Bacterial minicell")],
      [/immunotoxin|exotoxin|fusion protein|cytotoxin/i, NAMED("protein-fusion", "Antibody fragment or cytokine fusion")],
    ], t) ?? NAMED("monoclonal-antibody", "Monoclonal antibody");
    const detail = (t.match(/Ig[GAM][1-4]?/)?.[0]) ?? undefined;
    return this.named("carrier", hit, /antibody|ADC|conjugate/i.test(d.modality) ? "high" : "medium", ["modality", "mechanism"], [hit.id === "bispecific-antibody" ? "bispecific-adc" : hit.id === "peptide" || hit.id === "bicyclic-peptide" ? "peptide-drug-conjugate" : "monoclonal-antibody"], detail);
  }

  decompose(d: Drug, format: FormatId): Partial<Record<ComponentKey, Resolved>> {
    const c: Partial<Record<ComponentKey, Resolved>> = {};
    const text = this.text(d);
    const set = (r: Resolved | undefined) => { if (r) c[r.key] = r; };
    switch (format) {
      case "adc": {
        const a = this.antigens(d);
        set(this.joinTargets("target", a.ids, a.names, a.confidence, a.from));
        const p = this.payload(d); set(p.payload); set(p.payloadClass); set(p.dar);
        set(this.linker(d));
        set(this.carrier(d));
        break;
      }
      case "radioligand": {
        const a = this.antigens(d);
        let target = this.joinTargets("target", a.ids, a.names, a.confidence, a.from);
        if (!target) {
          const m = d.mechanism;
          if (/bone matrix|hydroxyapatite|calcium mimetic|bone turnover|osteoblastic/i.test(m)) target = { key: "target", id: "bone-matrix", name: "Bone matrix (calcium mimetic)", confidence: "medium", from: ["mechanism"] };
          else if (/sodium-iodide symporter|\bNIS\b/i.test(m)) target = { key: "target", id: "nis", name: "Sodium-iodide symporter (NIS)", confidence: "medium", from: ["mechanism"] };
          else if (/norepinephrine transporter/i.test(m)) target = { key: "target", id: "net", name: "Norepinephrine transporter", confidence: "medium", from: ["mechanism"] };
        }
        set(target);
        const iso = ISOTOPES.find((i) => i.re.test(text));
        if (iso) {
          set({ key: "isotope", id: iso.id, name: iso.name, href: this.isotopeIds.has(iso.id) ? `/isotopes/#${iso.id}` : undefined, confidence: "high", from: [iso.re.test(d.name) ? "name" : /177|225|212|223|131|153/.test(d.modality) ? "modality" : "mechanism"] });
          set({ key: "emission", id: iso.emission, name: EMISSION_NAME[iso.emission], href: this.entityHref(iso.emission === "alpha" ? "targeted-alpha-therapy" : "radioligand-therapy"), confidence: "high", from: ["isotope (physics table)"] });
        }
        const chel = rx([[/DOTAGA/i, NAMED("dotaga", "DOTAGA")], [/DOTA|tetraxetan|DOTATATE|DOTATOC|DOTAMTATE|dotatate/i, NAMED("dota", "DOTA")], [/EDTMP|lexidronam/i, NAMED("edtmp", "EDTMP")], [/macropa/i, NAMED("macropa", "Macropa")], [/HBED/i, NAMED("hbed", "HBED-CC")]], text);
        if (chel) set(this.named("chelator", chel, "high", ["name", "mechanism"]));
        const lig = rx([[/antibody/i, NAMED("antibody", "Antibody")], [/peptide|DOTATATE|DOTATOC|edotreotide|octreot|somatostatin analogue|DOTAMTATE|agonist/i, NAMED("peptide", "Peptide")], [/small-molecule|urea|PSMA-617|PSMA-I&T|vipivotide|ligand/i, NAMED("small-molecule", "Small-molecule ligand")], [/calcium mimetic|phosphonate|EDTMP|bone/i, NAMED("bone-seeker", "Bone-seeking mimetic")], [/iodide|MIBG|benzylguanidine|phosphate/i, NAMED("substrate", "Transporter substrate")]], `${d.modality} ${d.mechanism}`);
        if (lig) set(this.named("ligand", lig, "medium", ["modality", "mechanism"], [lig.id === "antibody" ? "radioimmunotherapy" : lig.id === "peptide" ? "prrt" : ""]));
        break;
      }
      case "car-t": {
        const a = this.antigens(d);
        set(this.joinTargets("target", a.ids, a.names, a.confidence, a.from));
        const m = d.mechanism + " " + d.modality;
        const costim = rx([[/4-1BB|41BB|CD137/i, NAMED("4-1bb", "4-1BB")], [/CD28/i, NAMED("cd28", "CD28")]], m);
        if (costim) set(this.named("costim", costim, "high", ["mechanism", "modality"], [costim.id === "4-1bb" ? "cd137" : "cd28"]));
        const binder = rx([[/VHH|nanobod|single-domain/i, NAMED("vhh", "VHH (single domain)")], [/D-domain/i, NAMED("d-domain", "D-domain")], [/scFv/i, NAMED("scfv", "scFv")], [/TAC\b|antigen coupler/i, NAMED("tac", "T-cell antigen coupler")]], m);
        if (binder) set(this.named("binder", binder, "high", ["mechanism"], [], m.match(/fully human|humanised|humanized|murine/i)?.[0]));
        const src = rx([[/autologous|patient's own|patient-derived|manufactured from the patient/i, NAMED("autologous", "Autologous")], [/allogeneic|donor|off-the-shelf/i, NAMED("allogeneic", "Allogeneic")]], m);
        if (src) set(this.named("cellSource", src, "high", ["mechanism", "modality"], [src.id === "allogeneic" ? "allogeneic-cell-therapy" : "car-t-manufacturing-process"]));
        const cell = rx([[/CAR-?NK|NK cell|haNK/i, NAMED("nk", "NK cell")], [/gamma-delta|γδ/i, NAMED("gamma-delta-t", "Gamma-delta T cell")], [/macrophage/i, NAMED("macrophage", "Macrophage")]], m) ?? NAMED("t", "T cell");
        set(this.named("cellType", cell, cell.id === "t" ? "medium" : "high", ["modality", "mechanism"], [cell.id === "nk" ? "car-nk-macrophage" : cell.id === "gamma-delta-t" ? "gamma-delta-t-cell-therapy" : "car-t"]));
        const vec = rx([[/lentivir/i, NAMED("lentiviral", "Lentiviral")], [/retrovir/i, NAMED("retroviral", "Retroviral")], [/CRISPR|gene-edit|base edit/i, NAMED("gene-edited", "Gene-edited")], [/transposon|piggyBac|sleeping beauty/i, NAMED("transposon", "Transposon")]], m);
        if (vec) set(this.named("vector", vec, "high", ["mechanism"], ["viral-vector-manufacturing"]));
        break;
      }
      case "tcr-t": {
        const a = this.antigens(d);
        set(this.joinTargets("target", a.ids, a.names, a.confidence, a.from));
        const hla = text.match(/HLA-?A\*?0?2(?::0?1)?|HLA-A\*?11|HLA-?A/i);
        if (d.targets.includes("hla-a") || hla) set({ key: "hla", id: "hla-a02", name: hla && /02|A\*2/.test(hla[0]) ? "HLA-A*02" : "HLA-A", href: this.entityHref("hla-a"), confidence: hla ? "high" : "medium", from: [d.targets.includes("hla-a") ? "targets" : "mechanism"] });
        const src = rx([[/autologous|patient's own/i, NAMED("autologous", "Autologous")], [/allogeneic|donor/i, NAMED("allogeneic", "Allogeneic")]], text);
        if (src) set(this.named("cellSource", src, "high", ["mechanism"]));
        const f = rx([[/affinity-enhanced/i, NAMED("affinity-enhanced-tcr", "Affinity-enhanced TCR")], [/antigen coupler|\bTAC\b/i, NAMED("tac", "T-cell antigen coupler")]], text);
        if (f) set(this.named("format", f, "high", ["mechanism", "modality"], ["tcr-t"]));
        break;
      }
      case "bispecific": {
        const own = d.targets.filter((t) => !NOT_ANTIGEN.has(t));
        // Prose fills in a missing arm only; a record that already names both arms is not second-guessed.
        const prose = own.length >= 2 ? [] : findTargets(`${d.modality} ${d.mechanism}`, this.aliases).filter((t) => !NOT_ANTIGEN.has(t));
        const ids = [...new Set([...own, ...prose])];
        // A biparatopic antibody binds two epitopes of one target: both arms are that target.
        if (ids.length === 1 && /biparatopic/i.test(d.modality)) ids.push(ids[0]);
        const from = own.length && prose.some((p) => !own.includes(p)) ? ["targets", "modality", "mechanism"] : own.length ? ["targets"] : ["modality", "mechanism"];
        const effector = ids.find((t) => EFFECTOR_ARMS.includes(t));
        const tumour = ids.filter((t) => t !== effector);
        // A record that names both arms is high; so is a biparatopic whose one declared target is, by definition, both arms.
        const conf: Confidence = own.length >= 2 || (own.length === 1 && ids.length === 2 && ids[0] === ids[1]) ? "high" : ids.length >= 2 ? "medium" : ids.length ? "medium" : "low";
        if (ids.length === 2 && ids[0] === ids[1]) { set(this.targetComponent("target", ids[0], conf, from)); set({ ...this.targetComponent("targetB", ids[0], conf, [...from, "modality"]), detail: "biparatopic: two epitopes of one target" }); }
        else if (effector && tumour.length) { set(this.joinTargets("target", tumour, [], conf, from)); set(this.targetComponent("targetB", effector, conf, from)); }
        else if (tumour.length >= 2) {
          const [a, b] = tumour.map((id) => this.targetComponent("target", id, conf, from)).sort((x, y) => x.name.localeCompare(y.name));
          set(a); set({ ...b, key: "targetB" });
          if (tumour.length > 2) c.target = { ...a, id: tumour.filter((t) => t !== b.id).join("+"), name: tumour.filter((t) => t !== b.id).map((t) => this.g.get(t)?.name ?? t).join(" x "), detail: "trispecific" };
        } else if (ids.length === 1) set(this.targetComponent(effector ? "targetB" : "target", ids[0], conf, from));
        else { const anti = [...d.mechanism.matchAll(/anti-([A-Z][A-Za-z0-9.-]{1,12})/g)].map((m) => m[1]); if (anti[0]) set(this.joinTargets("target", [], [anti[0]], "low", ["mechanism"])); if (anti[1]) set({ ...this.joinTargets("targetB", [], [anti[1]], "low", ["mechanism"])!, key: "targetB" }); }
        const a = c.target?.id, b = c.targetB?.id;
        const pair = b === "cd3" || /engager|BiTE|ImmTAC/i.test(d.modality) ? NAMED("t-cell-engager", "T-cell engager") : b && ["cd28", "cd137"].includes(b) ? NAMED("costimulatory", "Costimulatory") : a && b && CHECKPOINTS.has(a) && CHECKPOINTS.has(b) ? NAMED("dual-checkpoint", "Dual checkpoint") : a && b && (CHECKPOINTS.has(a) || CHECKPOINTS.has(b)) ? NAMED("checkpoint-plus", "Checkpoint plus a second axis") : a && b ? NAMED("dual-tumour-target", "Dual tumour target") : undefined;
        if (pair) set(this.named("pairClass", pair, b ? "high" : "medium", ["targets", "modality"], [pair.id === "t-cell-engager" ? "t-cell-engager" : "bispecific-antibody"]));
        const f = rx([[/ImmTAC|TCR/i, NAMED("immtac", "ImmTAC (TCR x CD3)")], [/\bBiTE\b|tandem scFv/i, NAMED("bite", "BiTE (tandem scFv)")], [/DuoBody/i, NAMED("duobody", "DuoBody IgG1")], [/2:1|2\+1/i, NAMED("two-to-one", "2:1 IgG")], [/\bDART\b/i, NAMED("dart", "DART")], [/trifunctional|rat-mouse/i, NAMED("triomab", "Trifunctional (Triomab)")], [/trispecific/i, NAMED("trispecific", "Trispecific")], [/fusion|trap/i, NAMED("antibody-trap", "Antibody-trap fusion")], [/Ig[GAM][1-4]?/, NAMED("igg-like", "IgG-like")]], `${d.modality} ${d.mechanism}`);
        if (f) set(this.named("format", f, "high", ["modality", "mechanism"], [f.id === "trispecific" ? "trispecific-antibodies" : f.id === "immtac" ? "t-cell-engager" : "bispecific-antibody"]));
        break;
      }
      case "degrader": {
        const back = this.targetsNaming(d.id).filter((t) => t !== "cereblon");
        const ids = d.targets.length ? d.targets : back.length ? back : findTargets(`${d.modality} ${d.mechanism}`, this.aliases).filter((t) => t !== "cereblon");
        set(this.joinTargets("target", ids.filter((t) => t !== "cereblon"), [], d.targets.length || back.length ? "high" : "medium", d.targets.length ? ["targets"] : back.length ? ["target record (drugs field)"] : ["modality", "mechanism"]));
        const m = `${d.modality} ${d.mechanism}`;
        const lig = rx([[/cereblon|CRBN|CELMoD|IMiD|molecular glue|immunomodulatory/i, NAMED("cereblon", "Cereblon (CRBN)")], [/\bVHL\b|von Hippel/i, NAMED("vhl", "VHL")], [/\bIAP\b|cIAP/i, NAMED("iap", "IAP")], [/DCAF/i, NAMED("dcaf", "DCAF")], [/\bMDM2\b.*ligase/i, NAMED("mdm2", "MDM2")]], m);
        if (lig) set(this.named("ligase", lig, "high", ["modality", "mechanism"], [lig.id === "cereblon" ? "cereblon" : lig.id]));
        const type = rx([[/molecular glue|CELMoD|IMiD|cereblon modulator|immunomodulatory drug/i, NAMED("molecular-glue", "Molecular glue")], [/PROTAC|heterobifunctional|recruit.*E3 ligase/i, NAMED("protac", "PROTAC (heterobifunctional)")], [/SERD|receptor degrader|ligand-directed degrader/i, NAMED("receptor-degrader", "Receptor-directed degrader")], [/degrader/i, NAMED("degrader-unspecified", "Degrader (mechanism not stated)")]], m);
        if (type) set(this.named("degraderType", type, "high", ["modality", "mechanism"], [type.id === "molecular-glue" ? "celmods" : "protac-degrader"]));
        break;
      }
      case "small-molecule": {
        const back = this.targetsNaming(d.id);
        const ids = d.targets.length ? d.targets : back.length ? back : findTargets(`${d.modality} ${d.mechanism}`, this.aliases);
        set(this.joinTargets("target", ids.slice(0, 2), [], d.targets.length || back.length ? "high" : "medium", d.targets.length ? ["targets"] : back.length ? ["target record (drugs field)"] : ["modality", "mechanism"]));
        const tech = d.technologies;
        const TECH_CLASS: Array<[string, { id: string; name: string }]> = [
          ["parp-inhibitor", NAMED("parp-inhibitor", "PARP inhibitor")], ["cdk46-inhibitor", NAMED("cdk-inhibitor", "CDK inhibitor")], ["kras-inhibitors", NAMED("ras-inhibitor", "RAS inhibitor")], ["bcl2-inhibitors", NAMED("bcl2-inhibitor", "BCL-2 inhibitor")], ["idh-inhibitors", NAMED("idh-inhibitor", "IDH inhibitor")], ["menin-inhibitors", NAMED("menin-inhibitor", "Menin inhibitor")], ["endocrine-therapy", NAMED("endocrine", "Endocrine therapy")], ["oral-serds", NAMED("endocrine", "Endocrine therapy")], ["pi3k-akt-mtor-inhibitors", NAMED("pi3k-akt-mtor-inhibitor", "PI3K, AKT or mTOR inhibitor")], ["hedgehog-inhibitors", NAMED("hedgehog-inhibitor", "Hedgehog inhibitor")], ["atr-chk1-inhibitors", NAMED("ddr-inhibitor", "DNA damage response inhibitor")], ["mdm2-inhibitors", NAMED("mdm2-inhibitor", "MDM2 inhibitor")], ["lsd1-inhibitors", NAMED("epigenetic", "Epigenetic inhibitor")], ["kat6-inhibitors", NAMED("epigenetic", "Epigenetic inhibitor")], ["epigenetic-drugs", NAMED("epigenetic", "Epigenetic inhibitor")], ["gamma-secretase-inhibitors", NAMED("gamma-secretase-inhibitor", "Gamma-secretase inhibitor")], ["her2-tyrosine-kinase-inhibitors", NAMED("kinase-inhibitor", "Kinase inhibitor")], ["kinase-inhibitors", NAMED("kinase-inhibitor", "Kinase inhibitor")], ["antiangiogenic", NAMED("kinase-inhibitor", "Kinase inhibitor")],
        ];
        const fromTech = TECH_CLASS.find(([t]) => tech.includes(t));
        const m = `${d.modality} ${d.mechanism}`;
        const cls = fromTech?.[1] ?? rx([
          [/PARP/i, NAMED("parp-inhibitor", "PARP inhibitor")], [/\bCDK/i, NAMED("cdk-inhibitor", "CDK inhibitor")], [/KRAS|\bRAS\b|SOS1|SHP2/i, NAMED("ras-inhibitor", "RAS inhibitor")], [/BCL-?2|MCL-?1|BH3/i, NAMED("bcl2-inhibitor", "BCL-2 inhibitor")], [/\bIDH/i, NAMED("idh-inhibitor", "IDH inhibitor")], [/menin/i, NAMED("menin-inhibitor", "Menin inhibitor")],
          [/SERD|SERM|aromatase|antiandrogen|androgen receptor|oestrogen|estrogen|CYP17|CYP11B|androgen synthesis|hormon/i, NAMED("endocrine", "Endocrine therapy")], [/PI3K|\bAKT\b|mTOR/i, NAMED("pi3k-akt-mtor-inhibitor", "PI3K, AKT or mTOR inhibitor")], [/hedgehog|smoothened|\bSMO\b/i, NAMED("hedgehog-inhibitor", "Hedgehog inhibitor")], [/\bATR\b|CHK1|WEE1|PKMYT1|POL[θQ]|ATM\b/i, NAMED("ddr-inhibitor", "DNA damage response inhibitor")], [/MDM2|p53/i, NAMED("mdm2-inhibitor", "MDM2 inhibitor")],
          [/HDAC|EZH2|DNMT|LSD1|KAT6|BET\b|BRD4|bromodomain|methyltransferase|deacetylase|epigenetic|PRMT5|DOT1L/i, NAMED("epigenetic", "Epigenetic inhibitor")], [/proteasome/i, NAMED("proteasome-inhibitor", "Proteasome inhibitor")], [/XPO1|exportin|nuclear export/i, NAMED("xpo1-inhibitor", "XPO1 inhibitor")], [/gamma-secretase/i, NAMED("gamma-secretase-inhibitor", "Gamma-secretase inhibitor")], [/IAP|SMAC/i, NAMED("iap-antagonist", "IAP antagonist")], [/HIF/i, NAMED("hif-inhibitor", "HIF inhibitor")], [/NEDD8|NAE\b/i, NAMED("nae-inhibitor", "NAE inhibitor")],
          [/kinase|\bTKI\b|BTK|MEK|EGFR|ALK|ROS1|RET|MET|FGFR|VEGFR|JAK|FLT3|KIT|BRAF|NTRK|AXL|FAK|PDGFR|HER2|CSF1R|Aurora|PLK|SYK|ERK/i, NAMED("kinase-inhibitor", "Kinase inhibitor")],
          [/agonist/i, NAMED("receptor-agonist", "Receptor agonist")], [/antagonist/i, NAMED("receptor-antagonist", "Receptor antagonist")], [/metabol|glutaminase|IDO|arginase|dehydrogenase/i, NAMED("metabolic-inhibitor", "Metabolic enzyme inhibitor")], [/inhibitor/i, NAMED("other-inhibitor", "Inhibitor (class not stated)")],
        ], m);
        if (cls) set(this.named("mechanismClass", cls, fromTech ? "high" : "medium", fromTech ? ["technologies"] : ["modality", "mechanism"], [fromTech?.[0] ?? (cls.id === "kinase-inhibitor" ? "kinase-inhibitors" : cls.id === "parp-inhibitor" ? "parp-inhibitor" : cls.id === "endocrine" ? "endocrine-therapy" : cls.id === "ras-inhibitor" ? "kras-inhibitors" : cls.id === "cdk-inhibitor" ? "cdk46-inhibitor" : cls.id === "bcl2-inhibitor" ? "bcl2-inhibitors" : cls.id === "idh-inhibitor" ? "idh-inhibitors" : cls.id === "menin-inhibitor" ? "menin-inhibitors" : cls.id === "pi3k-akt-mtor-inhibitor" ? "pi3k-akt-mtor-inhibitors" : cls.id === "hedgehog-inhibitor" ? "hedgehog-inhibitors" : cls.id === "mdm2-inhibitor" ? "mdm2-inhibitors" : cls.id === "epigenetic" ? "epigenetic-drugs" : "")]));
        const bind = rx([[/covalent|irreversible/i, NAMED("covalent", "Covalent")], [/allosteric/i, NAMED("allosteric", "Allosteric")], [/ATP-competitive|reversible/i, NAMED("atp-competitive", "ATP-competitive or reversible")], [/selective/i, NAMED("selective", "Selective (mode not stated)")]], m);
        if (bind) set(this.named("binding", bind, "high", ["modality", "mechanism"]));
        break;
      }
      case "antibody": {
        const a = this.antigens(d);
        set(this.joinTargets("target", a.ids, a.names, a.confidence, a.from));
        const m = `${d.modality} ${d.mechanism}`;
        const f = rx([[/biosimilar/i, NAMED("biosimilar", "Biosimilar")], [/mixture|combination|co-?formulated/i, NAMED("fixed-combination", "Fixed-dose antibody combination")], [/Fc-engineered|afucosylated|glycoengineered|ADCC-enhanced|Fc-enhanced|defucosylated|low-fucose/i, NAMED("fc-engineered", "Fc-engineered (effector enhanced)")], [/Fc-silent|Fc null|Fc-engineered null|IgG4|IgG2/i, NAMED("fc-silent", "Fc-silent or IgG4")], [/fusion|\btrap\b|Fc fusion/i, NAMED("fc-fusion", "Fc fusion or ligand trap")], [/IgG1|ADCC-competent|ADCC/i, NAMED("igg1", "IgG1 (Fc-competent)")], [/chimeric/i, NAMED("chimeric", "Chimeric")]], m);
        if (f) set(this.named("antibodyFormat", f, "high", ["modality", "mechanism"], [f.id === "biosimilar" ? "biosimilar-manufacturing" : "monoclonal-antibody"], m.match(/fully human|humanised|humanized|murine|chimeric/i)?.[0]));
        break;
      }
      case "cytokine": {
        const m = `${d.name} ${d.modality} ${d.mechanism}`;
        const cy = rx([[/IL-?2\b|interleukin-2|aldesleukin/i, NAMED("il-2", "Interleukin-2")], [/IL-?15|interleukin-15/i, NAMED("il-15", "Interleukin-15")], [/IL-?12|interleukin-12/i, NAMED("il-12", "Interleukin-12")], [/IL-?10/i, NAMED("il-10", "Interleukin-10")], [/IL-?7\b/i, NAMED("il-7", "Interleukin-7")], [/IL-?18/i, NAMED("il-18", "Interleukin-18")], [/IL-?21/i, NAMED("il-21", "Interleukin-21")], [/interferon alfa|interferon-alpha|IFN-?α|IFN-?alpha|interferon/i, NAMED("ifn-alpha", "Interferon alfa")], [/TNF/i, NAMED("tnf-alpha", "Tumour necrosis factor alfa")], [/GM-CSF/i, NAMED("gm-csf", "GM-CSF")]], m);
        if (cy) set(this.named("cytokine", cy, "high", ["name", "modality", "mechanism"], ["cytokine-therapy"]));
        const eng = rx([[/PEG/i, NAMED("pegylated", "PEGylated")], [/superagonist/i, NAMED("superagonist", "Superagonist complex")], [/immunocytokine|antibody-cytokine|fused to an antibody|antibody/i, NAMED("immunocytokine", "Immunocytokine (antibody-aimed)")], [/Fc fusion|fused to.*Fc|Fc fragment/i, NAMED("fc-fusion", "Fc fusion")], [/mutein|biased|not-alpha|CD122/i, NAMED("receptor-biased", "Receptor-biased mutein")], [/isolated limb|intratumou?ral|intralesional|intravesical/i, NAMED("local-delivery", "Local delivery")], [/recombinant/i, NAMED("recombinant", "Recombinant wild-type")]], m);
        if (eng) set(this.named("engineering", eng, "high", ["modality", "mechanism"], [eng.id === "immunocytokine" ? "immunocytokines" : "cytokine-therapy"]));
        const a = this.antigens(d, { allowProse: false });
        set(this.joinTargets("target", a.ids, [], a.confidence, a.from));
        break;
      }
      case "vaccine": {
        const m = `${d.name} ${d.modality} ${d.mechanism}`;
        const ids = d.targets.filter((t) => !NOT_ANTIGEN.has(t));
        let antigen: Resolved | undefined;
        if (/neoantigen|personalised|personalized|patient-specific|neoepitope/i.test(m)) antigen = { key: "antigen", id: "personalised-neoantigens", name: "Personalised neoantigens", href: this.entityHref("neoantigen-mrna-vaccine"), confidence: "high", from: ["modality", "mechanism"] };
        else if (/HPV/i.test(m)) antigen = { key: "antigen", id: "hpv", name: "HPV antigens (L1, E6, E7)", href: this.entityHref("hpv-vaccine"), confidence: "high", from: ["modality", "mechanism"] };
        else if (ids.length) antigen = this.joinTargets("antigen", ids, [], "high", ["targets"]);
        else if (/tumou?r lysate/i.test(m)) antigen = { key: "antigen", id: "tumour-lysate", name: "Autologous tumour lysate", confidence: "high", from: ["mechanism"] };
        else if (/Globo H|glycan|carbohydrate/i.test(m)) antigen = { key: "antigen", id: "glycan", name: "Tumour glycan (Globo H)", confidence: "high", from: ["mechanism"] };
        else if (/brachyury|TBXT/i.test(m)) antigen = { key: "antigen", id: "brachyury", name: "Brachyury (TBXT)", confidence: "high", from: ["mechanism"] };
        else if (/prostatic acid phosphatase|PAP\b/i.test(m)) antigen = this.targetComponent("antigen", "pap", "medium", ["mechanism"]);
        else if (/alpha-gal/i.test(m)) antigen = { key: "antigen", id: "alpha-gal", name: "Alpha-gal (xenoantigen)", confidence: "high", from: ["mechanism"] };
        else { const prose = findTargets(d.mechanism, this.aliases).filter((t) => !NOT_ANTIGEN.has(t)); if (prose.length) antigen = this.joinTargets("antigen", prose, [], "medium", ["mechanism"]); }
        set(antigen);
        if (ids.length) set(this.joinTargets("target", ids, [], "high", ["targets"]));
        const plat = rx([[/mRNA|lipoplex|\bLNP\b|lipid nanoparticle/i, NAMED("mrna", "mRNA")], [/DNA plasmid|plasmid/i, NAMED("dna-plasmid", "DNA plasmid")], [/arenavirus|adenovir|viral vector|vector/i, NAMED("viral-vector", "Viral vector")], [/dendritic|antigen-presenting cell|APC/i, NAMED("dendritic-cell", "Dendritic or antigen-presenting cell")], [/whole-cell|cell lines|irradiated .*cell/i, NAMED("whole-cell", "Whole cell")], [/virus-like particle|\bVLP\b|capsid/i, NAMED("vlp", "Virus-like particle")], [/yeast/i, NAMED("yeast", "Recombinant yeast")], [/glycan|carbohydrate|conjugated to a carrier/i, NAMED("glycoconjugate", "Glycoconjugate")], [/long-peptide|peptide/i, NAMED("peptide", "Peptide")]], m);
        if (plat) set(this.named("platform", plat, "high", ["modality", "mechanism"], [plat.id === "mrna" ? "neoantigen-mrna-vaccine" : plat.id === "dendritic-cell" ? "dendritic-cell-vaccines" : plat.id === "vlp" ? "hpv-vaccine" : "shared-antigen-vaccine"]));
        break;
      }
      case "oncolytic-virus": {
        const m = `${d.name} ${d.modality} ${d.mechanism}`;
        const v = rx([[/HSV-?1|herpes/i, NAMED("hsv-1", "Herpes simplex virus 1")], [/adenovir/i, NAMED("adenovirus", "Adenovirus")], [/vaccinia/i, NAMED("vaccinia", "Vaccinia")], [/reovirus/i, NAMED("reovirus", "Reovirus")], [/measles/i, NAMED("measles", "Measles")], [/coxsackie/i, NAMED("coxsackievirus", "Coxsackievirus")], [/Newcastle/i, NAMED("ndv", "Newcastle disease virus")], [/vesicular stomatitis|VSV/i, NAMED("vsv", "Vesicular stomatitis virus")], [/Maraba/i, NAMED("maraba", "Maraba virus")], [/polio/i, NAMED("poliovirus", "Poliovirus")]], m);
        if (v) set(this.named("virus", v, "high", ["modality", "mechanism", "name"], ["oncolytic-virus"]));
        const tg = rx([[/GM-CSF/i, NAMED("gm-csf", "GM-CSF")], [/IL-?12/i, NAMED("il-12", "IL-12")], [/CD40L/i, NAMED("cd40l", "CD40 ligand")], [/anti-CTLA-4|CTLA-4/i, NAMED("anti-ctla4", "Anti-CTLA-4")], [/anti-PD-1|PD-1/i, NAMED("anti-pd1", "Anti-PD-1")], [/IL-?2\b/i, NAMED("il-2", "IL-2")], [/TNF/i, NAMED("tnf", "TNF")]], d.mechanism);
        if (tg) set(this.named("transgene", tg, "high", ["mechanism"]));
        else if (/deleted|E1B|ICP34\.5|replicates only|conditionally replicating/i.test(d.mechanism) && !/express|secrete|carr/i.test(d.mechanism)) set({ key: "transgene", id: "none-stated", name: "No transgene stated (deletion-based selectivity)", confidence: "medium", from: ["mechanism"] });
        break;
      }
      case "cell-therapy": {
        const m = `${d.name} ${d.modality} ${d.mechanism}`;
        const cell = rx([[/\bTIL\b|tumou?r-infiltrating/i, NAMED("til", "Tumour-infiltrating lymphocytes")], [/NK cell|haNK|natural killer/i, NAMED("nk", "NK cell")], [/cord blood|CD34/i, NAMED("cord-blood-hsc", "Cord blood stem cells")], [/virus-specific|EBV|Epstein/i, NAMED("virus-specific-t", "Virus-specific T cells")], [/mesenchymal|stromal/i, NAMED("msc", "Mesenchymal stromal cells")], [/regulatory T|Treg/i, NAMED("treg", "Regulatory T cells")], [/dendritic|antigen-presenting/i, NAMED("apc", "Antigen-presenting cells")], [/\bT cells?\b/i, NAMED("t", "T cells (unspecified)")]], m);
        if (cell) set(this.named("cellType", cell, "high", ["modality", "mechanism"], [cell.id === "til" ? "til-therapy" : cell.id === "nk" ? "nk-cell-therapy" : cell.id === "cord-blood-hsc" ? "allogeneic-hsct" : cell.id === "virus-specific-t" ? "virus-specific-t-cells" : ""]));
        const src = rx([[/autologous|patient's own/i, NAMED("autologous", "Autologous")], [/allogeneic|donor|off-the-shelf|cord blood/i, NAMED("allogeneic", "Allogeneic")]], m);
        if (src) set(this.named("cellSource", src, "high", ["modality", "mechanism"], [src.id === "allogeneic" ? "allogeneic-cell-therapy" : ""]));
        const a = this.antigens(d, { allowProse: false });
        set(this.joinTargets("target", a.ids, [], a.confidence, a.from));
        break;
      }
    }
    return c;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// State of a medicine from the records that name it.

const shortStatus = (s: string) => s.replace(/-/g, " ");

function evidenceFor(d: Drug, g: Graph): { state: DrugState; evidence: Evidence[]; reasons: StopReason[] } {
  const ev: Evidence[] = [];
  const route = routeFor(d);
  const st = d.status;
  if (st) {
    const state: DrugState | undefined = APPROVED_STATUS.has(st) ? "approved" : DEVELOPMENT_STATUS.has(st) ? "development" : STOPPED_STATUS.has(st) ? "stopped" : undefined;
    if (state) ev.push({ record: d.id, field: "status", kind: "drug", state, label: `Drug record status: ${shortStatus(st)}`, href: route, ...(state === "stopped" ? { quote: d.tldr } : {}) });
  }
  d.approvals.forEach((a, i) => ev.push({ record: d.id, field: `approvals[${i}]`, kind: "approval", state: "approved", label: `${a.region} ${a.year}: ${a.indication}`, href: route }));
  const row = regionalApprovals[d.id];
  if (row) for (const [region, entry] of Object.entries(row) as Array<[Region, NonNullable<(typeof row)[Region]>]>) {
    const label = `${REGION_META[region].regulator} (${region})`;
    if (entry.status === "approved" || entry.status === "conditional") ev.push({ record: d.id, field: `regional.${region}`, kind: "regional", state: "approved", label: `${label}: ${entry.status}${entry.year ? ` ${entry.year}` : ""}`, href: entry.source ?? "/regulatory/regions/" });
    else if (entry.status === "withdrawn" || entry.status === "rejected") ev.push({ record: d.id, field: `regional.${region}`, kind: "regional", state: "stopped", label: `${label}: ${entry.status}${entry.year ? ` ${entry.year}` : ""}`, href: entry.source ?? "/regulatory/regions/", quote: entry.note });
  }
  d.regulatoryEvents.forEach((e, i) => { if (e.type === "withdrawal" || e.type === "crl") ev.push({ record: d.id, field: `regulatoryEvents[${i}]`, kind: "event", state: "stopped", label: `${e.region} ${e.date}: ${e.type === "crl" ? "complete response letter" : "withdrawal"}`, href: e.source ?? route, quote: e.note }); });

  const trials = new Map<string, Trial>();
  for (const t of g.incoming(d.id).get("trial") ?? []) if (t.kind === "trial") trials.set(t.id, t);
  for (const id of d.trials) { const t = g.get(id); if (t?.kind === "trial") trials.set(t.id, t); }
  for (const t of [...trials.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    const tr = routeFor(t);
    const phase = `phase ${t.phase}`;
    if (t.status && DEV_TRIAL.has(t.status)) ev.push({ record: t.id, field: "status", kind: "trial", state: "development", label: `${t.name}: ${phase}, ${shortStatus(t.status)}`, href: tr });
    else if (t.status === "withdrawn") {
      const why = t.notes.map((n) => n.match(/Why stopped, in the sponsor's words: (.*)$/)?.[1]).find(Boolean);
      ev.push({ record: t.id, field: why ? "notes (registry whyStopped)" : t.result ? "result" : "tldr", kind: "trial", state: "stopped", label: `${t.name}: ${phase}, terminated or withdrawn`, href: tr, quote: why ?? t.result ?? t.tldr });
    } else if (t.status === "negative") {
      const primary = t.outcomes.find((o) => o.primary);
      const quote = t.result ?? (primary ? `Primary endpoint ${primary.endpoint}${primary.hr ? `, HR ${primary.hr}` : ""}${primary.p ? `, p ${primary.p}` : ""}` : t.tldr);
      ev.push({ record: t.id, field: t.result ? "result" : primary ? "outcomes (primary)" : "tldr", kind: "trial", state: "stopped", label: `${t.name}: ${phase}, negative`, href: tr, quote });
    }
  }
  const reg = REGISTRY[d.id];
  if (reg) {
    const active = (reg.byStatus.RECRUITING ?? 0) + (reg.byStatus.ACTIVE_NOT_RECRUITING ?? 0) + (reg.byStatus.NOT_YET_RECRUITING ?? 0) + (reg.byStatus.ENROLLING_BY_INVITATION ?? 0);
    const stopped = (reg.byStatus.TERMINATED ?? 0) + (reg.byStatus.WITHDRAWN ?? 0);
    if (active) ev.push({ record: `registry:${d.id}`, kind: "registry", state: "development", label: `ClinicalTrials.gov: ${active} recruiting, active or planned stud${active === 1 ? "y" : "ies"} (fetched ${reg.fetched})`, href: `${route}#registry` });
    else if (stopped) ev.push({ record: `registry:${d.id}`, kind: "registry", state: "stopped", label: `ClinicalTrials.gov: ${stopped} terminated or withdrawn stud${stopped === 1 ? "y" : "ies"} and none active (fetched ${reg.fetched})`, href: `${route}#registry` });
  }

  const has = (s: DrugState) => ev.some((e) => e.state === s);
  let state: DrugState;
  if (st && STOPPED_STATUS.has(st)) state = "stopped";
  else if (has("approved")) state = "approved";
  else if (has("development")) state = "development";
  else if (has("stopped")) state = "stopped";
  else state = "unclear";
  // Every stopped study, withdrawal or negative result with a recorded reason, whatever the drug's overall state: a
  // medicine still in development can carry a terminated trial, and the reader should see both.
  const reasons: StopReason[] = ev.filter((e) => e.state === "stopped" && e.quote).map((e) => ({ drugId: d.id, drugName: d.name, drugRoute: route, drugState: state, record: e.record, kind: e.kind, label: e.label, href: e.href, quote: e.quote! }));
  return { state, evidence: ev, reasons };
}

// ---------------------------------------------------------------------------------------------------------------
// The index.

const EMPTY_STATES = (): Record<DrugState, number> => ({ approved: 0, development: 0, stopped: 0, unclear: 0 });

function buildFormat(def: FormatDef, drugs: DecomposedDrug[], unresolved: UnresolvedDrug[]): FormatIndex {
  const [ka, kb] = def.axes;
  const notRecorded: Component = { key: kb, id: NOT_RECORDED, name: `${COMPONENT_LABEL[kb]} not recorded` };
  const cellMap = new Map<string, Cell>();
  const rowMap = new Map<string, Component>(), colMap = new Map<string, Component>();
  const rowCount = new Map<string, number>(), colCount = new Map<string, number>();
  const compCounts: Partial<Record<ComponentKey, Map<string, ComponentCount>>> = {};
  let partial = 0;
  for (const d of drugs) {
    const a = d.components[ka]!;
    const bRes = d.components[kb];
    const b: Component = bRes ? { key: kb, id: bRes.id, name: bRes.name, href: bRes.href } : notRecorded;
    if (!bRes) partial++;
    const aC: Component = { key: ka, id: a.id, name: a.name, href: a.href };
    rowMap.set(a.id, aC); rowCount.set(a.id, (rowCount.get(a.id) ?? 0) + 1);
    colMap.set(b.id, b); colCount.set(b.id, (colCount.get(b.id) ?? 0) + 1);
    const key = `${a.id}|${b.id}`;
    let cell = cellMap.get(key);
    if (!cell) { cell = { a: aC, b, state: "unclear", drugs: [], counts: EMPTY_STATES(), parts: {}, evidence: [], reasons: [] }; cellMap.set(key, cell); }
    cell.drugs.push({ id: d.id, name: d.name, route: d.route, state: d.state, status: d.status });
    cell.counts[d.state]++;
    cell.evidence.push(...d.evidence);
    cell.reasons.push(...d.reasons);
    for (const k of def.components) {
      if (k === ka || k === kb) continue;
      const r = d.components[k];
      if (!r) continue;
      const list = cell.parts[k] ?? (cell.parts[k] = []);
      if (!list.some((x) => x.id === r.id)) list.push({ key: k, id: r.id, name: r.name, href: r.href });
    }
    for (const k of def.components) {
      const r = d.components[k];
      if (!r) continue;
      const m = compCounts[k] ?? (compCounts[k] = new Map());
      let cc = m.get(r.id);
      if (!cc) { cc = { key: k, id: r.id, name: r.name, href: r.href, count: 0, drugIds: [], states: EMPTY_STATES() }; m.set(r.id, cc); }
      cc.count++; cc.drugIds.push(d.id); cc.states[d.state]++;
    }
  }
  for (const cell of cellMap.values()) {
    cell.state = cell.counts.approved ? "approved" : cell.counts.development ? "development" : cell.counts.stopped ? "stopped" : "unclear";
    cell.drugs.sort((x, y) => x.name.localeCompare(y.name));
  }
  const byCount = (m: Map<string, number>) => (x: Component, y: Component) => (y.id === NOT_RECORDED ? -1 : x.id === NOT_RECORDED ? 1 : (m.get(y.id) ?? 0) - (m.get(x.id) ?? 0) || x.name.localeCompare(y.name));
  const rows = [...rowMap.values()].sort(byCount(rowCount));
  const cols = [...colMap.values()].sort(byCount(colCount));
  const cells = [...cellMap.values()].sort((x, y) => (rowCount.get(y.a.id) ?? 0) - (rowCount.get(x.a.id) ?? 0) || x.a.name.localeCompare(y.a.name) || (colCount.get(y.b.id) ?? 0) - (colCount.get(x.b.id) ?? 0));
  const realCols = cols.filter((c) => c.id !== NOT_RECORDED).length;
  const triedReal = cells.filter((c) => c.b.id !== NOT_RECORDED).length;
  const counts: FormatIndex["counts"] = { approved: 0, development: 0, stopped: 0, unclear: 0, untried: Math.max(0, rows.length * realCols - triedReal), drugs: drugs.length, partial, unresolved: unresolved.length };
  for (const c of cells) counts[c.state]++;
  const components: FormatIndex["components"] = {};
  for (const k of def.components) { const m = compCounts[k]; if (m) components[k] = [...m.values()].sort((x, y) => y.count - x.count || x.name.localeCompare(y.name)); }
  // Stopped medicines first, then the stopped studies of medicines still in development or approved.
  const order: Record<DrugState, number> = { stopped: 0, unclear: 1, development: 2, approved: 3 };
  const stopped = drugs.flatMap((d) => d.reasons).sort((x, y) => order[x.drugState] - order[y.drugState] || x.drugName.localeCompare(y.drugName));
  const total = drugs.length + unresolved.length;
  const full = drugs.length - partial;
  return { format: def, drugs, unresolved, rows, cols, cells, counts, components, stopped, coverage: { total, full, partial, unresolved: unresolved.length, pct: total ? Math.round((100 * drugs.length) / total) : 0 } };
}

let cached: Engine | undefined;
/** The whole engine, built once per process from the graph. */
export function engine(): Engine {
  if (cached) return cached;
  const g = graph();
  const dec = new Decomposer(g);
  const perFormat = new Map<FormatId, { drugs: DecomposedDrug[]; unresolved: UnresolvedDrug[] }>();
  for (const f of FORMATS) perFormat.set(f.id, { drugs: [], unresolved: [] });
  const outside: OutsideDrug[] = [];
  let fetched = "", fetchedFrom = "";
  for (const d of g.kind("drug")) {
    const cl = classify(d);
    const route = routeFor(d);
    if ("outside" in cl) { outside.push({ id: d.id, name: d.name, route, modality: d.modality, reason: cl.outside }); continue; }
    const def = FORMATS.find((f) => f.id === cl.format)!;
    const components = dec.decompose(d, cl.format);
    const bucket = perFormat.get(cl.format)!;
    const missingA = !components[def.axes[0]];
    if (missingA) {
      const missing = def.components.filter((k) => !components[k]);
      bucket.unresolved.push({ id: d.id, name: d.name, route, format: cl.format, modality: d.modality, missing, why: `No ${COMPONENT_LABEL[def.axes[0]].toLowerCase()} on the record: the targets field is empty and the modality and mechanism text name none the corpus knows.` });
      continue;
    }
    const resolved = Object.values(components) as Resolved[];
    const confidence: Confidence = resolved.every((r) => r.confidence === "high") ? "high" : resolved.some((r) => r.confidence === "low") ? "low" : "medium";
    const fields = [...new Set(resolved.flatMap((r) => r.from))];
    const { state, evidence, reasons } = evidenceFor(d, g);
    const date = REGISTRY[d.id]?.fetched;
    if (date) {
      if (date > fetched) fetched = date;
      if (!fetchedFrom || date < fetchedFrom) fetchedFrom = date;
    }
    bucket.drugs.push({ id: d.id, name: d.name, route, format: cl.format, status: d.status, modality: d.modality, components, confidence, fields, state, evidence, reasons });
  }
  const formats = FORMATS.map((f) => { const b = perFormat.get(f.id)!; b.drugs.sort((x, y) => x.name.localeCompare(y.name)); b.unresolved.sort((x, y) => x.name.localeCompare(y.name)); return buildFormat(f, b.drugs, b.unresolved); });
  const byReason = new Map<string, number>();
  for (const o of outside) byReason.set(o.reason, (byReason.get(o.reason) ?? 0) + 1);
  cached = { formats, outside, outsideByReason: [...byReason.entries()].map(([reason, count]) => ({ reason, count })).sort((x, y) => y.count - x.count), fetched, fetchedFrom, drugs: g.kind("drug").length };
  return cached;
}

export function formatIndex(id: FormatId): FormatIndex | undefined {
  return engine().formats.find((f) => f.format.id === id);
}

/** Does an evidence record id name something a reader can open: a corpus entity, or a drug's registry file? */
export function evidenceRecordExists(record: string, g: Graph = graph()): boolean {
  if (record.startsWith("registry:")) return !!REGISTRY[record.slice("registry:".length)];
  return !!g.get(record);
}

/** The plain JSON an agent reads for one format: the same index without the React-only bits (there are none), with the counts first; `proposed` are the open-pipeline proposals for this format (src/lib/combination-ideas-adapter.ts), hypotheses kept apart from the recorded grid. */
export function formatFile(f: FormatIndex, proposed: ProposedCell[] = []): unknown {
  return {
    format: { id: f.format.id, name: f.format.name, blurb: f.format.blurb, axes: f.format.axes, axisLabels: f.format.axes.map((k) => COMPONENT_LABEL[k]), components: f.format.components.map((k) => ({ key: k, label: COMPONENT_LABEL[k] })) },
    counts: f.counts, coverage: f.coverage,
    rows: f.rows, cols: f.cols,
    cells: f.cells, components: f.components,
    drugs: f.drugs.map((d) => ({ id: d.id, name: d.name, route: d.route, status: d.status ?? null, modality: d.modality, state: d.state, confidence: d.confidence, fields: d.fields, components: Object.fromEntries(Object.entries(d.components).map(([k, r]) => [k, { id: r!.id, name: r!.name, href: r!.href ?? null, confidence: r!.confidence, from: r!.from, detail: r!.detail ?? null }])), evidence: d.evidence, reasons: d.reasons })),
    unresolved: f.unresolved, stopped: f.stopped,
    proposed,
    note: "Every state is derived from the records named in evidence; untried means no medicine in this corpus combines the two parts. Proposed cells are hypotheses from the open pipeline (docs/OPEN-PIPELINE.md), not records of a medicine. CC BY-NC 4.0, attribute Data from OnCo (onco.cc). Not medical advice.",
  };
}
