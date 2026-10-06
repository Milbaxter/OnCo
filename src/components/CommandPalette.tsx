"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { loadSearch, searchRanked } from "@/lib/search-client";
import { flattenGroups, groupByKind, type KindGroup } from "@/lib/search-rank";
import { KindGroupHeader } from "./KindGroupHeader";
import { RowAvatar } from "./RowAvatar";

// The palette is in the root layout, so its static imports ship with every page. The molecule slot brings the
// structure index and the 3D drawing code, which only matter once a reader has typed and a drug is in the results;
// it is fetched then. The dialog never renders on the server (closed), so there is nothing to prerender.
const MoleculeSlot = dynamic(() => import("./MoleculeSlot").then((m) => m.MoleculeSlot), {
  ssr: false,
  loading: () => <span className="inline-flex h-9 w-9 shrink-0 rounded-md border border-border bg-card" aria-hidden />,
});
import type { SearchDoc } from "@/lib/search-index";
import { statusClass } from "@/lib/text";
import { useT } from "@/lib/i18n/ui";

type Item = { id: string; kind: SearchDoc["kind"]; name: string; tldr: string; route: string; status?: string; portrait?: string; action?: true };

/** Rows the palette shows in all for a query, across every kind group. */
const VISIBLE = 14;
/** Tool pages matched by their own text, before the index is consulted. */
const PAGE_MATCHES = 3;

const PAGES: Item[] = ([
  { id: "p-search", name: "Search: words and concepts", tldr: "Full results with the reason each matched", route: "/search/", action: true },
  { id: "p-path", name: "Connections: how any two records are linked", tldr: "Shortest routes between any two objects", route: "/path/", action: true },
  { id: "p-explore", name: "Browse the corpus by cancer and kind", tldr: "Pick a cancer, switch kind, sort and filter", route: "/explore/", action: true },
  { id: "p-for-me", name: "For me", tldr: "What works and what could work for your cancer(s)", route: "/for-me/", action: true },
  { id: "p-tumor-board", name: "Tumour board", tldr: "Enter biomarkers, get matched options", route: "/tumor-board/", action: true },
  { id: "p-graph", name: "Graph explorer", tldr: "Navigate the knowledge graph visually", route: "/graph/", action: true },
  { id: "p-compare", name: "Compare products, technologies, targets, trials, or cancers", tldr: "Up to five side by side, differences highlighted", route: "/compare/", action: true },
  { id: "p-calendar", name: "Readout calendar", tldr: "Upcoming decisions, readouts, congresses", route: "/calendar/", action: true },
  { id: "p-digests", name: "Congress digests", tldr: "ASCO, ESMO, AACR, ASCO GU", route: "/digests/", action: true },
  { id: "p-failures", name: "Failure museum", tldr: "What did not work and why", route: "/failures/", action: true },
  { id: "p-resistance", name: "Resistance: how tumours escape each drug class", tldr: "Escape routes per drug class", route: "/resistance/", action: true },
  { id: "p-paths", name: "Reading paths", tldr: "Curated sequences of pages", route: "/paths/", action: true },
  { id: "p-institutions", name: "Institutions map and ranking", tldr: "Who matters, where", route: "/institutions/", action: true },
  { id: "p-saved", name: "Saved views and watchlist", tldr: "Your saved tables and starred pages, with what changed since you looked", route: "/saved/", action: true },
  { id: "p-report", name: "State of the war on cancer, 2026", tldr: "Annual report from the corpus", route: "/report/2026/", action: true },
  { id: "p-hub", name: "Roadmap", tldr: "What OnCo is building next, in waves, with status", route: "/roadmap/", action: true },
  { id: "p-api", name: "Open API", tldr: "The corpus as JSON, CSV and feeds", route: "/api/", action: true },
  { id: "p-about", name: "About and methodology", tldr: "Rules for facts, ranking formula, licence", route: "/about/", action: true },
] as Array<Omit<Item, "kind">>).map((p) => ({ ...p, kind: "page" as const }));

/** The empty palette: every tool page under one "Pages" header. */
const PAGE_GROUPS: KindGroup<Item>[] = groupByKind(PAGES, PAGES.length, PAGES.length);

/** `g` then one of these keys jumps to the page. */
const GOTO: Array<{ key: string; route: string; label: string }> = [
  { key: "h", route: "/", label: "Home" },
  { key: "c", route: "/cancers/", label: "Cancers" },
  { key: "d", route: "/drugs/", label: "Treatments and tests" },
  { key: "t", route: "/trials/", label: "Trials" },
  { key: "a", route: "/targets/", label: "Targets" },
  { key: "e", route: "/explore/", label: "Browse" },
  { key: "s", route: "/saved/", label: "Saved views and watchlist" },
];

