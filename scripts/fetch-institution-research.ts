/**
 * Oncology research output per institution (and per cooperative trials group, a company record since 25 September 2026) from OpenAlex (CC0), five publication years.
 *
 * For every institution record: resolve an OpenAlex institution id (the id already recorded in
 * public/openalex/institutions.json first; otherwise the free ROR affiliation matcher picks the ROR
 * record for the name, checked against the record's country, and one OpenAlex lookup turns the ROR id
 * into an OpenAlex id; a plain OpenAlex name search is only tried with --search because it costs ten
 * times as much), then pull works whose primary topic subfield is Oncology (2730) with
 * authorships.institutions.lineage so that a university's hospitals count: works and citations per
 * year, open-access, clinical-trial and review counts, the 15 most-cited works, and the 10 authors with
 * the most works.
 *
 * Writes public/openalex/research/<institutionId>.json (about 6 KB each) and rebuilds the counts-only
 * public/openalex/research-index.json from every file on disk. Every number comes from the API response.
 *
 * Budget. OpenAlex meters requests: the free tier is 1,000 credits a day (a works query costs 1, an
 * institution lookup by ROR 1, a name search 10), resetting at midnight UTC. One institution costs about
 * 7 credits, so a run covers roughly 140 institutions and the corpus takes four daily runs. The script
 * processes institutions without a file first, then the oldest snapshots, and stops cleanly when the
 * budget is spent, keeping everything already written. Set OPENALEX_API_KEY for a paid budget.
 *
 *   npm run fetch:research                 refresh what the budget allows (per-URL cache in /tmp keeps re-runs cheap)
 *   npm run fetch:research -- --force      ignore the /tmp cache
 *   npm run fetch:research -- --only=id    one institution
 *   npm run fetch:research -- --limit=N    at most N institutions this run
 *   npm run fetch:research -- --budget=N   stop after spending N credits (default 900)
 *   npm run fetch:research -- --search     allow OpenAlex name search (10 credits each) when ROR finds nothing
 *   npm run fetch:research -- --retry-unresolved  retry institutions marked unresolved in the last 30 days
 *   npm run fetch:research -- --people     also add resolvable DOIs to matched people with fewer than 3 papers
 *   npm run fetch:research -- --ror-only   only run the free ROR matcher for institutions without a snapshot and report; spends nothing
 *
 * Polite pool: mailto on every request, about 5 requests per second.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { graph } from "../src/lib/graph";
import type { Company, Institution, Person } from "../src/lib/schema";
import { publicPath, sleep, today, writeJson } from "./feed-utils";
import { acronymMatches, bareDoi, CLINICAL_TRIAL_CONCEPT, institutionCoreTokens, matchAuthorToPerson, nameSimilarity, ONCOLOGY_SUBFIELD, researchWindow, type InstitutionResearch, type MatchConfidence, type ResearchAuthor, type ResearchIndex, type ResearchIndexRow, type ResearchWork } from "../src/lib/research";

/** What the matcher needs of a record: institutions, and cooperative trials groups, which are company records since 25 September 2026. */
type Subject = Pick<Institution, "id" | "name" | "aka" | "country">;

const MAILTO = "onco@judegomila.com";
const API = "https://api.openalex.org";
const CACHE_DIR = "/tmp/onco-openalex-research";
const MIN_INTERVAL_MS = 200; // about 5 requests per second
const TOP_WORKS = 15;
const TOP_AUTHORS = 10;
const MAX_PAPERS_PER_PERSON = 3;

/** OpenAlex ids fixed by hand where neither institutions.json nor ROR settles the match (same ids as fetch-openalex.ts). */
const OVERRIDE_IDS: Record<string, string> = {
  "ncc-japan": "I4210145079", // NCC Hospital East (Kashiwa); OpenAlex has no record for the Tokyo hospital
  "einstein-sao-paulo": "I2800288331",
};

