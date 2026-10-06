import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";
import { Container, GroupKicker, PageHeader } from "@/components/ui";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { BreadcrumbJsonLd, WebPageJsonLd } from "@/components/JsonLd";
import { FormatGlyph, HUB_SECTION_GLYPH } from "@/components/FormatGlyph";
import { Tip } from "@/components/Tip";
import { StaticTable } from "@/components/filters/StaticTable";
import { modalityHub, MATURITY_LABEL, type ModalityHub, type Ref } from "@/lib/modalities";
import { MODALITY_COLUMNS, modalityRows } from "@/lib/tables/modalities";
import { pageRows } from "@/lib/static-tables";
import { FORMATS, formatById, modalityRoute, modalityTableId, STATE_META, type ModalityTable } from "@/lib/modular-formats";
import { KIND_META } from "@/lib/kinds";
import { CATEGORY_BY_ID } from "@/lib/resistance-categories";
import type { MechanismCategory } from "@/lib/resistance-categories";

export function generateStaticParams() {
  return FORMATS.map((f) => ({ format: f.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ format: string }> }): Promise<Metadata> {
  const { format } = await params;
  const def = formatById(format);
  if (!def) return {};
  return pageMeta({ title: `${def.name}: modality hub`, description: `Everything OnCo records about ${def.name.toLowerCase()}: how they work, the approved medicines with their cancers and years, the medicines in phase 3, the parts, the companies most active, the trials recruiting, the side-effect profile, resistance, key papers, roadmap eras, open questions and manufacturing, each section naming its records.`, path: modalityRoute(def.id) });
}

const n = (x: number) => x.toLocaleString("en-GB");
const short = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
const SIDEBAR_MAX = 10;
const COMPANIES_MAX = 20;
const EMPTY = "text-sm text-muted";

type SectionId = keyof typeof HUB_SECTION_GLYPH;
const SECTIONS: Array<{ id: SectionId; label: string }> = [
  { id: "how", label: "How it works" }, { id: "engine", label: "Engine grid" }, { id: "approved", label: "Approved" }, { id: "phase3", label: "Phase 3" }, { id: "parts", label: "The parts" },
  { id: "companies", label: "Companies" }, { id: "trials", label: "Trials recruiting" }, { id: "sideEffects", label: "Side effects" }, { id: "resistance", label: "Resistance" },
  { id: "papers", label: "Key papers" }, { id: "eras", label: "Roadmap eras" }, { id: "ideas", label: "Open questions" }, { id: "manufacturing", label: "Manufacturing" },
];

function Icon({ id, className = "h-4 w-4" }: { id: SectionId; className?: string }) {
  return <FormatGlyph glyph={HUB_SECTION_GLYPH[id]} className={className} />;
}

/** A pill to a record, with its kind in the tooltip. */
function RefPill({ r, className = "" }: { r: Ref; className?: string }) {
  return <Link href={r.route} className={`chip border border-border bg-card text-xs hover:bg-accent-soft hover:text-accent hover:border-accent ${className}`} title={`${KIND_META[r.kind].label}: ${r.name}`}>{r.name}</Link>;
}

/** "From these records" line under a section heading: the ids a section was read from, as pills. */
function From({ refs, note, max = 8 }: { refs: Ref[]; note: string; max?: number }) {
  const shown = refs.slice(0, max);
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted mb-3">
      <span title={note} className="underline decoration-dotted cursor-help">From {refs.length === 0 ? "no record yet" : `${n(refs.length)} record${refs.length === 1 ? "" : "s"}`}:</span>
      {shown.map((r) => <RefPill key={`${r.kind}-${r.id}`} r={r} />)}
      {refs.length > shown.length && <span>and {n(refs.length - shown.length)} more in the JSON</span>}
    </p>
  );
}

