/**
 * Automated research pulse (improvement #96): the latest items from the leading journals, regulators and
 * news outlets, matched to OnCo entity ids by name and alias. Sits beside the hand-curated themes on /pulse/.
 *
 * Sources are public RSS or RDF feeds; the FDA Oncology Center of Excellence has no feed, so its approval
 * table is parsed directly. General news feeds (STAT, Endpoints) are filtered to oncology items.
 *
 *   public/pulse/auto.json  { fetched, feeds: [{ id, name, homepage, url, ok, count, error? }], items: [{ feedId, title, url, date, refs }] }
 *
 * Run: npx tsx scripts/fetch-pulse.ts   Weekly via .github/workflows/refresh-pulse.yml.
 */
import { graph } from "../src/lib/graph";
import { FDA_OCE_URL, NameMatcher, ONCO_WORDS, getText, isoDaysAgo, matchableFromGraph, parseFeed, parseOcePage, publicPath, readJson, sleep, today, writeJson, type FeedItem } from "./feed-utils";

const OUT = publicPath("pulse", "auto.json");
const KEEP_DAYS = 60;
const MAX_PER_FEED = 40;

type FeedDef = { id: string; name: string; homepage: string; url: string; kind: "journal" | "regulator" | "news"; sourceId?: string; onlyOncology?: boolean };

/** `sourceId` links to the OnCo record for the source where one exists: a collection in src/data/sources.ts or a journal record. */
const FEEDS: FeedDef[] = [
  { id: "fda-oce", name: "FDA Oncology Center of Excellence", homepage: FDA_OCE_URL, url: FDA_OCE_URL, kind: "regulator", sourceId: "fda-approvals" },
  { id: "nejm", name: "New England Journal of Medicine", homepage: "https://www.nejm.org/", url: "https://www.nejm.org/action/showFeed?type=etoc&feed=rss&jc=nejm", kind: "journal", sourceId: "nejm", onlyOncology: true },
  { id: "lancet-oncology", name: "The Lancet Oncology", homepage: "https://www.thelancet.com/journals/lanonc/home", url: "https://www.thelancet.com/rssfeed/lanonc_current.xml", kind: "journal", sourceId: "lancet-oncology" },
  { id: "jco", name: "Journal of Clinical Oncology", homepage: "https://ascopubs.org/journal/jco", url: "https://ascopubs.org/action/showFeed?type=etoc&feed=rss&jc=jco", kind: "journal", sourceId: "jco" },
  { id: "nature-medicine", name: "Nature Medicine", homepage: "https://www.nature.com/nm/", url: "https://www.nature.com/nm.rss", kind: "journal", sourceId: "nature-medicine", onlyOncology: true },
  { id: "endpoints", name: "Endpoints News", homepage: "https://endpts.com/", url: "https://endpts.com/feed/", kind: "news", sourceId: "src-endpoints-news", onlyOncology: true },
  { id: "stat", name: "STAT", homepage: "https://www.statnews.com/", url: "https://www.statnews.com/feed/", kind: "news", sourceId: "src-stat-news", onlyOncology: true },
];

export type AutoPulseFeed = { id: string; name: string; homepage: string; url: string; kind: string; sourceId?: string; ok: boolean; count: number; error?: string };
export type AutoPulseItem = { feedId: string; title: string; url: string; date?: string; refs: string[] };
export type AutoPulseSnapshot = { fetched: string; feeds: AutoPulseFeed[]; items: AutoPulseItem[] };

/** Skip XML preambles without fetching an external DTD or mistaking its quoted text for the root. */
function feedRootText(text: string): string {
  let rest = text.replace(/^\uFEFF/, "").trim();
  for (;;) {
    const misc = rest.match(/^(?:<!--[\s\S]*?-->|<\?[\s\S]*?\?>)\s*/)?.[0];
    if (misc) { rest = rest.slice(misc.length); continue; }
    if (!/^<!DOCTYPE\s/.test(rest)) break;
    let quote = "", subset = 0, end = -1;
    for (let i = 9; i < rest.length; i++) {
      const c = rest[i];
      if (quote) { if (c === quote) quote = ""; }
      else if (rest.startsWith("<!--", i)) {
        const endComment = rest.indexOf("-->", i + 4);
        if (endComment < 0) return "";
        i = endComment + 2;
      }
      else if (c === '"' || c === "'") quote = c;
      else if (c === "[") subset++;
      else if (c === "]") subset--;
      else if (c === ">" && subset === 0) { end = i; break; }
    }
    if (end < 0) return "";
    rest = rest.slice(end + 1).trimStart();
  }
  // Comments and processing instructions may follow the document element too.
  for (;;) {
    const start = rest.endsWith("-->") ? rest.lastIndexOf("<!--") : rest.endsWith("?>") ? rest.lastIndexOf("<?") : -1;
    if (start < 0) return rest;
    rest = rest.slice(0, start).trimEnd();
  }
}