/** Societies, funders and regulators that publish little themselves; skipped, as in fetch-openalex.ts. */
// Skipped: charities, societies and consortia with no research output of their own, plus CRUK centres and satellite campuses that ROR resolves to the parent organisation, whose output is not theirs.
const SKIP = new Set(["herlev-hospital", "rigshospitalet", "mayo-clinic-arizona", "mayo-clinic-florida", "ncc-hospital-east", "nio-gliwice", "nio-warsaw", "north-central-london-cancer-alliance", "north-east-london-cancer-alliance", "renji-hospital", "ruijin-hospital", "aphp-paris-saclay-cancer-institute", "iba-masaryk", "jinshazhou-hospital", "mays-cancer-center", "mcgill-goodman", "minnesota-masonic", "nci-cairo", "northwell-cancer-institute", "nyu-perlmutter", "osu-james", "prince-of-wales-hospital-cuhk", "ramathibodi-hospital", "santaros-klinikos", "shaare-zedek", "sgo", "aecc", "lustgarten-foundation", "macmillan-cancer-support", "marie-curie-uk", "mark-foundation", "mascc", "movember", "mra", "nccn-org", "nice", "nmpa-cde", "oeci", "pan-mass-challenge", "pcf", "pmda", "ontario-health-cancer-care-ontario", "nova-scotia-cancer-care", "institut-strauss", "institute-of-mother-and-child", "kwf", "lasker-foundation", "leicester-cancer-research-centre", "li-ka-shing-foundation", "ligue-contre-le-cancer", "asco", "esmo", "aacr", "iarc", "cruk", "curie-nki-eortc", "bowelbabe-fund", "cruk-cambridge-centre", "cruk-city-of-london-centre", "cruk-convergence-science-centre", "city-of-hope-orange-county", "dokuz-eylul-institute-of-oncology", "emory-winship", "galway-university-hospital-cancer-centre", "gunma-heavy-ion-medical-center", "hacettepe-cancer-institute", "hawaii-cancer-center", "huntsman", "intermountain-cancer", "iowa-holden", "istanbul-oncology-institute", "iuc-aphp-sorbonne", "kauno-klinikos", "kentucky-markey", "klaipeda-university-hospital", "essen-wtz", "imperial-cancer-centre", "eha", "espen", "esso", "gates-foundation", "emerson-collective", "fondation-arc", "g-ba-iqwig", "health-canada", "ema", "histiocyte-society", "iaslc", "isoqol", "irish-cancer-society", "jsmo"]);
const ALLOWED_TYPES = new Set(["education", "healthcare", "facility", "government", "nonprofit", "other"]);

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const ONLY = args.find((a) => a.startsWith("--only="))?.slice(7);
const LIMIT = Number(args.find((a) => a.startsWith("--limit="))?.slice(8) ?? Infinity);
const BUDGET = Number(args.find((a) => a.startsWith("--budget="))?.slice(9) ?? 900);
const SEARCH = args.includes("--search");
const RETRY_UNRESOLVED = args.includes("--retry-unresolved");
const PEOPLE = args.includes("--people");
const ROR_ONLY = args.includes("--ror-only");
const API_KEY = process.env.OPENALEX_API_KEY;
const UNRESOLVED_RETRY_DAYS = 30;

type Json = Record<string, unknown>;

/** Thrown when OpenAlex reports the daily budget spent (or the run's own cap is reached); the run then writes what it has. */
class BudgetExhausted extends Error {}

const budget = { spent: 0, remaining: null as number | null };

