/**
 * Data-currency metadata for every automated feed: where its snapshot lives under public/, which script
 * and workflow refresh it, how often it should run, and what the snapshot's own `fetched` stamp and
 * counts say. Read at build time by /status/ (server components only: this module touches the file system).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { registryDateRange } from "./registry-dates";

export type FeedDef = {
  id: string;
  label: string;
  /** Snapshot path relative to public/. */
  path: string;
  script: string;
  workflow?: string;
  /** Expected refresh interval in days; a snapshot older than twice this is flagged stale. */
  cadenceDays: number;
  source: string;
  /** Pull the oldest fetched date, optional latest date and a headline count from the snapshot. */
  describe: (json: Record<string, unknown>) => { fetched?: string; fetchedThrough?: string; count?: number; note?: string };
};

export type FeedStatus = {
  id: string; label: string; path: string; script: string; workflow?: string; source: string; cadenceDays: number;
  present: boolean; fetched?: string; fetchedThrough?: string; ageDays?: number; count?: number; note?: string; stale: boolean;
};

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const num = (v: unknown) => (typeof v === "number" ? v : undefined);
const keys = (v: unknown) => (v && typeof v === "object" ? Object.keys(v as object).length : undefined);
const len = (v: unknown) => (Array.isArray(v) ? v.length : undefined);