/** Recognise the supported feed envelope, not full XML/schema validity or completeness of its items. */
function isFeedResponse(text: string): boolean {
  const xml = feedRootText(text);
  const root = xml.match(/^<([A-Za-z_][\w.:-]*)(\s+(?:[^"'<>]|"[^"]*"|'[^']*')*)?>/);
  const close = xml.match(/<\/([A-Za-z_][\w.:-]*)\s*>$/);
  if (!root || !close || root[1] !== close[1]) return false;
  const namespaces = (attributes: string, parent = new Map<string, string>()) => {
    const ns = new Map(parent);
    for (const a of attributes.matchAll(/(?:^|\s)xmlns(?::([\w.-]+))?\s*=\s*(["'])(.*?)\2/g)) ns.set(a[1] ?? "", a[3]);
    return ns;
  };
  const name = (qname: string, ns: Map<string, string>) => {
    const colon = qname.indexOf(":");
    return { local: qname.slice(colon + 1), uri: colon < 0 ? ns.get("") ?? "" : ns.get(qname.slice(0, colon)) };
  };
  const ns = namespaces(root[2] ?? ""), document = name(root[1], ns);
  if (document.local === "feed" && document.uri === "http://www.w3.org/2005/Atom") return true;
  const rss2 = document.local === "rss" && document.uri === "";
  const rdf = document.local === "RDF" && document.uri === "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
  if (!rss2 && !rdf) return false;
  const body = xml.slice(root[0].length, close.index).replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>/g, "");
  let depth = 0;
  for (const tag of body.matchAll(/<(\/?)([A-Za-z_][\w.:-]*)(\s+(?:[^"'<>]|"[^"]*"|'[^']*')*)?\s*\/?>/g)) {
    if (tag[1]) { depth--; continue; }
    const child = name(tag[2], namespaces(tag[3] ?? "", ns));
    if (depth === 0 && child.local === "channel" && child.uri === (rdf ? "http://purl.org/rss/1.0/" : "")) return true;
    if (!/\/\s*>$/.test(tag[0])) depth++;
  }
  return false;
}

async function main() {
  const g = graph();
  const matcher = new NameMatcher(matchableFromGraph(g.entities as never), ["drug", "target", "cancer", "technology", "trial", "company"]);
  const prev = readJson<AutoPulseSnapshot>(OUT);
  const fetched = today();
  const cutoff = isoDaysAgo(KEEP_DAYS);
  const snap: AutoPulseSnapshot = { fetched, feeds: [], items: [] };
  const seen = new Set<string>();

  for (const f of FEEDS) {
    const text = await getText(f.url, { accept: f.id === "fda-oce" ? "text/html" : "application/rss+xml, application/atom+xml, application/xml, text/xml" });
    await sleep(500);
    if (!text || (f.id !== "fda-oce" && !isFeedResponse(text))) {
      const error = text ? "response is not a supported feed" : "unreachable or blocked";
      snap.feeds.push({ ...f, ok: false, count: 0, error }); console.warn(`pulse: ${f.id} failed: ${error}`); continue;
    }
    let items: FeedItem[] = f.id === "fda-oce" ? parseOcePage(text).map((o) => ({ title: o.title, link: o.url, date: o.date, summary: o.summary })) : parseFeed(text);
    if (f.onlyOncology) items = items.filter((i) => ONCO_WORDS.test(`${i.title} ${i.summary ?? ""}`));
    items = items.filter((i) => !i.date || i.date >= cutoff).slice(0, MAX_PER_FEED);
    let n = 0;
    for (const it of items) {
      if (seen.has(it.link)) continue;
      seen.add(it.link);
      snap.items.push({ feedId: f.id, title: it.title, url: it.link, date: it.date, refs: matcher.match(`${it.title}. ${it.summary ?? ""}`).slice(0, 8) });
      n++;
    }
    snap.feeds.push({ ...f, ok: true, count: n });
    console.log(`pulse: ${f.id} ${n} items`);
  }

  // Keep items from feeds that failed this run, from the previous snapshot, so a blocked publisher does not blank its column.
  for (const pf of prev?.feeds ?? []) {
    const now = snap.feeds.find((x) => x.id === pf.id);
    if (now?.ok) continue;
    const carried = (prev?.items ?? []).filter((i) => i.feedId === pf.id && (!i.date || i.date >= cutoff) && !seen.has(i.url));
    for (const c of carried) { seen.add(c.url); snap.items.push(c); }
    if (now && carried.length) { now.count = carried.length; now.error = `${now.error}; showing ${carried.length} items from ${prev?.fetched}`; }
  }

  snap.items.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  writeJson(OUT, snap);
  console.log(`pulse: ${snap.items.length} items from ${snap.feeds.filter((f) => f.ok).length}/${snap.feeds.length} feeds -> ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
