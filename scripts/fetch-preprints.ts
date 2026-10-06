/**
 * Preprint tracker: bioRxiv, medRxiv and other preprints indexed by Europe PMC for every target, product and
 * technology, over the last 90 days, plus which of them have since appeared as journal articles.
 *
 *   public/preprints/<id>.json   { id, kind, name, query, fetched, windowDays, count, preprints: [...] }
 *   public/preprints/index.json  { fetched, windowDays, source, entities: { id: { kind, name, count, published } }, items: [...] }
 *
 * Preprints: (query) AND FIRST_PDATE in the window AND SRC:PPR, resultType=core.
 * Published versions: (query) AND HAS_PREPRINT:y AND SRC:MED over the last 18 months, resultType=core; each MED record's
 * commentCorrectionList carries {type: "Preprint in", id: "PPR..."} which links it to the preprint id.
 *
 * Run: npm run fetch:preprints   (network; ~2 requests per entity; skips ids fetched in the last 2 days unless --force)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { graph } from "../src/lib/graph";
import { EPMC_REST, paperQuery, type PaperLite } from "../src/lib/europepmc";

/** Europe PMC search URL with resultType=core (needed for commentCorrectionList and publisher). */
function coreUrl(query: string, pageSize: number): string {
  const p = new URLSearchParams({ query, format: "json", resultType: "core", pageSize: String(pageSize), sort: "P_PDATE_D desc" });
  return `${EPMC_REST}?${p.toString()}`;
}

const OUT = join(process.cwd(), "public", "preprints");
mkdirSync(OUT, { recursive: true });
const FORCE = process.argv.includes("--force");
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const KINDS = (process.argv.find((a) => a.startsWith("--kinds="))?.slice(8) ?? "target,drug,technology").split(",");
const WINDOW_DAYS = 90;
const CONCURRENCY = 4;
const UA = "OnCo/1.0 (https://github.com/judegomila/OnCo; preprint tracker)";

export type Preprint = { id: string; doi?: string; title: string; authors?: string; publisher?: string; date?: string; published?: { doi?: string; pmid?: string; journal?: string; date?: string; title?: string } };
export type PublishedVersion = { pprId: string; doi?: string; pmid?: string; journal?: string; date?: string; title: string; authors?: string };
export type PreprintSnapshot = { id: string; kind: string; name: string; query: string; fetched: string; windowDays: number; count: number; preprints: Preprint[]; nowPublished: PublishedVersion[] };
export type PreprintIndex = { fetched: string; windowDays: number; source: string; entities: Record<string, { kind: string; name: string; count: number; published: number }>; items: Array<Preprint & { entityIds: string[] }>; published: Array<PublishedVersion & { entityIds: string[] }> };

type CoreResult = PaperLite & { commentCorrectionList?: { commentCorrection?: Array<{ id: string; source: string; type: string }> }; bookOrReportDetails?: { publisher?: string } };
type CoreResponse = { hitCount?: unknown; resultList?: { result?: unknown } };

/** A successful HTTP response can still lack the search payload; that is not an empty result. */
function coreResults(response: CoreResponse): CoreResult[] {
  const results = response?.resultList?.result;
  if (!Array.isArray(results)) throw new Error("Incomplete Europe PMC response: missing resultList.result array");
  return results as CoreResult[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isoDaysAgo = (d: number) => { const x = new Date(); x.setUTCDate(x.getUTCDate() - d); return x.toISOString().slice(0, 10); };

async function getJson<T>(url: string, tries = 4): Promise<T> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
      if (r.status === 429 || r.status >= 500) { await sleep(1500 * (i + 1)); continue; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()) as T;
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(1000 * (i + 1));
    }
  }
  throw new Error("unreachable");
}

