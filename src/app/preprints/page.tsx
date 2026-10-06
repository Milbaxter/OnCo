import type { Metadata } from "next";
import Link from "next/link";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pageMeta } from "@/lib/seo";
import { graph } from "@/lib/graph";
import { KIND_META, routeFor, type Kind } from "@/lib/schema";
import { paperQuery, searchPageUrl } from "@/lib/europepmc";
import { Container, GroupKicker, PageHeader } from "@/components/ui";
import { LatestPapers } from "@/components/LatestPapers";
import { Tip } from "@/components/Tip";
import { literatureDates, literatureDateLabel } from "@/lib/literature-dates";

export const metadata: Metadata = pageMeta({ title: "Preprint tracker", description: "bioRxiv, medRxiv and other preprints from the last 90 days for every target, product and technology, refreshed weekly from Europe PMC, with the ones that have since appeared as journal articles.", path: "/preprints/" });

type Preprint = { id: string; doi?: string; title: string; authors?: string; publisher?: string; date?: string; published?: { doi?: string; pmid?: string; journal?: string; date?: string; title?: string }; entityIds: string[] };
type PublishedVersion = { pprId: string; doi?: string; pmid?: string; journal?: string; date?: string; title: string; authors?: string; entityIds: string[] };
type PreprintIndex = { fetched: string; windowDays: number; source: string; entities: Record<string, { kind: string; name: string; count: number; published: number }>; items: Preprint[]; published: PublishedVersion[] };

function readIndex(): PreprintIndex | null {
  const p = join(process.cwd(), "public", "preprints", "index.json");
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")) as PreprintIndex; } catch { return null; }
}

const link = (p: Preprint) => p.doi ? `https://doi.org/${p.doi}` : `https://europepmc.org/article/PPR/${p.id}`;
const firstAuthor = (a?: string) => a ? (a.includes(",") ? `${a.split(",")[0].trim()} et al.` : a) : "";
const KIND_LABEL: Record<string, string> = { target: "Targets", drug: "Products", technology: "Technologies" };
const LIVE_TOPICS = ["kras", "her2", "trop2", "adc", "car-t", "pathology-foundation-model"];

function PreprintRow({ p, g }: { p: Preprint; g: ReturnType<typeof graph> }) {
  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
        <a href={link(p)} rel="noopener" className="font-medium hover:underline leading-snug">{p.title}</a>
        <span className="chip bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200 text-[11px]">preprint</span>
        {p.published && <Tip title="Now published" text={`${p.published.journal ?? "Journal article"}${p.published.date ? `, ${p.published.date}` : ""}. Linked by Europe PMC to this preprint.`}><a href={p.published.doi ? `https://doi.org/${p.published.doi}` : p.published.pmid ? `https://europepmc.org/article/MED/${p.published.pmid}` : link(p)} rel="noopener" className="chip bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200 text-[11px]">now in {p.published.journal ?? "a journal"}</a></Tip>}
      </div>
      <div className="text-xs text-muted mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
        {p.date && <span>{p.date}</span>}
        {p.publisher && <span>· {p.publisher}</span>}
        {p.authors && <span>· {firstAuthor(p.authors)}</span>}
        <span className="inline-flex flex-wrap gap-1 ml-1">{p.entityIds.map((id) => { const e = g.get(id); return e ? <Link key={id} href={e.kind === "target" ? `/dossiers/${e.id}/` : routeFor(e)} className="chip border bg-card border-border hover:bg-foreground/5 text-[11px]">{e.name.split(" (")[0]}</Link> : null; })}</span>
      </div>
    </li>
  );
}

