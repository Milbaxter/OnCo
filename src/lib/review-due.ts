import type { Entity } from "./schema";

/**
 * When each kind of record is due a re-check, and which review track owns it.
 *
 * This lived in `scripts/freshness.ts` until 6 October 2026 and moved here because a reader needs it: the
 * review card on every record page used to open with "Not yet reviewed", which is the least useful true thing
 * it could say about a page whose facts are all dated and sourced. It now says when the page is next due,
 * which needs these rules at render time. `scripts/freshness.ts` imports them from here, so there is one copy.
 */
export type Track = "clinical" | "scientific" | "regulatory" | "advocate" | "editorial";
export const TRACK_META: Record<Track, { label: string; owner: string }> = {
  clinical: { label: "Expert (clinical)", owner: "Cancer pages, standard-of-care rows, trial outcomes" },
  scientific: { label: "Expert (scientific)", owner: "Targets, pathways, technologies, payloads, resistance" },
  regulatory: { label: "Expert (regulatory)", owner: "Product approvals, regulatory events, calendar" },
  advocate: { label: "Patient advocate", owner: "TL;DRs, glossary, questions and reading paths" },
  editorial: { label: "Maintainer", owner: "Everything else: companies, institutions, people, ideas, papers" },
};

export type Sla = { id: string; label: string; track: Track; days: number; critical: boolean; applies: (e: Entity) => boolean };

const APPROVED = new Set(["approved", "standard-of-care"]);
const OPEN_TRIAL = new Set(["recruiting", "active", "planned"]);

/** Order matters: the first SLA whose `applies` matches a record owns it. */
export const SLAS: Sla[] = [
  { id: "approved-products", label: "Approved products and standard-of-care regimens", track: "regulatory", days: 90, critical: true, applies: (e) => e.kind === "drug" && APPROVED.has(e.status ?? "") },
  { id: "recruiting-trials", label: "Recruiting, active or planned trials", track: "clinical", days: 120, critical: true, applies: (e) => e.kind === "trial" && OPEN_TRIAL.has(e.status ?? "") },
  { id: "cancers", label: "Cancer pages", track: "clinical", days: 180, critical: true, applies: (e) => e.kind === "cancer" },
  { id: "pipeline-products", label: "Pipeline products (not yet approved)", track: "regulatory", days: 180, critical: false, applies: (e) => e.kind === "drug" },
  { id: "reported-trials", label: "Reported and completed trials", track: "clinical", days: 365, critical: false, applies: (e) => e.kind === "trial" },
  { id: "pairings", label: "Pairings and cautions", track: "clinical", days: 365, critical: false, applies: (e) => e.kind === "pairing" },
  { id: "targets-pathways", label: "Targets and pathways", track: "scientific", days: 365, critical: false, applies: (e) => e.kind === "target" || e.kind === "pathway" },
  { id: "technologies", label: "Technologies and roadmaps", track: "scientific", days: 365, critical: false, applies: (e) => e.kind === "technology" || e.kind === "roadmap" },
  { id: "glossary", label: "Glossary terms and fronts", track: "advocate", days: 730, critical: false, applies: (e) => e.kind === "term" || e.kind === "section" },
  { id: "organisations", label: "Companies, institutions and people", track: "editorial", days: 365, critical: false, applies: (e) => e.kind === "company" || e.kind === "institution" || e.kind === "person" },
  { id: "ideas", label: "Ideas and bottlenecks", track: "editorial", days: 365, critical: false, applies: (e) => e.kind === "idea" || e.kind === "bottleneck" },
  { id: "literature", label: "Key papers, journals and collections", track: "editorial", days: 730, critical: false, applies: (e) => e.kind === "paper" || e.kind === "journal" || e.kind === "collection" },
];


/** The first SLA that claims this record, or undefined for a kind no SLA covers. */
export function slaFor(e: Entity): Sla | undefined {
  return SLAS.find((s) => s.applies(e));
}

/**
 * The date this record is next due a re-check: the date its facts were last checked plus its SLA's days.
 * Undefined when no SLA covers the kind, or when the record carries no `asOf` to count from.
 */
export function dueDate(e: Entity): { due: Date; sla: Sla } | undefined {
  const sla = slaFor(e);
  if (!sla || !e.asOf) return undefined;
  const from = new Date(e.asOf);
  if (Number.isNaN(from.getTime())) return undefined;
  return { due: new Date(from.getTime() + sla.days * 86_400_000), sla };
}
