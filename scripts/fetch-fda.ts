/**
 * FDA approvals feed (improvement #91).
 *
 * Two public sources, no key:
 *   (a) The FDA Oncology Center of Excellence "Oncology (Cancer)/Hematologic Malignancies Approval
 *       Notifications" page: every oncology approval, accelerated approval and label expansion, dated.
 *   (b) openFDA `drugsfda`: applications with a submission approved (status AP) inside the window, which
 *       catches supplements (new indications, label changes) for products already in the corpus.
 *
 * Each item is matched to corpus product ids by name, brand, code and alias. Items that match nothing are
 * "not yet in corpus" candidates. `firstSeen` is carried over from the previous snapshot so /regulatory/ can
 * show what is new since the last build.
 *
 * Writes public/fda/recent.json. Run: npx tsx scripts/fetch-fda.ts   Weekly via .github/workflows/refresh-fda.yml.
 */
import { graph } from "../src/lib/graph";
import { renameSync, rmSync } from "node:fs";
import { FDA_OCE_URL, NameMatcher, UA, getText, isoDaysAgo, matchableFromGraph, parseOcePage, publicPath, readJson, sleep, today, writeJson } from "./feed-utils";
import { isSupportiveIndication } from "../src/lib/supportive-care";

const WINDOW_DAYS = Number(process.argv.find((a) => a.startsWith("--days="))?.slice(7) ?? 120);
const OUT = publicPath("fda", "recent.json");
const PAGE_SIZE = 100;
const MAX_PAGES = 30;

/** `supportive` is true when the notification text reads as supportive care under the rule in src/lib/supportive-care.ts (symptom control, toxicity rescue or prophylaxis, infection prophylaxis, no antitumour purpose); a record written from it belongs in src/data/supportive-drugs.ts. */
export type OceApproval = { date: string; title: string; url: string; summary: string; drugIds: string[]; cancerIds: string[]; firstSeen: string; supportive?: boolean };
export type DrugsFdaApproval = { applicationNumber: string; sponsor?: string; brand?: string; generic?: string; submissionType: string; submissionNumber: string; classCode?: string; classDescription?: string; statusDate: string; drugIds: string[]; firstSeen: string };
export type FdaSnapshot = {
  fetched: string; previousFetched?: string; window: { from: string; to: string };
  sources: { oce: string; drugsfda: string };
  oce: OceApproval[];
  drugsfda: DrugsFdaApproval[];
  notInCorpus: Array<{ date: string; title: string; url: string; firstSeen: string; generic?: string; supportive?: boolean }>;
  errors: string[];
};

type DrugsFdaResult = {
  application_number?: string; sponsor_name?: string;
  products?: Array<{ brand_name?: string; active_ingredients?: Array<{ name?: string }> }>;
  openfda?: { generic_name?: string[]; brand_name?: string[] };
  submissions?: Array<{ submission_type?: string; submission_number?: string; submission_status?: string; submission_status_date?: string; submission_class_code?: string; submission_class_code_description?: string }>;
};

/** Unlike the shared nullable loader, retain the HTTP status to distinguish an empty search from a failed request. */
async function drugsFdaPage(url: string, skip: number): Promise<{ total: number; results: DrugsFdaResult[] }> {
  let response: Response | undefined;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      response = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
    } catch (error) {
      if (attempt === 3) throw new Error(`openFDA request failed at offset ${skip}`, { cause: error });
      await sleep(1000 * (attempt + 1));
      continue;
    }
    if (response.status !== 429 && response.status < 500) break;
    if (attempt === 3) throw new Error(`openFDA HTTP ${response.status} at offset ${skip}`);
    await sleep(1500 * (attempt + 1));
  }
  if (!response) throw new Error(`openFDA request failed at offset ${skip}`);
  const body = await response.json() as { error?: { code?: string; message?: string }; meta?: { results?: { total?: number; skip?: number; limit?: number } }; results?: DrugsFdaResult[] } | null;
  // FDA's API returns this exact 404 for an empty search. It cannot complete a later page that was promised by total.
  // https://github.com/FDA/openfda/blob/fdbe54327901a0c1e30130d1d6a2bbe67b79b77c/api/faers/api.js#L723-L727
  if (response.status === 404 && skip === 0 && body?.error?.code === "NOT_FOUND" && body.error.message === "No matches found!") return { total: 0, results: [] };
  if (!response.ok) throw new Error(`openFDA HTTP ${response.status} at offset ${skip}`);
  const meta = body?.meta?.results;
  const total = meta?.total;
  // These counts concern fetched applications, not the smaller number of matching corpus submissions.
  // https://open.fda.gov/apis/anatomy-of-a-response/
  if (typeof total !== "number" || !Number.isSafeInteger(total) || total < skip || meta?.skip !== skip || meta.limit !== PAGE_SIZE
    || !Array.isArray(body?.results) || body.results.length !== Math.min(PAGE_SIZE, total - skip)) throw new Error(`Incomplete openFDA page at offset ${skip}`);
  if (total > PAGE_SIZE * MAX_PAGES) throw new Error(`openFDA has ${total} applications; the ${PAGE_SIZE * MAX_PAGES}-application refresh cap cannot cover them`);
  return { total, results: body.results };
}

