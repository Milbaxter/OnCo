/**
 * Congress abstract harvest (improvement #94).
 *
 * Meeting abstracts are published as journal supplements with DOIs: ASCO in the Journal of Clinical Oncology
 * ("16_suppl" for the annual meeting, early-year supplements for ASCO GU/GI), ESMO in Annals of Oncology,
 * ASH in Blood, SABCS in Cancer Research. Europe PMC does not index most of these supplements, so the
 * harvest uses the Crossref REST API (public, polite pool with a mailto) and matches every title against
 * OnCo product, trial, target and cancer names.
 *
 *   public/digests/candidates.json  { fetched, congress: { id, label, year, window, source }, total, items: [...] }
 *
 * Run: npx tsx scripts/fetch-abstracts.ts [--congress=asco|asco-gu|esmo|ash|sabcs] [--year=2026]
 * Weekly via .github/workflows/refresh-pulse.yml; the script picks the most recent congress window by default.
 */
import { graph } from "../src/lib/graph";
import { NameMatcher, getJson, matchableFromGraph, publicPath, sleep, stripTags, today, writeJson } from "./feed-utils";

const MAILTO = "onco@judegomila.com";
const OUT = publicPath("digests", "candidates.json");
const MAX_PAGES = 12; // 1,000 records per page
const MAX_ITEMS = 400; // kept in the snapshot after ranking

type Congress = { id: string; label: string; issn: string; journal: string; /** month-day window inside the year */ from: string; to: string; accept: (issue: string | undefined, title: string, doi: string) => boolean };

const isSuppl = (issue?: string) => !!issue && /suppl/i.test(issue);
const CONGRESSES: Congress[] = [
  { id: "asco-gu", label: "ASCO Genitourinary Cancers Symposium", issn: "0732-183X", journal: "Journal of Clinical Oncology", from: "01-15", to: "03-10", accept: (i) => isSuppl(i) },
  { id: "asco", label: "ASCO Annual Meeting", issn: "0732-183X", journal: "Journal of Clinical Oncology", from: "05-10", to: "06-20", accept: (i) => /16_suppl/i.test(i ?? "") },
  { id: "esmo", label: "ESMO Congress", issn: "0923-7534", journal: "Annals of Oncology", from: "09-01", to: "11-15", accept: (i, t, d) => isSuppl(i) || /annonc\.\d{4}\.0[89]\./.test(d) || /^(LBA\d+|\d{1,4}[A-Z]{1,3}|P\d+-\d+)\b/.test(t) },
  { id: "ash", label: "ASH Annual Meeting", issn: "0006-4971", journal: "Blood", from: "10-25", to: "12-20", accept: (i) => isSuppl(i) },
  { id: "sabcs", label: "San Antonio Breast Cancer Symposium", issn: "0008-5472", journal: "Cancer Research", from: "01-20", to: "03-31", accept: (i) => isSuppl(i) },
];

export type AbstractCandidate = { doi: string; url: string; title: string; issue?: string; date?: string; lba: boolean; refs: { drugs: string[]; trials: string[]; targets: string[]; cancers: string[]; technologies: string[] } };
export type AbstractsSnapshot = { fetched: string; congress: { id: string; label: string; year: number; journal: string; window: { from: string; to: string }; source: string }; total: number; considered: number; matched: number; items: AbstractCandidate[]; errors: string[] };

type Work = { DOI: string; title?: string[]; issued?: { "date-parts"?: number[][] }; issue?: string; URL?: string };

function candidates(): Array<{ c: Congress; year: number }> {
  const want = process.argv.find((a) => a.startsWith("--congress="))?.slice(11);
  const yearArg = process.argv.find((a) => a.startsWith("--year="))?.slice(7);
  const now = today();
  if (want) { const c = CONGRESSES.find((x) => x.id === want); if (!c) throw new Error(`unknown congress ${want}`); return [{ c, year: Number(yearArg ?? now.slice(0, 4)) }]; }
  // Most recent windows first (this year, then last year). A window that has opened but not yet filled (the
  // supplement is published during the congress) falls through to the previous congress.
  const y = Number(now.slice(0, 4));
  return [y, y - 1].flatMap((yy) => CONGRESSES.map((c) => ({ c, year: yy, start: `${yy}-${c.from}` }))).filter((o) => o.start <= now).sort((a, b) => b.start.localeCompare(a.start));
}

