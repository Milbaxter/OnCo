/**
 * Citation counts by year for key papers (improvement #97), from OpenAlex works looked up by DOI (CC0, no key).
 * Feeds the "most cited key papers" board on /papers/. The per-paper chip uses the budget-free Europe PMC
 * counts from scripts/fetch-citations.ts instead.
 *
 *   public/openalex/papers.json  { fetched, source, license, papers: { <paperId>: { doi, openalexId, cited, byYear, year } }, missing: [ids] }
 *
 * Run: npx tsx scripts/fetch-openalex-papers.ts   Weekly via .github/workflows/refresh-pulse.yml (with the pulse and abstract feeds).
 */
import { graph } from "../src/lib/graph";
import { getJson, publicPath, sleep, today, writeJson } from "./feed-utils";

const MAILTO = "onco@judegomila.com";
const OUT = publicPath("openalex", "papers.json");

export type PaperCitations = { doi: string; openalexId: string; cited: number; byYear: Record<string, number>; year?: number; title?: string };
export type CitationsSnapshot = { fetched: string; source: string; license: string; papers: Record<string, PaperCitations>; missing: string[] };

type Work = { id: string; doi?: string; title?: string; cited_by_count?: number; publication_year?: number; counts_by_year?: Array<{ year: number; cited_by_count: number }> };

const normDoi = (d: string) => d.trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "");

async function main() {
  const g = graph();
  const papers = g.kind("paper").filter((p) => p.doi).map((p) => ({ id: p.id, doi: normDoi(p.doi!) }));
  const byDoi = new Map(papers.map((p) => [p.doi, p.id]));
  const snap: CitationsSnapshot = { fetched: today(), source: "https://api.openalex.org/works", license: "CC0", papers: {}, missing: [] };
  console.log(`citations: ${papers.length} key papers with a DOI`);

  for (let i = 0; i < papers.length; i += 50) {
    const batch = papers.slice(i, i + 50);
    const filter = `doi:${batch.map((p) => `https://doi.org/${p.doi}`).join("|")}`;
    const url = `https://api.openalex.org/works?filter=${encodeURIComponent(filter)}&per-page=50&select=id,doi,title,cited_by_count,publication_year,counts_by_year&mailto=${MAILTO}`;
    const json = await getJson<{ results?: Work[] }>(url);
    await sleep(250);
    // Publish only after every batch succeeds: failed lookups are not missing DOI matches.
    if (!json || !Array.isArray(json.results)) throw new Error(`citations: batch ${i / 50 + 1} failed or returned no results array; snapshot not replaced`);
    for (const w of json.results) {
      const doi = w.doi ? normDoi(w.doi) : undefined;
      const id = doi ? byDoi.get(doi) : undefined;
      if (!id || !doi) continue;
      const byYear: Record<string, number> = {};
      for (const c of w.counts_by_year ?? []) byYear[String(c.year)] = c.cited_by_count;
      snap.papers[id] = { doi, openalexId: w.id.replace("https://openalex.org/", ""), cited: w.cited_by_count ?? 0, byYear, year: w.publication_year, title: w.title };
    }
  }
  snap.missing = papers.filter((p) => !snap.papers[p.id]).map((p) => p.id);
  writeJson(OUT, snap);
  console.log(`citations: ${Object.keys(snap.papers).length} resolved, ${snap.missing.length} missing -> ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