let lastRequest = 0;
/** GET from OpenAlex through the /tmp cache, spacing requests and tracking the credit budget. */
async function get(url: string): Promise<Json | null> {
  const full = `${url}${url.includes("?") ? "&" : "?"}mailto=${MAILTO}${API_KEY ? `&api_key=${API_KEY}` : ""}`;
  const key = join(CACHE_DIR, `${createHash("sha1").update(full.replace(/&api_key=[^&]*/, "")).digest("hex")}.json`);
  if (!FORCE && existsSync(key)) return JSON.parse(readFileSync(key, "utf8")) as Json;
  if (budget.spent >= BUDGET) throw new BudgetExhausted(`run cap of ${BUDGET} credits reached`);
  for (let attempt = 0; attempt < 6; attempt++) {
    const wait = lastRequest + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();
    let r: Response;
    try { r = await fetch(full, { headers: { "User-Agent": `OnCo/1.0 (mailto:${MAILTO})`, Accept: "application/json" }, signal: AbortSignal.timeout(30_000) }); }
    catch { await sleep(1500 * 2 ** attempt); continue; }
    const remaining = Number(r.headers.get("x-ratelimit-remaining"));
    if (Number.isFinite(remaining) && r.headers.has("x-ratelimit-remaining")) budget.remaining = remaining;
    if (r.ok) {
      budget.spent += Number(r.headers.get("x-ratelimit-credits-used") ?? r.headers.get("x-ratelimit-credits-required") ?? 1) || 1;
      const j = (await r.json()) as Json;
      mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(key, JSON.stringify(j));
      return j;
    }
    if (r.status === 429) {
      const retryAfter = Number(r.headers.get("retry-after") ?? 0);
      if (retryAfter > 300 || budget.remaining === 0) throw new BudgetExhausted(`OpenAlex daily budget spent; resets in ${Math.round(retryAfter / 60)} min`);
      await sleep(Math.max(1500 * 2 ** attempt, retryAfter * 1000));
      continue;
    }
    if (r.status >= 500) { await sleep(1500 * 2 ** attempt); continue; }
    return null;
  }
  return null;
}

/** GET from the ROR API (free, no budget) through the same /tmp cache. */
async function getRor(url: string): Promise<Json | null> {
  const key = join(CACHE_DIR, `${createHash("sha1").update(url).digest("hex")}.json`);
  if (!FORCE && existsSync(key)) return JSON.parse(readFileSync(key, "utf8")) as Json;
  for (let attempt = 0; attempt < 5; attempt++) {
    const wait = lastRequest + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();
    let r: Response;
    try { r = await fetch(url, { headers: { "User-Agent": `OnCo/1.0 (mailto:${MAILTO})`, Accept: "application/json" }, signal: AbortSignal.timeout(30_000) }); }
    catch { await sleep(1500 * 2 ** attempt); continue; }
    if (r.ok) { const j = (await r.json()) as Json; mkdirSync(CACHE_DIR, { recursive: true }); writeFileSync(key, JSON.stringify(j)); return j; }
    if (r.status === 429 || r.status >= 500) { await sleep(1500 * 2 ** attempt); continue; }
    return null;
  }
  return null;
}

