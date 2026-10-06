/**
 * The modality lens (/modalities/ and /modalities/<format>/): one hub per format of the open drug engine
 * (src/lib/modular-formats.ts) assembling what the corpus already records about that shape of medicine. Nothing
 * here is written for the hub: every section is read from records that exist for other pages, and every section
 * names the records it came from (`from`) so a reader can check the claim and an agent can follow the ids. A
 * section with nothing behind it is empty, never filled in.
 *
 * The medicines of a format are the engine's (placed or unresolved, both belong to the format); the technology
 * records of a format are listed by hand in FORMAT_TECHNOLOGIES. From those two sets everything else follows by
 * graph links: approvals and cancers from the drug records, companies from the drug records and the companies that
 * list them, trials from the trial records that name a medicine, papers, ideas and roadmap steps from their refs,
 * side-effect terms from the glossary terms the medicines and technologies link, resistance from the atlas
 * (src/data/resistance.ts) where an exemplar is a medicine of the format, manufacturing from the site and supply
 * chain records (src/data/manufacturing.ts, manufacturing-wave.ts).
 */
import { graph, type Graph } from "./graph";
import { routeFor, type Company, type Drug, type Entity, type Idea, type Kind, type Paper, type Roadmap, type Technology, type Term, type Trial } from "./schema";
import { engine, type Component, type ComponentCount, type FormatIndex } from "./modular";
import { COMPONENT_LABEL, FORMATS, FORMAT_TECHNOLOGIES, engineRoute, modalityFile, modalityRoute, type CellState, type ComponentKey, type FormatDef, type FormatId } from "./modular-formats";
import { resistance, type ResistanceClass } from "@/data/resistance";
import { CATEGORY_BY_ID } from "./resistance-categories";
import { manufacturingSites, CAPABILITY_LABEL, type Capability } from "@/data/manufacturing";
import { supplyChains } from "@/data/manufacturing-wave";
import { symptomGroup } from "./side-effects";
import trialsIndex from "../../public/trials/index.json";

type RegistryEntry = { total: number; recruiting: number; fetched: string };
const REGISTRY = trialsIndex as Record<string, RegistryEntry>;
/** Anchor ids of the resistance page (src/app/resistance/page.tsx builds them the same way). */
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/** A record named by a section: enough to link it and say what kind it is. */
export type Ref = { id: string; kind: Kind; name: string; route: string };
const ref = (e: Entity): Ref => ({ id: e.id, kind: e.kind, name: e.name, route: routeFor(e) });
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

export type ApprovedRow = {
  drug: Ref; brand?: string; status?: string; modality: string;
  /** Cancers on the record, the approval's own indications, the years of every approval row and the regions. */
  cancers: Ref[]; indications: string[]; years: number[]; firstYear?: number; regions: string[];
  target?: Component; companies: Ref[];
};
export type Phase3Row = { drug: Ref; status?: string; modality: string; cancers: Ref[]; target?: Component; trials: Ref[]; companies: Ref[]; recruiting: number };
export type CompanyRow = { company: Ref; country: string; companyType: string; drugs: Ref[]; approved: number; phase3: number };
export type TrialRow = { trial: Ref; nct?: string; phase: string; status?: string; setting: string; sponsor?: string; cancers: Ref[]; drugs: Ref[]; enrolled?: number; yearReported?: number };
export type SideEffectTerm = Ref & { tldr: string; category: string; from: Ref[] };
export type SideEffectEvent = { group: string; drugs: number; maxGrade3?: number; maxAnyGrade?: number; examples: Ref[] };
export type ResistanceRow = { id: string; drugClass: string; tldr: string; route: string; exemplars: Ref[]; mechanisms: Array<{ name: string; category: string; categoryLabel: string; how: string; frequency?: string; route: string }>; sources: Array<{ label: string; url: string }> };
export type PaperRow = Ref & { year: number; journal: string; paperType: string; tldr: string; via: Ref[] };
export type EraRow = { roadmap: Ref; era: string; title: string; status: string; step: number; route: string; refs: Ref[] };
export type IdeaRow = Ref & { maturity: string; tldr: string; via: Ref[] };
export type SiteRow = { id: string; name: string; operator: string; operatorRoute?: string; ownership: string; city: string; country: string; capabilities: string[]; capabilityLabels: string[]; drugs: Ref[]; source: { label: string; url: string } };
export type ComponentGroup = { key: ComponentKey; label: string; values: ComponentCount[]; route: string };