const MIN_ABSTRACTS = 25;

async function harvest(matcher: NameMatcher, kindOf: (id: string) => string | undefined, c: Congress, year: number): Promise<AbstractsSnapshot> {
  const from = `${year}-${c.from}`, to = `${year}-${c.to}`;
  const snap: AbstractsSnapshot = { fetched: today(), congress: { id: c.id, label: c.label, year, journal: c.journal, window: { from, to }, source: "https://api.crossref.org/" }, total: 0, considered: 0, matched: 0, items: [], errors: [] };
  console.log(`abstracts: ${c.label} ${year}, ${c.journal} ${from}..${to}`);

  let cursor = "*";
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `https://api.crossref.org/journals/${c.issn}/works?filter=from-pub-date:${from},until-pub-date:${to}&rows=1000&cursor=${encodeURIComponent(cursor)}&select=DOI,title,issued,issue,URL&mailto=${MAILTO}`;
    const json = await getJson<{ message?: { "total-results"?: number; "next-cursor"?: string; items?: Work[] } }>(url);
    await sleep(600);
    if (!json?.message) throw new Error(`abstracts: ${c.label} ${year}: Crossref page ${page + 1} failed`);
    snap.total = json.message["total-results"] ?? snap.total;
    const items = json.message.items ?? [];
    for (const w of items) {
      const title = stripTags(w.title?.[0] ?? "");
      if (!title || !c.accept(w.issue, title, w.DOI)) continue;
      snap.considered++;
      const ids = matcher.match(title);
      if (!ids.length) continue;
      const refs = { drugs: ids.filter((i) => kindOf(i) === "drug"), trials: ids.filter((i) => kindOf(i) === "trial"), targets: ids.filter((i) => kindOf(i) === "target"), cancers: ids.filter((i) => kindOf(i) === "cancer"), technologies: ids.filter((i) => kindOf(i) === "technology") };
      if (!refs.drugs.length && !refs.trials.length) continue;
      const dp = w.issued?.["date-parts"]?.[0];
      const date = dp ? `${dp[0]}-${String(dp[1] ?? 1).padStart(2, "0")}-${String(dp[2] ?? 1).padStart(2, "0")}` : undefined;
      snap.items.push({ doi: w.DOI, url: w.URL ?? `https://doi.org/${w.DOI}`, title, issue: w.issue, date, lba: /^LBA\b|\bLBA\d/i.test(title) || /LBA/i.test(w.DOI), refs });
    }
    console.log(`  page ${page + 1}: ${items.length} records, ${snap.items.length} candidates so far`);
    cursor = json.message["next-cursor"] ?? "";
    if (!cursor || items.length < 1000) break;
  }

  // Most-connected first: late-breaking abstracts, then by number of linked objects.
  snap.items.sort((a, b) => Number(b.lba) - Number(a.lba) || (b.refs.drugs.length + b.refs.trials.length) - (a.refs.drugs.length + a.refs.trials.length) || a.title.localeCompare(b.title));
  console.log(`abstracts: ${snap.total} works in window, ${snap.considered} abstracts, ${snap.items.length} matched`);
  snap.matched = snap.items.length;
  snap.items = snap.items.slice(0, MAX_ITEMS);
  return snap;
}

async function main() {
  const g = graph();
  const matcher = new NameMatcher(matchableFromGraph(g.entities as never), ["drug", "trial", "target", "cancer", "technology"]);
  const kindOf = (id: string) => g.get(id)?.kind;
  let snap: AbstractsSnapshot | null = null;
  for (const { c, year } of candidates().slice(0, 3)) {
    snap = await harvest(matcher, kindOf, c, year);
    if (snap.considered >= MIN_ABSTRACTS || process.argv.some((a) => a.startsWith("--congress="))) break;
    console.log(`abstracts: only ${snap.considered} abstracts for ${c.label} ${year}; trying the previous congress`);
  }
  if (!snap) throw new Error("no congress window");
  writeJson(OUT, snap);
  console.log(`abstracts: ${snap.congress.label} ${snap.congress.year}, ${snap.items.length} candidates -> ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