export const FEEDS: FeedDef[] = [
  { id: "trials", label: "ClinicalTrials.gov phase 2/3 counts", path: "trials/index.json", script: "scripts/fetch-trials.ts", workflow: "refresh-trials.yml", cadenceDays: 7, source: "ClinicalTrials.gov API v2",
    describe: (j) => {
      const entries = Object.values(j) as Array<{ fetched?: string }>;
      const dates = registryDateRange(entries.map((e) => ({ fetched: e.fetched ?? "" })));
      // A retained old or undated snapshot must not look fresh after another product succeeds.
      return { fetched: entries.every((e) => e.fetched) ? dates.oldest || undefined : undefined,
        fetchedThrough: dates.newest || undefined, count: entries.length,
        note: "products with a trial snapshot; age and state use the oldest product snapshot" };
    } },
  { id: "trial-changes", label: "Trial status changes", path: "trials/changes.json", script: "scripts/fetch-trials.ts", workflow: "refresh-trials.yml", cadenceDays: 7, source: "ClinicalTrials.gov API v2 (diff against previous snapshot)",
    describe: (j) => ({ fetched: str(j.fetched), count: len(j.changes), note: "changes detected in the last 90 days" }) },
  { id: "papers", label: "Literature snapshot", path: "papers/index.json", script: "scripts/fetch-papers.ts", workflow: "refresh-papers.yml", cadenceDays: 7, source: "Europe PMC REST API",
    describe: (j) => ({ fetched: str(j.fetched), count: keys(j.entities), note: "objects with paper counts" }) },
  { id: "openalex-institutions", label: "Institution research output", path: "openalex/institutions.json", script: "scripts/fetch-openalex.ts", cadenceDays: 90, source: "OpenAlex (CC0)",
    describe: (j) => ({ fetched: str(j.fetched), count: keys(j.institutions), note: str(j.note) }) },
  { id: "openalex-research", label: "Institution research output, five years", path: "openalex/research-index.json", script: "scripts/fetch-institution-research.ts", workflow: "refresh-research.yml", cadenceDays: 7, source: "OpenAlex works by institution lineage (CC0)",
    describe: (j) => ({ fetched: str(j.fetched), count: keys(j.institutions), note: `${keys(j.unresolved) ?? 0} institutions unresolved` }) },
  { id: "citations", label: "Key paper citation counts", path: "citations/index.json", script: "scripts/fetch-citations.ts", workflow: "refresh-pulse.yml", cadenceDays: 7, source: "Europe PMC REST API (citedByCount by DOI or PMID)",
    describe: (j) => ({ fetched: str(j.fetched), count: keys(j.papers), note: "key papers with a citation count" }) },
  { id: "openalex-papers", label: "Key paper citations by year", path: "openalex/papers.json", script: "scripts/fetch-openalex-papers.ts", workflow: "refresh-pulse.yml", cadenceDays: 7, source: "OpenAlex works by DOI (CC0)",
    describe: (j) => ({ fetched: str(j.fetched), count: keys(j.papers), note: "key papers with yearly citation counts" }) },
  { id: "globocan", label: "GLOBOCAN incidence and mortality", path: "globocan/countries.json", script: "scripts/fetch-globocan.ts", cadenceDays: 365, source: "IARC Global Cancer Observatory",
    describe: (j) => ({ fetched: str(j.fetched), count: keys(j.countries), note: `estimates for ${num(j.year) ?? "?"}` }) },
  { id: "fda", label: "FDA oncology approvals", path: "fda/recent.json", script: "scripts/fetch-fda.ts", workflow: "refresh-fda.yml", cadenceDays: 7, source: "FDA OCE approval notifications and openFDA drugsfda",
    describe: (j) => ({ fetched: str(j.fetched), count: len(j.oce), note: `${len(j.notInCorpus) ?? 0} not yet in corpus` }) },
  { id: "regional", label: "EMA register check", path: "regional/candidates.json", script: "scripts/fetch-ema.ts", workflow: "refresh-regional.yml", cadenceDays: 7, source: "EMA medicines data (xlsx)",
    describe: (j) => ({ fetched: str(j.fetched), count: len(j.candidates), note: `${len(j.verified) ?? 0} rows verified` }) },
  { id: "abstracts", label: "Congress abstract harvest", path: "digests/candidates.json", script: "scripts/fetch-abstracts.ts", workflow: "refresh-pulse.yml", cadenceDays: 7, source: "Crossref (JCO, Annals of Oncology, Blood, Cancer Research supplements)",
    describe: (j) => { const c = j.congress as { label?: string; year?: number } | undefined; return { fetched: str(j.fetched), count: len(j.items), note: c ? `${c.label ?? ""} ${c.year ?? ""}`.trim() : undefined }; } },
  { id: "hta", label: "HTA decisions", path: "hta/index.json", script: "scripts/fetch-hta.ts", workflow: "refresh-hta.yml", cadenceDays: 30, source: "NICE, G-BA, PBAC",
    describe: (j) => ({ fetched: str(j.fetched), count: len(j.decisions), note: "decisions with a fetched date or document" }) },
  { id: "pulse", label: "Automated research pulse", path: "pulse/auto.json", script: "scripts/fetch-pulse.ts", workflow: "refresh-pulse.yml", cadenceDays: 7, source: "Journal and news RSS feeds, FDA OCE",
    describe: (j) => { const feeds = j.feeds as Array<{ ok?: boolean }> | undefined; return { fetched: str(j.fetched), count: len(j.items), note: feeds ? `${feeds.filter((f) => f.ok).length} of ${feeds.length} feeds reachable` : undefined }; } },
  { id: "survival", label: "Survival statistics", path: "survival/index.json", script: "scripts/fetch-survival.ts", workflow: "refresh-hta.yml", cadenceDays: 90, source: "SEER Cancer Stat Facts (NCI)",
    describe: (j) => ({ fetched: str(j.fetched), count: keys(j.sites), note: "SEER sites with survival tables" }) },
  { id: "preprints", label: "Preprints", path: "preprints/index.json", script: "scripts/fetch-preprints.ts", workflow: "refresh-preprints.yml", cadenceDays: 7, source: "Europe PMC preprint records",
    describe: (j) => ({ fetched: str(j.fetched), count: keys(j.entities) ?? len(j.items) }) },
  { id: "factcheck", label: "Registry fact check", path: "factcheck.json", script: "scripts/factcheck.ts", workflow: "factcheck.yml", cadenceDays: 7, source: "openFDA labels, ClinicalTrials.gov",
    describe: (j) => ({ fetched: str(j.generated)?.slice(0, 10), count: len(j.mismatches), note: "mismatches" }) },
  { id: "audit", label: "Corpus audit", path: "audit.json", script: "scripts/audit.ts", workflow: "factcheck.yml", cadenceDays: 7, source: "corpus rules",
    describe: (j) => ({ fetched: str(j.generated)?.slice(0, 10), count: len(j.findings), note: "findings" }) },
  { id: "provenance", label: "Provenance", path: "provenance.json", script: "scripts/provenance.ts", workflow: "factcheck.yml", cadenceDays: 7, source: "git blame",
    describe: (j) => { const dates = Object.values(j).map((v) => (v as { date?: string }).date).filter(Boolean) as string[]; return { fetched: dates.sort().at(-1), count: keys(j), note: "records with a last-edit commit" }; } },
  { id: "proposals", label: "Change proposals", path: "proposals/latest.json", script: "scripts/propose-updates.ts", workflow: "propose.yml", cadenceDays: 1, source: "fact check, trial changes, FDA and EMA feeds",
    describe: (j) => ({ fetched: str(j.generated)?.slice(0, 10), count: len(j.proposals), note: "drafted patches awaiting review" }) },
];

export function readPublicJson<T>(rel: string, root = process.cwd()): T | null {
  const p = join(root, "public", rel);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")) as T; } catch { return null; }
}

export function ageInDays(iso: string | undefined, now: Date): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return undefined;
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
}

export function feedStatus(def: FeedDef, now = new Date(), root = process.cwd()): FeedStatus {
  const json = readPublicJson<Record<string, unknown>>(def.path, root);
  const base = { id: def.id, label: def.label, path: def.path, script: def.script, workflow: def.workflow, source: def.source, cadenceDays: def.cadenceDays };
  if (!json) return { ...base, present: false, stale: true };
  let d: { fetched?: string; fetchedThrough?: string; count?: number; note?: string } = {};
  try { d = def.describe(json); } catch { d = {}; }
  const ageDays = ageInDays(d.fetched, now);
  return { ...base, present: true, fetched: d.fetched, fetchedThrough: d.fetchedThrough, ageDays, count: d.count, note: d.note, stale: ageDays === undefined || ageDays > def.cadenceDays * 2 };
}

export function feedStatuses(now = new Date(), root = process.cwd()): FeedStatus[] {
  return FEEDS.map((f) => feedStatus(f, now, root));
}
