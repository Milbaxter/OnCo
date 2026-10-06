"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { askLexical, loadSearch } from "@/lib/search-client";
import { loadSemantic } from "@/lib/semantic-client";
import { semanticSearch } from "@/lib/semantic";
import { loadAskIndex } from "@/lib/ask-index";
import { answerQuestion, type AskResult } from "@/lib/ask-pipeline";
import { INTENT_LABEL } from "@/lib/ask-intent";
import { loadEntityRecord } from "@/lib/entity-client";
import { answerText } from "@/lib/ask";
import { KIND_META, type Kind } from "@/lib/kinds";
import { KIND_COLOR } from "@/lib/text";
import { useT } from "@/lib/i18n/ui";
import { useRegion } from "@/lib/region";

export type AskExample = { question: string; audience: string };

type State = { status: "idle" } | { status: "working"; step: string } | { status: "done"; result: AskResult } | { status: "error"; message: string };

/**
 * Ask OnCo. In the browser: the question is read for its intent and the records it names (name and alias
 * index), those records are fetched as JSON, and a template per intent fills the answer from their fields,
 * every sentence cited. Word and concept search supply records when nothing is named. No language model;
 * nothing leaves the browser.
 */
export function AskOnco({ examples }: { examples: AskExample[] }) {
  const [q, setQ] = useState("");
  const { kind: kindName } = useT();
  const kindLabel = (k: Kind) => kindName(k, "label") ?? KIND_META[k].label;
  const [state, setState] = useState<State>({ status: "idle" });
  const [copied, setCopied] = useState(false);
  const { region } = useRegion();
  const latest = useRef(0);
  const invalidate = useCallback(() => { latest.current++; }, []);
  const regionRef = useRef(region);
  useEffect(() => { regionRef.current = region; }, [region]);

  const ask = useCallback(async (question: string, pin?: string) => {
    const value = question.trim();
    const key = ++latest.current;
    if (!value) { setState({ status: "idle" }); return; }
    setState({ status: "working", step: "Loading indexes" });
    try {
      const [{ ms }, semantic, index] = await Promise.all([loadSearch(), loadSemantic(), loadAskIndex()]);
      if (latest.current !== key) return;
      if (!index) { setState({ status: "error", message: "Ask is not available in this build. Search works: try the same words in the search box." }); return; }
      const result = await answerQuestion(value, {
        index,
        lexical: (text, k) => askLexical(ms, text, k),
        concept: (text, k) => (semantic ? semanticSearch(semantic, text, k).map((h) => h.id) : []),
        load: loadEntityRecord,
        region: regionRef.current ?? undefined,
        pin,
        onStep: (step) => { if (latest.current === key) setState({ status: "working", step }); },
      });
      if (latest.current !== key) return;
      setState({ status: "done", result });
    } catch (e) {
      if (latest.current === key) setState({ status: "error", message: e instanceof Error ? e.message : "Something went wrong" });
    }
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const p = new URLSearchParams(window.location.search);
      const initial = p.get("q") ?? "";
      if (initial) { setQ(initial); ask(initial, p.get("about") ?? undefined); }
    });
    return () => { cancelAnimationFrame(id); invalidate(); };
  }, [ask, invalidate]);

  const submit = (value: string, pin?: string) => {
    setQ(value);
    const p = new URLSearchParams();
    if (value.trim()) p.set("q", value.trim());
    if (pin) p.set("about", pin);
    window.history.replaceState(null, "", p.toString() ? `?${p}` : window.location.pathname);
    ask(value, pin);
  };

  const copy = async (r: AskResult) => {
    try { await navigator.clipboard.writeText(answerText(r)); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ }
  };

  const r = state.status === "done" ? state.result : null;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_320px] [&>*]:min-w-0">
      <div>
        <form onSubmit={(e) => { e.preventDefault(); submit(q); }} className="flex flex-wrap gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus placeholder="What does 'triple-negative' mean in breast cancer?" aria-label="Your question" className="flex-1 min-w-[16rem] rounded-lg border border-border bg-card px-3 py-3 text-base outline-none focus:ring-2 focus:ring-accent/40" />
          <button type="submit" className="rounded-lg bg-foreground text-background px-4 py-2 text-sm font-medium">Ask</button>
        </form>
        <p className="mt-2 text-xs text-muted">Answers are assembled from OnCo records by rules, not generated. Each sentence is numbered and linked to the record it came from. Not medical advice.</p>

        {state.status === "working" && <p className="mt-6 text-sm text-muted" aria-live="polite">{state.step}…</p>}
        {state.status === "error" && <p className="mt-6 text-sm text-rose-700">{state.message}</p>}
        {r && (
          <div className="mt-6" aria-live="polite">
            {r.entities.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 mb-3 text-sm">
                <span className="text-muted">You asked about:</span>
                {r.entities.map((e) => (
                  <Link key={e.id} href={e.route} className={`chip border ${KIND_COLOR[e.kind]}`} title={kindLabel(e.kind)}>{e.name}</Link>
                ))}
                <span className="chip bg-foreground/5 text-muted" title="How the question was read">{INTENT_LABEL[r.intent]}</span>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="kicker">Answer from OnCo records</span>
              <span className={`chip ${r.confidence === "high" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" : r.confidence === "medium" ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"}`} title={r.confidence === "high" ? "A record named in your question anchors this answer" : r.confidence === "medium" ? "No record was named; the closest record from search anchors this answer" : "Only loosely matching sentences were found"}>match: {r.confidence}</span>
              <button type="button" onClick={() => copy(r)} className="ml-auto text-xs underline text-muted">{copied ? "Copied" : "Copy with citations"}</button>
            </div>
            {r.note && <p className="text-sm text-muted mb-3">{r.note}</p>}
            {r.sentences.length > 0 ? (
              <div className="card p-4 text-[15px] leading-relaxed">
                {r.sentences.map((s, i) => (
                  <span key={i}>
                    {s.text}{" "}
                    <Link href={r.sources[s.cite - 1].route} className="inline-block align-baseline text-[11px] font-medium rounded border border-border bg-foreground/5 px-1 leading-5 hover:bg-foreground/10" title={`${r.sources[s.cite - 1].name} (${s.field})`}>{s.cite}</Link>{" "}
                  </span>
                ))}
              </div>
            ) : <p className="text-sm text-muted">Nothing in OnCo matches that question. Try naming a cancer, product, target, trial or term.</p>}
            {r.sources.length > 0 && (
              <ol className="mt-4 space-y-1.5 text-sm">
                {r.sources.map((s, i) => (
                  <li key={s.id} className="flex items-start gap-2">
                    <span className="text-[11px] font-medium rounded border border-border bg-foreground/5 px-1 leading-5 mt-0.5">{i + 1}</span>
                    <span className={`chip border ${KIND_COLOR[s.kind]}`}>{kindLabel(s.kind)}</span>
                    <Link href={s.route} className="hover:underline">{s.name}</Link>
                  </li>
                ))}
              </ol>
            )}

            {r.followUps.length > 0 && (
              <div className="mt-5">
                <div className="kicker mb-2">Ask next</div>
                <div className="flex flex-wrap gap-1.5">
                  {r.followUps.map((f) => <button key={f} type="button" onClick={() => submit(f)} className="chip border border-border bg-card hover:bg-foreground/5 text-left">{f}</button>)}
                </div>
              </div>
            )}

            {r.readMore.length > 0 && (
              <div className="mt-5">
                <div className="kicker mb-2">Read more</div>
                <ul className="text-sm space-y-1">
                  {r.readMore.map((x) => <li key={x.href}>{x.href.startsWith("http") ? <a href={x.href} className="underline" rel="noopener noreferrer" target="_blank">{x.label}</a> : <Link href={x.href} className="underline">{x.label}</Link>}</li>)}
                </ul>
              </div>
            )}

            {r.alternates.length > 0 && (
              <div className="mt-5">
                <div className="kicker mb-2">Not what you meant?</div>
                <div className="flex flex-wrap gap-1.5">
                  {r.alternates.map((e) => (
                    <button key={e.id} type="button" onClick={() => submit(q, e.id)} className={`chip border ${KIND_COLOR[e.kind]} hover:brightness-95 dark:hover:brightness-125`} title={`Answer about ${e.name} (${kindLabel(e.kind)}) instead`}>{e.name}</button>
                  ))}
                </div>
              </div>
            )}

            <p className="mt-5 text-xs text-muted"><strong className="text-foreground/80">How this answer was built.</strong> {r.method} Records read: {r.consulted.map((c, i) => <span key={c.id}>{i > 0 && ", "}<Link href={c.route} className="underline">{c.name}</Link></span>)}. <Link href={`/search/?q=${encodeURIComponent(q.trim())}`} className="underline">See the search results</Link>.</p>
          </div>
        )}
      </div>
      <aside className="space-y-4">
        <div className="card p-3">
          <div className="kicker mb-2">Try a question</div>
          <ul className="space-y-1.5 text-sm">
            {examples.map((e) => <li key={e.question}><button type="button" onClick={() => submit(e.question)} className="text-left hover:underline">{e.question}</button> <span className="text-xs text-muted">({e.audience})</span></li>)}
          </ul>
        </div>
        <div className="card p-3 text-xs text-muted space-y-2">
          <p><strong className="text-foreground/80">How it works.</strong> Your question is read for what it asks (what something means, how a cancer is treated, whether a product is approved, how it works, side effects, trials, results, a comparison, outlook, who or where, cost) and for the records it names, matched against every OnCo name and alias. Those records are fetched and a template for that kind of question fills the answer from their fields, plain English first, one citation per sentence. Approval answers start with your chosen region.</p>
          <p><strong className="text-foreground/80">What it cannot do.</strong> It does not reason, weigh evidence or fill gaps. If OnCo has no record on the point, it says so and falls back to the closest sentences from word and concept search. The <Link href="/eval/" className="underline">open benchmark</Link> scores this method in public.</p>
        </div>
      </aside>
    </div>
  );
}
