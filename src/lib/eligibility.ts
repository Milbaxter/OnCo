/**
 * Trial eligibility pre-screener.
 *
 * Parses the free-text "Inclusion Criteria / Exclusion Criteria" block that ClinicalTrials.gov returns
 * into individual criteria, tags the common structured ones (performance status, prior lines, brain
 * metastases, measurable disease, biomarkers, age, prior therapies) and scores them against the
 * browser profile. Deliberately conservative: "unknown" is the default, "unlikely" only when a
 * criterion is clearly contradicted by what the reader entered. The trial team decides; this is a
 * reading aid. Pure functions, no React, no graph.
 */

export type CriterionKind = "inclusion" | "exclusion";
export type BrainMets = "excluded" | "allowed-if-treated" | "allowed";

export type CriterionTags = {
  /** Allowed ECOG scores, e.g. [0, 1]. */
  ecog?: number[];
  /** Maximum number of prior lines or regimens allowed (0 for first-line / treatment-naive). */
  priorLinesMax?: number;
  /** Minimum number of prior lines or regimens required. */
  priorLinesMin?: number;
  brainMets?: BrainMets;
  /** True when measurable disease is required. */
  measurableDisease?: boolean;
  /** Biomarkers the tumour must have (canonical names, e.g. "HER2", "PD-L1", "KRAS G12C"). */
  biomarkers?: string[];
  /** Biomarkers the tumour must NOT have. */
  biomarkersExcluded?: string[];
  /** Combined or alternative biomarker clauses that cannot be represented as required-marker lists. */
  biomarkersUnclear?: boolean;
  age?: { min?: number; max?: number };
  /** Therapies the person must have received. */
  priorTherapyRequired?: string[];
  /** Therapies the person must NOT have received. */
  priorTherapyExcluded?: string[];
};

export type Criterion = { kind: CriterionKind; text: string; tags: CriterionTags };

export type Verdict = "likely" | "unclear" | "unlikely";
export type CheckStatus = "met" | "unmet" | "unknown";
export type Check = { criterion: Criterion; status: CheckStatus; why: string };
export type Score = { verdict: Verdict; reasons: string[]; checklist: Check[]; /** Criteria with nothing OnCo can assess; only the team can check these. */ unassessed: number };

export type ScoreProfile = { stage: string; biomarkers: string[]; priorLines: string[] };
export type ScoreContext = { biomarkerLabels: Record<string, string>; drugNames: Record<string, string> };

/* ------------------------------------------------------------------ parsing */

const BULLET = /^\s*(?:[*\-•·]|\d{1,2}[.)]|[a-z][.)]|\(?[ivx]{1,4}\))\s+/i;

