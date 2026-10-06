"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { SearchResult } from "minisearch";
import { askLexical, loadSearch, searchRanked } from "@/lib/search-client";
import { MoleculeSlot } from "./MoleculeSlot";
import { KindIcon } from "./KindIcon";
import { NavIcon, NavItemIcon } from "./NavIcon";
import type { SearchDoc } from "@/lib/search-index";
import { KIND_META, KINDS, type Kind } from "@/lib/kinds";
import { KIND_COLOR, STATUS_LABEL, statusClass } from "@/lib/text";
import { loadSemantic } from "@/lib/semantic-client";
import { fuseRanks, semanticSearch, type SemanticIndex } from "@/lib/semantic";
import { loadAskIndex } from "@/lib/ask-index";
import { answerQuestion, type AskResult } from "@/lib/ask-pipeline";
import type { Neighbour } from "@/lib/ask-compose";
import { loadEntityRecord } from "@/lib/entity-client";
import { pickMyCancer, shortCancerName, useMyCancer } from "@/lib/use-my-cancer";
import { useMyCancerList } from "@/lib/use-my-cancer-list";
import { CancerIcon } from "./CancerIcon";
import { askHref, FEW_HITS, looksLikeQuestion, normaliseQuery, parseSearchState, searchHref, searchQueryString, searchTerms, usefulSuggestions } from "@/lib/search-query";

type Row = SearchDoc & { lexical?: string[]; concept?: string[]; both: boolean; rank: number };
type Phase = "idle" | "loading" | "lexical" | "fused";
type Related = { of: Row; items: Neighbour[] };
/** An Ask OnCo outcome tagged with the query it answers, so a stale answer never shows under a new query. */
type AskState = { q: string; result: AskResult | "unavailable" };

const TOP = 40;
const PAGE_STRIP = 4;
const RELATED_MAX = 8;
const ASK_SENTENCES = 3;
/** Typing pause before the on-page box runs a search. */
const DEBOUNCE_MS = 120;
const ALL_KINDS: readonly string[] = [...KINDS, "page"];

/** The concept index once it has arrived, so a later search can fuse in the same frame as the word search. */
let semanticResolved: SemanticIndex | null | undefined;

/**
 * Outcome questions typed without a cancer name: "is it curable", "how long", "will I die". These are among the
 * commonest things a frightened person types and they match no record, so the generic empty state used to answer
 * them by asking for an NCT number. The same wording, with a cancer named, reaches `tPrognosis` in ask-compose.ts,
 * which leads with what can be done and never with a bare number; the empty state says so.
 */
const OUTCOME_QUESTION = /\b(curable|cure rate|how long|life expectancy|survival rate|prognosis|outlook|terminal|how serious|how bad|my chances|chances? of surviv|am i going to die|will i die|how deadly)\b/i;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const kindLabel = (k: string) => (k === "page" ? "Page" : KIND_META[k as Kind].label);
const kindChipClass = (k: string) => (k === "page" ? "border-border text-muted bg-card" : KIND_COLOR[k]);
function KindGlyph({ kind, className = "h-3 w-3" }: { kind: string; className?: string }) {
  return kind === "page" ? <NavIcon id="find" className={className} /> : <KindIcon kind={kind as Kind} className={className} />;
}

function SectionHeading({ id, icon, children, aside }: { id: string; icon: React.ReactNode; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-2">
      <h2 id={id} className="flex items-center gap-1.5 text-sm font-semibold tracking-tight"><span className="text-accent">{icon}</span>{children}</h2>
      {aside}
    </div>
  );
}