export type ModalityHub = {
  format: FormatDef;
  route: string; file: string;
  /** Every medicine of the format (placed or unresolved by the engine), with the counts the hub prints. */
  drugs: Ref[];
  counts: { drugs: number; approved: number; phase3: number; trials: number; companies: number; papers: number; ideas: number; eras: number };
  /** Plain-English "how it works" read from the format's technology records: TL;DR then principle of the first record with one; the other records are listed. */
  how: { paragraphs: string[]; from: Ref[]; technologies: Array<Ref & { status?: string; tldr: string }> };
  /** The glossary terms the format's technology records link, for the pills under "how it works". */
  terms: Array<Ref & { tldr: string; category: string }>;
  engine: { route: string; axes: [string, string]; rows: number; cols: number; counts: Record<CellState, number>; placed: number; total: number; pct: number };
  approved: ApprovedRow[];
  phase3: Phase3Row[];
  components: ComponentGroup[];
  companies: CompanyRow[];
  trials: TrialRow[];
  registry: { drugs: number; recruiting: number; fetched: string; fetchedFrom: string };
  sideEffects: { terms: SideEffectTerm[]; events: SideEffectEvent[]; drugsWithToxicity: number };
  resistance: ResistanceRow[];
  papers: PaperRow[];
  eras: EraRow[];
  ideas: IdeaRow[];
  manufacturing: { sites: SiteRow[]; capabilities: string[]; chain?: { id: string; name: string; summary: string; route: string; technologies: Ref[]; companies: Ref[]; products: Ref[] }; technologies: Array<Ref & { tldr: string }> };
};

const APPROVED_STATUS = new Set(["approved", "standard-of-care", "established"]);
const LIVE_TRIAL = new Set(["recruiting", "active", "planned"]);
/** Manufacturing capabilities and supply chain of each format, by the ids the manufacturing records use. */
const MANUFACTURING: Record<FormatId, { capabilities: Capability[]; chain?: string }> = {
  adc: { capabilities: ["adc-conjugation", "payload-linker", "antibody-drug-substance"], chain: "adcs" },
  radioligand: { capabilities: ["radioisotope", "radiopharmaceutical"], chain: "isotopes" },
  "car-t": { capabilities: ["cell-therapy", "viral-vector"], chain: "cell-therapy" },
  "tcr-t": { capabilities: ["cell-therapy", "viral-vector"], chain: "cell-therapy" },
  bispecific: { capabilities: ["antibody-drug-substance"], chain: "biologics" },
  degrader: { capabilities: [], chain: "small-molecules" },
  "small-molecule": { capabilities: [], chain: "small-molecules" },
  antibody: { capabilities: ["antibody-drug-substance"], chain: "biologics" },
  cytokine: { capabilities: ["antibody-drug-substance"], chain: "biologics" },
  vaccine: { capabilities: ["plasmid-mrna"], chain: "mrna" },
  "oncolytic-virus": { capabilities: ["viral-vector"], chain: "cell-therapy" },
  "cell-therapy": { capabilities: ["cell-therapy"], chain: "cell-therapy" },
};

const unique = <T extends { id: string }>(xs: T[]): T[] => { const seen = new Set<string>(); return xs.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true))); };

function companiesOf(d: Drug, g: Graph): Company[] {
  const out: Company[] = [];
  for (const id of d.companies) { const c = g.get(id); if (c?.kind === "company") out.push(c); }
  for (const c of g.incoming(d.id).get("company") ?? []) if (c.kind === "company") out.push(c);
  return unique(out).sort(byName);
}

function trialsOf(d: Drug, g: Graph): Trial[] {
  const out: Trial[] = [];
  for (const id of d.trials) { const t = g.get(id); if (t?.kind === "trial") out.push(t); }
  for (const t of g.incoming(d.id).get("trial") ?? []) if (t.kind === "trial") out.push(t);
  return unique(out);
}

function cancersOf(e: Entity, g: Graph): Ref[] {
  return e.cancers.map((id) => g.get(id)).filter((c): c is Entity => !!c).map(ref);
}