/** Split the CT.gov criteria text into inclusion and exclusion items. */
export function parseCriteria(text: string): Criterion[] {
  if (!text || !text.trim()) return [];
  const clean = text.replace(/\r/g, "").replace(/\\\[/g, "[").replace(/\\\]/g, "]").replace(/\\\^/g, "^").replace(/\\([*_])/g, "$1");
  const out: Criterion[] = [];
  // Find section headings; text before the first heading is treated as inclusion.
  const parts = clean.split(/^\s*(?:[*#\-]*\s*)?(inclusion criteria|exclusion criteria|key inclusion criteria|key exclusion criteria|inclusion|exclusion)\s*:?\s*[*#]*\s*$/gim);
  let kind: CriterionKind = "inclusion";
  const blocks: Array<{ kind: CriterionKind; body: string }> = [];
  if (parts.length === 1) blocks.push({ kind, body: parts[0] });
  else {
    if (parts[0].trim()) blocks.push({ kind, body: parts[0] });
    for (let i = 1; i < parts.length; i += 2) {
      kind = /exclusion/i.test(parts[i]) ? "exclusion" : "inclusion";
      blocks.push({ kind, body: parts[i + 1] ?? "" });
    }
  }
  for (const b of blocks) {
    for (const item of splitItems(b.body)) out.push({ kind: b.kind, text: item, tags: tagCriterion(item, b.kind) });
  }
  return out;
}

/** Bulleted or numbered lines become items; continuation lines join the previous item; blank-line paragraphs also split. */
function splitItems(body: string): string[] {
  const items: string[] = [];
  let cur = "";
  const push = () => { const t = cur.replace(/\s+/g, " ").trim(); if (t.length > 3) items.push(t); cur = ""; };
  for (const raw of body.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) { push(); continue; }
    if (BULLET.test(line)) { push(); cur = line.replace(BULLET, ""); continue; }
    // Inline "N. ..." runs inside one line (CT.gov sometimes collapses numbering).
    const inline = line.split(/\s(?=\d{1,2}\.\s+[A-Z])/);
    if (inline.length > 1 && cur) { cur += " " + inline[0]; push(); for (const seg of inline.slice(1)) { cur = seg.replace(/^\d{1,2}\.\s+/, ""); push(); } continue; }
    cur = cur ? `${cur} ${line.trim()}` : line.trim();
  }
  push();
  return items;
}

/* ------------------------------------------------------------------ tagging */

const WORD_NUM: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const num = (s: string) => (WORD_NUM[s.toLowerCase()] ?? parseInt(s, 10));

/** Canonical biomarker names and the patterns that name them in criteria text or OnCo biomarker labels. */
export const BIOMARKER_PATTERNS: Array<[string, RegExp]> = [
  ["KRAS G12C", /\bKRAS\s*(?:p\.)?G12C\b/i],
  ["KRAS G12D", /\bKRAS\s*(?:p\.)?G12D\b/i],
  ["KRAS", /\bKRAS\b/i],
  ["HER2-low", /\bHER2[- ]low\b/i],
  ["HER2", /\b(?:HER2|HER-2|ERBB2)\b/i],
  ["PD-L1", /\bPD-?L1\b/i],
  ["EGFR exon 20", /\bEGFR\b[^.;]{0,30}\bexon\s*20\b/i],
  ["EGFR", /\bEGFR\b/i],
  ["ALK", /\bALK\b/],
  ["ROS1", /\bROS1\b/i],
  ["RET", /\bRET\b(?!\w)/],
  ["BRAF V600", /\bBRAF\s*(?:p\.)?V600[EK]?\b/i],
  ["BRAF", /\bBRAF\b/i],
  ["NTRK", /\bNTRK\d?\b/i],
  ["MET", /\bMET\b(?:\s*(?:exon\s*14|amplif|alteration))/i],
  ["BRCA", /\bBRCA[12]?\b|\bgBRCA\b/i],
  ["PALB2", /\bPALB2\b/i],
  ["HRD", /\bHRD\b|homologous recombination deficien/i],
  ["MSI-H / dMMR", /\bMSI-?H\b|microsatellite instability|\bdMMR\b|mismatch repair deficien/i],
  ["TMB-high", /\bTMB\b|tumou?r mutational burden/i],
  ["ESR1", /\bESR1\b/i],
  ["PIK3CA", /\bPIK3CA\b/i],
  ["AKT1", /\bAKT1\b/i],
  ["PTEN", /\bPTEN\b/i],
  ["FGFR", /\bFGFR[1-4]?\b/i],
  ["IDH", /\bIDH[12]?\b/i],
  ["FLT3", /\bFLT3\b/i],
  ["NPM1", /\bNPM1\b/i],
  ["TP53", /\bTP53\b|\bp53\b|del\(?17p\)?/i],
  ["MGMT", /\bMGMT\b/i],
  ["Ki-67", /\bKi-?67\b/i],
  ["HR-positive", /\b(?:HR|ER|oestrogen receptor|estrogen receptor|hormone receptor)(?:[- ]?positive\b|\s*\+(?=\W|$))/i],
  ["HR-negative", /\b(?:HR|ER|hormone receptor)(?:[- ]?negative\b|\s*-(?=\W|$))/i],
  ["TROP2", /\bTROP-?2\b/i],
  ["Claudin 18.2", /\bCLDN18\.2\b|claudin\s*18\.2/i],
  ["DLL3", /\bDLL3\b/i],
  ["BCMA", /\bBCMA\b/i],
  ["CD19", /\bCD19\b/i],
  ["CD20", /\bCD20\b/i],
  ["CD30", /\bCD30\b/i],
  ["CD38", /\bCD38\b/i],
  ["GD2", /\bGD2\b/i],
  ["PSMA", /\bPSMA\b/i],
  ["SSTR", /\bSSTR\d?\b|somatostatin receptor/i],
  ["Nectin-4", /\bnectin-?4\b/i],
  ["FRα", /\bFR-?α\b|\bFRa\b|folate receptor/i],
  ["EGFRvIII", /\bEGFRvIII\b/i],
  ["Triple-negative", /\btriple[- ]negative\b|\bTNBC\b/i],
];

/** Therapy classes and agents recognised in criteria text and in OnCo drug names. */
export const THERAPY_PATTERNS: Array<[string, RegExp]> = [
  ["trastuzumab deruxtecan", /trastuzumab deruxtecan|T-DXd|Enhertu/i],
  ["trastuzumab emtansine", /trastuzumab emtansine|T-DM1|Kadcyla/i],
  ["trastuzumab", /\btrastuzumab\b(?! (?:deruxtecan|emtansine))|Herceptin/i],
  ["pertuzumab", /pertuzumab/i],
  ["sacituzumab govitecan", /sacituzumab govitecan|Trodelvy/i],
  ["datopotamab deruxtecan", /datopotamab/i],
  ["enfortumab vedotin", /enfortumab/i],
  ["antibody-drug conjugate", /antibody[- ]drug conjugate|\bADCs?\b/i],
  ["PD-1 / PD-L1 inhibitor", /anti-?PD-?(?:1|L1)|PD-?(?:1|L1) (?:inhibitor|antibod|blockade)|checkpoint inhibitor|immune checkpoint|immunotherapy|pembrolizumab|nivolumab|atezolizumab|durvalumab|cemiplimab|avelumab|dostarlimab|tislelizumab|toripalimab|Keytruda|Opdivo|Tecentriq|Imfinzi/i],
  ["CTLA-4 inhibitor", /anti-?CTLA-?4|ipilimumab|tremelimumab/i],
  ["CDK4/6 inhibitor", /CDK ?4\/?6|palbociclib|ribociclib|abemaciclib/i],
  ["endocrine therapy", /endocrine therapy|hormonal therapy|hormone therapy|aromatase inhibitor|letrozole|anastrozole|exemestane|tamoxifen|fulvestrant|\bSERD\b/i],
  ["PARP inhibitor", /PARP inhibitor|\bPARPi\b|olaparib|niraparib|rucaparib|talazoparib/i],
  ["EGFR TKI", /EGFR[- ]?TKI|osimertinib|erlotinib|gefitinib|afatinib|lazertinib|amivantamab/i],
  ["ALK TKI", /ALK[- ]?(?:TKI|inhibitor)|alectinib|lorlatinib|brigatinib|crizotinib/i],
  ["KRAS G12C inhibitor", /sotorasib|adagrasib|KRAS ?G12C inhibitor/i],
  ["BRAF/MEK inhibitor", /BRAF (?:and\/or )?(?:MEK )?inhibitor|dabrafenib|trametinib|encorafenib|binimetinib|vemurafenib|cobimetinib/i],
  ["taxane", /\btaxanes?\b|paclitaxel|docetaxel|nab-paclitaxel/i],
  ["platinum", /\bplatinum\b|cisplatin|carboplatin|oxaliplatin/i],
  ["anthracycline", /anthracycline|doxorubicin|epirubicin/i],
  ["fluoropyrimidine", /fluoropyrimidine|5-?FU|fluorouracil|capecitabine|FOLFOX|FOLFIRI|FOLFIRINOX|CAPOX|XELOX/i],
  ["gemcitabine", /gemcitabine/i],
  ["irinotecan", /irinotecan/i],
  ["temozolomide", /temozolomide/i],
  ["bevacizumab", /bevacizumab|anti-?VEGF/i],
  ["EGFR antibody", /cetuximab|panitumumab|anti-?EGFR antibod/i],
  ["VEGFR TKI", /sorafenib|lenvatinib|sunitinib|cabozantinib|axitinib|pazopanib|regorafenib|VEGFR[- ]?TKI/i],
  ["mTOR inhibitor", /everolimus|mTOR inhibitor/i],
  ["androgen receptor pathway inhibitor", /enzalutamide|abiraterone|apalutamide|darolutamide|androgen receptor (?:pathway )?inhibitor|\bARPI\b|\bARSI\b|novel hormonal (?:agent|therapy)/i],
  ["androgen deprivation therapy", /androgen deprivation|\bADT\b|castration/i],
  ["PSMA radioligand", /lutetium|177Lu|Lu-?177|PSMA[- ]?(?:radioligand|RLT)|Pluvicto/i],
  ["proteasome inhibitor", /proteasome inhibitor|bortezomib|carfilzomib|ixazomib/i],
  ["immunomodulatory drug", /lenalidomide|pomalidomide|thalidomide|\bIMiD\b/i],
  ["anti-CD38 antibody", /anti-?CD38|daratumumab|isatuximab/i],
  ["BCMA-directed therapy", /BCMA[- ]directed|anti-?BCMA|teclistamab|elranatamab|belantamab|ciltacabtagene|idecabtagene/i],
  ["BTK inhibitor", /BTK inhibitor|ibrutinib|acalabrutinib|zanubrutinib|pirtobrutinib/i],
  ["venetoclax", /venetoclax|BCL-?2 inhibitor/i],
  ["anti-CD20 antibody", /anti-?CD20|rituximab|obinutuzumab/i],
  ["CAR-T", /CAR[- ]?T|chimeric antigen receptor|axicabtagene|tisagenlecleucel|lisocabtagene/i],
  ["bispecific antibody", /bispecific|T-cell engager|\bBiTE\b|glofitamab|epcoritamab|mosunetuzumab|tarlatamab|blinatumomab/i],
  ["hypomethylating agent", /hypomethylating|azacitidine|decitabine/i],
  ["FLT3 inhibitor", /FLT3 inhibitor|gilteritinib|midostaurin|quizartinib/i],
  ["stem cell transplant", /stem[- ]cell transplant|\bHSCT\b|\bASCT\b|\ballo-?SCT\b|autologous transplant|allogeneic transplant/i],
  ["radiotherapy", /radiotherapy|radiation therapy|\bXRT\b|\bRT\b/],
  ["chemotherapy", /chemotherapy|cytotoxic/i],
];

const NEGATIVE_BM = /(negative|wild[- ]?type|\bWT\b|without|lacking|absence of|no (?:known )?(?:[A-Za-z0-9-]+\s){0,3}(?:mutation|alteration|amplification|expression|rearrangement|fusion))/i;
const REQUIRED_CUE = /(positive|\+\b|mutat|alteration|amplif|overexpress|express|rearrang|fusion|documented|confirmed|known|deficien|high|≥|>=|status)/i;
const NEGATED_MARKER_PREFIX = /\b(?:(?:no|without)(?:\s+(?:any|known|detectable|documented|confirmed|clear))*(?:\s+evidence\s+of)?|(?:absence|lack)\s+of|lacking|negative\s+for|not)\s*$/i;

/** Read an explicit result attached to this marker before considering sentence-wide wording. */
function markerPolarity(text: string, name: string, pattern: RegExp): "positive" | "negative" | "unclear" | undefined {
  const match = pattern.exec(text);
  if (!match) return undefined;
  const after = text.slice(match.index + match[0].length);
  const before = text.slice(0, match.index);
  // The absence applies to this marker even when its following word is "expression" or "amplification".
  // Keep the prefix anchored: "without distant metastases, HER2-positive" must still mean HER2-positive.
  const negated = NEGATED_MARKER_PREFIX.test(before);
  const localBefore = before.split(/[,;:.]|\b(?:and|or|but)\b/i).at(-1) ?? "";
  // An unrecognised negation construction must not fall through to a nearby positive cue.
  if (/\b(?:no|not|without|absence|lacking|negative for|lack of)\b/i.test(localBefore.replace(NEGATED_MARKER_PREFIX, ""))) return "unclear";
  if (/^\s*(?:[-:]\s*)?(?:(?:is|are|was|were|must be)\s+)?not\s+(?:negative|wild[- ]?type)\b/i.test(after)) return "unclear";
  // A trailing minus is a result only at a word boundary, not the hyphen in e.g. HER2-directed.
  if (name === "HR-negative"
    || /^\s*(?:[-:]\s*)?(?:(?:is|are|was|were|must be)\s+)?(?:(?:mutations?|fusions?|rearrangements?|amplification|expression|status)\s*[-:]?\s*)?(?:negative\b|wild[- ]?type\b|WT\b|not (?:detected|mutated|amplified|expressed|overexpressed|rearranged|positive)\b|loss\b)/i.test(after)
    || /^\s*[-−](?=\W|$)/.test(after)
  ) return negated ? "unclear" : "negative";
  // Absence of HER2-low does not establish HER2-positive or HER2-negative.
  if (name === "HER2" && /^[- ]low\b/i.test(after)) return negated ? "unclear" : "negative";
  if (negated) return "negative";
  if (name === "HR-positive" || name === "HER2-low" || name === "Triple-negative") return "positive";
  if (/^\s*(?:[-:]\s*)?(?:(?:is|are|was|were|must be)\s+)?(?:positive\b|mutat|alteration|amplif|overexpress|express|rearrang|fusion|deficien|high\b)/i.test(after)
    || /^\s*\+(?=\W|$)/.test(after)
    || /positive for\s*$/i.test(before)) return "positive";
  return undefined;
}

/** Locations of named markers, ignoring overlapping generic/specific names of one marker. */
function biomarkerMentions(text: string): Array<{ start: number; end: number }> {
  const matches = BIOMARKER_PATTERNS.flatMap(([, pattern]) =>
    [...text.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))].map((m) => ({ start: m.index, end: m.index + m[0].length })))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const mentions: Array<{ start: number; end: number }> = [];
  for (const m of matches) if (!mentions.length || m.start >= mentions[mentions.length - 1].end) mentions.push(m);
  return mentions;
}