/** Where to go when there is nothing to show yet, or nothing matched: the body map, For me, and every kind hub. */
function Hubs({ heading }: { heading: string }) {
  return (
    <section aria-labelledby="search-hubs" className="mt-6">
      <SectionHeading id="search-hubs" icon={<NavIcon id="map" className="h-4 w-4" />}>{heading}</SectionHeading>
      <ul className="grid gap-2 sm:grid-cols-2">
        {[{ href: "/body/", label: "Body map", blurb: "Start from where the cancer is in the body." }, { href: "/for-me/", label: "For me", blurb: "Choose your cancer type and see what works and what could work." }].map((h) => (
          <li key={h.href}>
            <Link href={h.href} className="card p-3 flex items-start gap-3 hover:bg-foreground/5 h-full">
              <span className="text-accent mt-0.5"><NavItemIcon href={h.href} label={h.label} className="h-5 w-5" /></span>
              <span className="min-w-0"><span className="block font-medium">{h.label}</span><span className="block text-sm text-muted">{h.blurb}</span></span>
            </Link>
          </li>
        ))}
      </ul>
      <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Browse by kind">
        {KINDS.map((k) => (
          <li key={k}><Link href={`/${KIND_META[k].route}/`} className={`chip border ${KIND_COLOR[k]} hover:brightness-95 dark:hover:brightness-125`}><KindIcon kind={k} className="h-3 w-3" />{cap(KIND_META[k].title ?? KIND_META[k].plural)}</Link></li>
        ))}
      </ul>
    </section>
  );
}