async function snapshot(id: string, kind: string, name: string, query: string): Promise<PreprintSnapshot> {
  const today = isoDaysAgo(0), from = isoDaysAgo(WINDOW_DAYS), pubFrom = isoDaysAgo(548);
  const pp = await getJson<CoreResponse>(coreUrl(`((${query}) AND FIRST_PDATE:[${from} TO ${today}]) AND SRC:PPR`, 50));
  const count = pp?.hitCount;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0) throw new Error("Incomplete Europe PMC response: invalid preprint hitCount");
  const preprintResults = coreResults(pp);
  await sleep(80);
  const pubUrl = coreUrl(`(${query}) AND HAS_PREPRINT:y AND SRC:MED AND FIRST_PDATE:[${pubFrom} TO ${today}]`, 50);
  const pub = await getJson<CoreResponse>(pubUrl);
  const publishedByPpr = new Map<string, Preprint["published"]>();
  const nowPublished: PublishedVersion[] = [];
  for (const r of coreResults(pub)) {
    for (const c of r.commentCorrectionList?.commentCorrection ?? []) if (c.source === "PPR" && /preprint/i.test(c.type)) {
      publishedByPpr.set(c.id, { doi: r.doi, pmid: r.pmid, journal: r.journalTitle, date: r.firstPublicationDate, title: r.title });
      nowPublished.push({ pprId: c.id, doi: r.doi, pmid: r.pmid, journal: r.journalTitle, date: r.firstPublicationDate, title: r.title, authors: r.authorString });
    }
  }
  const preprints: Preprint[] = preprintResults.map((p) => ({ id: p.id, doi: p.doi, title: p.title, authors: p.authorString, publisher: p.bookOrReportDetails?.publisher, date: p.firstPublicationDate, published: publishedByPpr.get(p.id) }));
  // `nowPublished` covers preprints of any age (up to 18 months) whose journal version appeared; most are older than the window.
  return { id, kind, name, query, fetched: today, windowDays: WINDOW_DAYS, count, preprints, nowPublished };
}

function writeIndex(snaps: Map<string, PreprintSnapshot>) {
  const entities: PreprintIndex["entities"] = {};
  const items = new Map<string, Preprint & { entityIds: string[] }>();
  const pubs = new Map<string, PublishedVersion & { entityIds: string[] }>();
  for (const s of snaps.values()) {
    entities[s.id] = { kind: s.kind, name: s.name, count: s.count, published: (s.nowPublished ?? []).length };
    for (const p of s.nowPublished ?? []) {
      const cur = pubs.get(p.pprId);
      if (cur) { if (!cur.entityIds.includes(s.id)) cur.entityIds.push(s.id); } else pubs.set(p.pprId, { ...p, entityIds: [s.id] });
    }
    for (const p of s.preprints) {
      const cur = items.get(p.id);
      if (cur) { if (!cur.entityIds.includes(s.id)) cur.entityIds.push(s.id); if (!cur.published && p.published) cur.published = p.published; }
      else items.set(p.id, { ...p, entityIds: [s.id] });
    }
  }
  const list = [...items.values()].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const published = [...pubs.values()].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const index: PreprintIndex = { fetched: isoDaysAgo(0), windowDays: WINDOW_DAYS, source: "Europe PMC REST API (SRC:PPR; HAS_PREPRINT for published versions)", entities, items: list, published };
  writeFileSync(join(OUT, "index.json"), JSON.stringify(index));
  return index;
}

async function main() {
  const g = graph();
  const ents = g.entities.filter((e) => KINDS.includes(e.kind) && (!ONLY || e.id === ONLY));
  const jobs = ents.map((e) => ({ e, query: paperQuery(e as never) })).filter((j): j is { e: (typeof ents)[number]; query: string } => !!j.query);
  console.log(`preprints: ${jobs.length} entities with queries (of ${ents.length}); window ${WINDOW_DAYS} days`);

  const snaps = new Map<string, PreprintSnapshot>();
  // Keep snapshots of entities not in this run (e.g. --only) so the index stays complete.
  if (existsSync(join(OUT, "index.json"))) {
    for (const j of g.entities) {
      const p = join(OUT, `${j.id}.json`);
      if (existsSync(p)) { try { snaps.set(j.id, JSON.parse(readFileSync(p, "utf8")) as PreprintSnapshot); } catch { /* ignore */ } }
    }
  }

  let done = 0, skipped = 0, failed = 0;
  const queue = [...jobs];
  const worker = async () => {
    for (;;) {
      const job = queue.shift();
      if (!job) return;
      const path = join(OUT, `${job.e.id}.json`);
      const prev = snaps.get(job.e.id);
      if (!FORCE && prev && prev.query === job.query && Date.now() - new Date(prev.fetched).getTime() < 2 * 86400000) { skipped++; continue; }
      try {
        const snap = await snapshot(job.e.id, job.e.kind, job.e.name, job.query);
        writeFileSync(path, JSON.stringify(snap));
        snaps.set(job.e.id, snap);
        done++;
        if (done % 50 === 0) { console.log(`  ${done} fetched, ${skipped} cached, ${failed} failed, ${queue.length} left`); writeIndex(snaps); }
      } catch (e) {
        failed++; console.warn(`  failed ${job.e.id}: ${(e as Error).message}`);
      }
      await sleep(120);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const index = writeIndex(snaps);
  console.log(`preprints: ${done} fetched, ${skipped} cached, ${failed} failed → public/preprints/index.json (${Object.keys(index.entities).length} entities, ${index.items.length} preprints, ${index.published.length} preprints since published)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
