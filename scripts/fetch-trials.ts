/**
 * Pipeline tracker: for every product in the corpus, pull phase 2/3 studies from the
 * ClinicalTrials.gov API v2 and write public/trials/<drugId>.json plus public/trials/index.json.
 *
 * Change detection (improvement #92): before overwriting a product's snapshot, the previous one is diffed
 * study by study. Status changes (for example RECRUITING to COMPLETED), newly posted results, and moved
 * primary completion dates are appended to public/trials/changes.json, which /calendar/ lists as
 * auto-detected "expected" events pending editorial review. Changes older than 90 days are dropped.
 *
 * Run: npm run fetch:trials     (network; resilient: retries, rate limiting, skips failures)
 * Refreshed weekly by .github/workflows/refresh-trials.yml, which opens a PR with the diff.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { graph } from "../src/lib/graph";


export type Study = { nct: string; title: string; status: string; phases: string[]; conditions: string[]; start?: string; primaryCompletion?: string; sponsor?: string; hasResults?: boolean };
export type DrugTrials = { drugId: string; query: string; fetched: string; total: number; studies: Study[] };
type IndexEntry = { query: string; total: number; byPhase: Record<string, number>; byStatus: Record<string, number>; recruiting: number; fetched: string };

export type TrialChangeKind = "status" | "results-posted" | "primary-completion" | "new-study";
export type TrialChange = { detected: string; drugId: string; nct: string; title: string; kind: TrialChangeKind; from?: string; to?: string; phases: string[]; sponsor?: string; primaryCompletion?: string };
export type TrialChanges = { fetched: string; previousFetched?: string; keepDays: number; changes: TrialChange[] };

const KEEP_DAYS = 90;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url: string, attempt = 1): Promise<unknown | null> {
  try {
    const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "OnCo/1.0 (github.com/judegomila/OnCo)" } });
    if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    if (attempt >= 4) { console.warn(`  giving up: ${url} (${String(e)})`); return null; }
    await sleep(1000 * 2 ** attempt);
    return fetchJson(url, attempt + 1);
  }
}

/** Pick the search term: generic name without parenthetical/brand noise; code as fallback. */
function queryFor(name: string, code?: string): string {
  const cleaned = name.replace(/\(.*?\)/g, "").replace(/\/.*$/, "").replace(/ \+ .*$/, "").trim();
  if (cleaned.split(" ").length <= 3 && cleaned.length > 3) return cleaned;
  return code?.split(",")[0].trim() || cleaned;
}

/**
 * Diff two snapshots of the same product. Rules that keep the list honest:
 *  - no previous snapshot, no changes (a first run is a baseline);
 *  - "results posted" only when the previous snapshot recorded hasResults = false (older snapshots lack the field);
 *  - "new study" only when the previous list was complete (under the 100-study page), otherwise a reordered page
 *    would look like a flood of new trials.
 */
export function diffStudies(prev: DrugTrials | null, next: DrugTrials, detected: string): TrialChange[] {
  if (!prev) return [];
  const before = new Map(prev.studies.map((s) => [s.nct, s]));
  const prevComplete = prev.studies.length < 100 && prev.total <= prev.studies.length;
  const changes: TrialChange[] = [];
  for (const s of next.studies) {
    const base = { detected, drugId: next.drugId, nct: s.nct, title: s.title, phases: s.phases, sponsor: s.sponsor, primaryCompletion: s.primaryCompletion };
    const p = before.get(s.nct);
    if (!p) { if (prevComplete) changes.push({ ...base, kind: "new-study", to: s.status }); continue; }
    if (p.status !== s.status) changes.push({ ...base, kind: "status", from: p.status, to: s.status });
    if (p.hasResults === false && s.hasResults) changes.push({ ...base, kind: "results-posted" });
    if (p.primaryCompletion && s.primaryCompletion && p.primaryCompletion !== s.primaryCompletion) changes.push({ ...base, kind: "primary-completion", from: p.primaryCompletion, to: s.primaryCompletion });
  }
  return changes;
}

function readPrev(path: string): DrugTrials | null {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")) as DrugTrials; } catch { return null; }
}

type TrialProduct = { id: string; name: string; code?: string };
type RefreshOptions = { directory: string; only?: string; request?: typeof fetchJson; pause?: typeof sleep };

