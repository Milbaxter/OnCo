/**
 * Survival statistics (improvement #98) from the NCI SEER Cancer Stat Facts pages.
 *
 * For every SEER site mapped in src/data/survival-map.ts the fact sheet is read for:
 *   - the headline 5-year relative survival and its data period (e.g. 91.9%, 2016-2022);
 *   - the "Percent of Cases and 5-Year Relative Survival by Stage at Diagnosis" table (localised, regional,
 *     distant, unknown), when the site has one (haematologic cancers do not);
 *   - the basis footnote ("Based on data from SEER 21 (Excluding IL) 2016-2022").
 *
 * Nothing is computed or estimated: the page shows exactly what SEER publishes, with the caveats that relative
 * survival is a US population statistic and that several OnCo cancers share one SEER site.
 *
 *   public/survival/index.json  { fetched, source, sourceUrl, sites: { <slug>: {...} }, failed: [slugs] }
 *
 * Run: npx tsx scripts/fetch-survival.ts   Quarterly via .github/workflows/refresh-hta.yml.
 */
import { SURVIVAL_SITES } from "../src/data/survival-map";
import { decodeEntities, getText, publicPath, sleep, stripTags, today, writeJson } from "./feed-utils";

const OUT = publicPath("survival", "index.json");

export type StageRow = { stage: string; description?: string; casesPct?: number; survivalPct?: number };
export type SurvivalSite = { slug: string; label: string; url: string; overall?: { pct: number; period: string }; byStage: StageRow[]; basis?: string; newCasesPer100k?: number; deathsPer100k?: number; ratesPeriod?: string; fetched: string };
export type SurvivalSnapshot = { fetched: string; source: string; sourceUrl: string; note: string; sites: Record<string, SurvivalSite>; failed: string[] };

const pct = (s?: string) => { const m = s?.match(/(\d+(?:\.\d+)?)\s*%/); return m ? Number(m[1]) : undefined; };

export function parseStatFacts(slug: string, html: string, fetched: string): SurvivalSite {
  const url = `https://seer.cancer.gov/statfacts/html/${slug}.html`;
  const label = decodeEntities(html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? slug).replace(/^Cancer Stat Facts:\s*/i, "").replace(/\s*-\s*NCI.*$/i, "").replace(/\s*\|\s*SEER.*$/i, "").trim();
  const site: SurvivalSite = { slug, label, url, byStage: [], fetched };
  const head = html.match(/5-Year<br\s*\/?>\s*Relative Survival<\/p>\s*<strong>([^<]*)<\/strong>\s*<span>([^<]*)<\/span>/i);
  if (head) { const p = pct(head[1]); if (p !== undefined) site.overall = { pct: p, period: decodeEntities(head[2]).replace(/[–—]/g, "-") }; }
  const tableBlock = html.match(/by Stage at Diagnosis[\s\S]*?<table[^>]*>([\s\S]*?)<\/table>/i)?.[1];
  if (tableBlock) {
    for (const row of tableBlock.match(/<tr>[\s\S]*?<\/tr>/g) ?? []) {
      const th = row.match(/<th[^>]*>([\s\S]*?)<\/th>/)?.[1];
      const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => stripTags(m[1]));
      if (!th || tds.length < 2) continue;
      const stage = stripTags(th.match(/<strong>([\s\S]*?)<\/strong>/)?.[1] ?? th);
      const description = stripTags(th.replace(/<strong>[\s\S]*?<\/strong>/, ""));
      site.byStage.push({ stage, description: description || undefined, casesPct: pct(tds[0]), survivalPct: pct(tds[1]) });
    }
  }
  const basis = html.match(/Based on data from SEER[^.<]*\./)?.[0];
  if (basis) site.basis = decodeEntities(basis).replace(/[–—]/g, "-");
  const rates = stripTags(html.match(/Rate of New Cases and Deaths per 100,000[\s\S]{0,600}?<\/p>/i)?.[0] ?? "");
  const newCases = rates.match(/rate of new cases of [^.]*? was (\d+(?:\.\d+)?) per 100,000/i)?.[1];
  const deaths = rates.match(/death rate was (\d+(?:\.\d+)?) per 100,000/i)?.[1];
  const period = rates.match(/based on (\d{4}-\d{4}) cases and (\d{4}-\d{4}) deaths/i);
  if (newCases) site.newCasesPer100k = Number(newCases);
  if (deaths) site.deathsPer100k = Number(deaths);
  if (period) site.ratesPeriod = `${period[1]} cases, ${period[2]} deaths`;
  return site;
}

async function main() {
  const fetched = today();
  const snap: SurvivalSnapshot = { fetched, source: "SEER Cancer Stat Facts, Surveillance, Epidemiology, and End Results Program, National Cancer Institute", sourceUrl: "https://seer.cancer.gov/statfacts/", note: "US population statistics. Relative survival compares people with the cancer to the general population of the same age, sex and race; it is not a prediction for an individual. Stage groups are SEER summary stages (localised, regional, distant), not TNM stages.", sites: {}, failed: [] };
  const slugs = [...new Set(Object.values(SURVIVAL_SITES).map((s) => s.slug))].sort();
  for (const slug of slugs) {
    const html = await getText(`https://seer.cancer.gov/statfacts/html/${slug}.html`, { accept: "text/html", tries: 3 });
    await sleep(700);
    if (!html) { snap.failed.push(slug); console.warn(`  survival: ${slug} unreachable`); continue; }
    const site = parseStatFacts(slug, html, fetched);
    if (!site.overall && !site.byStage.length) { snap.failed.push(slug); console.warn(`  survival: ${slug} parsed nothing`); continue; }
    snap.sites[slug] = site;
    console.log(`  ${slug}: ${site.overall?.pct ?? "?"}% (${site.overall?.period ?? "?"}), ${site.byStage.length} stage rows`);
  }
  if (snap.failed.length) throw new Error(`survival: incomplete refresh (${snap.failed.join(", ")}); snapshot not written`);
  writeJson(OUT, snap, true);
  console.log(`survival: ${Object.keys(snap.sites).length} sites, ${snap.failed.length} failed -> ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