const SHORTCUTS_KEY = "onco:shortcuts:v1";
const shortcutsEnabled = () => { try { return window.localStorage.getItem(SHORTCUTS_KEY) !== "off"; } catch { return true; } };

/** True when the key press belongs to a text field or another dialog, so single-key shortcuts must not fire. */
function typing(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return true;
  if (t.isContentEditable) return true;
  return !!t.closest?.('[role="dialog"], [role="listbox"], [role="menu"]');
}

/** Focusable row anchors: EntityBrowser puts `data-row` on the name link of every row; any table can do the same. */
const rowLinks = () => [...document.querySelectorAll<HTMLElement>("[data-row]")].filter((el) => el.offsetParent !== null);

/** Move row focus by `delta` (j = +1, k = -1) and keep the focused row in view without scrolling the page far. */
function moveRow(delta: 1 | -1) {
  const rows = rowLinks();
  if (!rows.length) return false;
  const cur = document.activeElement instanceof HTMLElement ? rows.indexOf(document.activeElement.closest("[data-row]") as HTMLElement) : -1;
  const next = cur < 0 ? (delta > 0 ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, cur + delta));
  const el = rows[next];
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: "nearest" });
  return true;
}

/** ⌘K / Ctrl+K command palette: search every object and jump to any page. Also owns the site's keyboard shortcut layer. */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [q, setQ] = useState("");
  // Results grouped by kind in tier order (cancers first, then treatments and trials, and so on); `items` is the
  // flattened keyboard order and `active` indexes it. Group headers are presentation rows the arrows skip.
  const [groups, setGroups] = useState<KindGroup<Item>[]>(PAGE_GROUPS);
  const items = useMemo(() => flattenGroups(groups), [groups]);
  const [active, setActive] = useState(0);
  const [ready, setReady] = useState(false);
  const [indexed, setIndexed] = useState(0);
  const { kind: kindName, status: statusName } = useT();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const pendingG = useRef<number | null>(null);
  const request = useRef(0);
  const query = useRef("");
  const router = useRouter();

  const close = useCallback(() => { request.current++; setOpen(false); }, []);
  const run = useCallback((value: string) => {
    const current = ++request.current;
    query.current = value;
    setActive(0);
    const needle = value.trim().toLowerCase();
    if (!needle) { setGroups(PAGE_GROUPS); return; }
    const pages = PAGES.filter((p) => `${p.name} ${p.tldr}`.toLowerCase().includes(needle)).slice(0, PAGE_MATCHES);
    // Only this query's immediate page matches can be keyboard targets while the index is pending.
    setGroups(groupByKind(pages, VISIBLE));
    loadSearch().then(({ ms }) => {
      if (request.current !== current) return;
      // The whole ranked list comes back so the grouping can take the top rows of each kind; a page the tool list
      // already matched is not repeated from the index.
      const seen = new Set(pages.map((p) => p.route));
      const hits: Item[] = searchRanked(ms, value).filter((h) => !seen.has(h.route)).map((h) => ({ id: h.id, kind: h.kind, name: h.name, tldr: h.tldr, route: h.route, status: h.status }));
      setGroups(groupByKind([...pages, ...hits], VISIBLE));
    });
  }, []);

  // Global shortcut layer: ⌘K / Ctrl+K and Escape always; single keys only outside text fields and dialogs,
  // and only while the reader has them on (the "?" sheet has the switch; off is remembered in this browser).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); if (open) close(); else setOpen(true); return; }
      if (e.key === "Escape") { close(); setSheet(false); return; }
      if (open || sheet || e.metaKey || e.ctrlKey || e.altKey || typing(e) || !shortcutsEnabled()) return;
      if (pendingG.current !== null) {
        window.clearTimeout(pendingG.current); pendingG.current = null;
        const to = GOTO.find((x) => x.key === e.key.toLowerCase());
        if (to) { e.preventDefault(); router.push(to.route); }
        return;
      }
      switch (e.key) {
        case "/": e.preventDefault(); setOpen(true); break;
        case "?": e.preventDefault(); setSheet(true); break;
        case "g": pendingG.current = window.setTimeout(() => { pendingG.current = null; }, 1200); break;
        case "j": if (moveRow(1)) e.preventDefault(); break;
        case "k": if (moveRow(-1)) e.preventDefault(); break;
        case "Enter": {
          const row = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>("[data-row]") : null;
          if (row && !(row instanceof HTMLAnchorElement)) { const a = row.querySelector("a"); if (a) { e.preventDefault(); a.click(); } }
          break;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    // Open synchronously inside the tap that asked for it: iOS only shows the keyboard when focus happens in the user gesture,
    // so the input must mount (and autofocus) before the click handler returns, not in a later timer.
    const onOpen = () => flushSync(() => setOpen(true));
    const onSheet = () => setSheet(true);
    window.addEventListener("onco:open-palette", onOpen);
    window.addEventListener("onco:open-shortcuts", onSheet);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("onco:open-palette", onOpen); window.removeEventListener("onco:open-shortcuts", onSheet); };
  }, [open, sheet, router, close]);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const t = setTimeout(() => input.current?.focus(), 0);
    let live = true;
    const pendingRequest = request;
    // Closing cancels pending results; reopening recomputes any retained query from the shared index.
    run(query.current);
    loadSearch().then(({ docs }) => { if (live) { setIndexed(docs.length); setReady(true); } });
    document.body.style.overflow = "hidden";
    return () => { live = false; pendingRequest.current++; clearTimeout(t); document.body.style.overflow = ""; opener.current?.focus?.(); };
  }, [open, run]);

  const go = (item: Item) => { close(); query.current = ""; setQ(""); setGroups(PAGE_GROUPS); router.push(item.route); };

  /** Focus trap: Tab cycles through the dialog's own controls (the input and the footer button) and never leaves. */
  const trap = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !dialog.current) return;
    const focusable = [...dialog.current.querySelectorAll<HTMLElement>("input, button, a[href]")].filter((el) => !el.hasAttribute("disabled"));
    if (!focusable.length) return;
    const i = focusable.indexOf(document.activeElement as HTMLElement);
    const next = e.shiftKey ? (i <= 0 ? focusable.length - 1 : i - 1) : (i >= focusable.length - 1 ? 0 : i + 1);
    e.preventDefault();
    focusable[next].focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!items.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(items.length - 1); }
    else if (e.key === "Enter" && items[active]) { e.preventDefault(); go(items[active]); }
  };
  useEffect(() => { list.current?.querySelector(`#palette-opt-${active}`)?.scrollIntoView({ block: "nearest" }); }, [active]);

  // Render order: each group's header, then its rows numbered on through the flat list so ids and `active` agree.
  const rows = useMemo(() => {
    let i = 0;
    return groups.map((g) => ({ kind: g.kind, rows: g.items.map((it) => ({ it, i: i++ })) }));
  }, [groups]);

  if (sheet && !open) return <ShortcutsSheet onClose={() => setSheet(false)} />;
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 backdrop-blur-sm p-4 pt-[12vh]" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-label="Search OnCo" onKeyDown={trap} className="w-full max-w-2xl card shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 border-b border-border">
          <span className="text-muted" aria-hidden>⌕</span>
          <input ref={input} autoFocus value={q} onChange={(e) => { setQ(e.target.value); run(e.target.value); }} onKeyDown={onKeyDown}
            placeholder="Search products, targets, cancers, trials, companies, pages…" className="flex-1 bg-transparent py-3.5 text-base outline-none"
            role="combobox" aria-label="Search" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list" aria-activedescendant={items[active] ? `palette-opt-${active}` : undefined} autoComplete="off" spellCheck={false} />
          <kbd className="hidden sm:inline text-[10px] text-muted border border-border rounded px-1.5 py-0.5">esc</kbd>
        </div>
        <ul id="palette-list" ref={list} className="max-h-[60vh] overflow-auto py-1" role="listbox" aria-label="Results">
          {!ready && q && <li className="px-4 py-3 text-sm text-muted" role="presentation">Loading index…</li>}
          {items.length === 0 && ready && <li className="px-4 py-3 text-sm text-muted" role="presentation">No matches.</li>}
          {rows.map((g) => [
            <KindGroupHeader key={`h-${g.kind}`} kind={g.kind} label={g.kind === "page" ? undefined : kindName(g.kind, "title")} />,
            ...g.rows.map(({ it, i }) => (
              <li key={it.id} id={`palette-opt-${i}`} role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); go(it); }}
                className={`flex items-start gap-3 px-4 py-1.5 cursor-pointer ${i === active ? "bg-foreground/5" : ""}`}>
                {it.kind === "drug" && <MoleculeSlot drugId={it.id} name={it.name} className="h-9 w-9" />}
                {/* A person is a face before they are a name: the owner, 30 September 2026, "show peoples faces in the
                    search". RowAvatar falls back to initials on a tinted tile, so a row is never an empty square. */}
                {it.kind === "person" && <RowAvatar src={it.portrait} name={it.name} round />}
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium truncate">{it.name}</span>
                  <span className="block text-xs text-muted line-clamp-1">{it.tldr}</span>
                </span>
                {it.status && <span className={`chip shrink-0 ${statusClass(it.status)}`}>{statusName(it.status)}</span>}
                {i === active && <kbd className="hidden sm:inline text-[10px] text-muted border border-border rounded px-1.5 py-0.5 self-center" aria-hidden>↵</kbd>}
              </li>
            )),
          ])}
        </ul>
        <div className="flex items-center gap-4 px-4 py-2 border-t border-border text-[11px] text-muted">
          <span><kbd className="border border-border rounded px-1">↑</kbd> <kbd className="border border-border rounded px-1">↓</kbd> navigate</span>
          <span><kbd className="border border-border rounded px-1">↵</kbd> open</span>
          <span><kbd className="border border-border rounded px-1">⌘K</kbd> toggle</span>
          <button type="button" onClick={() => { close(); setSheet(true); }} className="underline hover:text-foreground">All shortcuts <kbd className="border border-border rounded px-1">?</kbd></button>
          <span className="ml-auto" aria-live="polite">{ready ? `${indexed.toLocaleString("en-GB")} objects indexed` : ""}</span>
        </div>
      </div>
    </div>
  );
}