/** Recognised assay notation describes a marker result; it is not an alternative eligibility branch. */
function withoutAssayAnnotations(text: string): string {
  const assayResult = /^(?:(?:IHC|ISH)\s*)?(?:[0-3]\+?(?:\s*\/\s*ISH\s*[-−+])?|amplified|negative|positive)$/i;
  return text.replace(/\(([^()]*)\)/g, (whole, inner: string) =>
    /^\s*(?:IHC|ISH)\b/i.test(inner) && inner.split(/\s*,\s*|\s+or\s+/i).every((part) => assayResult.test(part.trim())) ? " " : whole);
}

/** Inclusion can require a marker while allowing alternatives inside an attached relative modifier. */
function biomarkerLogicText(text: string): string {
  // "HER2-positive cancer that is unresectable or metastatic" asserts HER2 outside the relative clause.
  // More elaborate relative clauses remain unresolved rather than guessing the scope of their connectors.
  return withoutAssayAnnotations(text).replace(/\b(?:that|which)\s+(?:is|are)\s+[a-z-]+(?:\s+(?:or|and)\s+[a-z-]+)+[.;]?\s*$/i,
    (clause) => biomarkerMentions(clause).length ? clause : "");
}

/** A non-marker alternative can qualify too; do not require a named marker merely because it is recognised. */
function hasBiomarkerAlternatives(text: string): boolean {
  return biomarkerMentions(text).length > 0 && /\bor\b/i.test(biomarkerLogicText(text));
}