function Skeleton() {
  return (
    <ol aria-hidden className="space-y-2 mt-3">
      {Array.from({ length: 5 }, (_, i) => (
        <li key={i} className="card p-3 flex items-start gap-3 animate-pulse">
          <span className="h-4 w-6 rounded bg-foreground/5" />
          <span className="flex-1 space-y-2"><span className="block h-4 w-2/5 rounded bg-foreground/5" /><span className="block h-3 w-4/5 rounded bg-foreground/5" /><span className="block h-3 w-1/3 rounded bg-foreground/5" /></span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Full search results: lexical (MiniSearch over names, aliases, TL;DRs and tags) and concept search
 * (TF-IDF over each record plus the names of everything it links to) fused by reciprocal rank, with the
 * reason each hit matched. Around the list: the site's own pages first, kind filter chips with counts,
 * "Did you mean" from MiniSearch's fuzzy suggestions, an Ask OnCo answer when the query is a question,
 * and the top hit's related records. Every state lives in ?q= and ?kind=, so it is shareable.
 */
export function SearchResults() {
  const [q, setQ] = useState("");
  const [forMine, setForMine] = useState(false);
  const myId = useMyCancer().id;
  const mine = pickMyCancer(useMyCancerList(!!myId), myId);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [semanticReady, setSemanticReady] = useState<boolean | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [ask, setAsk] = useState<AskState | null>(null);
  const [related, setRelated] = useState<Related | null>(null);
  const latest = useRef("");
  const searchReady = useRef(false);
  const urlReady = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(async (raw: string) => {
    const value = normaliseQuery(raw);
    latest.current = value;
    setQuery(value);
    if (!value) { setRows(null); setPhase("idle"); setSuggestions([]); return; }
    const terms = searchTerms(value) || value;
    if (!searchReady.current) setPhase("loading");
    const { ms, byId } = await loadSearch();
    searchReady.current = true;
    if (latest.current !== value) return;
    const lexical: SearchResult[] = searchRanked(ms, terms, TOP);
    const lexTerms = new Map(lexical.map((h) => [String(h.id), Object.keys(h.match ?? {})]));
    const build = (index: SemanticIndex | null): Row[] => {
      const concept = index ? semanticSearch(index, terms, TOP) : [];
      const conTerms = new Map(concept.map((h) => [h.id, h.matched.slice(0, 4)]));
      const fused = fuseRanks([lexical.map((h) => ({ id: String(h.id) })), concept]).slice(0, TOP);
      return fused.map((f, i) => ({ ...byId.get(f.id)!, lexical: lexTerms.get(f.id), concept: conTerms.get(f.id), both: f.in.length === 2, rank: i + 1 })).filter((r) => r.id);
    };
    const finish = (index: SemanticIndex | null) => {
      const out = build(index);
      setRows(out);
      setSemanticReady(!!index);
      setPhase("fused");
      setSuggestions(out.length < FEW_HITS ? usefulSuggestions(value, ms.autoSuggest(terms, { fuzzy: 0.3, prefix: true })) : []);
    };
    if (semanticResolved !== undefined) { finish(semanticResolved); return; }
    // First paint straight from the word index; the concept index is fused in when it lands.
    setRows(build(null));
    setPhase("lexical");
    const index = await loadSemantic();
    semanticResolved = index;
    if (latest.current !== value) return;
    finish(index);
  }, []);

  // Initial state from the URL, then keep the URL in step so every state is shareable.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const s = parseSearchState(window.location.search, ALL_KINDS);
      setKind(s.kind);
      urlReady.current = true;
      if (s.q) { setQ(s.q); run(s.q); }
    });
    return () => cancelAnimationFrame(id);
  }, [run]);
  useEffect(() => {
    if (!urlReady.current) return;
    window.history.replaceState(null, "", searchQueryString({ q: query, kind }) || window.location.pathname);
  }, [query, kind]);

  const submit = (value: string) => {
    if (timer.current) clearTimeout(timer.current);
    setQ(value);
    run(value);
  };
  const type = (value: string) => {
    setQ(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => run(value), DEBOUNCE_MS);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // Ask OnCo, only when the query reads as a question and only after the list has painted.
  const isQuestion = looksLikeQuestion(query);
  useEffect(() => {
    if (!isQuestion || !query) return;
    let live = true;
    (async () => {
      const [{ ms }, semantic, index] = await Promise.all([loadSearch(), loadSemantic(), loadAskIndex()]);
      if (!live) return;
      if (!index) { setAsk({ q: query, result: "unavailable" }); return; }
      const result = await answerQuestion(query, {
        index,
        lexical: (text, k) => askLexical(ms, text, k),
        concept: (text, k) => (semantic ? semanticSearch(semantic, text, k).map((h) => h.id) : []),
        load: loadEntityRecord,
      }).catch(() => null);
      if (live) setAsk({ q: query, result: result ?? "unavailable" });
    })();
    return () => { live = false; };
  }, [query, isQuestion]);
  const askState = ask && ask.q === query ? ask.result : "loading";
  const askResult = typeof askState === "object" ? askState : null;

  // Related records of the top hit (pages have no neighbours, so the first record wins).
  const top = useMemo(() => (rows ?? []).find((r) => r.kind !== "page") ?? null, [rows]);
  useEffect(() => {
    if (!top || phase !== "fused") return;
    let live = true;
    loadEntityRecord(top.id).then((rec) => {
      if (!live || !rec) return;
      const seen = new Set<string>([top.id]);
      const items: Neighbour[] = [];
      outer: for (const list of Object.values(rec.neighbours ?? {})) for (const n of list) { if (seen.has(n.id)) continue; seen.add(n.id); items.push(n); if (items.length >= RELATED_MAX) break outer; }
      setRelated({ of: top, items });
    }).catch(() => { /* The optional related strip must not turn a failed record fetch into an unhandled rejection. */ });
    return () => { live = false; };
  }, [top, phase]);
  // Only the strip for the current top hit is shown; a strip fetched for an earlier query stays hidden.
  const relatedShown = related && top && related.of.id === top.id && related.items.length > 0 ? related : null;

  const kindCounts = useMemo(() => { const m = new Map<string, number>(); for (const r of rows ?? []) m.set(r.kind, (m.get(r.kind) ?? 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]); }, [rows]);
  const pages = useMemo(() => (rows ?? []).filter((r) => r.kind === "page").slice(0, PAGE_STRIP), [rows]);
  const showPages = pages.length > 0 && (!kind || kind === "page");
  const stripIds = useMemo(() => new Set(showPages && kind !== "page" ? pages.map((p) => p.id) : []), [pages, showPages, kind]);
  // "for <cancer>": records that link to the remembered cancer (or are it). Pages carry no cancers and drop out.
  const aboutMine = (r: Row) => !!mine && (r.id === mine.id || (r.cancers ?? "").split(" ").includes(mine.id));
  const mineCount = mine ? (rows ?? []).filter(aboutMine).length : 0;
  const shown = (rows ?? []).filter((r) => (!kind || r.kind === kind) && !stripIds.has(r.id) && (!forMine || !mine || aboutMine(r)));
  const pickKind = (k: string | null) => setKind((cur) => (cur === k ? null : k));

  return (
    <div>
      <form role="search" onSubmit={(e) => { e.preventDefault(); submit(q); }} className="flex flex-wrap gap-2 mb-4">
        <input type="search" value={q} onChange={(e) => type(e.target.value)} autoFocus placeholder="drug for HER2-low breast cancer, PSMA radioligand trial, who leads ADC trials in Madrid…" aria-label="Search OnCo" className="flex-1 min-w-[16rem] rounded-lg border border-border bg-card px-3 py-3 text-base outline-none focus:ring-2 focus:ring-accent/40" />
        <button type="submit" className="rounded-lg bg-foreground text-background px-4 py-2 text-sm font-medium">Search</button>
        {query && <Link href={askHref(query)} className="rounded-lg border border-border bg-card px-4 py-2 text-sm hover:bg-foreground/5">Ask OnCo this</Link>}
      </form>

      {phase === "loading" && <><p className="text-sm text-muted" role="status" aria-live="polite">Loading the search index…</p><Skeleton /></>}

      {rows && (
        <div className="flex flex-wrap items-center gap-2 mb-3 text-sm">
          <p className="text-muted mr-1" role="status" aria-live="polite">{shown.length === rows.length ? `${rows.length} ${rows.length === 1 ? "result" : "results"}` : `${shown.length} of ${rows.length} results`} for <q>{query}</q>{phase === "lexical" ? ", concept search still loading" : ""}</p>
          {rows.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Filter by kind">
              <li><button type="button" onClick={() => setKind(null)} aria-pressed={kind === null} className={`chip border ${kind === null ? "bg-foreground text-background border-foreground" : "bg-card border-border hover:bg-foreground/5"}`}>All <span className="tabular-nums opacity-70">{rows.length}</span></button></li>
              {kindCounts.map(([k, n]) => (
                <li key={k}><button type="button" onClick={() => pickKind(k)} aria-pressed={kind === k} title={kind === k ? "Show every kind" : `Only ${kindLabel(k).toLowerCase()} results`} className={`chip border ${kind === k ? "bg-foreground text-background border-foreground" : `${kindChipClass(k)} hover:brightness-95 dark:hover:brightness-125`}`}><KindGlyph kind={k} />{kindLabel(k)} <span className="tabular-nums opacity-70">{n}</span></button></li>
              ))}
            </ul>
          )}
          {mine && rows.length > 0 && (
            <button type="button" onClick={() => setForMine((v) => !v)} aria-pressed={forMine} title={forMine ? "Show results for every cancer" : `Only results linked to ${mine.name}`} className={`chip border ${forMine ? "bg-accent text-accent-fg border-accent" : "border-accent/40 bg-accent-soft text-accent hover:border-accent"}`}><CancerIcon cancerId={mine.id} className="h-3 w-3" />for {shortCancerName(mine.name)} <span className="tabular-nums opacity-70">{mineCount}</span></button>
          )}
          {semanticReady === false && <span className="text-xs text-muted">Concept index not built for this deployment; showing word matches only.</span>}
        </div>
      )}

      {rows && suggestions.length > 0 && (
        <p className="text-sm mb-3 flex flex-wrap items-center gap-1.5">
          <span className="text-muted">Did you mean</span>
          {suggestions.map((s) => <Link key={s} href={searchHref(s, kind)} onClick={(e) => { e.preventDefault(); submit(s); }} className="chip border border-border bg-card hover:bg-foreground/5 font-medium">{s}</Link>)}
          <span className="text-muted">?</span>
        </p>
      )}

      {rows && isQuestion && (
        <section aria-labelledby="search-ask" className="card p-3 mb-4 border-accent/30">
          <SectionHeading id="search-ask" icon={<NavIcon id="find" className="h-4 w-4" />} aside={<Link href={askHref(query)} className="text-xs underline">Full answer with sources</Link>}>Ask OnCo</SectionHeading>
          {askState === "loading" && <p className="text-sm text-muted" aria-live="polite">Reading the records this question names…</p>}
          {askState === "unavailable" && <p className="text-sm text-muted">That reads like a question. <Link href={askHref(query)} className="underline">Ask OnCo</Link> assembles a cited answer from the records.</p>}
          {askResult && askResult.sentences.length > 0 && (
            <p className="text-[15px] leading-relaxed">
              {askResult.sentences.slice(0, ASK_SENTENCES).map((s, i) => (
                <span key={i}>{s.text} <Link href={askResult.sources[s.cite - 1].route} className="inline-block align-baseline text-[11px] font-medium rounded border border-border bg-foreground/5 px-1 leading-5 hover:bg-foreground/10" title={`${askResult.sources[s.cite - 1].name} (${s.field})`}>{s.cite}</Link> </span>
              ))}
              {askResult.sentences.length > ASK_SENTENCES && <Link href={askHref(query)} className="text-sm underline">Read on</Link>}
            </p>
          )}
          {askResult && askResult.sentences.length === 0 && <p className="text-sm text-muted">No record answers this directly. The results below are the closest matches; <Link href={askHref(query)} className="underline">Ask OnCo</Link> shows what it looked at.</p>}
          {askResult && askResult.sources.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Sources">
              {askResult.sources.slice(0, 4).map((s) => <li key={s.id}><Link href={s.route} className={`chip border ${KIND_COLOR[s.kind]} hover:brightness-95 dark:hover:brightness-125`}><KindIcon kind={s.kind} className="h-3 w-3" />{s.name}</Link></li>)}
            </ul>
          )}
        </section>
      )}

      {rows && showPages && (
        <section aria-labelledby="search-pages" className="mb-4">
          <SectionHeading id="search-pages" icon={<NavIcon id="find" className="h-4 w-4" />}>Pages</SectionHeading>
          <ul className="grid gap-2 sm:grid-cols-2">
            {pages.map((p) => (
              <li key={p.id}>
                <Link href={p.route} className="card p-3 flex items-start gap-3 hover:bg-foreground/5 h-full">
                  <span className="text-accent mt-0.5"><NavItemIcon href={p.route} label={p.name} className="h-5 w-5" /></span>
                  <span className="min-w-0"><span className="block font-medium">{p.name}</span><span className="block text-sm text-muted line-clamp-2">{p.tldr}</span></span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {rows && rows.length === 0 && (
        <section aria-labelledby="search-empty">
          <SectionHeading id="search-empty" icon={<NavIcon id="search" className="h-4 w-4" />}>Nothing matched</SectionHeading>
          {/* "is it curable" and "how long" are two of the three things a frightened person types, and both used to
              land on "try an NCT number". The machinery that answers them well already exists (tPrognosis in
              ask-compose.ts leads with what can be done, never a bare number); it only needs the cancer named. */}
          {OUTCOME_QUESTION.test(query) ? (
            <p className="text-sm">That question needs a cancer named before OnCo can answer it. Add one, as in &ldquo;is pancreatic cancer curable&rdquo; or &ldquo;how long with glioblastoma&rdquo;, and the answer starts with what the standard of care offers and says where the population figures sit. Or pick yours on <Link href="/for-me/" className="underline">For me</Link>.</p>
          ) : (
            <p className="text-sm text-muted">Try a product, target, cancer or trial name, a code such as an NCT number, or a plainer phrase. {isQuestion ? "" : "Questions work too: end with a question mark and Ask OnCo has a go."}</p>
          )}
          <Hubs heading="Start somewhere else" />
        </section>
      )}

      {rows && rows.length > 0 && (
        <section aria-labelledby="search-results">
          <SectionHeading id="search-results" icon={<NavIcon id="search" className="h-4 w-4" />}>{kind ? `${kindLabel(kind)} results` : "Results"}</SectionHeading>
          {shown.length === 0 && <p className="text-sm text-muted">No {kindLabel(kind ?? "").toLowerCase()} results for this query. <button type="button" onClick={() => setKind(null)} className="underline">Show every kind</button>.</p>}
          <ol className="space-y-2" aria-label="Search results">
            {shown.map((r) => (
              <li key={r.id} className="card p-3 flex items-start gap-3">
                <span className="text-xs text-muted tabular-nums w-6 pt-1">{r.rank}</span>
                {r.kind === "drug" && <MoleculeSlot drugId={r.id} name={r.name} className="h-10 w-10" />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => pickKind(r.kind)} aria-pressed={kind === r.kind} title={`Only ${kindLabel(r.kind).toLowerCase()} results`} className={`chip border ${kindChipClass(r.kind)} hover:brightness-95 dark:hover:brightness-125`}><KindGlyph kind={r.kind} />{kindLabel(r.kind)}</button>
                    <Link href={r.route} className="font-medium hover:underline">{r.name}</Link>
                    {r.status && <span className={`chip ${statusClass(r.status)}`}>{STATUS_LABEL[r.status] ?? r.status}</span>}
                  </div>
                  <p className="text-sm text-muted mt-1 line-clamp-2">{r.tldr}</p>
                  <p className="text-xs mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                    {r.lexical && r.lexical.length > 0 && <span><span className="text-muted">Words: </span>{r.lexical.slice(0, 4).join(", ")}</span>}
                    {r.concept && r.concept.length > 0 && <span><span className="text-muted">Concepts: </span>{r.concept.join(", ")}</span>}
                    {r.both && <span className="text-emerald-700 dark:text-emerald-300">Both searches agree</span>}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {rows && relatedShown && (
        <section aria-labelledby="search-related" className="mt-6">
          <SectionHeading id="search-related" icon={<KindIcon kind="pathway" className="h-4 w-4" />}>Related to <Link href={relatedShown.of.route} className="hover:underline">{relatedShown.of.name}</Link></SectionHeading>
          <ul className="flex flex-wrap gap-1.5">
            {relatedShown.items.map((n) => (
              <li key={n.id}><Link href={n.route} className={`chip border ${KIND_COLOR[n.kind]} hover:brightness-95 dark:hover:brightness-125`} title={kindLabel(n.kind)}><KindIcon kind={n.kind} className="h-3 w-3" />{n.name}</Link></li>
            ))}
          </ul>
        </section>
      )}

      {phase === "idle" && <Hubs heading="Or start from a map" />}

      <details className="mt-6 text-xs text-muted">
        <summary className="cursor-pointer">How results are ranked</summary>
        <p className="mt-1 max-w-3xl">Two searches run in your browser. The word search matches names, aliases, TL;DRs and tags, with prefixes and small typos allowed; its scores are then weighted by kind, cancers first, then treatments, tests, trials and the site&apos;s own pages, then targets, pathways and terms, then companies, institutions and people, then papers and journals, and a record whose name is the query rises above records that only mention it. The concept search scores each record&apos;s full text plus the names of every object it links to, so a product can match a cancer or biomarker it treats even when its own text never uses that word. The two rankings are merged by reciprocal rank; a record found by both rises. Nothing is sent to a server.</p>
      </details>
    </div>
  );
}