/** Refresh snapshots and their index together. The injectable request keeps offline checks off the network. */
export async function refreshTrials(products: TrialProduct[], options: RefreshOptions) {
  const out = options.directory;
  const ONLY = options.only;
  const request = options.request ?? fetchJson;
  const pause = options.pause ?? sleep;
  mkdirSync(out, { recursive: true });
  const drugs = products.filter((d) => !ONLY || d.id === ONLY);
  const index: Record<string, IndexEntry> = {};
  const indexPath = join(out, "index.json");
  // Failed requests keep their last successful counts and fetched date, just as their per-product
  // snapshot is kept below. Starting from an empty index made a temporary outage erase coverage.
  if (existsSync(indexPath)) { try { Object.assign(index, JSON.parse(readFileSync(indexPath, "utf8"))); } catch { /* fresh */ } }
  if (!ONLY) {
    const currentIds = new Set(products.map((d) => d.id));
    for (const id of Object.keys(index)) if (!currentIds.has(id)) delete index[id];
  }
  const fetched = new Date().toISOString().slice(0, 10);
  const changesPath = join(out, "changes.json");
  const prevChanges = readPrev(changesPath) as unknown as TrialChanges | null;
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  const changes: TrialChange[] = (prevChanges?.changes ?? []).filter((c) => c.detected >= cutoff);
  let previousFetched: string | undefined = prevChanges?.fetched;
  let ok = 0, skipped = 0, detected = 0;

  for (const d of drugs) {
    const q = queryFor(d.name, d.code);
    const params = new URLSearchParams({
      "query.intr": q,
      "filter.advanced": "AREA[Phase](PHASE2 OR PHASE3)",
      fields: "NCTId,BriefTitle,OverallStatus,Phase,Condition,StartDate,PrimaryCompletionDate,LeadSponsorName,HasResults",
      pageSize: "100",
      countTotal: "true",
    });
    const url = `https://clinicaltrials.gov/api/v2/studies?${params}`;
    const json = (await request(url)) as { totalCount?: number; studies?: Array<{ protocolSection?: Record<string, Record<string, unknown>>; hasResults?: boolean }> } | null;
    await pause(350);
    if (!json) { skipped++; continue; }
    const studies: Study[] = (json.studies ?? []).map((s) => {
      const p = s.protocolSection ?? {};
      const id = p.identificationModule ?? {}, st = p.statusModule ?? {}, des = p.designModule ?? {}, cond = p.conditionsModule ?? {}, sp = p.sponsorCollaboratorsModule ?? {};
      return {
        nct: String(id.nctId ?? ""),
        title: String(id.briefTitle ?? ""),
        status: String(st.overallStatus ?? ""),
        phases: (des.phases as string[] | undefined) ?? [],
        conditions: ((cond.conditions as string[] | undefined) ?? []).slice(0, 5),
        start: (st.startDateStruct as { date?: string } | undefined)?.date,
        primaryCompletion: (st.primaryCompletionDateStruct as { date?: string } | undefined)?.date,
        sponsor: (sp.leadSponsor as { name?: string } | undefined)?.name,
        hasResults: s.hasResults === true,
      };
    });
    const total = json.totalCount ?? studies.length;
    const byPhase: Record<string, number> = {}, byStatus: Record<string, number> = {};
    for (const s of studies) {
      for (const ph of s.phases) byPhase[ph] = (byPhase[ph] ?? 0) + 1;
      byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
    }
    const rec: DrugTrials = { drugId: d.id, query: q, fetched, total, studies };
    const path = join(out, `${d.id}.json`);
    const prev = readPrev(path);
    if (prev && prev.query === q) {
      const diff = diffStudies(prev, rec, fetched);
      changes.push(...diff);
      detected += diff.length;
      if (!previousFetched || prev.fetched > previousFetched) previousFetched = prev.fetched;
    }
    writeFileSync(path, JSON.stringify(rec));
    index[d.id] = { query: q, total, byPhase, byStatus, recruiting: byStatus["RECRUITING"] ?? 0, fetched };
    ok++;
  }
  writeFileSync(indexPath, JSON.stringify(index));
  // Deduplicate (same nct, kind, from, to) keeping the earliest detection; newest first.
  const seen = new Set<string>();
  const merged = changes.sort((a, b) => a.detected.localeCompare(b.detected)).filter((c) => { const k = `${c.nct}|${c.kind}|${c.from ?? ""}|${c.to ?? ""}`; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => b.detected.localeCompare(a.detected) || a.nct.localeCompare(b.nct));
  const changesOut: TrialChanges = { fetched, previousFetched, keepDays: KEEP_DAYS, changes: merged };
  writeFileSync(changesPath, JSON.stringify(changesOut));
  console.log(`trials: ${ok} products written, ${skipped} skipped, ${detected} changes detected (${merged.length} kept), to public/trials/`);
}

if (process.argv[1]?.endsWith("fetch-trials.ts")) {
  refreshTrials(graph().kind("drug"), {
    directory: join(process.cwd(), "public", "trials"),
    only: process.argv.find((a) => a.startsWith("--only="))?.slice(7),
  }).catch((e) => { console.error(e); process.exit(1); });
}
