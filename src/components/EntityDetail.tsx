import Link from "next/link";
import { enrolmentLabel } from "@/lib/enrolment";
import { publicTags, tagRoute } from "@/lib/tags";
import { Fragment, type ReactNode } from "react";
import { EVIDENCE_TIER_LABEL, TARGET_ROLE_LABEL, type Entity, type Roadmap, type Term } from "@/lib/schema";
import { KIND_META, phaseLabel, routeFor, type Kind } from "@/lib/kinds";
import { graph } from "@/lib/graph";
import { Bullets, ChipList, Container, KindChip, PageHeader, StatusChip } from "./ui";
import { Block, Field, KeyPapers, keyPapersFor, LatestLiterature, Refs, Summary, ToolsStrip } from "./record-blocks";
import { PrevalenceTable } from "./PrevalenceTable";
import { WhatIsBeingDone } from "./WhatIsBeingDone";
import { regimensFor, regimenRoute, cycleSummary } from "@/lib/regimens";
import { interventionQuery } from "@/lib/ctgov";
import { CitationChip, CitationChipDefs } from "./CitationChip";
import { OrganSchematic } from "./OrganSchematic";
import { cancerTabs } from "./CancerRecord";
import { NEIGHBOUR_CAP, forwardedAnchors } from "@/lib/record-sections";
import { Neighbours } from "./Neighbours";
import { PathwayDiagram } from "./PathwayDiagram";
import { rankInstitutions } from "@/lib/ranking";
import { MoleculeViewer, type StructureEntry } from "./MoleculeViewer";
import { Logo } from "./Logo";
import { Portrait, PortraitCredit } from "./Portrait";
import { JsonLd } from "./JsonLd";
import { MachineLinks } from "./MachineLinks";
import { AkaLine } from "./AkaLine";
import { CheckpointPills } from "./CheckpointPills";
import { ModalityPills } from "./ModalityPills";
import { PrintButton } from "./PrintButton";
import { TrialFinderGeo as TrialFinder } from "./TrialFinderGeo";
import { TrialCounts } from "./TrialCounts";
import { ReviewBadge } from "./ReviewBadge";
import { TechSchematic } from "./TechSchematic";
import { Wireframe3D } from "./Wireframe3D";
import { StickyAside } from "./StickyAside";
import { schematicFor } from "@/data/schematics";
import { Tabs, type Tab } from "./Tabs";
import { ScrollRow } from "./ScrollRow";
import { RoadmapStory } from "./RoadmapStory";
import { TrialOutcomes } from "./Pictogram";
import { TrialExplainer } from "./TrialExplainer";
import { EvidenceBar } from "./EvidenceBar";
import { EvidenceGradeChip } from "./EvidenceGradeChip";
import { SourceList } from "./SourceList";
import { SuggestEdit } from "./SuggestEdit";
import { sourceLocation } from "@/lib/source-location";
import { ProvenanceLine } from "./ProvenanceLine";
import { ConfidenceChip, ConfidenceLegend } from "./ConfidenceChip";
import { ProcessSchematic, processSchematicKey } from "./ProcessSchematic";
import { DosingCard } from "./DosingCard";
import { ToxicityTable } from "./ToxicityTable";
import { RecoveryPanel } from "./RecoveryPanel";
import { cellsForDrug as recoveryCellsForDrug } from "@/data/recovery-matrix";
import { AccessTable } from "./AccessTable";
import { RegulatoryTimeline } from "./RegulatoryTimeline";
import { SeeItInAction } from "./SeeItInAction";
import { modalityGroup } from "@/lib/modality-group";
import { TldrText } from "./TldrText";
import { FrontSchematic } from "./FrontSchematic";
import { TermSchematic } from "./TermSchematic";
import { termVisual } from "@/lib/term-visual";
import { DrugGrid } from "./DrugCard";
import type { Drug, Paper } from "@/lib/schema";
import { TargetSpecificityPills } from "./TargetSpecificityPills";
import { SupportivePill } from "./SupportivePill";
import { CompanyTypePill } from "./CompanyTypePill";
import { TargetWhereFound, hpaFor } from "./TargetWhereFound";
import { KindName, TL } from "./T";
import { KIND_COLOR, statusClass } from "@/lib/text";
import { withTermHovers } from "@/lib/term-hover";
import { paperQuery } from "@/lib/europepmc";
import { roadmapStorySteps } from "@/lib/roadmap-story";
import { defaultOpen, eraBody, eraCounts, roadmapFile, WATCH_PAGE, watchRows } from "@/lib/roadmap-eras";
import { RoadmapEra, RoadmapWatchMore, WatchRowView } from "./RoadmapEras";
import structureIndex from "../../public/structures/index.json";
import { RegionStrip } from "./RegionMatrix";
import { RegistryCheck } from "./RegistryCheck";
import { regionalApprovals } from "@/data/regional-approvals";
import { CancerIcon } from "./CancerIcon";
import { YearEvents, YearNav, YearStats } from "./YearRecord";
import { ResearchOutput } from "./ResearchOutput";
import { confidence } from "@/data/confidence";
import { FrontIcon } from "./FrontIcon";
import { ApprovalChip } from "./ApprovalChip";
import { MechanicsPills } from "./MechanicsPills";
import { TargetSchematic } from "./TargetSchematic";
import { IntentLink } from "./IntentLink";
import { TargetExplainer } from "./TargetExplainer";
import { CoverageUsCard } from "./CoverageUs";
import { CoverageUkCard } from "./CoverageUk";
import { coverageUs } from "@/data/coverage-us";
import { coverageUk } from "@/data/coverage-uk";
import { similarLinks } from "@/lib/similar";
import { agentById } from "@/lib/interactions";
import { IdentifierRow, XrefStrip } from "./XrefStrip";
import { nameAttrs } from "@/lib/translate";
import { HotspotPlot } from "./HotspotPlot";
import { OpenMedicalPanel } from "./OpenMedicalPanel";
import { OpenSourcePanel } from "./OpenSourcePanel";
import { SoftwarePanel } from "./SoftwarePanel";
import { hotspotsFor } from "@/data/hotspots";
import { questionsFor } from "@/data/open-questions";
import { assaysForTarget, assaysForDrug } from "@/data/assays";
import { modelFor, datasetFor } from "@/data/model-registry";
import { modelsFor } from "@/data/preclinical-models";
import { CatalystsPanel, CompanyScorePanel, DealsPanel, ExclusivityPanel, ManufacturingPanel } from "@/components/InvestorPanels";
import { FundingPanel, PortfolioPanel } from "@/components/StartupPanels";
import { StageIcon } from "@/components/StageIcon";
import { portfolioOf, STAGE_LABEL, stageOf, ycBatchLabel } from "@/lib/startups";
import { BiomarkerDetail, ReadoutStrip, ReadoutsForDrug, ReadoutsForTerm } from "./BiomarkerDetail";

const STRUCTURES = structureIndex as Record<string, StructureEntry[]>;

/** PDB structures of drugs caught in the act on this target (antibody with its antigen, small molecule in the pocket), from the products that hit it. Representative IgG stand-ins are left out. */
function structuresForTarget(targetId: string): StructureEntry[] {
  const g = graph();
  const seen = new Set<string>();
  const out: StructureEntry[] = [];
  for (const d of g.incoming(targetId).get("drug") ?? []) for (const en of STRUCTURES[d.id] ?? []) {
    if (en.source !== "pdb" || seen.has(en.file) || !/bound to|with /i.test(en.label) || /representative/i.test(en.label)) continue;
    seen.add(en.file); out.push(en);
  }
  return out.slice(0, 6);
}