const short = (id: string) => id.replace(/^https:\/\/openalex\.org\//, "");

type Candidate = { id: string; display_name: string; country_code?: string; type: string; works_count: number; ror?: string | null };
type Resolved = { oid: string; oname: string; ror: string | null; confidence: MatchConfidence };

/** Names to try in order: the main name before any " / ", then each alias. */
function searchNames(inst: Subject): string[] {
  const main = inst.name.split(" / ")[0].replace(/\(.*?\)/g, "").trim();
  const rest = inst.name.split(" / ").slice(1).map((s) => s.replace(/\(.*?\)/g, "").trim());
  return [...new Set([main, ...(inst.aka ?? []), ...rest].filter((s) => s && /[a-z]/i.test(s)))];
}

type RorItem = { chosen: boolean; score: number; organization: { id: string; names: Array<{ value: string; types: string[] }>; locations: Array<{ geonames_details?: { country_code?: string } }>; types: string[] } };
const ROR_TYPES = new Set(["healthcare", "education", "facility", "government", "nonprofit", "other", "funder"]);

/** ROR's affiliation matcher: the chosen organisation for a name string, when it is confident and in the right country. */
async function rorFor(inst: Subject): Promise<{ ror: string; name: string } | { reason: string }> {
  let reason = "ROR affiliation matcher found nothing";
  for (const q of searchNames(inst)) {
    const j = await getRor(`https://api.ror.org/v2/organizations?affiliation=${encodeURIComponent(q)}`);
    const items = (j?.items as RorItem[] | undefined) ?? [];
    const chosen = items.find((i) => i.chosen) ?? items.find((i) => i.score >= 0.95);
    if (!chosen) continue;
    const name = chosen.organization.names.find((n) => n.types.includes("ror_display"))?.value ?? chosen.organization.names[0]?.value ?? "";
    const country = chosen.organization.locations[0]?.geonames_details?.country_code;
    if (country && country !== inst.country) { reason = `ROR chose "${name}" in ${country}, record says ${inst.country}`; continue; }
    if (!chosen.organization.types.some((t) => ROR_TYPES.has(t))) { reason = `ROR chose "${name}" of type ${chosen.organization.types.join("/")}`; continue; }
    if (chosen.score < 0.9) { reason = `ROR best "${name}" scored ${chosen.score.toFixed(2)}`; continue; }
    return { ror: chosen.organization.id, name };
  }
  return { reason };
}

async function resolve(inst: Subject, previous: Record<string, { openalexId: string; openalexName: string }>): Promise<Resolved | { reason: string }> {
  const prev = previous[inst.id];
  if (prev) return { oid: prev.openalexId, oname: prev.openalexName, ror: null, confidence: "override" };
  if (OVERRIDE_IDS[inst.id]) {
    const j = await get(`${API}/institutions/${OVERRIDE_IDS[inst.id]}?select=id,display_name,ror`);
    if (j && typeof j.display_name === "string") return { oid: OVERRIDE_IDS[inst.id], oname: j.display_name, ror: (j.ror as string | null) ?? null, confidence: "override" };
  }
  const declared = (inst as unknown as { ror?: string }).ror;
  const viaRor = declared ? { ror: declared, name: inst.name } : await rorFor(inst);
  if ("ror" in viaRor) {
    const j = await get(`${API}/institutions?filter=ror:${encodeURIComponent(viaRor.ror)}&select=id,display_name,ror,works_count&per_page=1`);
    const hit = ((j?.results as Candidate[] | undefined) ?? [])[0];
    if (hit) return { oid: short(hit.id), oname: hit.display_name, ror: hit.ror ?? viaRor.ror, confidence: "ror" };
    if (!SEARCH) return { reason: `ROR ${viaRor.ror} (${viaRor.name}) has no OpenAlex institution` };
  }
  if (!SEARCH) return { reason: "reason" in viaRor ? viaRor.reason : "no OpenAlex institution for the ROR id" };
  let bestReason = "no search result";
  // Each name, then its distinguishing words alone ("Wake Forest" for "Wake Forest Baptist Comprehensive Cancer Center").
  const queries = [...new Set(searchNames(inst).flatMap((q) => { const core = institutionCoreTokens(q).join(" "); return core && core !== q.toLowerCase() && core.length >= 4 ? [q, core] : [q]; }))];
  for (const q of queries) {
    const j = await get(`${API}/institutions?search=${encodeURIComponent(q)}&filter=country_code:${inst.country}&per_page=5&select=id,display_name,country_code,type,works_count,ror`);
    const results = ((j?.results as Candidate[] | undefined) ?? []).filter((r) => ALLOWED_TYPES.has(r.type) && r.works_count >= 200);
    if (!results.length) continue;
    const acronym = results.find((r) => acronymMatches(q, r.display_name));
    if (acronym) return { oid: short(acronym.id), oname: acronym.display_name, ror: acronym.ror ?? null, confidence: "high" };
    const scored = results.map((r) => ({ r, sim: nameSimilarity(q, r.display_name) })).sort((a, b) => b.sim - a.sim || b.r.works_count - a.r.works_count);
    const top = scored[0], second = scored[1];
    if (top.sim >= 0.6) return { oid: short(top.r.id), oname: top.r.display_name, ror: top.r.ror ?? null, confidence: "high" };
    if (top.sim >= 0.34 && (!second || top.r.works_count >= 3 * second.r.works_count || top.sim >= second.sim + 0.25)) return { oid: short(top.r.id), oname: top.r.display_name, ror: top.r.ror ?? null, confidence: "medium" };
    bestReason = `ambiguous: "${q}" best "${top.r.display_name}" (${top.sim.toFixed(2)})${second ? ` vs "${second.r.display_name}" (${second.sim.toFixed(2)})` : ""}`;
  }
  return { reason: bestReason };
}

type Group = { key: string; key_display_name: string; count: number };
const groups = (j: Json | null) => ((j?.group_by as Group[] | undefined) ?? []);
const metaCount = (j: Json | null) => ((j?.meta as { count?: number } | undefined)?.count ?? 0);

type RawWork = {
  id: string; doi: string | null; title: string | null; publication_year: number; cited_by_count: number; type: string;
  open_access?: { is_oa?: boolean; oa_url?: string | null };
  primary_location?: { source?: { display_name?: string } | null } | null;
};

async function pull(inst: Subject, r: Resolved, years: [number, number]): Promise<InstitutionResearch | null> {
  const base = `authorships.institutions.lineage:${r.oid},primary_topic.subfield.id:${ONCOLOGY_SUBFIELD},publication_year:${years[0]}-${years[1]}`;
  const works = `${API}/works?filter=${base}`;
  // Sequential on purpose: the rate limiter in get() spaces requests about 200 ms apart.
  const byYearJ = await get(`${works}&group_by=publication_year`);
  const byTypeJ = await get(`${works}&group_by=type`);
  const oaJ = await get(`${works}&group_by=open_access.is_oa`);
  const authorsJ = await get(`${works}&group_by=authorships.author.id`);
  const trialsJ = await get(`${works},concepts.id:${CLINICAL_TRIAL_CONCEPT}&per_page=1&select=id`);
  const topJ = await get(`${works}&sort=cited_by_count:desc&per_page=${TOP_WORKS}&cited_by_count_sum=true&select=id,doi,title,publication_year,cited_by_count,type,open_access,primary_location`);
  if (!byYearJ || !byTypeJ || !oaJ || !authorsJ || !trialsJ || !topJ) return null;
  const byYear: Record<string, number> = {};
  for (let y = years[0]; y <= years[1]; y++) byYear[String(y)] = 0;
  for (const g of groups(byYearJ)) if (g.key in byYear) byYear[g.key] = g.count;
  const meta = (topJ.meta as { count?: number; cited_by_count_sum?: number } | undefined) ?? {};
  const total = meta.count ?? Object.values(byYear).reduce((a, b) => a + b, 0);
  const reviews = groups(byTypeJ).find((g) => g.key_display_name === "review")?.count ?? 0;
  const openAccess = groups(oaJ).find((g) => g.key_display_name === "true")?.count ?? 0;
  const topWorks: ResearchWork[] = ((topJ.results as RawWork[] | undefined) ?? []).filter((w) => w.title).map((w) => ({
    id: short(w.id),
    title: w.title!.replace(/\s+/g, " ").trim(),
    doi: w.doi ? `https://doi.org/${bareDoi(w.doi)}` : null,
    year: w.publication_year,
    journal: w.primary_location?.source?.display_name ?? null,
    cited: w.cited_by_count,
    type: w.type,
    oaUrl: w.open_access?.is_oa && w.open_access.oa_url ? w.open_access.oa_url : null,
  }));
  const topAuthors: ResearchAuthor[] = groups(authorsJ).slice(0, TOP_AUTHORS).map((g) => ({ id: short(g.key), name: g.key_display_name, works: g.count }));
  return {
    institutionId: inst.id, openalexId: r.oid, openalexName: r.oname, ror: r.ror, confidence: r.confidence, fetched: today(), years,
    works: total, cited: meta.cited_by_count_sum ?? 0, byYear, openAccess, clinicalTrials: trialsJ ? metaCount(trialsJ) : 0, reviews, topWorks, topAuthors,
  };
}

/** HEAD against doi.org; a DOI "resolves" when the registry answers with a redirect or a page. */
async function doiResolves(doi: string): Promise<boolean> {
  try {
    const r = await fetch(`https://doi.org/${bareDoi(doi)}`, { method: "HEAD", redirect: "manual", headers: { "User-Agent": `OnCo/1.0 (mailto:${MAILTO})` }, signal: AbortSignal.timeout(20_000) });
    return r.status >= 200 && r.status < 400;
  } catch { return false; }
}

type Addition = { personId: string; file: string; paper: { title: string; journal?: string; year: number; doi: string; url: string } };

/** For matched top authors with fewer than 3 papers, fetch their most-cited oncology works at this institution. */
async function peopleAdditions(res: InstitutionResearch, people: Person[], fileOf: Map<string, string>, planned: Map<string, number>): Promise<Addition[]> {
  const out: Addition[] = [];
  for (const a of res.topAuthors) {
    const person = matchAuthorToPerson({ name: a.name }, res.institutionId, people);
    if (!person) continue;
    const have = person.papers.length + (planned.get(person.id) ?? 0);
    if (have >= MAX_PAPERS_PER_PERSON) continue;
    const file = fileOf.get(person.id);
    if (!file) continue;
    const j = await get(`${API}/works?filter=authorships.author.id:${a.id},authorships.institutions.lineage:${res.openalexId},primary_topic.subfield.id:${ONCOLOGY_SUBFIELD},publication_year:${res.years[0]}-${res.years[1]},type:article&sort=cited_by_count:desc&per_page=6&select=id,doi,title,publication_year,cited_by_count,type,primary_location`);
    const known = new Set(person.papers.map((p) => (p.doi ? bareDoi(p.doi).toLowerCase() : p.title.toLowerCase())));
    let room = MAX_PAPERS_PER_PERSON - have;
    for (const w of (j?.results as RawWork[] | undefined) ?? []) {
      if (room <= 0) break;
      if (!w.doi || !w.title) continue;
      const doi = bareDoi(w.doi);
      if (known.has(doi.toLowerCase()) || known.has(w.title.toLowerCase())) continue;
      // House style forbids em and en dashes in rendered text; keep titles that need none.
      const title = w.title.replace(/\s+/g, " ").trim();
      if (/[–—]/.test(title) || title.length > 220) continue;
      if (!(await doiResolves(doi))) continue;
      out.push({ personId: person.id, file, paper: { title, journal: w.primary_location?.source?.display_name ?? undefined, year: w.publication_year, doi, url: `https://doi.org/${doi}` } });
      known.add(doi.toLowerCase());
      room--;
      planned.set(person.id, (planned.get(person.id) ?? 0) + 1);
    }
  }
  return out;
}

/** Where each person id is declared, so paper additions land in the right source file. */
function personFiles(): Map<string, string> {
  const dir = join(process.cwd(), "src", "data", "people");
  const map = new Map<string, string>();
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
    const src = readFileSync(join(dir, f), "utf8");
    for (const m of src.matchAll(/\bid: "([a-z0-9-]+)"/g)) map.set(m[1], join(dir, f));
  }
  return map;
}

