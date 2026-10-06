import type { StaticColumn, StaticRow, CellObj } from "@/components/filters/StaticTable";
import { modalityHubs, MATURITY_LABEL, type ApprovedRow, type IdeaRow, type ModalityHub, type PaperRow, type Phase3Row, type Ref, type TrialRow } from "@/lib/modalities";
import { modalityTableId, MODALITY_TABLES, type ModalityTable } from "@/lib/modular-formats";
import { phaseLabel } from "@/lib/kinds";
import { statusClass } from "@/lib/text";
import type { TableFile } from "./index";

/**
 * The paged tables of a modality hub (/modalities/<format>/): approved medicines, medicines in phase 3, trials
 * recruiting now, key papers and open questions. The page carries the first TABLE_PAGE rows of each and the rest
 * lives in /api/v1/tables/modality-<format>-<table>.json (scripts/build-tables.ts). Rows are plain cells, so the
 * client table draws them without anything crossing the server boundary but JSON; every filterable column's values
 * are deep-linkable through scoped query keys (`?trials.cancers=tnbc`).
 */
const CHIP = "border border-border bg-card text-xs";
const chips = (xs: Ref[], chip = CHIP): CellObj[] => xs.map((x) => ({ text: x.name, v: x.id, href: x.route, chip }));
const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export const approvedColumns: StaticColumn[] = [
  { key: "drug", label: "Medicine", sortable: true, className: "min-w-[160px]" },
  { key: "target", label: "Target", filterable: true, hide: "hidden md:table-cell", tip: "The target the open drug engine read from the record; a filter pill deep-links the engine table too." },
  { key: "cancers", label: "Cancers", filterable: true, className: "min-w-[180px]", tip: "The cancers the record links; the approvals' own indications are in the tooltip of each year." },
  { key: "firstYear", label: "First approval", sortable: true, numeric: true, className: "text-right tabular-nums", tip: "The earliest year among the record's approval rows; hover for every row." },
  { key: "regions", label: "Regions", filterable: true, hide: "hidden lg:table-cell" },
  { key: "status", label: "Status", filterable: true, hide: "hidden lg:table-cell" },
  { key: "companies", label: "Companies", filterable: true, hide: "hidden xl:table-cell" },
];

export function approvedRow(a: ApprovedRow): StaticRow {
  return {
    id: a.drug.id,
    drug: { text: a.drug.name, href: a.drug.route, strong: true, sub: a.brand, title: a.modality },
    target: a.target ? { text: a.target.name, v: a.target.id, href: a.target.href, chip: CHIP } : undefined,
    cancers: chips(a.cancers),
    firstYear: a.firstYear !== undefined ? { text: String(a.firstYear), v: a.firstYear, title: a.years.length ? `Approval rows: ${a.years.join(", ")}. ${a.indications.map((i) => short(i, 80)).join("; ")}` : "Recorded as approved or standard of care; no dated approval row" } : { text: "no dated row", v: 0, muted: true, title: "Recorded as approved, established or standard of care without a dated approval row" },
    regions: a.regions.map((r): CellObj => ({ text: r, v: r, chip: CHIP })),
    status: a.status ? { text: a.status.replace(/-/g, " "), v: a.status, chip: `${statusClass(a.status)} text-xs` } : undefined,
    companies: chips(a.companies),
  };
}

export const phase3Columns: StaticColumn[] = [
  { key: "drug", label: "Medicine", sortable: true, className: "min-w-[160px]" },
  { key: "target", label: "Target", filterable: true, hide: "hidden md:table-cell" },
  { key: "cancers", label: "Cancers", filterable: true, className: "min-w-[160px]" },
  { key: "trials", label: "Phase 3 trials here", className: "min-w-[160px]", tip: "Trial records in the corpus with phase 3 (or 2/3) and a recruiting, active or planned status that name the medicine." },
  { key: "recruiting", label: "Registry recruiting", sortable: true, numeric: true, hide: "hidden lg:table-cell", className: "text-right tabular-nums", tip: "Recruiting studies in the ClinicalTrials.gov index for this medicine (public/trials/), any phase." },
  { key: "status", label: "Record status", filterable: true, hide: "hidden lg:table-cell" },
  { key: "companies", label: "Companies", filterable: true, hide: "hidden xl:table-cell" },
];