/** Labels and block titles are English source strings, translated on the client through the chrome dictionary (`TL`). */
/** A Wayback Machine snapshot recorded as the website is shown as an archived copy of the original address. */
function websiteView(url: string): { label: string; text: string } {
  const m = url.match(/^https?:\/\/web\.archive\.org\/web\/\d+\/(https?:\/\/.+)$/);
  if (m) return { label: "Archived website", text: m[1].replace(/^https?:\/\//, "") };
  if (/^https?:\/\/(www\.)?ycombinator\.com\/companies\//.test(url)) return { label: "Y Combinator profile", text: url.replace(/^https?:\/\//, "") };
  return { label: "Website", text: url.replace(/^https?:\/\//, "") };
}

/** Fetcher notes on a person's papers, rendered once under the table in plain English rather than under every row. */
const PAPER_PROVENANCE: Record<string, string> = {
  "OpenAlex author record matched by institution": "These papers come from the OpenAlex author record for this person at their institution, taking the most cited articles with a DOI.",
  "Europe PMC author record matched by affiliation": "These papers come from a Europe PMC search on the author's name and institution, taking the most cited articles.",
};
function paperProvenance(papers: ReadonlyArray<{ note?: string }>): string[] {
  return [...new Set(papers.map((p) => (p.note && PAPER_PROVENANCE[p.note]) || "").filter(Boolean))];
}

export function EntityDetail({ e }: { e: Entity }) {
  const g = graph();
  const neighbours = g.neighbours(e.id);
  const meta = KIND_META[e.kind];
  const nCon = [...neighbours.values()].reduce((a, l) => a + l.length, 0);

  // Each tab's content is one keyed fragment. React Flight collapses a keyless fragment into a plain array as it
  // crosses to the client, and Tabs would then render that array as a list without keys (the warning on every record
  // page); a fragment keyed on the tab id crosses intact, so the section has one child.
  const tabs: Tab[] = keyedContent([
    ...kindTabs(e),
    // Cancer records carry notes, key papers and the literature inside their Evidence and Data sections (CancerRecord.tsx).
    ...(e.kind === "cancer" ? [] : [
      ...(e.notes.length ? [{ id: "notes", label: "Notes", content: <Bullets items={e.notes} linked={(t) => withTermHovers(t, { skipId: e.id })} /> }] : []),
      ...keyPapersTab(e),
      ...papersTab(e),
    ]),
    // Cancer pages carry "Related pages" (every direct link plus the products' targets, companies and technologies, with
    // the Similar strip) instead: the generic Connected tab repeated the same lists and doubled the markup of the page.
    ...(e.kind === "cancer" ? [] : [{ id: "connected", label: "Connected", count: nCon, content: <Neighbours groups={neighbours} similar={similarLinks(e.id)} max={NEIGHBOUR_CAP} /> }]),
  ]);
  const aside = <RecordAside e={e} />;
  const openMedical = (e.kind === "section" || e.kind === "technology") ? <OpenMedicalPanel id={e.id} kind={e.kind} limit={e.kind === "section" ? 12 : undefined} /> : null;
  const openSource = (e.kind === "technology" || e.kind === "collection" || e.kind === "institution" || e.kind === "company") ? <OpenSourcePanel id={e.id} name={e.name} kind={e.kind} /> : null;
  const software = (e.kind === "technology" || e.kind === "company" || e.kind === "institution" || e.kind === "cancer") ? <SoftwarePanel id={e.id} name={e.name} kind={e.kind} /> : null;
  const afterTabs = (openSource || openMedical || software) ? <>{openSource}{software}{openMedical}</> : null;

  return (
    <>
      <JsonLd e={e} />
      <PageHeader
        kicker={<><Link href={`/${meta.route}/`} className="kicker hover:underline"><KindName kind={e.kind} form="plural" fallback={meta.plural} /></Link><KindChip kind={e.kind} />{e.kind === "drug" ? <ApprovalChip drugId={e.id} status={e.status} /> : <StatusChip status={e.status} />}</>}
        title={e.name}
        titleAttrs={nameAttrs(e.kind)}
        ledeNode={<TldrText id={e.id} tldr={e.tldr} simple={e.simple} />}
        logo={e.kind === "cancer" ? <span className="inline-flex h-16 w-16 items-center justify-center rounded-2xl border border-accent/30 bg-accent-soft text-accent"><CancerIcon cancerId={e.id} className="h-10 w-10" /></span> : e.kind === "section" ? <span className="inline-flex h-16 w-16 items-center justify-center rounded-2xl border border-accent/30 bg-accent-soft text-accent"><FrontIcon id={e.id} className="h-9 w-9" /></span> : "website" in e ? <Logo id={e.id} website={e.website} name={e.name} size={64} /> : "url" in e && (e.kind === "collection" || e.kind === "journal") ? <Logo id={e.id} website={e.url} name={e.name} size={64} /> : undefined}
        under={<AkaLine e={e} />}
      />
      <Container className="pb-16">
        {(e.kind === "target" || e.kind === "pathway") && <MechanicsPills id={e.id} className="mb-6" />}
        {e.kind === "drug" && e.supportive && <SupportivePill className="mb-6" />}
        {e.kind !== "cancer" && <ToolsStrip e={e} />}
        {(e.kind === "target" || e.kind === "pathway" || e.kind === "term" || e.kind === "technology") && <CheckpointPills id={e.id} className="mb-6" />}
        {(e.kind === "technology" || e.kind === "drug") && <ModalityPills e={e} className="mb-6" />}
        {/* The tab bar takes the full content width and both columns start beneath it (Tabs owns the grid), so the right column never cuts the tabs short. Pages with one section keep the plain grid. */}
        {tabs.length > 1
          ? <Tabs tabs={tabs} ariaLabel={`${e.name} sections`} after={afterTabs} aside={aside} anchors={e.kind === "cancer" ? forwardedAnchors(e) : undefined} />
          : <div className="grid *:min-w-0 gap-10 lg:grid-cols-[1fr_300px]"><div className="min-w-0"><div className="space-y-10">{tabs.map((t) => <Block key={t.id} title={t.id === "overview" ? undefined : t.label}>{t.content}</Block>)}</div>{afterTabs}</div>{aside}</div>}
      </Container>
      <SourceList e={e} />
      {/* Who last edited this and when. It opened the right-hand column until 6 October 2026; the owner: "not
          useful surface area, this should goto the bottom of the page". It is provenance, which a reader wants
          after the page rather than before it. */}
      <Container className="pb-4"><ProvenanceLine id={e.id} /></Container>
      <MachineLinks e={e} />
    </>
  );
}

/** Wraps each tab's content in a fragment keyed on the tab id (see the note where the tabs are assembled). */
function keyedContent(tabs: Tab[]): Tab[] {
  return tabs.map((t) => ({ ...t, content: <Fragment key={`${t.id}-content`}>{t.content}</Fragment> }));
}

/**
 * Record kinds where the patient pack earns the control in the Data row: the pages a patient or a carer takes to
 * an appointment, where "every section in plain language, dated, with a QR code back to the page and the
 * disclaimer" is something a browser cannot produce. On a company, journal, person or paper page the three modes
 * collapse into the browser's own print command, so the control is not shown there (see the note in PrintButton).
 */
const PACK_KINDS: ReadonlySet<Kind> = new Set<Kind>(["cancer", "drug", "trial", "term"]);

/**
 * The right-hand column of a record page: evidence, Wikipedia and tags, the patient pack, suggest an edit,
 * quick links, and last of all the review panel.
 *
 * Provenance, the source count and the JSON link all left it on 6 October 2026. Each was a pointer to
 * something that now lives at the foot of the page, and a pointer above the fold costs more attention than the
 * thing it points at is worth.
 *
 * The sources are no longer here. `e.links` rendered as one unbounded list, 124 of them on pancreatic cancer
 * and 109 on triple-negative breast cancer, so the column was worst on the pages with the most work in them
 * and on a phone it stacked above the reader's own content. They sit at the foot of the page now, grouped by
 * publisher (`SourceList`), and the column keeps one line saying how many there are and where. Wikipedia
 * stays: it identifies the record rather than citing it.
 *
 * The review panel used to sit second, above everything a reader came for. It is the page talking about itself:
 * machine commentary on 21 records, and on the other ~19,000 a card saying nobody has reviewed the page yet.
 * Neither is what a reader opens a cancer page for, so it goes at the foot of the column, after the actions.
 * `src/app/record-top.test.ts` keeps it there.
 */
export function RecordAside({ e }: { e: Entity }) {
  return (
          <StickyAside>
            {e.kind === "person" && <PortraitCredit id={e.id} />}
            {e.kind === "technology" && e.tags.some((t) => t.startsWith("evidence:")) && <div className="card p-4 text-sm"><div className="kicker mb-1.5">Evidence grade</div><EvidenceGradeChip tags={e.tags} /><p className="text-[11px] text-muted mt-2">How much and what kind of evidence, for the stated purpose. Grades are explained on the <Link className="underline" href="/live/complementary/">complementary approaches page</Link>.</p></div>}
            {(e.kind === "drug" || e.kind === "technology" || e.kind === "target" || e.kind === "trial") && <EvidenceBar e={e} />}
            <div className="card p-4 text-sm space-y-3">
              {e.wikipedia && <div><div className="kicker mb-1"><TL text="Wikipedia" /></div><a className="underline break-all" href={e.wikipedia} rel="noopener">{decodeURIComponent(e.wikipedia.replace("https://en.wikipedia.org/wiki/", "")).replace(/_/g, " ")}</a></div>}
              {!e.wikipedia && e.kind === "term" && e.wikipediaChecked && <div><div className="kicker mb-1"><TL text="Wikipedia" /></div><p className="text-muted" title={`English Wikipedia searched on ${e.wikipediaChecked}: no article with this name or any of its aliases`}><TL text="No Wikipedia article" /></p></div>}
              {publicTags(e.tags).length > 0 && <div><div className="kicker mb-1"><Link href="/tagged/" className="hover:underline"><TL text="Tags" /></Link></div><div className="flex flex-wrap gap-1" data-tag-chips>{publicTags(e.tags).map((t) => <Link key={t} href={tagRoute(t)} className="chip bg-foreground/5 hover:bg-accent-soft hover:text-accent" title={`Every record tagged ${t}`}>{t}</Link>)}</div></div>}
            </div>
            {PACK_KINDS.has(e.kind) && <div className="card p-4 text-sm no-print"><PrintButton className="underline" asOf={e.asOf} title={e.name} /></div>}
            <SuggestEdit id={e.id} kind={e.kind} name={e.name} fields={Object.keys(e)} source={sourceLocation(e.id, e.kind)} route={routeFor(e)} asOf={e.asOf} />
            {e.kind !== "cancer" && <QuickLinks e={e} />}
            <div data-review><ReviewBadge id={e.id} /></div>
          </StickyAside>
  );
}

/**
 * Quick links a group shows in the sidebar before it says "and N more". The Connected section below lists every one
 * of them with its kind and hover, so a long array here is the same names a second time in the markup: a roadmap
 * with fourteen eras carried 19 KB of duplicate sidebar links.
 */
const QUICK_LINKS = 8;

function QuickLinks({ e }: { e: Entity }) {
  const g = graph();
  const rows: Array<[string, string[]]> = [
    ["Cancers", e.cancers], ["People", e.people], ["Fronts", e.sections], ["Technologies", e.technologies], ["Targets", e.targets], ["Products", e.drugs], ["Companies", e.companies], ["Institutions", e.institutions], ["Pathways", e.pathways], ["Terms", e.terms], ["Trials", e.trials], ["Related", e.related],
  ];
  const nonEmpty = rows.filter(([, ids]) => ids.length);
  if (!nonEmpty.length) return null;
  return (
    <div className="card p-4 text-sm space-y-3" data-quick-links>
      {nonEmpty.map(([label, ids]) => (
        <div key={label}>
          <div className="kicker mb-1"><TL text={label} /></div>
          <ul className="space-y-0.5">{ids.slice(0, QUICK_LINKS).map((id) => { const x = g.get(id); return x ? <li key={id}><IntentLink className="hover:underline" href={routeFor(x)}>{x.name}</IntentLink></li> : null; })}</ul>
          {ids.length > QUICK_LINKS && <Link href="#connected" className="text-xs text-muted hover:text-foreground hover:underline" data-more>and {ids.length - QUICK_LINKS} more →</Link>}
        </div>
      ))}
    </div>
  );
}

/** Key papers in the corpus that cite this object, with what they mean in plain English (record-blocks.tsx renders the cards). */
function keyPapersTab(e: Entity): Tab[] {
  const all = keyPapersFor(e);
  if (!all.length) return [];
  return [{ id: "key-papers", label: "Key papers", count: all.length, content: <KeyPapers e={e} all={all} /> }];
}

/** Live literature from Europe PMC plus the weekly trend, for the kinds a query can be built for. */
function papersTab(e: Entity): Tab[] {
  if (!["drug", "target", "technology"].includes(e.kind) || !paperQuery(e)) return [];
  return [{ id: "papers", label: "Latest papers", content: <LatestLiterature e={e} /> }];
}

/** Per-kind tabs. The first tab is always "Overview" and contains the summary. */
function kindTabs(e: Entity): Tab[] {
  const g = graph();
  const overview = (extra?: ReactNode): Tab => ({ id: "overview", label: "Overview", content: <><Summary e={e} />{extra}</> });

  switch (e.kind) {
    case "cancer":
      return cancerTabs(e);
    case "technology":
      return [
        overview(<>
          <div className="mt-8"><TechSchematic tech={e} /></div>
          {modelFor(e.id) && (() => { const m = modelFor(e.id)!; return (<div className="mt-6 card p-4 text-sm"><div className="kicker mb-1">Model registry</div><div className="grid *:min-w-0 gap-x-6 gap-y-1 sm:grid-cols-2"><div><span className="text-muted">Modality:</span> {m.modality}</div>{m.parametersM && <div><span className="text-muted">Parameters:</span> {m.parametersM >= 1000 ? `${m.parametersM / 1000} B` : `${m.parametersM} M`}</div>}<div><span className="text-muted">Weights:</span> {m.weights}</div>{m.licence && <div><span className="text-muted">Licence:</span> {m.licence}</div>}<div className="sm:col-span-2"><span className="text-muted">Training data:</span> {m.trainingData}</div>{m.benchmark && <div className="sm:col-span-2"><span className="text-muted">Reported result:</span> {m.benchmark}</div>}</div><Link className="underline text-xs text-muted mt-2 inline-block" href="/models/">Compare all models →</Link></div>); })()}
          {questionsFor(e.id).length > 0 && <Block title="Open questions"><ul className="list-disc ps-5 space-y-1 text-[15px]">{questionsFor(e.id).map((q) => <li key={q.id}><Link className="hover:underline" href={`/open-questions/?subject=${encodeURIComponent(e.name)}`}>{q.question}</Link></li>)}</ul></Block>}
          <Block title="How it works"><p className="text-[15px] leading-relaxed max-w-3xl">{e.principle}</p></Block>
          <div className="grid *:min-w-0 gap-6 sm:grid-cols-2 mt-8">
            <Field label="Strengths"><Bullets items={e.strengths} linked={(t) => withTermHovers(t, { skipId: e.id })} /></Field>
            <Field label="Limitations"><Bullets items={e.limitations} linked={(t) => withTermHovers(t, { skipId: e.id })} /></Field>
            <Field label="Generation">{e.generation}</Field>
            <Field label="Since">{e.since}</Field>
          </div>
          <TechDependencies e={e} />
        </>),
        ...productsTab(g.incoming(e.id).get("drug") ?? []),
      ];
    case "target":
      return [
        overview(<>
          <div className="mt-8"><TargetSchematic target={{ id: e.id, name: e.name, targetClass: e.targetClass, tldr: e.tldr }} /></div>
          {structuresForTarget(e.id).length > 0 && <div className="mt-6"><div className="kicker mb-2">Solved structures with a drug bound</div><MoleculeViewer entries={structuresForTarget(e.id)} /></div>}
          <div className="mt-6"><TargetExplainer target={e} /></div>
          <div className="mt-6"><CatalystsPanel id={e.id} /></div>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-2"><Link href={`/dossiers/${e.id}/`} className="chip border bg-card border-border hover:bg-foreground/5 text-sm">Full dossier: hotspots, trials, resistance, assays, models, open questions →</Link></div>
          {(e.role.length > 0 || e.evidenceTier) && (
            <div className="mt-6 flex flex-wrap items-center gap-1.5" data-target-roles>
              {e.role.map((r) => <Link key={r} href={`/targets/?role=${encodeURIComponent(TARGET_ROLE_LABEL[r])}`} className="chip border bg-card border-border hover:bg-foreground/5 text-xs" title={`All targets listed as ${TARGET_ROLE_LABEL[r].toLowerCase()}`}>{TARGET_ROLE_LABEL[r]}</Link>)}
              {e.evidenceTier && <Link href={`/targets/?evidence=${encodeURIComponent(EVIDENCE_TIER_LABEL[e.evidenceTier])}`} className="chip bg-foreground/5 text-xs" title="Strongest public evidence tying the gene to cancer; click for every target at this tier">Evidence: {EVIDENCE_TIER_LABEL[e.evidenceTier]}</Link>}
              <Link href="/targets/genome/" className="text-xs text-muted underline ms-1">All cancer genes by role →</Link>
            </div>
          )}
          <TargetSpecificityPills target={e} className="mt-4" />
          {e.firstDescribed !== undefined && (
            <p className="text-sm text-muted mt-4" data-target-first-described>
              <span className="font-medium text-foreground">First described {e.firstDescribed}.</span>{" "}
              {e.firstDescribedNote}{e.firstDescribedSource && <> <a className="underline hover:text-foreground" href={e.firstDescribedSource} rel="noopener">Source</a>.</>}
            </p>
          )}
          <Block title="External identifiers"><XrefStrip targetId={e.id} compact fallback={e.hgnc ? { symbol: e.symbol ?? e.name, name: e.aka[0] ?? e.name, hgnc: e.hgnc, ensembl: e.ensembl, uniprot: e.uniprot, entrez: e.entrez } : undefined} /></Block>
          {e.sources.length > 0 && (
            <p className="text-sm text-muted mt-3" data-target-sources>
              <span className="font-medium text-foreground">Sources:</span>{" "}
              {e.sources.map((s, i) => <span key={s.url}>{i > 0 && "; "}<a className="underline hover:text-foreground" href={s.url} rel="noopener" title={s.note}>{s.label}</a>{s.note && <span className="text-xs"> ({s.note})</span>}</span>)}
            </p>
          )}
          {hotspotsFor(e.id) && <Block title="Mutation hotspots"><HotspotPlot map={hotspotsFor(e.id)!} compact /><p className="text-xs text-muted mt-1"><Link className="underline" href={`/dossiers/${e.id}/#hotspots`}>Residue-by-residue table on the dossier →</Link></p></Block>}
          {questionsFor(e.id).length > 0 && <Block title="Open questions"><ul className="list-disc ps-5 space-y-1 text-[15px]">{questionsFor(e.id).map((q) => <li key={q.id}><Link className="hover:underline" href={`/dossiers/${e.id}/#q-${q.id}`}>{q.question}</Link></li>)}</ul></Block>}
          {assaysForTarget(e.id).length > 0 && <Block title="Companion diagnostics"><ul className="text-sm space-y-1">{assaysForTarget(e.id).map((a) => <li key={a.id}><Link className="font-medium hover:underline" href={`/assays/#${a.id}`}>{a.name}</Link> <span className="text-muted">· {a.cutoff}</span></li>)}</ul></Block>}
          <ReadoutStrip targetId={e.id} />
          {modelsFor(e.id) && <p className="text-sm text-muted mt-4"><Link className="underline" href={`/preclinical-models/?subject=${encodeURIComponent(e.name.split(" (")[0])}`}>Cell lines and mouse models for this target →</Link></p>}
          <Block title="Biology"><p className="text-[15px] leading-relaxed max-w-3xl">{withTermHovers(e.biology, { skipId: e.id })}</p></Block>
          <div className="grid *:min-w-0 gap-6 sm:grid-cols-2 mt-8">
            <Field label="Where it is found"><Bullets items={e.whereFound} linked={(t) => withTermHovers(t, { skipId: e.id })} /></Field>
            <Field label="Class"><span className="capitalize">{e.targetClass.replace("-", " ")}</span>{e.symbol && <span className="text-muted"> · {e.symbol}</span>}</Field>
            {e.hgnc && <Field label="Identifiers"><IdentifierRow target={e} /></Field>}
          </div>
          {hpaFor(e.id) && <Block title="Where it is found: normal tissues and cancers"><TargetWhereFound targetId={e.id} /></Block>}
          {e.prevalence.length > 0 && <Block title="How often this target appears"><PrevalenceTable target={e} /></Block>}
        </>),
        ...productsTab(g.incoming(e.id).get("drug") ?? []),
      ];
    case "drug":
      return [
        overview(<>
          {STRUCTURES[e.id] ? <div className="mt-8"><MoleculeViewer entries={STRUCTURES[e.id]} /></div> : <DrugSchematic technologies={e.technologies} modality={e.modality} />}
          <div className="mt-6"><SeeItInAction drug={e.name} group={modalityGroup(e.modality)} mechanism={e.mechanism} steps={e.mechanismSteps} complex={STRUCTURES[e.id]?.find((s) => s.source === "pdb" && /bound to/i.test(s.label))} molecule={STRUCTURES[e.id]?.find((s) => s.source === "pubchem")} targets={e.targets.map((id) => graph().get(id)).filter((t): t is NonNullable<typeof t> => !!t).map((t) => ({ id: t.id, name: t.name, route: routeFor(t) }))} schematic={processSchematicKey(e) ? <ProcessSchematic entity={e} bare height="h-64 sm:h-72" /> : undefined} /></div>
          {/resist|escape|progress/i.test(e.summary) && <div className="mt-6"><WhatIsBeingDone topic="resistance" compact /></div>}
          <div className="grid *:min-w-0 gap-6 sm:grid-cols-2 mt-8">
            <Field label="Modality">{e.modality}</Field>
            <Field label="Mechanism">{e.mechanism}</Field>
            <Field label="Brand / code">{[e.brand, e.code].filter(Boolean).join(" · ")}</Field>
            <Field label="Payload">{e.payload}</Field>
            <Field label="Linker">{e.linker}</Field>
          </div>
          {e.dosing && <div className="mt-6"><DosingCard drug={e} /></div>}
          <ReadoutsForDrug drugId={e.id} />
          {assaysForDrug(e.id).length > 0 && <div className="mt-6"><div className="kicker mb-2"><TL text="Companion diagnostics" /></div><ul className="text-sm space-y-1">{assaysForDrug(e.id).map((a) => <li key={a.id}><Link className="font-medium hover:underline" href={`/assays/#${a.id}`}>{a.name}</Link> <span className="text-muted">· {a.cutoff}</span></li>)}</ul></div>}
          {(coverageUs[e.id] || coverageUk[e.id]) && <div className="mt-6 grid gap-4 md:grid-cols-2">{coverageUs[e.id] && <CoverageUsCard drugId={e.id} />}{coverageUk[e.id] && <CoverageUkCard drugId={e.id} />}</div>}
          <div className="mt-6 space-y-4"><ExclusivityPanel drugId={e.id} /><DealsPanel id={e.id} /><CatalystsPanel id={e.id} /></div>
          {regionalApprovals[e.id] && <div className="mt-6"><div className="kicker mb-2"><TL text="Where it is approved" /></div><RegionStrip row={regionalApprovals[e.id]} /><p className="text-xs text-muted mt-1"><Link className="underline" href="/regulatory/regions/">Compare all products across the US, EU, UK, Japan, China and Australia →</Link></p></div>}
        </>),
        ...(e.approvals.length || e.regulatoryEvents.length ? [{ id: "approvals", label: "Regulatory", count: e.regulatoryEvents.length || e.approvals.length, content: (<>
          {e.regulatoryEvents.length > 0 && <RegulatoryTimeline events={e.regulatoryEvents} />}
          {e.approvals.length > 0 && <Block title="Approvals"><ScrollRow className="-mx-4 px-4"><table className="onco" lang="en"><thead><tr><th>Region</th><th>Year</th><th>Indication</th></tr></thead>
            <tbody>{e.approvals.map((a, i) => <tr key={i}><td>{a.region}</td><td className="tabular-nums">{a.year}</td><td>{a.indication}{a.note && <span className="text-muted"> · {a.note}</span>}</td></tr>)}</tbody></table></ScrollRow></Block>}
        </>) }] : []),
        ...(regimensFor(e.id).length ? [{ id: "regimens", label: "Regimens", count: regimensFor(e.id).length, content: (
          <ul className="grid *:min-w-0 gap-3 sm:grid-cols-2">{regimensFor(e.id).map((r) => <li key={r.id}><Link href={regimenRoute(r)} className="card block p-3 text-sm hover:shadow-md transition"><div className="font-medium">{r.name}</div><div className="text-xs text-muted mt-1 line-clamp-2">{r.setting}</div><div className="text-xs text-muted mt-1">{cycleSummary(r)}</div></Link></li>)}</ul>) }] : []),
        ...(e.toxicity.length || agentById(e.id) || recoveryCellsForDrug(e.id).length ? [{ id: "safety", label: "Safety", count: e.toxicity.length || undefined, content: (<>
          {e.toxicity.length > 0 && <ToxicityTable toxicity={e.toxicity} />}
          <RecoveryPanel drugId={e.id} />
          {agentById(e.id) && <p className="text-sm mt-3"><Link href={`/interactions/?drugs=${e.id}`} className="underline">Check interactions for {e.name} →</Link></p>}
          {/anti-pd|anti-ctla|pd-1|pd-l1|ctla-4|checkpoint/i.test(e.modality + " " + e.mechanism) && <p className="text-sm mt-1"><Link href="/irae/" className="underline">Checkpoint side effects by organ →</Link></p>}
        </>) }] : []),
        ...(e.access.length ? [{ id: "access", label: "Cost & access", count: e.access.length, content: <AccessTable access={e.access} /> }] : []),
        { id: "trials", label: "Trials", content: <><TrialCounts drugId={e.id} /><Block title="Trials recruiting now"><TrialFinder intervention={interventionQuery(e.name)} title={e.name} /></Block>{e.trials.length > 0 && <Block title="Landmark trials"><Refs ids={e.trials} /></Block>}</> },
      ];
    case "company": {
      const stage = stageOf(e);
      const portfolio = e.companyType === "investor" ? portfolioOf(e.id) : [];
      return [
        overview(<div className="grid *:min-w-0 gap-6 sm:grid-cols-2 mt-8">
          <Field label="Headquarters">{e.hq}, {e.country}</Field>
          <div className="sm:col-span-2 space-y-4"><CompanyScorePanel id={e.id} /><FundingPanel id={e.id} /><DealsPanel id={e.id} /><CatalystsPanel id={e.id} /><ManufacturingPanel companyId={e.id} /></div>
          <Field label="Type"><CompanyTypePill type={e.companyType} />{e.ticker && <span className="text-muted"> · {e.ticker}</span>}</Field>
          <Field label="Stage">{stage && <span className="inline-flex items-center gap-1.5"><StageIcon stage={stage} className="h-4 w-4 text-accent" />{STAGE_LABEL[stage]}{e.ycBatch && <span className="text-muted"> · Y Combinator {ycBatchLabel(e.ycBatch)}</span>}</span>}</Field>
          {e.website && <Field label={websiteView(e.website).label}><a className="underline break-all" href={e.website} rel="noopener">{websiteView(e.website).text}</a></Field>}
          <Field label="Founded">{e.founded}</Field>
          {/* Cooperative groups came from institution records and keep their OpenAlex snapshot under the same id. */}
          {e.companyType === "cooperative-group" && <ResearchOutput institutionId={e.id} />}
        </div>),
        ...(e.companyType === "investor" ? [{ id: "portfolio", label: "Portfolio", count: portfolio.length, content: <PortfolioPanel id={e.id} /> }] : []),
        ...productsTab([...new Map([...e.drugs.map((id) => g.must(id)), ...(g.incoming(e.id).get("drug") ?? [])].map((d) => [d.id, d])).values()]),
        ...peopleTab([...(g.incoming(e.id).get("person") ?? []), ...e.people.map((id) => g.must(id))]),
      ];
    }
    case "institution": {
      const row = rankInstitutions().find((r) => r.institution.id === e.id);
      return [
        overview(<>
          <div className="grid *:min-w-0 gap-6 sm:grid-cols-2 mt-8">
            <Field label="Location">{e.city}, {e.country}</Field>
            <Field label="Type"><span className="capitalize">{e.institutionType.replace("-", " ")}</span>{e.university && <span className="text-muted"> · {e.university}</span>}</Field>
            {e.website && <Field label={websiteView(e.website).label}><a className="underline break-all" href={e.website} rel="noopener">{websiteView(e.website).text}</a></Field>}
            <Field label="Newsweek 2026 oncology rank">{e.newsweekOncology2026 ? `#${e.newsweekOncology2026}` : "Not in top 300 listing used"}</Field>
            {e.nci && <Field label="NCI designation"><span className="capitalize">{e.nci}</span></Field>}
            {row && <Field label="OnCo score">#{row.rank} · {row.score} points ({row.newsweekPoints} Newsweek + {row.nciPoints} NCI + {row.linkPoints} from {row.links} linked objects) · <Link className="underline" href="/institutions/">ranking</Link></Field>}
            <ResearchOutput institutionId={e.id} />
          </div>
        </>),
        ...(e.programs.length ? [{ id: "programmes", label: "Programmes", count: e.programs.length, content: <Bullets items={e.programs} linked={(t) => withTermHovers(t, { skipId: e.id })} /> }] : []),
        ...peopleTab([...(g.incoming(e.id).get("person") ?? []), ...e.people.map((id) => g.must(id))]),
      ];
    }
    case "pathway":
      return [
        overview(<Block title="Analogy"><p className="text-[15px] leading-relaxed max-w-3xl italic">{e.analogy}</p></Block>),
        { id: "diagram", label: "Diagram", content: <PathwayDiagram p={e} /> },
        { id: "interventions", label: "How drugs attack it", count: e.interventions.length, content: <Bullets items={e.interventions} linked={(t) => withTermHovers(t, { skipId: e.id })} /> },
      ];
    case "term":
      return [overview(<><div className="mt-8"><TermVisualPanel term={e} /></div><ReadoutsForTerm termId={e.id} /><div className="mt-6"><Field label="Category"><Link className="underline" href={`/terms/?category=${encodeURIComponent(e.category)}`}>{e.category}</Link></Field></div></>)];
    case "trial":
      return [
        overview(<div className="grid *:min-w-0 gap-6 sm:grid-cols-2 mt-8">
          <Field label="Setting">{e.setting}</Field>
          <Field label="Phase">{phaseLabel(e.phase)}</Field>
          <Field label="Sponsor">{e.sponsor}</Field>
          <Field label="Registry">{e.nct && <a className="underline" href={`https://clinicaltrials.gov/study/${e.nct}`} rel="noopener">{e.nct}</a>}</Field>
          <Field label="Headline result">{e.result}</Field>
          <Field label="Started">{e.started && <span title={e.startedType ? `ClinicalTrials.gov marks this start date ${e.startedType}` : "Start date as ClinicalTrials.gov states it"}>{e.started}{e.startedType === "estimated" && <span className="text-xs text-muted"> (estimated)</span>}</span>}</Field>
          <Field label="Reported">{e.yearReported}</Field>
          <Field label="Enrolled">{e.enrolled !== undefined && <span title={e.enrolledNote ?? undefined}>{enrolmentLabel(e.enrolled, e.enrolledBasis)}{e.enrolledNote && <span className="block text-xs text-muted mt-0.5">{e.enrolledNote}</span>}</span>}</Field>
          <Field label="Replication">{e.replication}</Field>
        </div>),
        ...(e.outcomes.length ? [{ id: "outcomes", label: "Outcomes", count: e.outcomes.length, content: <div className="space-y-4"><TrialExplainer trial={e} /><TrialOutcomes t={e} /></div> }] : []),
      ];
    case "pairing": {
      const a = g.get(e.a), b = g.get(e.b);
      return [
        overview(<>
          <div className="card p-4 mt-6 flex flex-wrap items-center gap-3 text-sm">
            {a && <Link href={routeFor(a)} className={`chip border text-sm ${KIND_COLOR[a.kind]}`}>{a.name}</Link>}
            <span className="text-muted">{e.pairingType === "caution" ? "⚠ with" : e.pairingType === "sequence" ? "→ then" : e.pairingType === "diagnostic-therapeutic" ? "→ selects" : "+"}</span>
            {b && <Link href={routeFor(b)} className={`chip border text-sm ${KIND_COLOR[b.kind]}`}>{b.name}</Link>}
            <span className={`chip ml-auto ${statusClass(e.pairingType === "caution" ? "negative" : "established")}`}>{e.pairingType.replace("-", " → ")}</span>
          </div>
          <div className="grid *:min-w-0 gap-6 sm:grid-cols-2 mt-8">
            <Field label="Rationale">{e.rationale}</Field>
            <Field label="Evidence">{e.evidence}</Field>
          </div>
        </>),
      ];
    }
    case "roadmap":
      return [overview(), { id: "steps", label: "Steps", count: e.steps.length, content: <RoadmapSteps r={e} /> }, { id: "story", label: "Story", content: <RoadmapStory title={e.name} steps={roadmapStorySteps(e)} src={roadmapFile(e.id)} /> }];
    case "idea":
      return [
        overview(<div className="grid *:min-w-0 gap-6 mt-8">
          {(confidence[e.id] || e.confidence) && <Field label="Confidence"><ConfidenceChip id={e.id} value={e.confidence ?? undefined} /></Field>}
          <Field label="Hypothesis">{e.hypothesis}</Field>
          <Field label="Rationale">{e.rationale}</Field>
          <Field label="Proposed test">{e.test}</Field>
          <Field label="Maturity"><span className={`chip ${statusClass(e.maturity === "being-tested-at-scale" ? "phase-3" : e.maturity === "early-clinical" ? "phase-2" : e.maturity === "preclinical-evidence" ? "phase-1" : "concept")}`}>{e.maturity.replace(/-/g, " ")}</span></Field>
          {(e.actor || e.cost || e.horizonYears !== undefined) && <div className="grid *:min-w-0 gap-6 sm:grid-cols-3">
            {e.actor && <Field label="Who acts"><span className="capitalize">{e.actor}</span></Field>}
            {e.cost && <Field label="Cost to try">{e.cost === "small" ? "Small (under $1M)" : e.cost === "medium" ? "Medium ($1M to $50M)" : "Large (over $50M)"}</Field>}
            {e.horizonYears !== undefined && <Field label="Years to first evidence">{e.horizonYears}</Field>}
          </div>}
          {e.bottlenecks.length > 0 && <Field label="Bottlenecks it attacks"><ul className="space-y-1">{e.bottlenecks.map((id) => { const b = g.get(id); return b ? <li key={id}><Link className="underline" href={routeFor(b)}>{b.name}</Link><span className="text-muted"> · {b.tldr}</span></li> : null; })}</ul></Field>}
        </div>),
      ];
    case "paper": {
      const typeLabel: Record<string, string> = { rct: "Randomised controlled trial", "meta-analysis": "Meta-analysis", observational: "Observational study", "real-world": "Real-world evidence", basic: "Basic science", translational: "Translational study", review: "Review", guideline: "Guideline", methods: "Methods" };
      return [
        overview(<div className="grid *:min-w-0 gap-6 mt-8">
          <div className="flex flex-wrap gap-2 items-center text-sm">
            <span className="chip bg-foreground/5">{typeLabel[e.paperType] ?? e.paperType}</span>
            {e.changedPractice !== undefined && <span className={`chip ${statusClass(e.changedPractice ? "approved" : "mixed")}`}>{e.changedPractice ? "Changed practice" : "Has not changed practice yet"}</span>}
            {e.participants !== undefined && <span className="chip bg-foreground/5 tabular-nums">{e.participants.toLocaleString()} participants</span>}
            <CitationChip id={e.id} />
          </div>
          <div className="grid *:min-w-0 gap-6 sm:grid-cols-2">
            <Field label="Authors">{e.authors}</Field>
            <Field label="Published">{(() => { const j = g.kind("journal").find((x) => x.kind === "journal" && (x.name === e.journal || x.matchNames.includes(e.journal))); return j ? <Link className="underline" href={routeFor(j)}>{e.journal}</Link> : e.journal; })()}, {e.year}</Field>
            {(e.doi || e.pmid) && <Field label="Full text">{e.doi && <a className="underline mr-3" href={`https://doi.org/${e.doi}`} rel="noopener">doi:{e.doi}</a>}{e.pmid && <a className="underline" href={`https://pubmed.ncbi.nlm.nih.gov/${e.pmid}/`} rel="noopener">PubMed {e.pmid}</a>}</Field>}
          </div>
          {e.findings.length > 0 && <Field label="Findings"><ul className="list-disc ps-5 space-y-1">{e.findings.map((f, i) => <li key={i}>{withTermHovers(f)}</li>)}</ul></Field>}
          <div className="card p-4 bg-accent-soft/60 border-accent/20"><div className="kicker mb-1"><TL text="What it means" /></div><p className="text-[15px] leading-relaxed">{withTermHovers(e.whatItMeans)}</p></div>
          {e.caveats.length > 0 && <Field label="Caveats"><ul className="list-disc ps-5 space-y-1">{e.caveats.map((c, i) => <li key={i}>{withTermHovers(c)}</li>)}</ul></Field>}
        </div>),
      ];
    }
    case "journal": {
      const papers = g.kind("paper").filter((p): p is Paper => p.kind === "paper" && (p.journal === e.name || e.matchNames.includes(p.journal))).sort((a, b) => b.year - a.year);
      const people = g.kind("person").filter((p) => p.kind === "person" && p.papers.some((pp) => pp.journal && (pp.journal === e.name || e.matchNames.includes(pp.journal))));
      return [
        overview(<div className="grid *:min-w-0 gap-6 mt-8">
          <div className="grid *:min-w-0 gap-6 sm:grid-cols-2">
            <Field label="Publisher">{e.publisher}{e.society && <span className="text-muted"> · {e.society}</span>}</Field>
            <Field label="Scope">{e.scope}</Field>
            <Field label="Website"><a className="underline break-all" href={e.url} rel="noopener">{e.url.replace(/^https?:\/\//, "")}</a></Field>
            {e.access && <Field label="Access model"><span className="capitalize">{e.access.replace(/-/g, " ")}</span></Field>}
            {e.founded && <Field label="Founded">{e.founded}</Field>}
            {e.issn && <Field label="ISSN">{e.issn}</Field>}
            {e.impactFactor && <Field label={`Impact factor (${e.impactFactor.year})`}><span className="tabular-nums">{e.impactFactor.value}</span>{e.impactFactor.source && <span className="text-muted text-xs"> · {e.impactFactor.source}</span>}</Field>}
          </div>
        </div>),
        ...(papers.length ? [{ id: "key-papers", label: "Key papers", count: papers.length, content: (
          <div className="grid *:min-w-0 gap-3 md:grid-cols-2"><CitationChipDefs />{papers.map((p) => <Link key={p.id} href={routeFor(p)} className="card p-4 hover:shadow-md transition"><div className="flex flex-wrap items-center gap-2 text-xs text-muted mb-1"><span className="chip bg-foreground/5">{p.paperType.replace(/-/g, " ")}</span><span>{p.year}</span>{p.changedPractice && <span className={`chip ${statusClass("approved")}`}>changed practice</span>}<CitationChip id={p.id} sprite /></div><div className="font-medium leading-snug">{p.name}</div><p className="text-sm text-muted mt-1 line-clamp-3">{p.whatItMeans}</p></Link>)}</div>) }] : []),
        ...peopleTab(people),
      ];
    }
    case "bottleneck": {
      const ideas = g.incoming(e.id).get("idea") ?? [];
      const relievers = [...(g.incoming(e.id).get("technology") ?? []), ...(g.incoming(e.id).get("collection") ?? []), ...(g.incoming(e.id).get("trial") ?? [])];
      const sevClass = e.severity === "critical" ? "negative" : e.severity === "major" ? "phase-2" : "mixed";
      return [
        overview(<div className="grid *:min-w-0 gap-6 mt-8">
          <div className="flex flex-wrap gap-2"><span className={`chip ${statusClass(sevClass)}`}>{e.severity}</span><span className="chip bg-foreground/5">{e.stage.replace(/-/g, " ")}</span><span className="chip bg-foreground/5">{ideas.length} ideas to fix it</span></div>
          {e.metrics.length > 0 && <div><div className="kicker mb-2"><TL text="Scale of the problem" /></div><div className="grid *:min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">{e.metrics.map((m, i) => <div key={i} className="card p-3"><div className="text-2xl font-semibold tabular-nums">{m.value}</div><div className="text-sm">{m.label}</div>{(m.source || m.url) && <div className="text-xs text-muted mt-1">{m.url ? <a className="underline" href={m.url} rel="noopener">{m.source ?? "source"}</a> : m.source}</div>}</div>)}</div></div>}
          {e.causes.length > 0 && <Field label="Root causes"><ul className="list-disc ps-5 space-y-1">{e.causes.map((c, i) => <li key={i}>{withTermHovers(c)}</li>)}</ul></Field>}
          {e.currentEfforts.length > 0 && <Field label="Current efforts"><ul className="list-disc ps-5 space-y-1">{e.currentEfforts.map((c, i) => <li key={i}>{withTermHovers(c)}</li>)}</ul></Field>}
          {e.successLooksLike && <Field label="Success criteria">{e.successLooksLike}</Field>}
        </div>),
        ...(ideas.length ? [{ id: "ideas", label: "Ideas to fix it", count: ideas.length, content: (
          <div className="grid *:min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">{ideas.map((i) => i.kind === "idea" && <Link key={i.id} href={routeFor(i)} className="card p-3 hover:shadow-md transition"><div className="flex flex-wrap gap-1 mb-1"><span className={`chip ${statusClass(i.maturity === "being-tested-at-scale" ? "phase-3" : i.maturity === "early-clinical" ? "phase-2" : i.maturity === "preclinical-evidence" ? "phase-1" : "concept")}`}>{i.maturity.replace(/-/g, " ")}</span>{i.actor && <span className="chip bg-foreground/5">{i.actor}</span>}{i.cost && <span className="chip bg-foreground/5">{i.cost} cost</span>}</div><div className="font-medium">{i.name}</div><p className="text-sm text-muted mt-0.5 line-clamp-3">{i.tldr}</p></Link>)}</div>) }] : []),
        ...(relievers.length ? [{ id: "relievers", label: "Relief available today", count: relievers.length, content: <RefsWithMolecules ids={relievers.map((r) => r.id)} /> }] : []),
      ];
    }
    case "biomarker":
      return [overview(<BiomarkerDetail bm={e} />)];
    case "year":
      // Generated from every dated field in the corpus (src/data/years.ts). One tab: the counts strip, then every
      // dated entry grouped by what kind of thing it was, then the previous and next year.
      return [
        overview(<><YearStats y={e} /><YearEvents y={e} /><YearNav y={e} /></>),
      ];
    case "collection":
      return [
        overview(<div className="grid *:min-w-0 gap-6 sm:grid-cols-2 mt-8">
          <Field label="URL"><a className="underline break-all" href={e.url} rel="noopener">{e.url.replace(/^https?:\/\//, "")}</a></Field>
          <Field label="Holds">{e.holds}</Field>
          <Field label="Licence">{e.license}</Field>
          <Field label="Maintainer">{e.maintainer}</Field>
          {datasetFor(e.id) && (() => { const d = datasetFor(e.id)!; return (<div className="sm:col-span-2 card p-4 text-sm"><div className="kicker mb-1">Dataset registry</div><div><span className="text-muted">Size:</span> {d.size}</div><div><span className="text-muted">Access:</span> {d.access}</div><div><span className="text-muted">Consent and reuse:</span> {d.consent}</div><Link className="underline text-xs text-muted mt-2 inline-block" href="/models/">All datasets and the models trained on them →</Link></div>); })()}
        </div>),
      ];
    case "person": {
      const inst = e.institutionId ? g.get(e.institutionId) : undefined;
      return [
        overview(<div className="grid *:min-w-0 gap-6 sm:grid-cols-2 mt-8">
          <Field label="Role">{e.role}</Field>
          <Field label={inst?.kind === "company" ? "Group" : "Institution"}>{inst && <Link className="underline" href={routeFor(inst)}>{inst.name}</Link>}</Field>
          <Field label="Specialisms"><div className="flex flex-wrap gap-1">{e.specialisms.map((s) => <span key={s} className="chip bg-foreground/5">{s}</span>)}</div></Field>
          <Field label="Profiles"><ul className="space-y-0.5">{e.profiles.map((p) => <li key={p.url}><a className="underline" href={p.url} rel="noopener">{p.label}</a></li>)}{e.orcid && <li><a className="underline" href={`https://orcid.org/${e.orcid}`} rel="noopener">ORCID {e.orcid}</a></li>}</ul></Field>
        </div>),
        ...(e.papers.length ? [{ id: "papers", label: "Papers", count: e.papers.length, content: (
          <div className="card"><ScrollRow><table className="onco" lang="en"><thead><tr><th>Title</th><th>Journal</th><th>Year</th></tr></thead>
            <tbody>{e.papers.map((p, i) => <tr key={i}><td>{p.url || p.doi ? <a className="underline" href={p.url ?? `https://doi.org/${p.doi}`} rel="noopener">{p.title}</a> : p.title}{p.note && !PAPER_PROVENANCE[p.note] && <div className="text-xs text-muted">{p.note}</div>}</td><td className="text-muted">{p.journal}</td><td className="tabular-nums text-muted">{p.year}</td></tr>)}</tbody></table></ScrollRow>
            {paperProvenance(e.papers).map((line) => <p key={line} className="px-4 py-2 text-xs text-muted border-t border-border">{line}</p>)}</div>) }] : []),
      ];
    }
    case "section": {
      const techs = g.incoming(e.id).get("technology") ?? [];
      return [
        overview(<div className="mt-8"><FrontSchematic sectionId={e.id} /></div>),
        { id: "technologies", label: "Technologies", count: techs.length, content: (
          <div className="grid *:min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">{techs.map((t) => t.kind === "technology" && <Link key={t.id} href={routeFor(t)} className="card overflow-hidden hover:shadow-md transition"><TechSchematic tech={t} compact height="h-32" /><div className="p-3"><div className="flex items-center gap-2 mb-1"><StatusChip status={t.status} /></div><div className="font-medium">{t.name}</div><p className="text-sm text-muted mt-0.5 line-clamp-2">{t.tldr}</p></div></Link>)}</div>) },
      ];
    }
  }
}

function peopleTab(items: Entity[]): Tab[] {
  const people = [...new Map(items.filter((x) => x.kind === "person").map((x) => [x.id, x])).values()];
  if (!people.length) return [];
  return [{ id: "people", label: "People", count: people.length, content: (
    <div className="grid *:min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">{people.map((p) => p.kind === "person" && (
      <Link key={p.id} href={routeFor(p)} className="card p-3 hover:shadow-md transition">
        <div className="flex items-start gap-3">
          <Portrait id={p.id} name={p.name} size={40} className="mt-0.5" />
          <div className="min-w-0">
            <div className="font-medium">{p.name}</div>
            <div className="text-xs text-muted">{p.role}</div>
          </div>
        </div><div className="mt-1 flex flex-wrap gap-1">{p.specialisms.slice(0, 3).map((s) => <span key={s} className="chip bg-foreground/5">{s}</span>)}</div><p className="text-sm text-muted mt-1 line-clamp-2">{p.tldr}</p></Link>))}</div>) }];
}

function productsTab(drugs: Entity[]): Tab[] {
  if (!drugs.length) return [];
  return [{ id: "products", label: "Products", count: drugs.length, content: <DrugGrid drugs={drugs.filter((d): d is Drug => d.kind === "drug")} /> }];
}

/** Refs with product cards (molecule thumbnails) for drugs and chips for everything else. */
function RefsWithMolecules({ ids }: { ids: string[] }) {
  const g = graph();
  const items = ids.map((id) => g.get(id)).filter((x): x is Entity => !!x);
  const drugs = items.filter((x): x is Drug => x.kind === "drug");
  const rest = items.filter((x) => x.kind !== "drug");
  return (<>
    {drugs.length > 0 && <DrugGrid drugs={drugs} compact />}
    {rest.length > 0 && <div className={drugs.length ? "mt-4" : ""}><ChipList items={rest} /></div>}
  </>);
}

/**
 * The timeline. Every era's date range, status, title and summary are in the HTML; each era's records, trial
 * outcomes and papers sit behind a "Show era" pill that fetches /api/v1/roadmaps/<id>.json (src/lib/roadmap-eras.ts),
 * except the first and the current era, which are open and carry their bodies. The watch table carries its first
 * WATCH_PAGE rows and pages the rest from the same file.
 */
function RoadmapSteps({ r }: { r: Roadmap }) {
  const g = graph();
  const tone: Record<string, string> = { historic: "bg-zinc-400", current: "bg-emerald-500", emerging: "bg-amber-500", speculative: "bg-violet-500" };
  const src = roadmapFile(r.id);
  const open = new Set(defaultOpen(r));
  const watch = watchRows(g, r);
  return (<>
    <ol className="relative border-s-2 border-border ms-3 space-y-8">
      {r.steps.map((s, i) => {
        const body = eraBody(g, s);
        return (
          <li key={i} className="ml-6">
            <span className={`absolute -left-[9px] mt-1.5 h-4 w-4 rounded-full ring-4 ring-background ${tone[s.status]}`} />
            <div className="flex flex-wrap items-center gap-2"><span className="kicker">{s.era}</span><span className={`chip ${statusClass(s.status === "current" ? "approved" : s.status === "emerging" ? "phase-2" : s.status === "speculative" ? "concept" : "historic")}`}>{s.status}</span>{s.status === "speculative" && <ConfidenceChip id={`${r.id}#${i}`} compact />}</div>
            <h3 className="font-semibold mt-1">{s.title}</h3>
            <p className="text-[15px] leading-relaxed mt-1 max-w-3xl">{s.description}</p>
            <RoadmapEra src={src} index={i} counts={eraCounts(body)} initial={open.has(i) ? body : undefined} />
          </li>
        );
      })}
    </ol>
    <p className="text-xs text-muted mt-4" data-roadmap-export>
      <noscript>Show era needs JavaScript. </noscript>Every era&apos;s records, trial outcomes and papers, and every watch item, as <a href={src} className="underline">JSON</a>.
    </p>
    {r.steps.some((s) => s.status === "speculative") && <div className="mt-4"><ConfidenceLegend /></div>}
    {watch.length > 0 && (
      <section className="mt-10" aria-labelledby={`${r.id}-watch`}>
        <h3 id={`${r.id}-watch`} className="font-semibold">What to watch <span className="text-muted font-normal tabular-nums">({watch.length.toLocaleString("en-GB")})</span></h3>
        <p className="text-sm text-muted mt-1 max-w-3xl">Readouts, decisions and registry completion dates ahead. Each date is quoted from its source, not inferred; a missing date means no source states one.</p>
        <ol className="card divide-y divide-border mt-3">
          {watch.slice(0, WATCH_PAGE).map((w, i) => <WatchRowView key={i} row={w} />)}
          {watch.length > WATCH_PAGE && <RoadmapWatchMore src={src} total={watch.length} first={WATCH_PAGE} />}
        </ol>
      </section>
    )}
    <RegistryCheck roadmapId={r.id} />
  </>);
}

/** "Depends on" and "Needed by" strips from the technology dependency DAG (`dependsOn`), linking to the map with this technology as root. */
function TechDependencies({ e }: { e: Extract<Entity, { kind: "technology" }> }) {
  const g = graph();
  const up = e.dependsOn.map((id) => g.get(id)).filter((t): t is Entity => !!t);
  const down = g.kind("technology").filter((t) => t.dependsOn.includes(e.id));
  if (!up.length && !down.length) return null;
  const chip = (t: Entity) => <Link key={t.id} href={routeFor(t)} className="chip border bg-card border-border hover:bg-foreground/5 text-sm">{t.name}</Link>;
  const mapHref = `/dependencies/?root=${e.id}`;
  return (
    <Block title="Dependencies" aside={<Link className="text-sm text-accent hover:underline whitespace-nowrap" href={mapHref}>Open the dependency map →</Link>}>
      <div className="grid *:min-w-0 gap-4 sm:grid-cols-2">
        <div>
          <div className="kicker mb-1.5"><TL text="Depends on" /> <span className="text-muted font-normal">({up.length})</span></div>
          {up.length ? <div className="flex flex-wrap gap-1.5">{up.map(chip)}</div> : <p className="text-sm text-muted">Nothing recorded yet: a foundation, or a gap to fill.</p>}
        </div>
        <div>
          <div className="kicker mb-1.5"><TL text="Needed by" /> <span className="text-muted font-normal">({down.length})</span></div>
          {down.length ? <div className="flex flex-wrap gap-1.5">{down.map(chip)}</div> : <p className="text-sm text-muted">Nothing in the corpus depends on this yet.</p>}
        </div>
      </div>
      <p className="text-xs text-muted mt-3">Dependencies are what this technology cannot be delivered without: manufacturing steps, instruments, software, upstream methods. <Link className="underline" href={mapHref}>See its full chain on the map</Link>.</p>
    </Block>
  );
}

/** Products with no molecule (cells, vaccines, devices, tests) get the schematic of their primary technology. */
function DrugSchematic({ technologies, modality }: { technologies: string[]; modality: string }) {
  const g = graph();
  const tech = technologies.map((id) => g.get(id)).find((t) => t && t.kind === "technology");
  if (!tech || tech.kind !== "technology") return null;
  const { mesh } = schematicFor(tech.id, tech.sections);
  return (
    <div className="mt-8 card overflow-hidden">
      <Wireframe3D mesh={mesh} />
      <div className="px-4 py-3 border-t border-border text-sm"><span className="font-medium">Schematic of the modality</span><span className="text-muted"> · {modality} · not a molecule; see the <Link className="underline" href={routeFor(tech)}>{tech.name}</Link> page</span></div>
    </div>
  );
}

/** A glossary term's picture: its target, molecule, technology or organ when it has one, otherwise the category animation. */
function TermVisualPanel({ term }: { term: Term }) {
  const g = graph();
  const v = termVisual(term, g);
  switch (v.kind) {
    case "target": return <><TargetSchematic target={v.target} /><p className="mt-2 text-xs text-muted">Showing the target this term concerns: <Link className="underline" href={`/targets/${v.target.id}/`}>{v.target.name}</Link>.</p></>;
    case "molecule": { const entries = STRUCTURES[v.drugId] ?? []; const d = g.get(v.drugId); return <><MoleculeViewer entries={entries} /><p className="mt-2 text-xs text-muted">Showing the molecule this term concerns: {d ? <Link className="underline" href={routeFor(d)}>{d.name}</Link> : v.drugId}.</p></>; }
    case "tech": return <><TechSchematic tech={v.tech} /><p className="mt-2 text-xs text-muted">Showing the technology this term belongs to: <Link className="underline" href={routeFor(v.tech)}>{v.tech.name}</Link>.</p></>;
    case "cancer": { const c = g.get(v.cancerId); return <><OrganSchematic cancerId={v.cancerId} /><p className="mt-2 text-xs text-muted">Showing the organ this term concerns{c ? <>: <Link className="underline" href={routeFor(c)}>{c.name}</Link></> : null}.</p></>; }
    default: return <TermSchematic category={term.category} />;
  }
}