const lit = (s: string) => JSON.stringify(s);

/** Insert paper literals into the `papers: [...]` array of the named person in its source file. */
function applyAdditions(additions: Addition[]): number {
  const byFile = new Map<string, Addition[]>();
  for (const a of additions) byFile.set(a.file, [...(byFile.get(a.file) ?? []), a]);
  let applied = 0;
  for (const [file, list] of byFile) {
    let src = readFileSync(file, "utf8");
    for (const a of list) {
      const idAt = src.indexOf(`id: ${lit(a.personId)}`);
      if (idAt < 0) continue;
      const nextRecord = src.indexOf("\n  p({", idAt + 1);
      const end = nextRecord < 0 ? src.length : nextRecord;
      const papersAt = src.indexOf("papers: [", idAt);
      if (papersAt < 0 || papersAt > end) continue;
      const open = papersAt + "papers: [".length;
      const close = matchBracket(src, open - 1);
      if (close < 0) continue;
      const inner = src.slice(open, close);
      const item = `{ title: ${lit(a.paper.title)}${a.paper.journal ? `, journal: ${lit(a.paper.journal)}` : ""}, year: ${a.paper.year}, doi: ${lit(a.paper.doi)}, url: ${lit(a.paper.url)} }`;
      const newInner = inner.trim() ? `${inner.replace(/\s*$/, "")}, ${item}` : item;
      src = src.slice(0, open) + newInner + src.slice(close);
      applied++;
    }
    writeFileSync(file, src);
  }
  return applied;
}