function buildHub(def: FormatDef, f: FormatIndex, g: Graph): ModalityHub {
  const drugIds = [...f.drugs.map((d) => d.id), ...f.unresolved.map((u) => u.id)];
  const drugs = drugIds.map((id) => g.get(id)).filter((d): d is Drug => d?.kind === "drug").sort(byName);
  const drugSet = new Set(drugs.map((d) => d.id));
  const targetOf = new Map(f.drugs.map((d) => [d.id, d.components[def.axes[0]] ?? d.components.target]));
  const techs = FORMAT_TECHNOLOGIES[def.id].map((id) => g.get(id)).filter((t): t is Technology => t?.kind === "technology");
  const techSet = new Set(techs.map((t) => t.id));
  const memberSet = new Set([...drugSet, ...techSet]);
  const route = modalityRoute(def.id);

  // How it works: the first technology record with a principle speaks; the rest are listed.
  const speaker = techs.find((t) => t.principle) ?? techs[0];
  const how = {
    paragraphs: speaker ? [speaker.tldr, ...(speaker.principle && speaker.principle !== speaker.tldr ? [speaker.principle] : [])] : [],
    from: speaker ? [ref(speaker)] : [],
    technologies: techs.map((t) => ({ ...ref(t), status: t.status, tldr: t.tldr })),
  };
  const terms = unique(techs.flatMap((t) => t.terms).map((id) => g.get(id)).filter((t): t is Term => t?.kind === "term")).map((t) => ({ ...ref(t), tldr: t.tldr, category: t.category }));

  // Approved medicines with cancers and years, from the drug records' approval rows.
  const approved: ApprovedRow[] = drugs.filter((d) => d.approvals.length > 0 || APPROVED_STATUS.has(d.status ?? "")).map((d) => {
    const years = [...new Set(d.approvals.map((a) => a.year))].sort((a, b) => a - b);
    const t = targetOf.get(d.id);
    return {
      drug: ref(d), brand: d.brand, status: d.status, modality: d.modality,
      cancers: cancersOf(d, g), indications: [...new Set(d.approvals.map((a) => a.indication))], years, firstYear: years[0], regions: [...new Set(d.approvals.map((a) => a.region))],
      target: t ? { key: t.key, id: t.id, name: t.name, href: t.href } : undefined, companies: companiesOf(d, g).map(ref),
    };
  }).sort((a, b) => (a.firstYear ?? 9999) - (b.firstYear ?? 9999) || byName(a.drug, b.drug));
  const approvedSet = new Set(approved.map((a) => a.drug.id));

  // Phase 3: the record says so, or a live phase 3 trial names the medicine and it is not approved.
  const phase3: Phase3Row[] = drugs.filter((d) => !approvedSet.has(d.id)).flatMap((d) => {
    const trials = trialsOf(d, g).filter((t) => (t.phase === "3" || t.phase === "2/3") && LIVE_TRIAL.has(t.status ?? ""));
    if (d.status !== "phase-3" && trials.length === 0) return [];
    const t = targetOf.get(d.id);
    return [{ drug: ref(d), status: d.status, modality: d.modality, cancers: cancersOf(d, g), target: t ? { key: t.key, id: t.id, name: t.name, href: t.href } : undefined, trials: trials.map(ref), companies: companiesOf(d, g).map(ref), recruiting: REGISTRY[d.id]?.recruiting ?? 0 }];
  });
  const phase3Set = new Set(phase3.map((p) => p.drug.id));

  // Components: the engine's per-part counts, each value a filter link into the engine table.
  const components: ComponentGroup[] = def.components.map((k) => ({ key: k, label: COMPONENT_LABEL[k], values: f.components[k] ?? [], route: `${engineRoute(def.id)}#table` }));

  // Companies most active in the format: distinct medicines, approved and phase 3 among them.
  const coMap = new Map<string, { company: Company; drugs: Drug[] }>();
  for (const d of drugs) for (const c of companiesOf(d, g)) { const e = coMap.get(c.id) ?? { company: c, drugs: [] }; e.drugs.push(d); coMap.set(c.id, e); }
  const companies: CompanyRow[] = [...coMap.values()].map(({ company, drugs: ds }) => ({
    company: ref(company), country: company.country, companyType: company.companyType, drugs: ds.map(ref), approved: ds.filter((d) => approvedSet.has(d.id)).length, phase3: ds.filter((d) => phase3Set.has(d.id)).length,
  })).sort((a, b) => b.drugs.length - a.drugs.length || b.approved - a.approved || byName(a.company, b.company));

  // Trials recruiting now: corpus trial records with that status naming a medicine of the format.
  const trialMap = new Map<string, { trial: Trial; drugs: Drug[] }>();
  for (const d of drugs) for (const t of trialsOf(d, g)) { if (t.status !== "recruiting") continue; const e = trialMap.get(t.id) ?? { trial: t, drugs: [] }; e.drugs.push(d); trialMap.set(t.id, e); }
  const trials: TrialRow[] = [...trialMap.values()].map(({ trial: t, drugs: ds }) => ({
    trial: ref(t), nct: t.nct, phase: t.phase, status: t.status, setting: t.setting, sponsor: t.sponsor, cancers: cancersOf(t, g), drugs: unique(ds).sort(byName).map(ref), enrolled: t.enrolled, yearReported: t.yearReported,
  })).sort((a, b) => (b.phase === "3" ? 1 : 0) - (a.phase === "3" ? 1 : 0) || byName(a.trial, b.trial));
  let recruiting = 0, withRegistry = 0, fetched = "", fetchedFrom = "";
  for (const d of drugs) { const r = REGISTRY[d.id]; if (!r) continue; withRegistry++; recruiting += r.recruiting; if (r.fetched > fetched) fetched = r.fetched; if (r.fetched && (!fetchedFrom || r.fetched < fetchedFrom)) fetchedFrom = r.fetched; }

  // Side-effect profile: glossary terms of the Side effects category linked from the medicines and technologies, then the label events the drug records carry.
  const termFrom = new Map<string, { term: Term; from: Entity[] }>();
  for (const src of [...techs, ...drugs]) for (const id of src.terms) { const t = g.get(id); if (t?.kind !== "term" || t.category !== "Side effects") continue; const e = termFrom.get(t.id) ?? { term: t, from: [] }; e.from.push(src); termFrom.set(t.id, e); }
  const sideTerms: SideEffectTerm[] = [...termFrom.values()].map(({ term, from }) => ({ ...ref(term), tldr: term.tldr, category: term.category, from: from.map(ref) })).sort((a, b) => b.from.length - a.from.length || byName(a, b));
  const eventMap = new Map<string, { drugs: Set<string>; maxGrade3?: number; maxAny?: number; examples: Drug[] }>();
  let drugsWithToxicity = 0;
  for (const d of drugs) {
    if (!d.toxicity.length) continue;
    drugsWithToxicity++;
    for (const t of d.toxicity) {
      const group = symptomGroup(t.event);
      const e = eventMap.get(group) ?? { drugs: new Set(), examples: [] };
      if (!e.drugs.has(d.id)) { e.drugs.add(d.id); if (e.examples.length < 3) e.examples.push(d); }
      if (t.grade3PlusPct !== undefined) e.maxGrade3 = Math.max(e.maxGrade3 ?? 0, t.grade3PlusPct);
      if (t.anyGradePct !== undefined) e.maxAny = Math.max(e.maxAny ?? 0, t.anyGradePct);
      eventMap.set(group, e);
    }
  }
  const events: SideEffectEvent[] = [...eventMap.entries()].map(([group, e]) => ({ group, drugs: e.drugs.size, maxGrade3: e.maxGrade3, maxAnyGrade: e.maxAny, examples: e.examples.map(ref) })).sort((a, b) => b.drugs - a.drugs || a.group.localeCompare(b.group)).slice(0, 10);

  // Resistance: atlas classes whose exemplars are medicines of the format, or whose mechanisms cite a technology of it.
  const resistanceRows: ResistanceRow[] = resistance.filter((r: ResistanceClass) => r.exemplars.some((id) => drugSet.has(id)) || r.mechanisms.some((m) => m.refs.some((id) => techSet.has(id)))).map((r) => ({
    id: r.id, drugClass: r.drugClass, tldr: r.tldr, route: `/resistance/#${r.id}`,
    exemplars: r.exemplars.map((id) => g.get(id)).filter((e): e is Entity => !!e).map(ref),
    mechanisms: r.mechanisms.map((m) => ({ name: m.name, category: m.category, categoryLabel: CATEGORY_BY_ID[m.category].label, how: m.how, frequency: m.frequency, route: `/resistance/#${r.id}-${slug(m.name)}` })),
    sources: r.sources,
  }));

  // Key papers: linked from the medicines and technologies, or naming them.
  const paperVia = new Map<string, { paper: Paper; via: Entity[] }>();
  const addPaper = (p: Entity | undefined, via: Entity) => { if (p?.kind !== "paper") return; const e = paperVia.get(p.id) ?? { paper: p, via: [] }; if (!e.via.some((v) => v.id === via.id)) e.via.push(via); paperVia.set(p.id, e); };
  for (const src of [...drugs, ...techs]) { for (const id of src.keyPapers) addPaper(g.get(id), src); for (const p of g.incoming(src.id).get("paper") ?? []) addPaper(p, src); }
  const papers: PaperRow[] = [...paperVia.values()].map(({ paper, via }) => ({ ...ref(paper), year: paper.year, journal: paper.journal, paperType: paper.paperType, tldr: paper.tldr, via: via.slice(0, 4).map(ref) })).sort((a, b) => b.year - a.year || byName(a, b));

  // Roadmap eras whose steps cite a medicine or technology of the format.
  const eras: EraRow[] = g.kind("roadmap").flatMap((r: Roadmap) => r.steps.flatMap((s, i) => {
    const refs = s.refs.filter((id) => memberSet.has(id)).map((id) => g.get(id)).filter((e): e is Entity => !!e).map(ref);
    return refs.length ? [{ roadmap: ref(r), era: s.era, title: s.title, status: s.status, step: i + 1, route: `${routeFor(r)}#story-step-${i}`, refs }] : [];
  })).sort((a, b) => byName(a.roadmap, b.roadmap) || a.step - b.step);

  // Open questions: ideas that link a medicine or technology of the format (or carry the format id as a tag).
  const ideaVia = new Map<string, { idea: Idea; via: Entity[] }>();
  const addIdea = (i: Entity | undefined, via?: Entity) => { if (i?.kind !== "idea") return; const e = ideaVia.get(i.id) ?? { idea: i, via: [] }; if (via && !e.via.some((v) => v.id === via.id)) e.via.push(via); ideaVia.set(i.id, e); };
  for (const src of [...drugs, ...techs]) for (const i of g.incoming(src.id).get("idea") ?? []) addIdea(i, src);
  for (const i of g.kind("idea")) if (i.tags.includes(def.id)) addIdea(i);
  const ideas: IdeaRow[] = [...ideaVia.values()].map(({ idea, via }) => ({ ...ref(idea), maturity: idea.maturity, tldr: idea.tldr, via: via.slice(0, 4).map(ref) })).sort((a, b) => MATURITY_ORDER.indexOf(a.maturity) - MATURITY_ORDER.indexOf(b.maturity) || byName(a, b));

  // Manufacturing and supply: sites with a capability the format needs, the supply chain record, and the format's manufacturing technologies.
  const man = MANUFACTURING[def.id];
  const sites: SiteRow[] = manufacturingSites.filter((s) => s.capabilities.some((c) => man.capabilities.includes(c)) || (s.drugs ?? []).some((id) => drugSet.has(id))).map((s) => {
    const op = s.operatorId ? g.get(s.operatorId) : undefined;
    return { id: s.id, name: s.name, operator: s.operator, operatorRoute: op ? routeFor(op) : undefined, ownership: s.ownership, city: s.city, country: s.country, capabilities: s.capabilities, capabilityLabels: s.capabilities.map((c) => CAPABILITY_LABEL[c]), drugs: (s.drugs ?? []).map((id) => g.get(id)).filter((e): e is Entity => !!e).map(ref), source: s.source };
  }).sort(byName);
  const chainRec = man.chain ? supplyChains.find((c) => c.id === man.chain) : undefined;
  const ents = (ids: string[]) => ids.map((id) => g.get(id)).filter((e): e is Entity => !!e).map(ref);
  const chain = chainRec ? { id: chainRec.id, name: chainRec.name, summary: chainRec.summary, route: `/manufacturing/#chain-${chainRec.id}`, technologies: ents(chainRec.technologies), companies: ents(chainRec.companies), products: ents(chainRec.products) } : undefined;
  const manTech = techs.filter((t) => t.tags.includes("manufacturing-wave") || t.tags.includes("supporting") || (chainRec?.technologies.includes(t.id) ?? false)).map((t) => ({ ...ref(t), tldr: t.tldr }));

  return {
    format: def, route, file: modalityFile(def.id),
    drugs: drugs.map(ref),
    counts: { drugs: drugs.length, approved: approved.length, phase3: phase3.length, trials: trials.length, companies: companies.length, papers: papers.length, ideas: ideas.length, eras: eras.length },
    how, terms,
    engine: { route: engineRoute(def.id), axes: [COMPONENT_LABEL[def.axes[0]], COMPONENT_LABEL[def.axes[1]]], rows: f.rows.length, cols: f.cols.filter((c) => c.id !== "not-recorded").length, counts: { approved: f.counts.approved, development: f.counts.development, stopped: f.counts.stopped, unclear: f.counts.unclear, untried: f.counts.untried }, placed: f.drugs.length, total: f.coverage.total, pct: f.coverage.pct },
    approved, phase3, components, companies, trials,
    registry: { drugs: withRegistry, recruiting, fetched, fetchedFrom },
    sideEffects: { terms: sideTerms, events, drugsWithToxicity },
    resistance: resistanceRows, papers, eras, ideas,
    manufacturing: { sites, capabilities: man.capabilities.map((c) => CAPABILITY_LABEL[c]), chain, technologies: manTech },
  };
}