/**
 * Exclusion needs the entire predicate, not just one recognised word in it. Accept only a small grammar
 * of marker assertions, with no residual histology, spread, stage or other condition. A conjunction,
 * qualified branch or unknown wording stays unresolved. NOT(A OR B) is flattened only for positive atoms.
 */
function simpleMarkerExclusion(text: string): boolean {
  const branches = withoutAssayAnnotations(text).split(/\bor\b/i);
  return branches.every((branch) => {
    if (biomarkerMentions(branch).length !== 1) return false;
    const marker = BIOMARKER_PATTERNS.find(([, pattern]) => pattern.test(branch));
    if (!marker) return false;
    const match = marker[1].exec(branch)!;
    const before = branch.slice(0, match.index).replace(NEGATED_MARKER_PREFIX, "");
    const after = branch.slice(match.index + match[0].length);
    const prefix = /^\s*(?:(?:patients?|participants?|subjects?)\s+(?:with\s+)?)?(?:(?:known|documented|confirmed)\s+|(?:presence|evidence)\s+of\s+)?$/i;
    const suffix = /^\s*(?:[-:]\s*)?(?:(?:is|are|was|were|must be)\s+)?(?:(?:mutations?|fusions?|rearrangements?|amplification|expression|status)\s*[-:]?\s*)?(?:positive|negative|wild[- ]?type|WT|not (?:detected|mutated|amplified|expressed|overexpressed|rearranged|positive)|loss|mutations?|mutated|alterations?|amplified|amplification|overexpressed|overexpression|expressed|expression|rearranged|rearrangements?|fusions?|deficient|high|[+−-])?\s*(?:disease|cancers?|tumou?rs?)?\s*\.?\s*$/i;
    const polarity = markerPolarity(branch, ...marker);
    return prefix.test(before) && suffix.test(after) && (polarity === "positive" || (branches.length === 1 && polarity === "negative"));
  });
}