/** "granted accelerated approval to sevabertinib (Hyrnuo, Bayer ...)" -> "sevabertinib" */
function genericFromSummary(summary: string): string | undefined {
  const m = summary.match(/(?:approv(?:ed|al)(?: to| for| of)?|authori[sz]ed|cleared|granted [a-z ]*approval (?:to|for))\s+((?:[a-z][a-z0-9-]+\s?){1,4}?)\s*\(/i);
  return m?.[1]?.trim();
}

export async function refreshFda() {
  const g = graph();
  const matcher = new NameMatcher(matchableFromGraph(g.entities as never), ["drug", "cancer"]);
  const prev = readJson<FdaSnapshot>(OUT);
  const fetched = today();
  const from = isoDaysAgo(WINDOW_DAYS);
  const snap: FdaSnapshot = { fetched, previousFetched: prev?.fetched, window: { from, to: fetched }, sources: { oce: FDA_OCE_URL, drugsfda: "https://api.fda.gov/drug/drugsfda.json" }, oce: [], drugsfda: [], notInCorpus: [], errors: [] };
  const prevOce = new Map((prev?.oce ?? []).map((o) => [o.url, o.firstSeen]));
  const prevNic = new Map((prev?.notInCorpus ?? []).map((o) => [o.url, o.firstSeen]));
  const prevDf = new Map((prev?.drugsfda ?? []).map((o) => [`${o.applicationNumber}/${o.submissionType}${o.submissionNumber}`, o.firstSeen]));

  // (a) OCE approval notifications.
  const html = await getText(FDA_OCE_URL, { accept: "text/html" });
  if (!html) throw new Error("FDA OCE page unreachable");
  else {
    const parsed = parseOcePage(html);
    // Historical rows establish that the source parsed. An empty current window is valid; unrecognised HTML is not.
    if (!parsed.length) throw new Error("FDA OCE page contained no parseable notices");
    const items = parsed.filter((i) => i.date >= from);
    for (const it of items) {
      const text = `${it.title} ${it.summary}`;
      const ids = matcher.match(text);
      const drugIds = ids.filter((id) => g.get(id)?.kind === "drug");
      const cancerIds = ids.filter((id) => g.get(id)?.kind === "cancer");
      // Supportive care rule (src/lib/supportive-care.ts) applied to the notification text; only set when true so old snapshots compare equal.
      const supportive = isSupportiveIndication(text) ? { supportive: true } : {};
      if (drugIds.length) snap.oce.push({ ...it, drugIds, cancerIds, firstSeen: prevOce.get(it.url) ?? fetched, ...supportive });
      else snap.notInCorpus.push({ date: it.date, title: it.title, url: it.url, generic: genericFromSummary(it.summary), firstSeen: prevNic.get(it.url) ?? fetched, ...supportive });
    }
    console.log(`fda: OCE ${items.length} notifications since ${from}; ${snap.oce.length} matched, ${snap.notInCorpus.length} not in corpus`);
  }

  // (b) openFDA drugsfda: applications with an approved submission in the window.
  const fromCompact = from.replace(/-/g, ""), toCompact = fetched.replace(/-/g, "");
  const search = `submissions.submission_status_date:[${fromCompact}+TO+${toCompact}]+AND+submissions.submission_status:AP`;
  let skip = 0, pages = 0, total = 0;
  const seenApplications = new Set<string>();
  for (;;) {
    const url = `https://api.fda.gov/drug/drugsfda.json?search=${search}&limit=${PAGE_SIZE}&skip=${skip}`;
    const json = await drugsFdaPage(url, skip);
    await sleep(400);
    if (pages > 0 && json.total !== total) throw new Error("openFDA total changed during pagination");
    total = json.total;
    for (const app of json.results) {
      if (!app || typeof app.application_number !== "string" || !app.application_number || seenApplications.has(app.application_number)) throw new Error(`Invalid or repeated openFDA application at offset ${skip}`);
      seenApplications.add(app.application_number);
      const names = new Set<string>();
      for (const p of app.products ?? []) { if (p.brand_name) names.add(p.brand_name); for (const a of p.active_ingredients ?? []) if (a.name) names.add(a.name); }
      for (const n of app.openfda?.generic_name ?? []) names.add(n);
      for (const n of app.openfda?.brand_name ?? []) names.add(n);
      const drugIds = matcher.match([...names].join(" ; "), ["drug"]);
      if (!drugIds.length) continue;
      for (const s of app.submissions ?? []) {
        const d = s.submission_status_date ?? "";
        if (s.submission_status !== "AP" || d < fromCompact || d > toCompact) continue;
        const key = `${app.application_number}/${s.submission_type}${s.submission_number}`;
        snap.drugsfda.push({
          applicationNumber: app.application_number ?? "", sponsor: app.sponsor_name, brand: app.products?.[0]?.brand_name ?? app.openfda?.brand_name?.[0],
          generic: app.openfda?.generic_name?.[0] ?? app.products?.[0]?.active_ingredients?.map((a) => a.name).join(" / "),
          submissionType: s.submission_type ?? "", submissionNumber: s.submission_number ?? "", classCode: s.submission_class_code, classDescription: s.submission_class_code_description,
          statusDate: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, drugIds, firstSeen: prevDf.get(key) ?? fetched,
        });
      }
    }
    skip += json.results.length; pages++;
    if (skip === total) break;
  }
  snap.drugsfda.sort((a, b) => b.statusDate.localeCompare(a.statusDate));
  console.log(`fda: drugsfda ${total} applications with approvals in window; ${snap.drugsfda.length} submissions for corpus products`);

  // Nothing touches the prior snapshot until both sources are complete. Rename also preserves it if writing fails.
  const temporary = `${OUT}.${process.pid}.tmp`;
  try { writeJson(temporary, snap); renameSync(temporary, OUT); }
  finally { rmSync(temporary, { force: true }); }
  console.log(`fda: wrote ${OUT}`);
}

if (process.argv[1]?.endsWith("fetch-fda.ts")) refreshFda().catch((e) => { console.error("FDA refresh failed; snapshot was not replaced.", e); process.exit(1); });