function Section({ id, title, aside, children }: { id: SectionId; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="mt-12 scroll-mt-24">
      <div className="flex items-baseline justify-between gap-4 mb-3 flex-wrap">
        <h2 className="text-lg font-semibold tracking-tight inline-flex items-center gap-2"><span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft text-accent"><Icon id={id} /></span>{title}</h2>
        {aside && <span className="text-xs text-muted">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function Table({ h, table, noun, empty }: { h: ModalityHub; table: ModalityTable; noun: string; empty: string }) {
  const rows = modalityRows(h, table);
  if (!rows.length) return <p className={EMPTY}>{empty}</p>;
  const paged = pageRows(modalityTableId(h.format.id, table), rows);
  return <div id={`${table}-table`}><StaticTable rows={paged.rows} more={paged.more} columns={MODALITY_COLUMNS[table]} noun={noun} url urlScope={table} /></div>;
}

export default async function ModalityPage({ params }: { params: Promise<{ format: string }> }) {
  const { format } = await params;
  const h = modalityHub(format);
  if (!h) notFound();
  const def = h.format;
  const crumbs = [{ label: "Home", href: "/" }, { label: "Pipeline funnel", href: "/pipeline/" }, { label: "Medicine types", href: modalityRoute() }, { label: def.name, href: h.route }];
  const description = `Everything OnCo records about ${def.name.toLowerCase()}, each section naming its records.`;
  const drugRefs = h.drugs;
  const techRefs: Ref[] = h.how.technologies.map(({ id, kind, name, route }) => ({ id, kind, name, route }));
  const members = [...techRefs, ...drugRefs];
  const c = h.counts;

  return (
    <>
      <BreadcrumbJsonLd items={crumbs} />
      <WebPageJsonLd path={h.route} name={`${def.name}: modality hub`} description={description} />
      <Breadcrumbs items={crumbs} />
      <PageHeader kicker={<GroupKicker id="intel"><Link href={modalityRoute()} className="kicker hover:underline">· Modalities</Link></GroupKicker>} title={def.name}
        logo={<span className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-soft text-accent"><FormatGlyph glyph={def.glyph} className="h-8 w-8" /></span>}
        lede={`${def.blurb} The corpus holds ${n(c.drugs)} ${def.name.toLowerCase()} medicine${c.drugs === 1 ? "" : "s"}: ${n(c.approved)} approved, ${n(c.phase3)} in phase 3, ${n(c.trials)} trial${c.trials === 1 ? "" : "s"} recruiting, ${n(c.companies)} compan${c.companies === 1 ? "y" : "ies"} named. Every section below says which records it was read from.`}
        right={<div className="flex flex-wrap gap-2 justify-end"><a href={h.file} className="chip border bg-card border-border hover:bg-foreground/5 text-sm" title="This hub as one JSON file: every section with the record ids behind it">JSON for agents</a><Link href={h.engine.route} className="chip border bg-card border-border hover:bg-foreground/5 text-sm" title="This format in the open drug engine: its parts and the grid of every combination">Engine grid →</Link><Link href={modalityRoute()} className="chip border bg-card border-border hover:bg-foreground/5 text-sm">All modalities →</Link></div>} />
      <Container className="pb-16">
        <div className="flex flex-wrap gap-1.5 mb-6 text-xs">
          {FORMATS.map((x) => <Link key={x.id} href={modalityRoute(x.id)} className={`chip border inline-flex items-center gap-1 ${x.id === def.id ? "bg-accent-solid text-accent-fg border-accent-solid" : "border-border bg-card hover:bg-accent-soft hover:text-accent hover:border-accent"}`} aria-current={x.id === def.id ? "page" : undefined} title={x.blurb}><FormatGlyph glyph={x.glyph} className="h-3 w-3" />{x.name}</Link>)}
        </div>
        <nav aria-label="Sections" data-tabbar className="flex flex-wrap gap-1.5 text-sm sticky top-14 z-10 py-2 -mx-1 px-1 bg-background/90 backdrop-blur">
          {SECTIONS.map((s) => {
            const count = s.id === "approved" ? c.approved : s.id === "phase3" ? c.phase3 : s.id === "trials" ? c.trials : s.id === "companies" ? c.companies : s.id === "papers" ? c.papers : s.id === "ideas" ? c.ideas : s.id === "eras" ? c.eras : s.id === "resistance" ? h.resistance.length : s.id === "sideEffects" ? h.sideEffects.terms.length + h.sideEffects.events.length : s.id === "manufacturing" ? h.manufacturing.sites.length + h.manufacturing.technologies.length : s.id === "parts" ? h.components.reduce((k, g) => k + g.values.length, 0) : undefined;
            return <a key={s.id} href={`#${s.id}`} className="chip border bg-card border-border hover:bg-foreground/5 inline-flex items-center gap-1.5"><Icon id={s.id} className="h-3.5 w-3.5 text-accent" /><span>{s.label}</span>{count !== undefined && <span className="text-muted tabular-nums">{n(count)}</span>}</a>;
          })}
        </nav>

        <Section id="how" title="How it works" aside={h.how.technologies.length ? `${n(h.how.technologies.length)} technology record${h.how.technologies.length === 1 ? "" : "s"} describe this format` : undefined}>
          <From refs={h.how.from} note="The technology record whose TL;DR and principle are quoted below, word for word." />
          {h.how.paragraphs.length === 0 ? <p className={EMPTY}>No technology record in the corpus describes this format yet; the one-line description above is the engine&apos;s own.</p> : (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-3 text-[15px] leading-relaxed max-w-3xl">
                {h.how.paragraphs.map((p, i) => <p key={i} className={i === 0 ? "" : "text-muted"}>{p}</p>)}
                {h.terms.length > 0 && (
                  <p className="flex flex-wrap items-center gap-1.5 text-xs pt-1">
                    <span className="kicker mr-1">Terms</span>
                    {h.terms.map((t) => <Tip key={t.id} title={t.name} text={t.tldr} href={t.route}><Link href={t.route} className="chip border border-border bg-card hover:bg-accent-soft hover:text-accent hover:border-accent">{t.name}</Link></Tip>)}
                  </p>
                )}
              </div>
              <div className="card p-4 text-sm">
                <h3 className="font-medium mb-2">Technology records of this format</h3>
                <ul className="space-y-1.5">
                  {h.how.technologies.map((t) => (
                    <li key={t.id} className="flex items-start justify-between gap-2 text-xs">
                      <Tip title={t.name} text={t.tldr} href={t.route}><Link href={t.route} className="hover:underline">{t.name}</Link></Tip>
                      {t.status && <span className="chip border border-border bg-card text-[11px] shrink-0">{t.status.replace(/-/g, " ")}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </Section>

        <Section id="engine" title="Engine grid" aside={<>{n(h.engine.placed)} of {n(h.engine.total)} medicines placed on the grid ({h.engine.pct}%)</>}>
          <From refs={drugRefs} note="The drug records the open drug engine files under this format, placed on its grid or listed as unresolved." />
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-5 text-xs">
            {(["approved", "development", "stopped", "unclear", "untried"] as const).map((s) => (
              <Link key={s} href={s === "untried" ? h.engine.route : `${h.engine.route}?state=${encodeURIComponent(STATE_META[s].label)}`} className={`chip ${STATE_META[s].chip} justify-between hover:ring-2 hover:ring-accent/30`} title={STATE_META[s].tip}>
                <span className="flex items-center gap-1.5"><span aria-hidden className={`inline-block h-2.5 w-2.5 rounded-sm ${STATE_META[s].swatch}`} />{STATE_META[s].label}</span>
                <span className="tabular-nums font-medium">{n(h.engine.counts[s])}</span>
              </Link>
            ))}
          </div>
          <p className="text-xs text-muted mt-2">{h.engine.axes[0]} against {h.engine.axes[1].toLowerCase()}, {n(h.engine.rows)} by {n(h.engine.cols)}. <Link href={h.engine.route} className="underline">Open the grid</Link>, where every cell links to its medicines and the records behind its state.</p>
        </Section>

        <Section id="approved" title="Approved medicines" aside={<>{n(c.approved)} medicine{c.approved === 1 ? "" : "s"} with an approval row or an approved status</>}>
          <From refs={h.approved.map((a) => a.drug)} note="Drug records with at least one approval row (region, year, indication) or a status of approved, established or standard of care; cancers and years are the record's own." />
          <Table h={h} table="approved" noun="medicines" empty="No medicine of this format has an approval row in the corpus." />
        </Section>

        <Section id="phase3" title="In phase 3" aside={<>{n(c.phase3)} medicine{c.phase3 === 1 ? "" : "s"} not yet approved</>}>
          <From refs={h.phase3.map((p) => p.drug)} note="Drug records with a phase-3 status, or named by a trial record of phase 3 or 2/3 that is recruiting, active or planned, and with no approval row." />
          <Table h={h} table="phase3" noun="medicines" empty="No medicine of this format is recorded in phase 3." />
        </Section>

        <Section id="parts" title="The parts" aside={<>{n(h.components.reduce((k, g) => k + g.values.length, 0))} distinct values across {h.components.length} component{h.components.length === 1 ? "" : "s"}</>}>
          <From refs={drugRefs} note="Read by the open drug engine from each medicine's record: its targets, payload, linker, isotope, costimulatory domain or E3 ligase fields, the payload registry and the INN stem of its name." />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {h.components.map((grp) => (
              <div key={grp.key} className="card p-4 text-sm">
                <h3 className="font-medium flex items-baseline justify-between gap-2">{grp.label} <span className="text-xs text-muted tabular-nums">{n(grp.values.length)} value{grp.values.length === 1 ? "" : "s"}</span></h3>
                {grp.values.length === 0 ? <p className="text-xs text-muted mt-1">Not recorded for any medicine in this format.</p> : (
                  <ul className="mt-2 space-y-1">
                    {grp.values.slice(0, SIDEBAR_MAX).map((v) => (
                      <li key={v.id} className="flex items-center justify-between gap-2 text-xs">
                        <span className="min-w-0 truncate">{v.href ? <Link href={v.href} className="hover:underline" title={`${v.name}: its own page`}>{v.name}</Link> : <span title={`${v.name}: no page of its own`}>{v.name}</span>}</span>
                        <Link href={`${h.engine.route}?${grp.key}=${encodeURIComponent(v.id)}#table`} className="chip border border-border bg-card tabular-nums hover:bg-accent-soft hover:text-accent hover:border-accent" title={`${n(v.count)} medicine${v.count === 1 ? "" : "s"} (${n(v.states.approved)} approved, ${n(v.states.development)} in development, ${n(v.states.stopped)} stopped). Filter the engine table to this value.`}>{n(v.count)}</Link>
                      </li>
                    ))}
                  </ul>
                )}
                {grp.values.length > SIDEBAR_MAX && <p className="text-xs text-muted mt-2"><Link href={grp.route} className="underline">And {n(grp.values.length - SIDEBAR_MAX)} more</Link>, every one a filter pill on the engine table.</p>}
              </div>
            ))}
          </div>
        </Section>

        <Section id="companies" title="Companies most active in the format" aside={<>{n(c.companies)} compan{c.companies === 1 ? "y" : "ies"} named on {n(c.drugs)} medicines</>}>
          <From refs={h.companies.map((x) => x.company)} note="Company records named in a medicine's companies field, or whose own record lists the medicine." />
          {h.companies.length === 0 ? <p className={EMPTY}>No company record is linked to a medicine of this format.</p> : (
            <>
              <div className="overflow-x-auto card">
                <table className="onco text-sm">
                  <thead><tr><th>Company</th><th className="hidden md:table-cell">Type</th><th className="text-right">Medicines</th><th className="text-right">Approved</th><th className="text-right">Phase 3</th><th className="hidden lg:table-cell">Which</th></tr></thead>
                  <tbody>
                    {h.companies.slice(0, COMPANIES_MAX).map((row) => (
                      <tr key={row.company.id}>
                        <td className="font-medium"><Link href={row.company.route} className="hover:underline">{row.company.name}</Link> <span className="text-xs text-muted font-normal">{row.country}</span></td>
                        <td className="hidden md:table-cell text-xs text-muted">{row.companyType.replace(/-/g, " ")}</td>
                        <td className="text-right tabular-nums">{n(row.drugs.length)}</td>
                        <td className="text-right tabular-nums">{n(row.approved)}</td>
                        <td className="text-right tabular-nums">{n(row.phase3)}</td>
                        <td className="hidden lg:table-cell"><div className="flex flex-wrap gap-1">{row.drugs.slice(0, 6).map((d) => <RefPill key={d.id} r={d} />)}{row.drugs.length > 6 && <span className="text-xs text-muted">+{row.drugs.length - 6}</span>}</div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {h.companies.length > COMPANIES_MAX && <p className="text-xs text-muted mt-2">The {n(h.companies.length - COMPANIES_MAX)} others are in the <a href={h.file} className="underline">JSON</a>; every medicine&apos;s page names its companies.</p>}
            </>
          )}
        </Section>

        <Section id="trials" title="Trials recruiting now" aside={h.registry.drugs ? <>Corpus trial records; the ClinicalTrials.gov index adds {n(h.registry.recruiting)} recruiting studies across {n(h.registry.drugs)} medicines, fetched {h.registry.fetched}</> : undefined}>
          <From refs={h.trials.map((t) => t.trial)} note="Trial records with a recruiting status that name a medicine of this format, or that a medicine's record lists." />
          <Table h={h} table="trials" noun="trials" empty="No trial record of this format is recruiting in the corpus." />
        </Section>

        <Section id="sideEffects" title="Side-effect profile" aside={<>{n(h.sideEffects.terms.length)} glossary term{h.sideEffects.terms.length === 1 ? "" : "s"}; label events from {n(h.sideEffects.drugsWithToxicity)} medicine{h.sideEffects.drugsWithToxicity === 1 ? "" : "s"}</>}>
          <From refs={h.sideEffects.terms.flatMap((t) => t.from).filter((r, i, xs) => xs.findIndex((y) => y.id === r.id) === i)} note="Glossary terms of the Side effects category linked from the format's technology and medicine records, and the toxicity tables on the medicine records (label or pivotal trial rates)." />
          {h.sideEffects.terms.length === 0 && h.sideEffects.events.length === 0 ? <p className={EMPTY}>No side-effect term or toxicity table is linked to a medicine or technology of this format.</p> : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="card p-4 text-sm">
                <h3 className="font-medium mb-2">Class effects the glossary describes</h3>
                {h.sideEffects.terms.length === 0 ? <p className="text-xs text-muted">No Side effects term is linked from this format&apos;s records.</p> : (
                  <ul className="space-y-2">
                    {h.sideEffects.terms.map((t) => (
                      <li key={t.id} className="text-xs">
                        <Link href={t.route} className="font-medium hover:underline">{t.name}</Link>
                        <p className="text-muted mt-0.5">{short(t.tldr, 220)}</p>
                        <p className="flex flex-wrap gap-1 mt-1"><span className="text-muted">Linked from</span>{t.from.slice(0, 5).map((r) => <RefPill key={`${r.kind}-${r.id}`} r={r} />)}{t.from.length > 5 && <span className="text-muted">+{t.from.length - 5}</span>}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="card p-4 text-sm">
                <h3 className="font-medium mb-2">Most recorded label events</h3>
                {h.sideEffects.events.length === 0 ? <p className="text-xs text-muted">No medicine of this format carries a toxicity table.</p> : (
                  <ul className="space-y-1.5">
                    {h.sideEffects.events.map((ev) => (
                      <li key={ev.group} className="flex items-start justify-between gap-2 text-xs">
                        <span className="min-w-0"><Link href="/side-effects/" className="hover:underline" title="Look the symptom up on the side-effects page">{ev.group}</Link> <span className="text-muted">on {n(ev.drugs)} medicine{ev.drugs === 1 ? "" : "s"}{ev.maxGrade3 !== undefined ? `, grade 3+ up to ${ev.maxGrade3}%` : ev.maxAnyGrade !== undefined ? `, any grade up to ${ev.maxAnyGrade}%` : ""}</span></span>
                        <span className="flex flex-wrap gap-1 justify-end shrink-0 max-w-[50%]">{ev.examples.map((r) => <RefPill key={r.id} r={r} />)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </Section>

        <Section id="resistance" title="Resistance mechanisms recorded" aside={<>{n(h.resistance.length)} class{h.resistance.length === 1 ? "" : "es"} in <Link href="/resistance/" className="underline">how tumours escape each drug class</Link></>}>
          <From refs={h.resistance.flatMap((r) => r.exemplars).filter((r, i, xs) => xs.findIndex((y) => y.id === r.id) === i)} note="Atlas classes (src/data/resistance.ts) whose exemplar medicines belong to this format, or whose mechanisms cite one of its technology records." />
          {h.resistance.length === 0 ? <p className={EMPTY}>No recorded escape route has exemplars that are medicines of this format.</p> : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {h.resistance.map((r) => (
                <div key={r.id} className="card p-4 text-sm">
                  <h3 className="font-medium"><Link href={r.route} className="hover:underline">{r.drugClass}</Link></h3>
                  <p className="text-xs text-muted mt-1">{r.tldr}</p>
                  <ul className="mt-2 space-y-1">
                    {r.mechanisms.map((m) => {
                      const cat = CATEGORY_BY_ID[m.category as MechanismCategory];
                      return (
                        <li key={m.name} className="flex items-start gap-2 text-xs">
                          <span aria-hidden className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: cat?.color }} />
                          <span><Link href={m.route} className="hover:underline">{m.name}</Link> <span className="chip border border-border bg-card text-[11px] ms-1" title={cat?.oneLiner}>{m.categoryLabel}</span>{m.frequency && <span className="text-muted"> · {m.frequency}</span>}</span>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="flex flex-wrap gap-1 mt-2 text-xs"><span className="text-muted">Exemplars</span>{r.exemplars.map((x) => <RefPill key={x.id} r={x} />)}</p>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section id="papers" title="Key papers" aside={<>{n(c.papers)} paper{c.papers === 1 ? "" : "s"}, newest first</>}>
          <From refs={members} note="Paper records named in the keyPapers field of a medicine or technology of this format, or naming one of them." />
          <Table h={h} table="papers" noun="papers" empty="No key paper in the corpus is linked to a medicine or technology of this format." />
        </Section>

        <Section id="eras" title="Roadmap eras that mention the format" aside={<>{n(c.eras)} step{c.eras === 1 ? "" : "s"} across {n(new Set(h.eras.map((e) => e.roadmap.id)).size)} roadmap{new Set(h.eras.map((e) => e.roadmap.id)).size === 1 ? "" : "s"}</>}>
          <From refs={h.eras.map((e) => e.roadmap).filter((r, i, xs) => xs.findIndex((y) => y.id === r.id) === i)} note="Roadmap records whose steps cite a medicine or technology of this format in their refs; the era and title are the step's own." />
          {h.eras.length === 0 ? <p className={EMPTY}>No roadmap step cites a medicine or technology of this format.</p> : (
            <ol className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {h.eras.map((e) => (
                <li key={`${e.roadmap.id}-${e.step}`} className="card p-3 text-sm flex items-start gap-3">
                  <span className="kicker shrink-0 w-24 pt-0.5">{e.era}</span>
                  <div className="min-w-0">
                    <Link href={e.route} className="font-medium hover:underline">{e.title}</Link>
                    <p className="text-xs text-muted mt-0.5"><Link href={e.roadmap.route} className="hover:underline">{e.roadmap.name}</Link>, step {e.step} · <span className="capitalize">{e.status}</span></p>
                    <p className="flex flex-wrap gap-1 mt-1">{e.refs.map((r) => <RefPill key={`${r.kind}-${r.id}`} r={r} />)}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Section>

        <Section id="ideas" title="Open questions" aside={<>{n(c.ideas)} idea{c.ideas === 1 ? "" : "s"}; {Object.entries(MATURITY_LABEL).map(([k, v]) => `${n(h.ideas.filter((i) => i.maturity === k).length)} ${v.toLowerCase()}`).join(", ")}</>}>
          <From refs={members} note="Idea records that link a medicine or technology of this format, or carry the format id as a tag." />
          <Table h={h} table="ideas" noun="ideas" empty="No idea in the corpus links a medicine or technology of this format." />
        </Section>

        <Section id="manufacturing" title="Manufacturing and supply" aside={h.manufacturing.capabilities.length ? <>Capabilities: {h.manufacturing.capabilities.join(", ")}</> : undefined}>
          <From refs={h.manufacturing.technologies.map(({ id, kind, name, route }) => ({ id, kind, name, route }))} note="Manufacturing sites (src/data/manufacturing.ts) with a capability this format needs or making one of its medicines, the supply chain record of the manufacturing map, and the format's manufacturing technology records." />
          {h.manufacturing.sites.length === 0 && !h.manufacturing.chain && h.manufacturing.technologies.length === 0 ? <p className={EMPTY}>No manufacturing site, supply chain or manufacturing technology record is linked to this format.</p> : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="space-y-4">
                {h.manufacturing.chain && (
                  <div className="card p-4 text-sm">
                    <h3 className="font-medium"><Link href={h.manufacturing.chain.route} className="hover:underline">{h.manufacturing.chain.name}</Link> <span className="text-xs text-muted font-normal">supply chain</span></h3>
                    <p className="text-xs text-muted mt-1">{h.manufacturing.chain.summary}</p>
                    <p className="flex flex-wrap gap-1 mt-2">{h.manufacturing.chain.technologies.map((r) => <RefPill key={r.id} r={r} />)}</p>
                    {h.manufacturing.chain.companies.length > 0 && <p className="flex flex-wrap gap-1 mt-2"><span className="text-xs text-muted">Companies</span>{h.manufacturing.chain.companies.map((r) => <RefPill key={r.id} r={r} />)}</p>}
                  </div>
                )}
                {h.manufacturing.sites.length > 0 && (
                  <div className="overflow-x-auto card">
                    <table className="onco text-sm">
                      <thead><tr><th>Site</th><th>Operator</th><th className="hidden md:table-cell">Capabilities</th><th className="hidden lg:table-cell">Makes</th><th className="hidden md:table-cell">Source</th></tr></thead>
                      <tbody>
                        {h.manufacturing.sites.map((s) => (
                          <tr key={s.id}>
                            <td className="font-medium">{s.name} <span className="block text-xs text-muted font-normal">{s.city}, {s.country} · {s.ownership === "cdmo" ? "contract manufacturer" : s.ownership}</span></td>
                            <td>{s.operatorRoute ? <Link href={s.operatorRoute} className="hover:underline">{s.operator}</Link> : s.operator}</td>
                            <td className="hidden md:table-cell"><div className="flex flex-wrap gap-1">{s.capabilityLabels.map((l) => <span key={l} className="chip border border-border bg-card text-[11px]">{l}</span>)}</div></td>
                            <td className="hidden lg:table-cell"><div className="flex flex-wrap gap-1">{s.drugs.map((d) => <RefPill key={d.id} r={d} />)}</div></td>
                            <td className="hidden md:table-cell text-xs"><a href={s.source.url} rel="noopener" className="underline">{short(s.source.label, 40)}</a></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="text-xs text-muted">The <Link href="/manufacturing/" className="underline">manufacturing map</Link> draws every site and the seven supply chains.</p>
              </div>
              <div className="card p-4 text-sm">
                <h3 className="font-medium mb-2">Manufacturing notes on the records</h3>
                {h.manufacturing.technologies.length === 0 ? <p className="text-xs text-muted">No manufacturing technology record is listed for this format.</p> : (
                  <ul className="space-y-2">
                    {h.manufacturing.technologies.map((t) => <li key={t.id} className="text-xs"><Link href={t.route} className="font-medium hover:underline">{t.name}</Link><p className="text-muted mt-0.5">{short(t.tldr, 200)}</p></li>)}
                  </ul>
                )}
              </div>
            </div>
          )}
        </Section>

        <section className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
          <div className="card p-5 space-y-2">
            <h2 className="font-semibold text-base">Where this page comes from</h2>
            <p>The medicines are the ones the <Link href={h.engine.route} className="underline">open drug engine</Link> files under {def.name.toLowerCase()}, whether it placed them on its grid or listed them as unresolved. The technology records are listed by hand (src/lib/modular-formats.ts) and each carries a pill back here. Everything else follows the graph&apos;s links from those two sets: approvals, cancers and toxicity from the medicine records; companies, trials, papers and ideas from the records that name a medicine or technology; roadmap steps from their refs; resistance from the atlas; manufacturing from the site and supply chain records.</p>
          </div>
          <div className="card p-5 space-y-2">
            <h2 className="font-semibold text-base">What it does not do</h2>
            <p>Nothing here is written for the hub. Where the corpus holds no record for a section, the section says so rather than filling the gap, and the counts are counts of records in OnCo, not of the world. The JSON companion carries every section with the record ids behind it. Not medical advice.</p>
          </div>
        </section>
      </Container>
    </>
  );
}