/** Attach structured tags to one criterion. Exported for tests. */
export function tagCriterion(text: string, kind: CriterionKind): CriterionTags {
  const t: CriterionTags = {};
  const s = text.replace(/\s+/g, " ");

  // Performance status.
  const ps = s.match(/(?:ECOG|Eastern Cooperative Oncology Group|performance status|\bPS\b)[^0-9]{0,60}?(\d)\s*(?:-|–|to|or|,)\s*(\d)/i) ?? s.match(/(?:ECOG|performance status|\bPS\b)[^0-9]{0,60}?(?:of |= ?|≤ ?|<= ?|less than or equal to )?(\d)\b/i);
  if (ps && /ECOG|performance status|\bPS\b/i.test(s)) {
    const a = parseInt(ps[1], 10), b = ps[2] !== undefined ? parseInt(ps[2], 10) : a;
    const hi = /≤|<=|less than or equal|or (?:less|lower|better)/i.test(s) && ps[2] === undefined ? a : Math.max(a, b);
    const lo = ps[2] === undefined && hi === a && /≤|<=|less than or equal|or (?:less|lower|better)|of 0/i.test(s) ? 0 : Math.min(a, b);
    if (hi <= 4) t.ecog = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  }

  // Prior lines.
  const lineWord = "(?:lines?|regimens?|(?:systemic )?therap(?:y|ies)|treatments?)";
  const maxM = s.match(new RegExp(`(?:no more than|up to|≤|<=|maximum of|a maximum of|at most|not more than|fewer than|less than)\\s*(\\d+|one|two|three|four|five)\\s*(?:prior|previous)?\\s*${lineWord}`, "i"));
  const rangeM = s.match(new RegExp(`(\\d+|one|two)\\s*(?:-|–|to|or)\\s*(\\d+|two|three|four|five)\\s*(?:prior|previous)\\s*${lineWord}`, "i"));
  const moreThan = s.match(new RegExp(`(?:more than|>|greater than|exceeding)\\s*(\\d+|one|two|three|four|five)\\s*(?:prior|previous)?\\s*${lineWord}`, "i"));
  const minM = s.match(new RegExp(`(?:at least|≥|>=|minimum of|a minimum of|no fewer than)\\s*(\\d+|one|two|three|four)\\s*(?:prior|previous)?\\s*${lineWord}`, "i"));
  if (maxM) { let n = num(maxM[1]); if (/fewer than|less than/i.test(maxM[0])) n -= 1; t.priorLinesMax = n; }
  else if (rangeM) { t.priorLinesMin = num(rangeM[1]); t.priorLinesMax = num(rangeM[2]); }
  else if (moreThan && kind === "exclusion") t.priorLinesMax = num(moreThan[1]);
  else if (moreThan && kind === "inclusion") t.priorLinesMin = num(moreThan[1]) + 1;
  if (minM && t.priorLinesMin === undefined) t.priorLinesMin = num(minM[1]);
  if (kind === "inclusion" && /\b(?:treatment|therapy|chemotherapy)[- ]na[iï]ve\b|\bfirst[- ]line\b|no prior systemic (?:therapy|treatment|anticancer)|not (?:have )?received (?:any )?prior systemic/i.test(s) && t.priorLinesMax === undefined && !/second|third|later|subsequent|after/i.test(s)) t.priorLinesMax = 0;

  // Brain metastases.
  if (/brain metastas|CNS metastas|central nervous system metastas|leptomening|intracranial/i.test(s)) {
    const qualified = /untreated|symptomatic|active|unstable|progressing|requiring (?:steroids|corticosteroids)|uncontrolled|leptomening/i.test(s);
    if (kind === "exclusion") t.brainMets = qualified ? "allowed-if-treated" : "excluded";
    else if (/allowed|permitted|eligible|may be|are eligible|stable|treated|asymptomatic/i.test(s)) t.brainMets = "allowed-if-treated";
    else if (/no (?:known )?brain|without brain|absence of brain/i.test(s)) t.brainMets = "excluded";
  }

  // Measurable disease.
  if (kind === "inclusion" && /measurable disease|measurable lesion/i.test(s) && !/non-?measurable|evaluable or measurable|measurable or (?:non-measurable|evaluable)/i.test(s)) t.measurableDisease = true;

  // Biomarkers.
  const found: Array<[string, RegExp]> = [];
  for (const [name, re] of BIOMARKER_PATTERNS) if (re.test(s) && !found.some(([f]) => f !== name && (f.startsWith(name) || name.startsWith(f)) && f.length > name.length)) found.push([name, re]);
  const alternatives = hasBiomarkerAlternatives(s);
  // NOT(A AND B) cannot be expressed by requiring NOT A and NOT B. Leave combined exclusions
  // for the team; only a list of positive alternatives has the existing exclude-each interpretation.
  const combinedExclusion = kind === "exclusion" && found.length > 0 && !simpleMarkerExclusion(s);
  if ((kind === "inclusion" && alternatives) || combinedExclusion
    || found.some(([name, pattern]) => markerPolarity(s, name, pattern) === "unclear")) t.biomarkersUnclear = true;
  else if (found.length) {
    const negative = NEGATIVE_BM.test(s);
    const required = REQUIRED_CUE.test(s);
    for (const [name, pattern] of found) {
      const polarity = markerPolarity(s, name, pattern);
      if (!polarity && kind === "inclusion" && !required && !negative) continue;
      const absent = polarity === "negative" || (!polarity && kind === "inclusion" && negative && !/positive/i.test(s));
      const field = absent === (kind === "inclusion") ? "biomarkersExcluded" : "biomarkers";
      (t[field] ??= []).push(name === "HR-negative" ? "HR-positive" : name);
    }
  }

  // Age.
  const ageMin = s.match(/(?:≥|>=|at least|aged?|age of|older than|over)\s*(\d{2})\s*years?(?:\s*(?:of age|old))?(?:\s*(?:or|and)\s*(?:older|above|over))?/i) ?? s.match(/(\d{2})\s*years?\s*(?:of age\s*)?(?:or|and)\s*(?:older|above|over|greater)/i);
  const ageMax = s.match(/(?:≤|<=|up to|under|younger than|no older than|not older than|less than)\s*(\d{2,3})\s*years?/i) ?? s.match(/(?:aged?|age)\s*\d{2}\s*(?:-|–|to)\s*(\d{2,3})\s*years?/i);
  if ((ageMin || ageMax) && /\bage|years? (?:of age|old)|≥ ?\d{2} years|>= ?\d{2} years/i.test(s)) {
    t.age = {};
    if (ageMin) t.age.min = parseInt(ageMin[1], 10);
    if (ageMax) t.age.max = parseInt(ageMax[1], 10);
    if (t.age.min !== undefined && (t.age.min < 1 || t.age.min > 90)) delete t.age.min;
    if (t.age.max !== undefined && (t.age.max < 1 || t.age.max > 130)) delete t.age.max;
    if (t.age.min === undefined && t.age.max === undefined) delete t.age;
  }

  // Prior therapies.
  const therapies: string[] = [];
  for (const [name, re] of THERAPY_PATTERNS) if (re.test(s)) therapies.push(name);
  if (therapies.length) {
    const noPrior = /\bno prior\b|\bnaive\b|\bnaïve\b|not (?:have )?(?:previously )?(?:received|been treated)|without prior|has not received|never (?:received|been treated)|must not have|no previous/i.test(s);
    const priorCue = /\bprior\b|\bprevious(?:ly)?\b|progress(?:ed|ion) (?:on|during|after|following)|refractory|relapsed|after|following|must have received|pretreated|pre-treated|exposure|history of|treated with|received/i.test(s);
    if (kind === "inclusion" && noPrior) t.priorTherapyExcluded = therapies;
    else if (kind === "inclusion" && priorCue) t.priorTherapyRequired = therapies;
    else if (kind === "exclusion" && (priorCue || /treatment with|therapy with|use of|within \d+ (?:days|weeks)/i.test(s))) t.priorTherapyExcluded = therapies;
  }

  return t;
}

