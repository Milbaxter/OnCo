# Tables: filter state and width (22 and 23 Sept 2026)

Every file under src/app and src/components containing `<table` (75 files, `src/app/nested-anchors.test.ts` and `src/components/MarkdownLite.tsx` excluded: a test scanner and a markdown renderer, not tables). One line each: file, what it lists, and how it filters today.

How the shared pieces fit together:

- `src/components/filters/ColumnFilter.tsx`: the header trigger (funnel glyph, popover of value pills with counts, search past eight values, Clear, Close, Escape, bottom sheet under sm).
- `src/components/filters/ResultsTable.tsx`: the shared table; `ColumnHead` puts the filter on any column that carries a `filter` spec.
- `src/components/filters/FilterableTable.tsx`: `useColumnFilters` (selection, sort, counts, optional URL sync through `src/lib/table-view.ts`) and `FilterableTable` (toolbar with the "N of M" count and a Clear pill, plus the table) for plain `columns` and `rows`. `initial` seeds a selection before the URL is read.
- `src/components/filters/StaticTable.tsx`: the client wrapper for server-rendered pages. The page builds plain rows (strings, numbers, `{ text, href, chip, sub, v, bar, bars, avatar }` objects or lists of them) and column specs; the component draws links, chips, bars and avatars on the client side, so no function or React node crosses the server boundary and every row is still in the exported HTML (filtering only hides rows). A single table uses `url` with column keys as query keys. Multiple tables also need distinct `urlScope` values: modality tables use `phase3.cancers`, `trials.cancers`, `phase3.sort`, and so on. Old unscoped links seed each table until it has scoped state; a scoped `v=1` marker preserves an explicitly cleared selection without deleting legacy keys before siblings read them.
- `src/lib/static-tables.ts`: paging for the long tables. A row handed to a client table is in the page twice (rendered HTML plus the hydration payload), so a table longer than `TABLE_PAGE` (30) rows carries only its first page and the rest lives in `/api/v1/tables/<id>.json` (`scripts/build-tables.ts`, listed in `scripts/api-layout.ts` and the OpenAPI description as `listTableRows`). `pageRows(id, rows)` splits the rows for the page; `StaticTable`, `EntityBrowser` and `ResearchRanking` take the result as `rows` and `more`, and fetch the file when the reader scrolls past the first page (IntersectionObserver sentinel), presses the "Show 30 more" pill, or sets a filter, search or sort that the first page cannot answer; header filters and URL state then run over the full set. Row builders live in `src/lib/tables/` so the page and the writer produce the same rows in the same order (the first page must be in the table's default sort order); `src/lib/tables/index.ts` lists every table, and `scripts/build-tables.test.ts` checks each file starts with the rows the page renders. Markup budgets for each paged page are in `src/app/heavy-pages.test.ts`.

Rule applied: a table with fewer than ten rows on every page that renders it stays a plain `<table>`; the skip is recorded below.

## Page weight after the conversion (measured 22 Sept 2026)

Live HTML of every page in group 1, one `curl` each (User-Agent "OnCo maintenance"), bytes as served. "Main" is the `<main>` element, "payload" the `self.__next_f.push` scripts React hydrates from: the two halves of the doubling. The dossier row is the largest target (PD-1, 648 trials).

| Page | HTML | Main | Payload | Rows in HTML | Now |
| --- | ---: | ---: | ---: | ---: | --- |
| /evidence/ | 6,207,276 | 3,574,409 | 2,583,839 | 3,528 | paged: first 30 of 3,527 trials, file 2.2 MB |
| /pathway-drugs/ | 4,044,746 | 1,392,869 | 2,598,148 | 1,181 | paged: first 30 of 108 pathways in the matrix, first 10 of 108 node sections (`PathwaySections`) |
| /dossiers/pd1/ | 2,142,659 | | | | paged: first 30 of 648 trials; 31 targets have more than a page and get a file |
| /countries/cn/ | 1,876,515 | 930,313 | 897,976 | 899 | paged: first 30 of 870 key trials |
| /audit/ | 1,627,262 | 792,662 | 786,747 | 1,798 | paged: every StaticTable longer than 30 rows (13 files) |
| /universities/ | 1,546,778 | 698,944 | 798,643 | 824 | paged: OpenAlex by institution (473), grouped (452) and corpus score (269), `ResearchRanking` takes `more`; logos as URLs instead of React nodes |
| /startups/ | 1,159,589 | 409,107 | 701,790 | 127 | paged: the EntityBrowser rows (first 30), `EntityBrowser` takes `more`; the investors table (64 rows, 25 shown) was not the weight |
| /papers/ | 409,219 | 256,233 | 105,330 | 142 | left: under 500 KB |
| /costs/ | 338,802 | 128,469 | 162,609 | 30 | left |
| /review/ | 334,284 | 135,125 | 151,410 | 99 | left |
| /eval/ | 322,711 | 140,624 | 134,497 | 105 | left |
| /deals/ | 314,844 | 141,498 | 125,694 | 71 | left |
| /survival/ | 305,048 | 118,325 | 139,144 | 37 | left |
| /countries/in/ | 297,054 | | | | left |
| /payloads/ | 178,906 | | | | left |
| /status/ | 163,028 | | | | left |
| /freshness/ | 120,104 | | | | left |
| /funding/ | 114,458 | | | | left |

No page fell between 500 KB and 1 MB, so the "rows once" variant of StaticTable (client render from props with a first-page fallback) was not needed; the payload does duplicate the rows on every page (payload is 45 to 65 percent of the HTML), which is why the paged pages carry only 30 rows in both halves. Markup of the paged pages when written, from `src/app/heavy-pages.test.ts` (the payload follows the same props): evidence 131 KB, China 209 KB, universities 140 KB, audit 323 KB, pathway-drugs 320 KB, PD-1 dossier 377 KB; expected live HTML roughly twice the markup, every page under 1 MB.

Left alone on purpose: `src/app/tumour-testing/page.tsx` (being redesigned by another agent).

## Kind browsers (measured 22 Sept 2026)

Live HTML of every kind index, one `curl` each (User-Agent "OnCo maintenance"), bytes as served, before the conversion. `EntityBrowser` is a client component, so every row was in the page twice (rendered and as hydration props), and the corpus keeps growing (13,789 records that day).

| Page | Rows | HTML | Now |
| --- | ---: | ---: | --- |
| /trials/ | 3,600 | 7,791,875 | paged: first 60, file `kind-trials` |
| /key-papers/ | 1,984 | 3,700,955 | paged: first 60, file `kind-key-papers` |
| /ideas/ | 1,140 | 2,888,140 | paged: first 60, file `kind-ideas` |
| /drugs/ | 1,068 | 2,811,673 | paged: first 60, file `kind-drugs` |
| /people/ | 1,547 | 2,566,843 | paged: first 60, file `kind-people` |
| /cancers/ | 328 | 1,909,867 | paged: first 60, file `kind-cancers`; the tile grid's 328 organ drawings became one symbol sheet (`CancerIconDefs`) |
| /companies/ | 1,186 | 1,699,683 | paged: first 60, file `kind-companies` |
| /terms/ | 768 | 1,258,778 | paged: first 60, file `kind-terms` |
| /institutions/ | 710 | 1,116,914 | paged: first 60, file `kind-institutions` |
| /technologies/ | 590 | 1,040,395 | paged: first 60, file `kind-technologies` |
| /targets/ | 188 | 724,402 | paged: first 60, file `kind-targets` |
| /journals/ | 259 | 658,707 | left: under 700 KB (next candidate as the corpus grows) |
| /pathways/ | 108 | 582,636 | left |
| /pairings/ | 86 | 479,838 | left |
| /collections/ | 133 | 464,557 | left |
| /bottlenecks/ | 45 | 414,813 | left |
| /biomarkers/ | 80 | not yet measured | left: every row ships; measure at the next weight pass |
| /roadmaps/ | 30 | 198,042 | left |

How a paged kind browser works (`src/lib/tables/kinds.ts`, `PAGED_KINDS`): the page builds every row as before (`buildBrowser` plus glossary marks), sorts them with the client's own comparator (`src/lib/browser-sort.ts`, the default order of the table) and hands `EntityBrowser` the first `KIND_PAGE` (60) rows, `more` pointing at `/api/v1/tables/kind-<route>.json`, and `counts`: the per-facet value counts over the whole table, so the facet pickers read "Phase 3 (412)" before anything is fetched. The file holds every row in the same order (`scripts/build-tables.ts` through `allTables()`; `scripts/build-tables.test.ts` checks the first 60 match). Scrolling past the first rows, the "Show 60 more" pill, a search, a facet or a sort fetches the file, after which search, facets, sort, the download and the URL scheme (`?phase=Phase+3&q=her2&sort=-name`) run over the full set exactly as before. Under the table a plain line links the kind's whole set as `/api/v1/<plural>.json` and `.csv` for crawlers and agents; every record also has its own page and the sitemap lists them, so the index need not list every row. Small kinds ship every row as before.

The gene hub (/targets/genome/, `src/lib/tables/genome.ts`, `src/components/GenomeRoles.tsx`) is paged the same way without a table: it listed every graded gene as a chip under every role it holds (2,083 chips over 1,447 genes, 940 KB of markup, 2.1 MB of HTML). Each role section now carries its first `TABLE_PAGE` (30) chips, the role's whole count and its split by evidence tier; one file, `/api/v1/tables/genome-genes.json`, holds every graded gene once (symbol, page, roles, tier) in the hub's order, fetched when the reader scrolls past a section's chips, presses "Show 30 more" or sets a role or evidence pill, after which the sections and the hub's own deep links (`?role=drug-target&evidence=approved-drug`, ids or the table's labels) run over the full set. A line under the sections links the file as "All N genes as JSON" for crawlers and agents. Markup when written: about 150 KB; budget 600 KB in `src/app/heavy-pages.test.ts`.

Why not `/api/v1/<plural>.json` for the rows themselves: those files hold the raw records, while a browser row carries what the graph derives for the table (linked names and routes with their TL;DR tips, counts of linked objects with deep links, facet chips, glossary marks, ranking scores), which would need the whole graph on the client to rebuild. The browser-row file is a table file like the others; the raw kind file is what the page links for the whole set.

Markup of the paged kind pages when written, from `src/app/heavy-pages.test.ts` (the budget is 600 KB each; the payload adds the same 60 rows as compact JSON): trials 289 KB, key papers 276 KB, drugs 277 KB, ideas 361 KB, people 246 KB, companies 235 KB, targets 224 KB, institutions 215 KB, technologies 205 KB, terms 176 KB, cancers 524 KB (of which the tile grid with the 328 TL;DR tooltips is about 280 KB). Expected live HTML: roughly 350 to 500 KB for each, /cancers/ about 600 KB; against 0.7 to 7.8 MB before.

## Kind browsers: width at 1280 and 1440 px (measured 23 Sept 2026)

Owner report: "table last column grey broken here https://onco.cc/drugs/". At 1440 px the drugs table was 1,334 px wide in a 1,230 px card: the Approved header was clipped, the page scrolled sideways, the Approved cells read as grey ranges ("2007 to 2017") and Cancers wrapped six lines deep. Column minimum widths were the cause, in order of size: a facet chip for a long modality string such as "Fluorescence-guided surgery agent (protoporphyrin IX precursor)" (322 px, chips never wrap), the Phase / status chip with seven flags (249 px), the name cell (248 px) and the nowrap year range (116 px).

What changed, for every EntityBrowser table:

- `src/components/filters/ResultsTable.tsx`: the table sits in a `ScrollRow` (`fitClass="overflow-x-auto lg:overflow-x-visible"`): while it fits, the box is visible from lg so the header can stick to the viewport as before; measured wider than its card, the box becomes a sideways scroller with the edge fade and arrows, and the page never widens. `scroll` keeps the box scrolling at every width.
- `src/components/EntityBrowser.tsx`: list cells show `cap` linked names (column `cap`, default `LIST_CAP` = 3) and a "+N more" pill (a button with a plus glyph; its tooltip names the rest; pressing it shows every name inline). The name cell is bounded at 24 rem; facet chips in cells are capped at 11 rem with an ellipsis (the full label is in the tooltip). A `YearRange` cell value (`{ first, last?, regions?, facet? }`) prints the first year in the foreground weight, a muted "to <latest>" only when the years differ, a tooltip "First approval 2007, latest 2017" with the regions, and one small flag per region the row records (flags may drop to a second line, so the column is never wider than the years). Sorting stays numeric on `sortKeys` (the first year); `cellText` gives "2007 to 2017" for search and export. With `facet` (25 Sept 2026) the first year is also the control that filters the table by it; the range is not a facet value, so the muted "to <latest>" stays text.
- `src/components/ApprovalChip.tsx`: at most four flags inside the chip, then "+N"; the tooltip still names every region.
- `src/lib/kind-browser.ts`: drugs' Targets, Cancers and Companies columns take `cap: 2`; Approved is a `YearRange` with the regions from `approvals[]`. No other kind browser has a year range column (trials and papers show a single year; technologies show `since`).

Every kind index on the dev server at 1280 and 1440 px, headless Chrome with a classic 15 px scrollbar (`/tmp/drafts/onco-overflow/audit.mjs`, `WIDTHS=1280,1440`): table width against its card, and the deepest cell in lines of text, after the change. Before it only /drugs/ overflowed (1,334 px at both widths).

| Page | 1280: table / card | 1440: table / card | Deepest cell (lines) |
| --- | ---: | ---: | ---: |
| /cancers/ | 1,215 / 1,215 | 1,230 / 1,230 | 5 |
| /fronts/ | 1,215 / 1,215 | 1,230 / 1,230 | 4 |
| /technologies/ | 1,215 / 1,215 | 1,230 / 1,230 | 6 |
| /targets/ | 1,215 / 1,215 | 1,230 / 1,230 | 6 |
| /drugs/ | 1,215 / 1,215 (was 1,334) | 1,230 / 1,230 (was 1,334) | 9 (was 26) |
| /companies/ | 1,215 / 1,215 | 1,230 / 1,230 | 6 |
| /institutions/ | 1,215 / 1,215 | 1,230 / 1,230 | 5 |
| /pathways/ | 1,215 / 1,215 | 1,230 / 1,230 | 5 |
| /terms/ | 1,215 / 1,215 | 1,230 / 1,230 | 6 |
| /trials/ | 1,215 / 1,215 | 1,230 / 1,230 | 7 |
| /pairings/ | 1,215 / 1,215 | 1,230 / 1,230 | 7 |
| /roadmaps/ | 1,215 / 1,215 | 1,230 / 1,230 | 8 |
| /ideas/ | 1,215 / 1,215 | 1,230 / 1,230 | 10 |
| /collections/ | 1,215 / 1,215 | 1,230 / 1,230 | 7 |
| /people/ | 1,215 / 1,215 | 1,230 / 1,230 | 9 |
| /journals/ | 1,215 / 1,215 | 1,230 / 1,230 | 6 |
| /key-papers/ | 1,215 / 1,215 | 1,230 / 1,230 | 13 |
| /bottlenecks/ | 1,215 / 1,215 | 1,230 / 1,230 | 6 |

The deepest cells are the name column (a long name, its sub-line and the two-line TL;DR) and, on /key-papers/ and /ideas/, a long title; no list cell now runs past its cap. Not a table finding, fixed the same day: at exactly 1280 px with a classic scrollbar (Windows, Linux, headless Chrome) the site header itself was 37 px wider than the viewport on every page (it needed 1,326 px; the full navigation appears at xl, 1280 px, and a classic scrollbar leaves 1,263 to 1,265 px). Between xl and 2xl the header row now uses gap 1.5, the navigation labels are 13 px with `px-1`, and the GitHub star count folds into its icon (the count stays in the title and aria-label), as the region and language labels already did; the "Sign in/up" label stays. Measured after (`/tmp/drafts/onco-overflow/header.mjs`, headless Chrome, 15 px scrollbar): the header needs 1,215 px between xl and 2xl and fits a 1,263 px viewport with 48 px to spare; at 1440 (1,425 px) and 1024 (1,009 px, menu button) nothing overflows or wraps.

## Cells that filter (25 Sept 2026)

Owner: "clicking on the year in 'reported' will allow the table in trials and other ones to be filtered. look for other opportunities to allow filtering to occur by clicking on the specific unlink data eg 2026." A cell already becomes a filter when the row builder gives it a `FacetLink` (`{ facet, value, label?, tip? }`, the `fl()` helper in `src/lib/kind-browser.ts`); `EntityBrowser.facetChip` renders it as a chip that sets that facet, which is the same state a shared link carries (`/trials/?year=2025`). The survey counted the cells that print a value the table can facet on and did not do this.

Converted, with the facet each needed:

| Table | Cell | Filters by | New facet |
| --- | --- | --- | --- |
| /trials/ | Reported | the year, exactly | yes, `year` ("Reported"), 33 values, 1,252 dated trials of 5,935 |
| /drugs/ | Approved (first year of the range) | the first approval year | yes, `approved` ("First approval"), 72 values |
| /technologies/ | Since | the decade, printed as the year | yes, `era` ("First used"), 13 values |
| /machines/ | Since | the decade (the `era` facet it already had) | no |
| /coverage/uk/ | NICE, SMC, Year | outcome, verdict, appraisal year | `year` ("Appraisal year"), 24 values |
| /coverage/us/ | Medicare, Commercial | part, commercial pattern | no |
| /models/ | Year, Licence | the year; the licence family behind the SPDX id | no |
| /open-source/ | Maintainer, where it is not a record | the maintainer name | no |
| /software/ | Category, What it does, Vendor where it is not a record, Behind the row, Source kind | the category, the segment, the vendor name, whether the row is independently sourced, the kind of source | no |

Two rules came out of it. **Precision**: a year is an exact value and filters exactly; a range is not, so on /drugs/ only the first year of "2007 to 2017" is a control and the muted "to 2017" stays text (`YearRange.facet`). **Grain**: where a year is too fine to be a filter (technologies have 66 distinct years, twenty of them holding one record) the cell prints the year and sets the decade, `decadeLabel` in `src/lib/kinds.ts`, the one rule /machines/ and /technologies/ share. A chip now says what it will do with the value it sets rather than the label it prints, so "2020" says "Filter by First used: 2020s" and "Apache-2.0" says "Filter by Licence family: Permissive".

Left as text, and why: names, NCT numbers and Cellosaurus ids (unique to the row); impact factors, list prices, enrolment and every count (continuous or derived, one row per value); HQ city (510 values over 1,244 companies, 348 of them holding one company); a data source's cadence (free prose, 14 of 17 values held by one source); an assay's approval year (38 rows, six years holding one); a startup's latest round ("Series B 2024 · $50M" is three facts in one cell, and only the round name is a facet value); a regimen's setting and a collection's holds (prose, which would become a field of links); the `intent` facet on /regimens/ has no column to click at all. The `StaticTable` family (/evidence/, /countries/cn/, /universities/, /audit/, /pathway-drugs/, the modality hubs, the engine grids) filters from its column headers only: its cells are plain data with no setter in reach, so making them filters is a change to `FilterableTable`, not to a row builder, and is not in this round.

Cost, measured on the first page of each browser (markup bytes in `<tbody>` divided by rows): trials 3,980 to 4,254 bytes a row, drugs 4,053 to 4,379, technologies 2,584 to 2,806, papers unchanged at 3,866; a chip costs about 260 bytes. The heaviest row on the site is an idea at 5,169 bytes. `src/app/heavy-pages.test.ts` now holds every paged kind browser to a 6,500 byte row with the same 15 percent margin the roadmaps and dossiers use, so the next column turned into a filter has to be paid for knowingly. Pages outside that loop, measured the same day: /coverage/uk/ 2,134 to 2,915 bytes a row (three cells converted), /coverage/us/ 1,948 to 2,460, /models/ 2,814 to 3,263, /machines/ 4,503 to 4,668, /open-source/ 4,516 to 4,679.

`src/components/filter-cells.test.ts` is the guard that a filter link is never a dead end: over every templated table, every filtering cell names a facet the table has and a value the same row carries, and for the paged browsers the value is in the facet counts the page ships.

## On the shared header filter before this round

- src/components/filters/ResultsTable.tsx: the shared results table; header cell exported as `ColumnHead`. Filters: yes.
- src/components/EntityBrowser.tsx: every kind browser plus /assays/, /coverage/uk/, /coverage/us/, /data-sources/, /dossiers/, /investors/, /machines/, /models/, /open-questions/, /preclinical-models/, /regimens/, /startups/, InstitutionsExplorer, StartupRequestBoard. Filters: yes, URL-synced. Header filters on every facet column.
- src/components/RegulatoryBrowser.tsx (/regulatory/): dated regulatory events. Headers: Event, Region, Date (year).
- src/components/CasesByCountry.tsx (/cases/): GLOBOCAN country rows. Headers: Region, HDI.
- src/components/CentreTable.tsx (cancer pages, /centres/): linked centres. Header: Country (single).
- src/components/HtaTable.tsx (/hta/): HTA appraisals. Headers: Body, Verdict.
- src/components/PowerView.tsx (/power/): ranked objects for a cancer. Header: Phase / status.
- src/components/RegionMatrix.tsx (/regulatory/regions/): products by region. Header: Modality (single).
- src/components/SideEffectLookup.tsx (/side-effects/): side effects by symptom. Header: Treatment.
- src/components/SponsorBoard.tsx (/sponsors/): trial sponsors. Header: Top cancers (single).
- src/components/ToxicityBrowser.tsx (/toxicity/): adverse events by class. Headers: Adverse event, Product.

## Group 1: server-rendered tables now on StaticTable

- src/app/deals/page.tsx (64 deals): one table replaces the per-year sections. Headers: Year, From region, To region, Type; Date, Upfront and Total sort (amounts parsed to a number, currencies treated alike). URL-synced.
- src/app/evidence/page.tsx (3,527 trials): Phase, Result, Strength filter; rank, Enrolled and Score sort. URL-synced. Paged: the first 30 rows in the HTML, the rest in /api/v1/tables/evidence.json (rows built in src/lib/tables/evidence.ts).
- src/app/funding/page.tsx (11 funders): the four type sections became one table. Headers: Type, Country, Year; Year sorts. URL-synced.
- src/app/universities/page.tsx, corpus score table (269 universities): Country filters; rank, Centres, Linked objects, Score sort. Logo drawn through `avatar`. (The OpenAlex output tables above it are ResearchRanking: see group 3.)
- src/app/payloads/page.tsx, payloads (11): Class, Bystander, Efflux substrate filter; DAR sorts. URL-synced. Linkers (9 rows): plain table, skipped.
- src/app/costs/page.tsx, all ideas (29): Who acts, Cost to try, Evidence so far filter; Years sorts. URL-synced. The per-driver cards above are not tables.
- src/app/status/page.tsx, feeds (19): State and Runs (automatically or by hand) filter; Fetched, Age, Count sort. URL-synced. Schedules (9 rows): plain, skipped.
- src/app/freshness/page.tsx: SLAs (13): Track and Critical filter; Max age, Checked, Past due sort; URL-synced. Past due (0 to 120 rows, rendered when anything is overdue): Critical, Kind, SLA filter; Last checked and Days over sort. By review track (5 rows): plain, skipped.
- src/app/eval/page.tsx, the questions (100): Category, Level, Outcome (all met, partly, missed, not scored) filter; Level and OnCo score sort. Expected answer moved to the row's second line and the rubric to its tooltip. URL-synced. Leaderboard (3 runs): plain, skipped.
- src/app/survival/page.tsx (36 cancers): Staged and Period filter; 5-year survival (with its bar) and the three stage columns sort. URL-synced.
- src/components/CitedPapers.tsx (/papers/, 25 rows): Journal and Year filter; rank, Citations and the two recent years sort; by-year bars kept through `bars`.
- src/components/PapersPulse.tsx `PulseTable` (/papers/, 15 to 30 rows per table): Kind (when the table mixes kinds) and Trend (growing, flat, shrinking) filter; counts and Change sort; yearly bars kept.
- src/app/startups/page.tsx, most active investors (64, first 25 shown, Show all): Type and Country filter; rank and Portfolio sort; logo through `avatar`. The startups browser itself is EntityBrowser.
- src/app/audit/page.tsx: per-check findings tables (up to 150 rows each, inside the details cards): Kind filters. Registry fact checks (237): Severity and Check filter, URL-synced. Proposed patches (116): Field filters. Broken links (150 of 1,975): Status and Archive filter. Staleness (80): Kind filters, Days sorts. Redirected links (moved, inside a details card): plain, skipped (no categorical column).
- src/app/review/page.tsx: where models disagree (21): Kind and Panel (split or agree) filter; Models, Disagreements, Latest sort. Human coverage by kind (13): Tracks needed filters; counts sort. The human queue (top 50): Kind and Needs filter; Score, Links, Evidence, Age sort; URL-synced. Model panel (2 rows) and Translations (8 rows): plain, skipped.
- src/app/countries/cn/page.tsx: key trials (851): Phase, Status, Year filter (Phase and Status are new columns); Year sorts; URL-synced. Out-licensing and acquisitions (27): Year and Type filter; Date sorts.
- src/app/countries/in/page.tsx, leading cancers (12): no categorical column; every figure sorts.
- src/app/pathway-drugs/page.tsx, pathways (108): Gap (undrugged nodes, fully drugged, no druggable node) filters; every count sorts and keeps its deep link. URL-synced. Per-pathway node tables (108 tables of at most 16 rows): plain, skipped (108 hydrated tables for a column that rarely has more than two values).
- src/components/Dossier.tsx, trials (per target, up to several hundred): Phase and Status filter. Products by modality (a matrix), companion diagnostics and cell lines (a few rows): plain.

## Group 1: skipped (fewer than ten rows everywhere, or not a data table)

- src/app/contributors/page.tsx: 4 contributors today.
- src/app/reviewers/page.tsx: roster empty today (the table only renders once someone has signed off).
- src/app/idea-votes/page.tsx: no idea has a vote yet, so the table does not render.
- src/app/coverage/rankings/page.tsx: list prices (4), UK routes (5), nine countries (9). PlanRankings on the same page: see group 2.
- src/components/HotspotPlot.tsx: at most 7 residues per gene.
- src/components/InvestorPanels.tsx `DealsPanel`: at most 6 deals per company.
- src/components/PrevalenceTable.tsx: at most 7 cancers per target; `CancerPrevalence` per cancer likewise small.
- src/components/AccessTable.tsx: at most 3 countries per product.
- src/components/EntityDetail.tsx approvals: at most 7 per product; papers on record pages: small per-record lists.
- src/components/ResearchOutput.tsx, src/components/StartupPanels.tsx, src/components/TrialLeadership.tsx: per-record panels with few rows; not in this round's list.
- src/components/CompletenessTable.tsx (one row per kind), src/components/CountryCasesMini.tsx (two side-by-side minis), src/components/Pictogram.tsx (per-trial figure).

## Group 2: client tables with their own controls, now also filtering from the header

The header shares state with the existing control where one exists (same setter, so both move together); new header-only filters use `useHeaderFilters` (`src/components/filters/useHeaderFilters.ts`) and `FilterHead` (`src/components/filters/ResultsTable.tsx`). Existing controls stay.

- src/components/TrialFinder.tsx (live ClinicalTrials.gov list): Phase and Sponsor headers; a count and Clear line appears when a header filter is active.
- src/components/TrialFinderGeo.tsx: Phase and Sponsor headers; the Sites header carries the Country filter (single) shared with the toolbar's FacetSelect and, until the next search, narrows the loaded studies to those with a site in that country.
- src/components/AssistanceBrowser.tsx: Product and Country headers share the toolbar state; Manufacturer programme (recorded or not) and Generic (yes, no, not recorded) are header-only. Clear resets all.
- src/components/GuidelineConcordance.tsx: the first column (now "Cancer and setting") filters by cancer, shared with the Cancer facet; each body column filters by that body's stance (including "No entry"); Verdict shares the Verdict facet. The body-website link left the header tip (a link inside a header button would nest interactive content) and sits in each row's cell as a small external-link glyph beside the stance chip (tooltip "Open the body's website", Tab-reachable); the stance chips still link to their sources.
- src/components/ManufacturingMap.tsx: Site filters by country (header-only); Operator filters by ownership and Capabilities by capability, both shared with the toolbar facets. Reset clears all.
- src/app/interactions/InteractionChecker.tsx: Severity and Pair (either drug of the pair) headers on the flagged-pairs table; an empty-state line with Clear when nothing passes.
- src/components/AutoPulse.tsx: Date filters by month, Names by the OnCo object named (header-only); Source shares the toolbar facet. Clear resets all.
- src/components/SurvivorshipPlan.tsx: one "Watch for" header filter (the treatment class that raised the effect) shared by every organ-system table; systems with nothing left are hidden and the count line reads N of M.
- src/components/MarketEstimator.tsx: "Prevalence as recorded" filters by measure (of tumours, IHC 3+, not stated).
- src/components/TumorBoard.tsx: Status and "Matched on" (biomarker hit) headers shared by every kind's table; a kind whose rows are all hidden disappears; a Clear link sits by the match count.
- src/components/Navigator.tsx: Option (products or technologies), Phase / status and "Why it ranks" (each scoring reason) headers on the ranked options; the heading count reads N of M when a filter is active.
- src/components/PlanRankings.tsx: "Plan or insurer" filters by kind; the chosen metric's header filters by whether a figure is published. Rank numbers stay those of the full ranking.
- src/components/CaregiverPanel.tsx: skipped. The per-treatment toxicity tables show at most eight rows and have no categorical column.

## Group 3: ResultsTable users whose toolbar facet had no column

- src/components/CountryRanking.tsx (/research/countries/): a Region column (hidden under md) carries the Region facet's filter with counts; the toolbar facet stays and both share one state.
- src/components/ScorecardTable.tsx (/scorecard/): Type and Country columns (hidden under lg; the same text stays under the company name on small screens) carry the Type and Country facets, and their cells are chips that select exactly that value; the Regions column filters from its header (header-only, "None" for companies with no approved region). A Clear link resets all three.
- src/components/PipelineFunnel.tsx (/pipeline/ crowding index): Approved filters by whether the target has an approved product; Crowding index filters by population completeness (complete, partial, no estimate).
- src/components/ResearchRanking.tsx (/universities/ OpenAlex tables): in institution mode the Institution header filters by parent university; the five-year works column filters by whether the institution is in the five-year index. The university-mode table has no categorical column.

## Left alone

- Matrices: src/components/BiomarkerMatrix.tsx, src/components/PrevalenceMatrix.tsx, src/components/DealFlow.tsx, src/components/PivotTable.tsx.
- src/components/CompareView.tsx (transposed), src/components/CommandPalette.tsx (search results), src/components/SavedViews.tsx (personal list), src/components/SlideDeck.tsx, src/components/QueryBuilder.tsx (the clauses are the filter), src/app/irae/IraeGuide.tsx (guide layout).
- Static reference or form tables: src/app/api/page.tsx, src/app/build/page.tsx, src/app/cancers/[id]/decisions/page.tsx, src/app/history/page.tsx, src/app/live/hair/page.tsx, src/app/privacy/page.tsx, src/app/regimens/[id]/page.tsx, src/app/report/2026/page.tsx, src/app/schema/page.tsx, src/app/sequencing/[id]/page.tsx, src/app/staging/page.tsx, src/app/startup-requests/page.tsx.
- src/app/tumour-testing/page.tsx: another agent's redesign.