export default function PreprintsPage() {
  const g = graph();
  const index = readIndex();
  const items = index?.items ?? [];
  const published = index?.published ?? [];
  const byKind = (kind: string) => Object.entries(index?.entities ?? {}).filter(([, e]) => e.kind === kind && e.count > 0).sort((a, b) => b[1].count - a[1].count).slice(0, 12);
  const active = Object.values(index?.entities ?? {}).filter((e) => e.count > 0).length;
  const totalTopics = g.entities.filter((e) => ["target", "drug", "technology"].includes(e.kind) && paperQuery(e as never)).length;
  const partial = !!index && Object.keys(index.entities).length < totalTopics;

  return (
    <>
      <PageHeader kicker={<GroupKicker id="intel" />} title="Preprint tracker"
        lede="Targets move first in preprints. Every week we ask Europe PMC for the bioRxiv, medRxiv and other preprints of the last 90 days that match each target, product and technology, and we check which of them have since appeared as journal articles. Preprints have not been peer reviewed: read them as claims, not findings." />
      <Container className="pb-16 space-y-10">
        <div className="card p-4 text-sm border-violet-300/60 dark:border-violet-700/60 max-w-3xl">
          <div className="kicker mb-1">Not peer-reviewed</div>
          <p className="text-muted">Everything on this page is a preprint unless marked &ldquo;now in&rdquo; a journal. Methods, statistics and claims have not been checked by reviewers or editors; some will change and a few will be withdrawn. Nothing here is a treatment recommendation.</p>
        </div>

        {!index && (
          <>
            <p className="card p-4 text-sm text-muted">The weekly preprint snapshot is not part of this build yet; it appears after the next refresh. Until then, live preprint feeds for a few of the most active topics are below, and every target, product and technology page has its own under &ldquo;Latest papers&rdquo;.</p>
            <div className="grid gap-4 lg:grid-cols-2">
              {LIVE_TOPICS.map((id) => { const e = g.get(id); const q = e ? paperQuery(e as never) : undefined; return e && q ? <div key={id}><div className="kicker mb-1.5"><Link className="hover:underline" href={routeFor(e)}>{e.name}</Link></div><LatestPapers query={`(${q}) AND SRC:PPR`} title={e.name} kind={e.kind} pageSize={6} /></div> : null; })}
            </div>
          </>
        )}

        {index && (
          <>
            <div className="text-sm text-muted flex flex-wrap gap-x-4 gap-y-1">
              <span>Topic data retrieved: <b className="text-foreground">{literatureDateLabel(literatureDates("preprints", index.entities))}</b></span>
              <span>Snapshot run: <b className="text-foreground">{index.fetched}</b></span>
              <span>Window: last <b className="text-foreground">{index.windowDays} days</b></span>
              <span>Preprints: <b className="text-foreground">{items.length.toLocaleString("en-GB")}</b></span>
              <span>Since published: <b className="text-foreground">{published.length.toLocaleString("en-GB")}</b></span>
              <span>Topics covered so far: <b className="text-foreground">{Object.keys(index.entities).length.toLocaleString("en-GB")}</b> of {totalTopics.toLocaleString("en-GB")} ({active.toLocaleString("en-GB")} with a preprint in the window)</span>
              <span>Source: {index.source}</span>
              <span>Refreshed weekly; schedule on <Link className="underline" href="/status/">when each feed last ran</Link></span>
            </div>

            {partial && <p className="card p-4 text-sm text-muted max-w-3xl">Coverage is partial: {Object.keys(index.entities).length.toLocaleString("en-GB")} of {totalTopics.toLocaleString("en-GB")} targets, products and technologies have been fetched so far. The weekly workflow resumes from this snapshot and completes the rest; topics not yet covered still have a live preprint feed on their own pages under &ldquo;Latest papers&rdquo;.</p>}

            <section id="sec-active" className="space-y-3">
              <h2 className="text-xl font-semibold">Most active topics</h2>
              <p className="text-sm text-muted">Preprints in the window that matched each object&apos;s literature query. Counts overlap: one preprint can match a target and its drug.</p>
              <div className="grid gap-4 md:grid-cols-3">
                {(["target", "drug", "technology"] as const).map((kind) => (
                  <div key={kind} className="card p-4">
                    <div className="kicker mb-2">{KIND_LABEL[kind]}</div>
                    <ol className="space-y-1 text-sm">
                      {byKind(kind).map(([id, e]) => { const ent = g.get(id); return (
                        <li key={id} className="flex items-baseline justify-between gap-2">
                          <a href={`#${id}`} className="hover:underline truncate">{e.name.split(" (")[0]}</a>
                          <span className="tabular-nums text-muted whitespace-nowrap">{e.count}{e.published ? <span className="text-emerald-700 dark:text-emerald-300"> · {e.published} published</span> : ""}{ent && <Link href={ent.kind === "target" ? `/dossiers/${ent.id}/` : routeFor(ent)} className="ml-1 text-xs underline">page</Link>}</span>
                        </li>); })}
                    </ol>
                  </div>
                ))}
              </div>
            </section>

            {published.length > 0 && (
              <section id="sec-published" className="space-y-3">
                <h2 className="text-xl font-semibold">Now published</h2>
                <p className="text-sm text-muted">Journal articles from the last 18 months that Europe PMC links back to a preprint on one of these topics. The journal version is the one to cite; the preprint shows how the claim started.</p>
                <ol className="card px-4 divide-y divide-border">{published.slice(0, 80).map((p) => (
                  <li key={p.pprId} className="py-2.5">
                    <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
                      <a href={p.doi ? `https://doi.org/${p.doi}` : p.pmid ? `https://europepmc.org/article/MED/${p.pmid}` : `https://europepmc.org/article/PPR/${p.pprId}`} rel="noopener" className="font-medium hover:underline leading-snug">{p.title}</a>
                      <span className="chip bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200 text-[11px]">published</span>
                    </div>
                    <div className="text-xs text-muted mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
                      {p.date && <span>{p.date}</span>}{p.journal && <span>· {p.journal}</span>}{p.authors && <span>· {firstAuthor(p.authors)}</span>}
                      <a className="underline" href={`https://europepmc.org/article/PPR/${p.pprId}`} rel="noopener">preprint version</a>
                      <span className="inline-flex flex-wrap gap-1 ml-1">{p.entityIds.map((id) => { const e = g.get(id); return e ? <Link key={id} href={e.kind === "target" ? `/dossiers/${e.id}/` : routeFor(e)} className="chip border bg-card border-border hover:bg-foreground/5 text-[11px]">{e.name.split(" (")[0]}</Link> : null; })}</span>
                    </div>
                  </li>
                ))}</ol>
              </section>
            )}

            <section id="sec-latest" className="space-y-3">
              <h2 className="text-xl font-semibold">Latest preprints, all topics</h2>
              <ol className="card px-4 divide-y divide-border">{items.slice(0, 150).map((p) => <PreprintRow key={p.id} p={p} g={g} />)}</ol>
              {items.length > 150 && <p className="text-xs text-muted">Showing the 150 most recent of {items.length.toLocaleString("en-GB")}; the per-topic sections below list the rest.</p>}
            </section>

            <section id="sec-by-topic" className="space-y-6">
              <h2 className="text-xl font-semibold">By topic</h2>
              {(["target", "drug", "technology"] as const).map((kind) => {
                const ents = Object.entries(index.entities).filter(([, e]) => e.kind === kind && e.count > 0).sort((a, b) => a[1].name.localeCompare(b[1].name));
                if (!ents.length) return null;
                return (
                  <div key={kind}>
                    <h3 className="font-semibold mb-2">{KIND_LABEL[kind]} · {ents.length}</h3>
                    <div className="space-y-2">
                      {ents.map(([id, e]) => {
                        const ent = g.get(id);
                        const list = items.filter((p) => p.entityIds.includes(id)).slice(0, 8);
                        return (
                          <details key={id} id={id} className="card px-4 py-2 scroll-mt-28">
                            <summary className="cursor-pointer text-sm flex items-baseline justify-between gap-3"><span className="font-medium">{e.name}</span><span className="text-muted tabular-nums whitespace-nowrap">{e.count} preprint{e.count === 1 ? "" : "s"}{e.published ? ` · ${e.published} published` : ""}</span></summary>
                            <ol className="divide-y divide-border mt-1">{list.map((p) => <PreprintRow key={p.id} p={p} g={g} />)}</ol>
                            <div className="text-xs text-muted py-2 flex flex-wrap gap-x-3">
                              {ent && <Link className="underline" href={ent.kind === "target" ? `/dossiers/${ent.id}/` : routeFor(ent)}>{KIND_META[ent.kind as Kind].label} page</Link>}
                              {ent && paperQuery(ent as never) && <a className="underline" href={searchPageUrl(`(${paperQuery(ent as never)}) AND SRC:PPR`)} rel="noopener">All preprints in Europe PMC</a>}
                            </div>
                          </details>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </section>
          </>
        )}

        <section id="sec-method" className="card p-5 text-sm space-y-2">
          <h2 className="text-lg font-semibold">Method and caveats</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Queries are the same title-and-abstract searches used for &ldquo;Latest papers&rdquo; on each object page, restricted to Europe PMC&apos;s preprint source (bioRxiv, medRxiv, Research Square, SSRN, Preprints.org and others) and to the last {index?.windowDays ?? 90} days by first publication date.</li>
            <li>&ldquo;Now published&rdquo; uses Europe PMC&apos;s preprint-to-article links, which come from Crossref relations and title matching; some links are missed and a few are wrong, so check the journal version.</li>
            <li>Counts are search hits, not curated relevance; a name collision (a short gene symbol, a common word) inflates them.</li>
            <li>Preprints are not peer reviewed and are not evidence for treatment decisions. Related: <Link className="underline" href="/papers/">what the world is publishing</Link>, <Link className="underline" href="/key-papers/">key papers</Link>.</li>
          </ul>
        </section>
      </Container>
    </>
  );
}