/* ------------------------------------------------------------------ scoring */

/** Canonical biomarker names present (and explicitly absent) in the reader's profile, derived from OnCo biomarker labels. */
export function profileBiomarkers(ids: string[], labels: Record<string, string>): { present: Set<string>; absent: Set<string> } {
  const present = new Set<string>(), absent = new Set<string>();
  for (const id of ids) {
    const label = labels[id] ?? id;
    if (hasBiomarkerAlternatives(label)) continue;
    for (const [name, re] of BIOMARKER_PATTERNS) {
      if (!re.test(label)) continue;
      const polarity = markerPolarity(label, name, re);
      if (polarity === "unclear") continue;
      const canonical = name === "HR-negative" ? "HR-positive" : name;
      if (polarity === "negative" || (!polarity && /negative|wild[- ]?type|\bWT\b|loss|not detected/i.test(label) && !/positive/i.test(label))) absent.add(canonical);
      else present.add(canonical);
    }
  }
  if (present.has("Triple-negative")) { absent.add("HR-positive"); absent.add("HER2"); present.delete("HER2"); }
  return { present, absent };
}

/** Therapy classes present in the reader's prior lines, derived from OnCo drug names (falling back to the id). */
export function profileTherapies(ids: string[], names: Record<string, string>): Set<string> {
  const out = new Set<string>();
  for (const id of ids) {
    const name = names[id] ?? id.replace(/-/g, " ");
    for (const [cls, re] of THERAPY_PATTERNS) if (re.test(name)) out.add(cls);
  }
  return out;
}