export function phase3Row(p: Phase3Row): StaticRow {
  return {
    id: p.drug.id,
    drug: { text: p.drug.name, href: p.drug.route, strong: true, title: p.modality },
    target: p.target ? { text: p.target.name, v: p.target.id, href: p.target.href, chip: CHIP } : undefined,
    cancers: chips(p.cancers),
    trials: p.trials.length ? p.trials.map((t): CellObj => ({ text: short(t.name, 72), title: t.name, v: t.id, href: t.route, chip: CHIP })) : { text: "record status only", muted: true },
    recruiting: p.recruiting,
    status: p.status ? { text: p.status.replace(/-/g, " "), v: p.status, chip: `${statusClass(p.status)} text-xs` } : undefined,
    companies: chips(p.companies),
  };
}

export const trialColumns: StaticColumn[] = [
  { key: "trial", label: "Trial", sortable: true, className: "min-w-[200px]" },
  { key: "phase", label: "Phase", filterable: true, order: ["Phase 3", "Phase 2/3", "Phase 2", "Phase 1/2", "Phase 1", "Platform"] },
  { key: "cancers", label: "Cancers", filterable: true, className: "min-w-[160px]" },
  { key: "drugs", label: "Medicines", filterable: true, className: "min-w-[160px]" },
  { key: "sponsor", label: "Sponsor", filterable: true, hide: "hidden lg:table-cell" },
  { key: "enrolled", label: "Enrolled", sortable: true, numeric: true, hide: "hidden xl:table-cell", className: "text-right tabular-nums" },
  { key: "nct", label: "Registry", hide: "hidden md:table-cell" },
];

export function trialRow(t: TrialRow): StaticRow {
  return {
    id: t.trial.id,
    trial: { text: t.trial.name, href: t.trial.route, strong: true, sub: short(t.setting, 90) },
    phase: { text: phaseLabel(t.phase), v: phaseLabel(t.phase), chip: CHIP },
    cancers: chips(t.cancers),
    drugs: chips(t.drugs),
    sponsor: t.sponsor,
    enrolled: t.enrolled,
    nct: t.nct ? { text: t.nct, href: `https://clinicaltrials.gov/study/${t.nct}`, ext: true, mono: true } : undefined,
  };
}

export const paperColumns: StaticColumn[] = [
  { key: "paper", label: "Paper", sortable: true, className: "min-w-[220px]" },
  { key: "year", label: "Year", sortable: true, numeric: true, className: "text-right tabular-nums" },
  { key: "journal", label: "Journal", filterable: true, hide: "hidden md:table-cell" },
  { key: "paperType", label: "Type", filterable: true, hide: "hidden lg:table-cell" },
  { key: "via", label: "Linked from", filterable: true, hide: "hidden xl:table-cell", tip: "The medicine or technology record of this format that names the paper, or that the paper names." },
];

export function paperRow(p: PaperRow): StaticRow {
  return {
    id: p.id,
    paper: { text: p.name, href: p.route, strong: true, sub: short(p.tldr, 140) },
    year: p.year,
    journal: p.journal,
    paperType: { text: p.paperType.replace(/-/g, " "), v: p.paperType, chip: CHIP },
    via: chips(p.via),
  };
}

export const ideaColumns: StaticColumn[] = [
  { key: "idea", label: "Idea", sortable: true, className: "min-w-[240px]" },
  { key: "maturity", label: "Maturity", filterable: true, order: Object.values(MATURITY_LABEL) },
  { key: "via", label: "Linked from", filterable: true, hide: "hidden lg:table-cell", tip: "The medicine or technology record of this format the idea links, or the format's own tag." },
];

export function ideaRow(i: IdeaRow): StaticRow {
  return {
    id: i.id,
    idea: { text: i.name, href: i.route, strong: true, sub: short(i.tldr, 160) },
    maturity: { text: MATURITY_LABEL[i.maturity] ?? i.maturity, v: MATURITY_LABEL[i.maturity] ?? i.maturity, chip: CHIP },
    via: i.via.length ? chips(i.via) : { text: "tagged with the format", muted: true },
  };
}

export const MODALITY_COLUMNS: Record<ModalityTable, StaticColumn[]> = { approved: approvedColumns, phase3: phase3Columns, trials: trialColumns, papers: paperColumns, ideas: ideaColumns };

/** Every row of one hub table, in the order the page renders them. */
export function modalityRows(h: ModalityHub, table: ModalityTable): StaticRow[] {
  switch (table) {
    case "approved": return h.approved.map(approvedRow);
    case "phase3": return h.phase3.map(phase3Row);
    case "trials": return h.trials.map(trialRow);
    case "papers": return h.papers.map(paperRow);
    case "ideas": return h.ideas.map(ideaRow);
  }
}

/** Every hub's tables for the API writer; only those longer than a page get a file. */
export function modalityTables(): TableFile[] {
  return modalityHubs().flatMap((h) => MODALITY_TABLES.map((t) => ({ id: modalityTableId(h.format.id, t), rows: modalityRows(h, t) })));
}