function matchBracket(src: string, openAt: number): number {
  let depth = 0, inStr: string | null = null;
  for (let i = openAt; i < src.length; i++) {
    const c = src[i];
    if (inStr) { if (c === "\\") i++; else if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if (c === "[") depth++;
    else if (c === "]") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

const readResearchFile = (path: string): InstitutionResearch | null => { try { return JSON.parse(readFileSync(path, "utf8")) as InstitutionResearch; } catch { return null; } };

const toIndexRow = (res: InstitutionResearch): ResearchIndexRow => ({ openalexId: res.openalexId, openalexName: res.openalexName, confidence: res.confidence, works: res.works, cited: res.cited, byYear: res.byYear, openAccess: res.openAccess, clinicalTrials: res.clinicalTrials, reviews: res.reviews });

async function main() {
  const g = graph();
  const years = researchWindow();
  const dir = publicPath("openalex", "research");
  mkdirSync(dir, { recursive: true });
  const indexFile = publicPath("openalex", "research-index.json");
  const prevIndex: ResearchIndex | null = existsSync(indexFile) ? (JSON.parse(readFileSync(indexFile, "utf8")) as ResearchIndex) : null;
  const prevFile = publicPath("openalex", "institutions.json");
  const previous: Record<string, { openalexId: string; openalexName: string }> = existsSync(prevFile) ? JSON.parse(readFileSync(prevFile, "utf8")).institutions : {};
  const people = g.kind("person") as Person[];
  const fileOf = PEOPLE ? personFiles() : new Map<string, string>();
  const planned = new Map<string, number>();
  const additions: Addition[] = [];
  // Cooperative trials groups (company records of type cooperative-group) keep their research snapshot under their id.
  const groups = (g.kind("company") as Company[]).filter((c) => c.companyType === "cooperative-group");
  const institutions = ([...(g.kind("institution") as Institution[]), ...groups] as Subject[]).filter((i) => !SKIP.has(i.id));
  const known = new Set(institutions.map((i) => i.id));

  // Unresolved verdicts carry over ("reason (checked YYYY-MM-DD)") and are retried after 30 days.
  const unresolved: Record<string, string> = {};
  const recentlyUnresolved = new Set<string>();
  const cutoff = new Date(Date.now() - UNRESOLVED_RETRY_DAYS * 86_400_000).toISOString().slice(0, 10);
  for (const [id, reason] of Object.entries(prevIndex?.unresolved ?? {})) {
    if (!known.has(id)) continue;
    const checked = /\(checked (\d{4}-\d{2}-\d{2})\)$/.exec(reason)?.[1];
    unresolved[id] = reason;
    if (checked && checked > cutoff && !RETRY_UNRESOLVED) recentlyUnresolved.add(id);
  }
  // Existing snapshots: keep them, and refresh the oldest first once every institution has one.
  const onDisk = new Map<string, InstitutionResearch>();
  for (const f of readdirSync(dir)) {
    const id = f.replace(/\.json$/, "");
    if (!f.endsWith(".json")) continue;
    if (!known.has(id)) { unlinkSync(join(dir, f)); continue; }
    const r = readResearchFile(join(dir, f));
    if (r) onDisk.set(id, r); else unlinkSync(join(dir, f));
  }
  const queue = institutions
    .filter((i) => (!ONLY || i.id === ONLY) && (ONLY || !recentlyUnresolved.has(i.id)))
    // Order: no snapshot yet (the curated institutions.json set first, since they need no lookup), then oldest snapshot first.
    .sort((a, b) => (onDisk.get(a.id)?.fetched ?? "").localeCompare(onDisk.get(b.id)?.fetched ?? "") || Number(!previous[a.id]) - Number(!previous[b.id]) || a.id.localeCompare(b.id))
    .slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined);

  if (ROR_ONLY) {
    let hits = 0;
    for (const inst of queue) {
      if (onDisk.has(inst.id) || previous[inst.id]) continue;
      const r = await rorFor(inst);
      if ("ror" in r) { hits++; console.log(`${inst.id.padEnd(30)} ${r.ror.padEnd(28)} ${r.name}`); }
      else console.log(`${inst.id.padEnd(30)} no ROR: ${r.reason}`);
    }
    console.log(`ror: ${hits} matched`);
    return;
  }

  let written = 0, stopped: string | null = null;
  try {
    for (const inst of queue) {
      const r = await resolve(inst, previous);
      if ("reason" in r) { unresolved[inst.id] = `${r.reason} (checked ${today()})`; console.log(`${inst.id.padEnd(30)} unresolved: ${r.reason}`); continue; }
      const res = await pull(inst, r, years);
      if (!res) { unresolved[inst.id] = `works query failed (checked ${today()})`; console.log(`${inst.id.padEnd(30)} works query failed`); continue; }
      writeJson(join(dir, `${inst.id}.json`), res);
      onDisk.set(inst.id, res);
      delete unresolved[inst.id];
      written++;
      console.log(`${inst.id.padEnd(30)} ${res.openalexId.padEnd(12)} ${res.openalexName.slice(0, 38).padEnd(38)} works=${String(res.works).padStart(6)} cited=${String(res.cited).padStart(8)} [${res.confidence}]${budget.remaining !== null ? ` credits left ${budget.remaining}` : ""}`);
      if (PEOPLE && res.works > 0) additions.push(...(await peopleAdditions(res, people, fileOf, planned)));
    }
  } catch (e) {
    if (!(e instanceof BudgetExhausted)) throw e;
    stopped = e.message;
  }

  const index: ResearchIndex = { fetched: today(), source: "https://openalex.org", license: "CC0", subfield: ONCOLOGY_SUBFIELD, years, institutions: {}, unresolved: {} };
  const seenOpenalex = new Map<string, string>();
  for (const id of [...onDisk.keys()].sort()) {
    const res = onDisk.get(id)!;
    index.institutions[id] = toIndexRow(res);
    const dupe = seenOpenalex.get(res.openalexId);
    if (dupe) console.log(`  note: ${id} shares OpenAlex id ${res.openalexId} with ${dupe}`);
    seenOpenalex.set(res.openalexId, id);
  }
  for (const id of Object.keys(unresolved).sort()) if (!index.institutions[id]) index.unresolved[id] = unresolved[id];
  writeJson(indexFile, index);
  const sizes = [...onDisk.keys()].map((id) => readFileSync(join(dir, `${id}.json`)).length);
  const avg = sizes.length ? Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length / 1024) : 0;
  const pending = institutions.length - onDisk.size - Object.keys(index.unresolved).length;
  console.log(`research: ${onDisk.size} institutions with a snapshot (${written} written this run, about ${avg} KB each), ${Object.keys(index.unresolved).length} unresolved, ${pending} not yet attempted; ${budget.spent} credits spent${budget.remaining !== null ? `, ${budget.remaining} left today` : ""}`);
  if (stopped) console.log(`research: stopped early: ${stopped}. Run again after the reset to continue.`);
  if (PEOPLE) {
    const applied = applyAdditions(additions);
    const peopleGaining = new Set(additions.map((a) => a.personId)).size;
    mkdirSync(CACHE_DIR, { recursive: true });
    writeJson(join(CACHE_DIR, "people-additions.json"), additions);
    console.log(`people: ${applied} papers added to ${peopleGaining} people (list in ${CACHE_DIR}/people-additions.json)`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