const Key = ({ k }: { k: string }) => <kbd className="inline-block min-w-[1.5rem] text-center border border-border rounded px-1.5 py-0.5 text-[11px] bg-card">{k}</kbd>;

/** Rows of the shortcuts sheet: `keys` pressed together (or in sequence when `chord`), and what happens. */
const SHORTCUT_ROWS: Array<{ keys: string[]; chord?: boolean; what: string }> = [
  { keys: ["⌘", "K"], what: "Open or close search (Ctrl K on Windows and Linux)" },
  { keys: ["/"], what: "Open search" },
  { keys: ["?"], what: "This sheet" },
  { keys: ["j", "k"], what: "Next and previous row in a table" },
  { keys: ["↵"], what: "Open the focused row" },
  { keys: ["Esc"], what: "Close any dialog" },
  ...GOTO.map((g) => ({ keys: ["g", g.key], chord: true, what: `Go to ${g.label}` })),
];

/** The "?" sheet: every shortcut on one card, and the switch that turns single-key shortcuts off. */
function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  // The sheet only ever mounts in the browser after a key press, so reading storage in the initialiser is safe.
  const [on, setOn] = useState(() => (typeof window === "undefined" ? true : shortcutsEnabled()));
  const first = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setTimeout(() => first.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);
  const toggle = () => { const next = !on; setOn(next); try { window.localStorage.setItem(SHORTCUTS_KEY, next ? "on" : "off"); } catch { /* private mode */ } };
  const trap = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !box.current) return;
    const f = [...box.current.querySelectorAll<HTMLElement>("button, a[href]")];
    const i = f.indexOf(document.activeElement as HTMLElement);
    const next = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i >= f.length - 1 ? 0 : i + 1);
    e.preventDefault(); f[next]?.focus();
  };
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 backdrop-blur-sm p-4 pt-[10vh]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" onKeyDown={trap} className="w-full max-w-lg card shadow-2xl p-5 text-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="kicker mb-1">Keyboard</div>
            <h2 id="shortcuts-title" className="text-lg font-semibold">Shortcuts</h2>
          </div>
          <button ref={first} type="button" onClick={onClose} className="ctl ctl-icon" aria-label="Close"><svg aria-hidden viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><path d="M5 5l10 10M15 5L5 15" /></svg></button>
        </div>
        <table className="mt-4 w-full text-sm">
          <tbody>
            {SHORTCUT_ROWS.map((r) => (
              <tr key={r.what} className="border-t border-border">
                <th scope="row" className="py-1.5 pr-4 text-left font-normal whitespace-nowrap">
                  {r.keys.map((k, i) => <span key={k}>{i > 0 && (r.chord ? " then " : " ")}<Key k={k} /></span>)}
                </th>
                <td className="py-1.5 text-muted">{r.what}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <button type="button" role="switch" aria-checked={on} onClick={toggle} className={`relative inline-flex h-5 w-9 items-center rounded-full border transition-colors ${on ? "bg-accent-solid border-accent-solid" : "bg-surface border-border-strong"}`}>
              <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? "translate-x-4" : "translate-x-0.5"}`} />
            </button>
            <span>Single-key shortcuts {on ? "on" : "off"}</span>
          </label>
          <span className="text-xs text-muted">Turn them off if they clash with your screen reader or browser. Search stays on ⌘K.</span>
        </div>
        <p className="mt-3 text-xs text-muted">Your <Link href="/saved/" className="underline" onClick={onClose}>saved views and watchlist</Link> live in this browser only.</p>
      </div>
    </div>
  );
}

/** A button that opens the palette; used in the header. */
export function PaletteTrigger({ className = "" }: { className?: string }) {
  const [mac, setMac] = useState(true);
  const { t } = useT();
  useEffect(() => { const id = requestAnimationFrame(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform))); return () => cancelAnimationFrame(id); }, []);
  return (
    <button type="button" onClick={() => window.dispatchEvent(new Event("onco:open-palette"))} className={`ctl ctl-icon text-muted min-w-0 overflow-hidden ${className}`} aria-label={t("header.openSearch")}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>
      <span className="sr-only">{t("header.search")} ({mac ? "⌘" : "Ctrl"} K)</span>
    </button>
  );
}