const list = (xs: string[]) => xs.join(", ");

/** Score parsed criteria against the profile. Conservative by design: see module comment. */
export function score(criteria: Criterion[], profile: ScoreProfile, ctx: ScoreContext): Score {
  const bm = profileBiomarkers(profile.biomarkers, ctx.biomarkerLabels);
  const rx = profileTherapies(profile.priorLines, ctx.drugNames);
  const nLines = profile.priorLines.length;
  const checklist: Check[] = [];
  let unassessed = 0;

  for (const c of criteria) {
    const tg = c.tags;
    // The same unresolved Boolean clause can also have age or therapy tags. None of its branches alone
    // proves that the whole criterion is met or contradicted.
    if (tg.biomarkersUnclear) {
      checklist.push({ criterion: c, status: "unknown", why: "This criterion combines biomarker results or alternative requirements in a way OnCo cannot assess. The trial team needs to check how it applies to your profile." });
      continue;
    }
    const checks: Array<[CheckStatus, string]> = [];

    if (tg.ecog) checks.push(["unknown", `Needs a performance status of ${tg.ecog.length === 1 ? `ECOG ${tg.ecog[0]}` : `ECOG ${tg.ecog[0]} to ${tg.ecog[tg.ecog.length - 1]}`}. OnCo does not record fitness; your team scores this in clinic.`]);

    if (tg.priorLinesMax !== undefined) {
      if (nLines > tg.priorLinesMax) checks.push(["unmet", `You listed ${nLines} treatment${nLines === 1 ? "" : "s"} already received; this trial allows at most ${tg.priorLinesMax}. Lines are counted differently in different trials, so check with the team.`]);
      else if (nLines > 0) checks.push(["met", `You listed ${nLines} treatment${nLines === 1 ? "" : "s"} already received, within the maximum of ${tg.priorLinesMax}.`]);
      else checks.push(["unknown", `Allows at most ${tg.priorLinesMax} prior line${tg.priorLinesMax === 1 ? "" : "s"}${tg.priorLinesMax === 0 ? " (first treatment)" : ""}. Add what has been tried to your profile to check this.`]);
    }
    if (tg.priorLinesMin !== undefined) {
      if (nLines >= tg.priorLinesMin) checks.push(["met", `Requires at least ${tg.priorLinesMin} prior line${tg.priorLinesMin === 1 ? "" : "s"}; you listed ${nLines}.`]);
      else checks.push(["unknown", `Requires at least ${tg.priorLinesMin} prior line${tg.priorLinesMin === 1 ? "" : "s"}; you listed ${nLines}. If your list is incomplete, add the rest.`]);
    }

    if (tg.brainMets) {
      const msg = tg.brainMets === "excluded" ? "People with brain metastases are excluded." : tg.brainMets === "allowed-if-treated" ? "Brain metastases are allowed only if treated and stable." : "Brain metastases are allowed.";
      checks.push(["unknown", `${msg} OnCo does not record where the cancer has spread; your team will know.`]);
    }
    if (tg.measurableDisease) checks.push(["unknown", "Requires measurable disease on scans (a tumour large enough to be tracked). Your latest scan report answers this."]);

    for (const b of tg.biomarkers ?? []) {
      if (bm.present.has(b)) checks.push(["met", `Requires ${b}; your profile lists it.`]);
      else if (bm.absent.has(b)) checks.push(["unmet", `Requires ${b}; your profile says your cancer does not have it.`]);
      else checks.push(["unknown", `Requires ${b}. Not in your profile; add it if your tumour has been tested.`]);
    }
    for (const b of tg.biomarkersExcluded ?? []) {
      if (bm.present.has(b)) checks.push(["unmet", `Excludes ${b}; your profile lists it.`]);
      else if (bm.absent.has(b)) checks.push(["met", `Excludes ${b}; your profile says your cancer does not have it.`]);
      else checks.push(["unknown", `Excludes ${b}. Not in your profile; if your tumour has been tested, add the result.`]);
    }

    if (tg.age) {
      const range = tg.age.min !== undefined && tg.age.max !== undefined ? `${tg.age.min} to ${tg.age.max}` : tg.age.min !== undefined ? `${tg.age.min} or older` : `up to ${tg.age.max}`;
      checks.push(["unknown", `Age ${range}. OnCo does not ask your age.`]);
    }

    if (tg.priorTherapyRequired?.length) {
      const hit = tg.priorTherapyRequired.filter((x) => rx.has(x));
      if (hit.length) checks.push(["met", `Requires prior ${list(tg.priorTherapyRequired)}; you listed ${list(hit)}.`]);
      else checks.push(["unknown", `Requires prior ${list(tg.priorTherapyRequired)}. ${nLines ? "None of the treatments you listed match; add it if received." : "Add what has been tried to your profile to check this."}`]);
    }
    if (tg.priorTherapyExcluded?.length) {
      const hit = tg.priorTherapyExcluded.filter((x) => rx.has(x));
      if (hit.length) checks.push(["unmet", `Excludes prior ${list(tg.priorTherapyExcluded)}; you listed ${list(hit)}.`]);
      else if (nLines) checks.push(["met", `Excludes prior ${list(tg.priorTherapyExcluded)}; none of the treatments you listed match.`]);
      else checks.push(["unknown", `Excludes prior ${list(tg.priorTherapyExcluded)}. Add what has been tried to your profile to check this.`]);
    }

    if (!checks.length) { unassessed += 1; continue; }
    // One line per criterion: the worst status wins, reasons joined.
    const status: CheckStatus = checks.some(([s]) => s === "unmet") ? "unmet" : checks.every(([s]) => s === "met") ? "met" : "unknown";
    checklist.push({ criterion: c, status, why: checks.filter(([s]) => s === status || status === "unknown").map(([, w]) => w).join(" ") });
  }

  const unmet = checklist.filter((c) => c.status === "unmet");
  const met = checklist.filter((c) => c.status === "met");
  const unknown = checklist.filter((c) => c.status === "unknown");
  const requiredBmUnknown = checklist.some((c) => c.status === "unknown" && (c.criterion.tags.biomarkers?.length || c.criterion.tags.biomarkersUnclear));

  let verdict: Verdict;
  const reasons: string[] = [];
  if (unmet.length) {
    verdict = "unlikely";
    reasons.push(...unmet.map((c) => c.why));
  } else if (met.length && !requiredBmUnknown) {
    verdict = "likely";
    reasons.push(`${met.length} checkable criteri${met.length === 1 ? "on" : "a"} match your profile; ${unknown.length + unassessed} can only be checked by the team.`);
  } else {
    verdict = "unclear";
    reasons.push(checklist.length ? `Nothing in your profile contradicts the criteria, but ${requiredBmUnknown ? "a biomarker requirement could not be checked and " : ""}${unknown.length + unassessed} criteria need information OnCo does not have.` : "The criteria could not be matched to anything in your profile.");
  }
  return { verdict, reasons, checklist, unassessed };
}
