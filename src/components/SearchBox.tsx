"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { searchHref } from "@/lib/search-query";
import type { SearchDoc } from "@/lib/search-index";
import { STATUS_LABEL, statusClass } from "@/lib/text";
import { loadSearch, searchRanked } from "@/lib/search-client";
import { flattenGroups, groupByKind } from "@/lib/search-rank";
import { KindGroupHeader } from "./KindGroupHeader";

type Hit = SearchDoc & { concept?: string[] };

/** Fewer than this many lexical hits triggers the concept-search fallback. */
const FALLBACK_BELOW = 3;
/** Rows the dropdown shows in all, across every kind group. */
const VISIBLE = 12;

export function SearchBox({ large = false, autoFocus = false }: { large?: boolean; autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Hit[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  // -1 is the input itself: the first ArrowDown moves to the first row. Owner, 4 October 2026: "the user cannot
  // press down to get to the results after type a string". The command palette had this and this box never did.
  const [active, setActive] = useState(-1);
  const list = useRef<HTMLUListElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const request = useRef(0);
  const router = useRouter();

  const runSearch = async (value: string) => {
    const current = ++request.current;
    setActive(-1);
    setResults([]);
    setState("loading");
    try {
      const { ms, byId } = await loadSearch();
      if (request.current !== current) return;
      setState("ready");
      if (!value.trim()) return;
      // Every hit comes back so the grouping can pick the top rows per kind; the dropdown itself shows VISIBLE rows.
      const lexical = searchRanked(ms, value) as SearchDoc[];
      setResults(lexical);
      if (lexical.length >= FALLBACK_BELOW) return;
      // Too few exact matches: add concept matches (paraphrases, linked names), labelled as such. The concept index
      // is optional: a failed chunk or request must not discard successful word matches.
      try {
        const [{ loadSemantic }, { semanticSearch }] = await Promise.all([import("@/lib/semantic-client"), import("@/lib/semantic")]);
        const index = await loadSemantic();
        if (!index || request.current !== current) return;
        const seen = new Set(lexical.map((h) => h.id));
        const extra: Hit[] = semanticSearch(index, value, 10).filter((h) => !seen.has(h.id)).map((h) => ({ ...byId.get(h.id)!, concept: h.matched.slice(0, 3) })).filter((h) => h.id).slice(0, VISIBLE - lexical.length);
        setResults([...lexical, ...extra]);
      } catch { /* Keep the word matches when concept search is unavailable. */ }
    } catch {
      if (request.current === current) setState("error");
    }
  };

  useEffect(() => {
    const pending = request;
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) { pending.current++; setOpen(false); setActive(-1); }
    };
    document.addEventListener("mousedown", onDoc);
    return () => { pending.current++; document.removeEventListener("mousedown", onDoc); };
  }, []);

  const placeholder = useMemo(() => "Search TROP2, Enhertu, PSMA PET, TNBC, Gustave Roussy…", []);
  // Grouped by kind in tier order (cancers, then treatments and trials, and so on), a few rows per kind.
  const groups = useMemo(() => groupByKind(results, VISIBLE), [results]);
  const close = () => { request.current++; setOpen(false); setQ(""); setResults([]); setState("idle"); setActive(-1); };
  const rows = useMemo(() => flattenGroups(groups), [groups]);

  // Keep the highlighted row in view when arrowing past the bottom of the dropdown.
  useEffect(() => {
    if (active < 0) return;
    list.current?.querySelector(`[data-row="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { request.current++; setOpen(false); setActive(-1); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!rows.length) {
        // Closing invalidates pending work. Reopen a retained query without relying on a hidden completion.
        if (!open && q.trim()) {
          e.preventDefault();
          setOpen(true);
          void runSearch(q);
          if (e.key === "ArrowDown") setActive(0);
        }
        return;
      }
      e.preventDefault();
      setOpen(true);
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => Math.min(rows.length - 1, Math.max(-1, i + step)));
      return;
    }
    if (e.key === "Enter") {
      // A highlighted row opens that record; otherwise Enter searches, which is what it always did.
      const hit = active >= 0 ? rows[active] : undefined;
      if (hit) { e.preventDefault(); router.push(hit.route); close(); return; }
      if (q.trim()) { e.preventDefault(); router.push(searchHref(q)); close(); }
    }
  };

  return (
    <div ref={box} className="relative">
      <input
        ref={input}
        type="search"
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => { setQ(e.target.value); setOpen(true); void runSearch(e.target.value); }}
        onFocus={() => { setOpen(true); if (!open) void runSearch(q); }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label="Search OnCo"
        role="combobox"
        aria-expanded={open && Boolean(q.trim())}
        aria-controls="searchbox-list"
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 && rows[active] ? `searchbox-opt-${active}` : undefined}
        autoComplete="off"
        className={`w-full rounded-lg border border-border bg-card px-3 ${large ? "py-3 text-base" : "py-1.5 text-sm"} outline-none focus:ring-2 focus:ring-accent/40`}
      />
      {open && q.trim() && (
        <div className="absolute z-50 mt-1 w-full card shadow-xl max-h-96 overflow-auto">
          {state === "loading" && <div role="status" className="p-3 text-sm text-muted">Loading index…</div>}
          {state === "error" && <div className="p-3 text-sm">
            <p role="status">Search is unavailable. Try again.</p>
            <button type="button" onClick={() => { input.current?.focus(); void runSearch(q); }} className="mt-2 underline rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">Retry search</button>
          </div>}
          {state === "ready" && results.length === 0 && <div role="status" className="p-3 text-sm text-muted">No matches.</div>}
          <ul id="searchbox-list" ref={list} role="listbox" aria-label="Results" aria-busy={state === "loading"}>
            {groups.map((g) => [
              <KindGroupHeader key={`h-${g.kind}`} kind={g.kind} />,
              ...g.items.map((r) => {
                const i = rows.indexOf(r);
                return (
                <li key={r.id} id={`searchbox-opt-${i}`} data-row={i} role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)}>
                  <Link href={r.route} onClick={close} className={`flex items-start gap-3 px-3 py-1.5 ${i === active ? "bg-foreground/5" : "hover:bg-foreground/5"}`}>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium truncate">{r.name}</span>
                      <span className="block text-xs text-muted line-clamp-2">{r.tldr}</span>
                    </span>
                    {r.status && <span className={`chip shrink-0 mt-0.5 ${statusClass(r.status)}`}>{STATUS_LABEL[r.status] ?? r.status}</span>}
                    {r.concept && <span className="chip bg-foreground/5 text-[10px] shrink-0 mt-0.5" title={`Concept match on: ${r.concept.join(", ")}`}>concept</span>}
                  </Link>
                </li>
                );
              }),
            ])}
          </ul>
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border px-3 py-2 text-xs">
            <Link href={`/search/?q=${encodeURIComponent(q.trim())}`} onClick={close} className="underline">All results and why they match</Link>
            <Link href={`/ask/?q=${encodeURIComponent(q.trim())}`} onClick={close} className="underline">Ask OnCo this as a question</Link>
          </div>
        </div>
      )}
    </div>
  );
}