const MATURITY_ORDER = ["being-tested-at-scale", "early-clinical", "preclinical-evidence", "speculative"];
export const MATURITY_LABEL: Record<string, string> = { speculative: "Speculative", "preclinical-evidence": "Preclinical evidence", "early-clinical": "Early clinical", "being-tested-at-scale": "Being tested at scale" };

let cached: Map<FormatId, ModalityHub> | undefined;
/** Every hub, built once per process from the engine and the graph. */
export function modalityHubs(): ModalityHub[] {
  if (!cached) {
    const g = graph();
    const e = engine();
    cached = new Map(FORMATS.map((def) => [def.id, buildHub(def, e.formats.find((f) => f.format.id === def.id)!, g)]));
  }
  return FORMATS.map((f) => cached!.get(f.id)!);
}
export function modalityHub(id: string): ModalityHub | undefined {
  return modalityHubs().find((h) => h.format.id === id);
}

/** The JSON companion of one hub: the same sections, with the format first and a note on provenance. */
export function modalityJson(h: ModalityHub): unknown {
  return {
    format: { id: h.format.id, name: h.format.name, blurb: h.format.blurb, route: h.route, engine: h.engine.route },
    counts: h.counts,
    how: h.how, terms: h.terms, engine: h.engine,
    approved: h.approved, phase3: h.phase3, components: h.components, companies: h.companies, trials: h.trials, registry: h.registry,
    sideEffects: h.sideEffects, resistance: h.resistance, papers: h.papers, eras: h.eras, ideas: h.ideas, manufacturing: h.manufacturing,
    drugs: h.drugs,
    note: "Every section is read from existing corpus records and names them (from, via, exemplars, refs); a section with nothing behind it is empty. Medicines of a format are the open drug engine's (/pipeline/engine/); technologies are listed in src/lib/modular-formats.ts. CC BY-NC 4.0, attribute Data from OnCo (onco.cc). Not medical advice.",
  };
}

/** The index file: one line per format with its counts and links. */
export function modalitiesIndexJson(): unknown {
  return {
    formats: modalityHubs().map((h) => ({ id: h.format.id, name: h.format.name, route: h.route, file: h.file, engine: h.engine.route, counts: h.counts, technologies: h.how.technologies.map((t) => t.id) })),
    note: "One hub per format of the open drug engine, assembling what the corpus records about that shape of medicine. CC BY-NC 4.0, attribute Data from OnCo (onco.cc). Not medical advice.",
  };
}
