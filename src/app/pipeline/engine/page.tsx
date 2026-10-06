import type { Metadata } from "next";
import Link from "next/link";
import { pageMeta } from "@/lib/seo";
import { Container, GroupKicker, PageHeader } from "@/components/ui";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Tip } from "@/components/Tip";
import { engine } from "@/lib/modular";
import { registryDateLabel } from "@/lib/registry-dates";
import { CELL_STATES, COMPONENT_LABEL, engineFile, engineRoute, modalityRoute, STATE_META, type FormatDef } from "@/lib/modular-formats";

export const metadata: Metadata = pageMeta({ title: "Open drug engine", description: "Every medicine in OnCo taken apart into its modules (target, payload, linker, isotope, costimulatory domain, E3 ligase) and, per format, the grid of every combination: approved, in development, tried and stopped with the recorded reason, or never tried.", path: "/pipeline/engine/" });

function Glyph({ f, className = "h-5 w-5" }: { f: FormatDef; className?: string }) {
  return <svg viewBox="0 0 24 24" aria-hidden className={className} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={f.glyph} /></svg>;
}

const n = (x: number) => x.toLocaleString("en-GB");

export default function EnginePage() {
  const e = engine();
  const inFormats = e.formats.reduce((s, f) => s + f.counts.drugs + f.counts.unresolved, 0);
  const totals = { approved: 0, development: 0, stopped: 0, untried: 0 };
  for (const f of e.formats) { totals.approved += f.counts.approved; totals.development += f.counts.development; totals.stopped += f.counts.stopped; totals.untried += f.counts.untried; }
  return (
    <>
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Pipeline funnel", href: "/pipeline/" }, { label: "Open drug engine", href: "/pipeline/engine/" }]} />
      <PageHeader kicker={<GroupKicker id="intel" />} title="Open drug engine"
        lede={`A medicine is a set of parts. This engine takes the ${n(inFormats)} medicines in OnCo that fit one of ${e.formats.length} modular formats apart into those parts, then lays out every combination of two of them: ${n(totals.approved)} combinations with an approved medicine, ${n(totals.development)} being worked on, ${n(totals.stopped)} tried and stopped with the record that says why, and ${n(totals.untried)} that no medicine in this corpus has ever combined.`}
        right={<div className="flex flex-wrap gap-2 justify-end"><a href={engineFile("index")} className="chip border bg-card border-border hover:bg-foreground/5 text-sm" title="Counts per format as JSON; each format has its own file under /api/v1/pipeline/engine/">JSON for agents</a><Link href={modalityRoute()} className="chip border bg-card border-border hover:bg-foreground/5 text-sm" title="The same formats read the other way: one hub per format with everything the corpus records about it">Modality hubs →</Link></div>} />
      <Container className="pb-16">
        <div className="flex flex-wrap gap-2 mb-8">
          {e.formats.map((f) => (
            <Link key={f.format.id} href={engineRoute(f.format.id)} className="chip border border-border bg-card hover:bg-accent-soft hover:text-accent hover:border-accent text-sm" title={f.format.blurb}>
              <Glyph f={f.format} className="h-3.5 w-3.5" />{f.format.name} <span className="text-xs text-muted tabular-nums">{n(f.counts.drugs)}</span>
            </Link>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-12">
          {e.formats.map((f) => {
            const [ka, kb] = f.format.axes;
            return (
              <div key={f.format.id} className="card p-5 flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent"><Glyph f={f.format} /></span>
                  <div className="min-w-0">
                    <h2 className="font-semibold leading-snug"><Link href={engineRoute(f.format.id)} className="hover:underline">{f.format.name}</Link></h2>
                    <p className="text-xs text-muted mt-0.5">{COMPONENT_LABEL[ka]} x {COMPONENT_LABEL[kb].toLowerCase()}: {n(f.rows.length)} x {n(f.cols.filter((c) => c.id !== "not-recorded").length)} grid</p>
                  </div>
                </div>
                <p className="text-sm text-muted leading-relaxed">{f.format.blurb}</p>
                <div className="grid grid-cols-2 gap-1.5 text-xs">
                  {CELL_STATES.map((s) => (
                    <Link key={s} href={s === "untried" ? engineRoute(f.format.id) : `${engineRoute(f.format.id)}?state=${encodeURIComponent(STATE_META[s].label)}`} className={`chip ${STATE_META[s].chip} justify-between hover:ring-2 hover:ring-accent/30`} title={STATE_META[s].tip}>
                      <span className="flex items-center gap-1.5"><span aria-hidden className={`inline-block h-2.5 w-2.5 rounded-sm ${STATE_META[s].swatch}`} />{STATE_META[s].label}</span>
                      <span className="tabular-nums font-medium">{n(f.counts[s])}</span>
                    </Link>
                  ))}
                </div>
                <p className="text-xs text-muted">
                  <Tip title="Coverage" text={`Of the ${n(f.coverage.total)} medicines the engine files under this format, ${n(f.drugs.length)} have their ${COMPONENT_LABEL[ka].toLowerCase()} resolved from a record (${n(f.coverage.full)} with both grid parts, ${n(f.coverage.partial)} with the ${COMPONENT_LABEL[kb].toLowerCase()} not recorded) and ${n(f.coverage.unresolved)} could not be placed and are listed, not guessed.`} href={`${engineRoute(f.format.id)}#unresolved`} linkLabel="See the unresolved list →">
                    <span className="underline decoration-dotted cursor-help">{n(f.drugs.length)} of {n(f.coverage.total)} medicines placed ({f.coverage.pct}%)</span>
                  </Tip>
                  {f.stopped.length > 0 && <> · <Link href={`${engineRoute(f.format.id)}#stopped`} className="hover:underline">{n(f.stopped.length)} recorded reason{f.stopped.length === 1 ? "" : "s"} for stopping</Link></>}
                </p>
              </div>
            );
          })}
        </div>

        <section className="grid md:grid-cols-2 gap-6 text-sm">
          <div className="card p-5 space-y-2">
            <h2 className="font-semibold text-base">What open drug development means here</h2>
            <p>Most of the work of making a medicine happens in private: which target a company pairs with which payload, which pairs it tried and dropped, and why. This engine is the public part of that ledger. Every medicine in the corpus is broken into the parts a designer chooses between: for an antibody-drug conjugate the target, the carrier, the payload class, the linker and the drug-to-antibody ratio; for a radioligand the target, the ligand, the chelator and the isotope; for a CAR-T the antigen, the binder, the costimulatory domain, the vector and the cell source; for a bispecific its two arms; for a degrader its target and its E3 ligase.</p>
            <p>Laying the parts out as a grid shows the field the way a designer sees it: which corners are crowded, which have one approved medicine and nothing behind it, which were tried and abandoned, and which nobody in this corpus has touched. Each cell links to the medicines in it and to the records that say what happened to them, so a reader can check the claim and a builder can start from where the last attempt stopped. The pages are open data (CC BY-NC 4.0) and every format has a JSON file so agents can read the engine the same way.</p>
          </div>
          <div className="card p-5 space-y-2">
            <h2 className="font-semibold text-base">How the pages are built</h2>
            <p>A decomposer (src/lib/modular.ts) reads each drug record&apos;s fields: its target list, its payload and linker fields, the ADC payload registry, the INN stem of its name (deruxtecan is DXd, vedotin is MMAE, tesirine is a PBD dimer), its mechanism text matched against the names the corpus uses for its targets, and the trial and target records that name it. Each part says which fields it was read from and how sure the reading is. A medicine whose grid row cannot be read from any record is listed as unresolved, never placed by guesswork.</p>
            <p>A cell&apos;s state comes from records alone: an approval row or a regulator&apos;s entry makes it approved; a recruiting, active or planned trial, a development-phase status or active studies in the ClinicalTrials.gov index make it in development; a withdrawn, negative or historic record, a terminated or negative trial or a withdrawn approval make it stopped, and the reason is quoted from the record (the registry&apos;s own whyStopped text where the sponsor wrote one). Untried means no medicine in this corpus combines the two parts: the corpus is large but not the world.</p>
            <p className="text-xs text-muted">{n(e.drugs)} drug records; {n(e.outside.length)} are outside the engine ({e.outsideByReason.map((r) => `${n(r.count)} ${r.reason}`).join("; ")}). Registry snapshots fetched {registryDateLabel(e.fetchedFrom, e.fetched)}.</p>
          </div>
        </section>
      </Container>
    </>
  );
}
