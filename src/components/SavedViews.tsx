"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { describeQuery, loadViews, removeView, renameView, useSavedViews } from "@/lib/saved-views";
import { changedSince, fetchEntityDates, loadWatchlist, markSeen, unwatch, useWatchlist, type WatchItem } from "@/lib/watchlist";
import { importSavedData, SavedImportStorageError } from "@/lib/saved-import";
import { download } from "@/lib/csv";
import { KIND_META, type Kind } from "@/lib/kinds";
import { KIND_COLOR } from "@/lib/text";

type Prov = Record<string, { date?: string; message?: string; commit?: string }>;
type Now = { asOf?: string; edited?: string; prov?: { date?: string; message?: string } };

/**
 * Everything the reader has kept in this browser: saved table views (name + URL) and the watchlist, with what
 * changed since they last looked. Change detection is a comparison of dates: the record's `asOf` and
 * `provenance.editedOn` from `/api/v1/entities/<id>.json`, and the last commit date from `/provenance.json`.
 * Nothing is sent anywhere; export and import move the two lists between browsers as a JSON file.
 */
export function SavedViews() {
  const [views, viewsReady] = useSavedViews();
  const [watching, watchReady] = useWatchlist();
  const [now, setNow] = useState<Record<string, Now>>({});
  /** The `ids` string the current `now` map was fetched for; `checked` is derived from it, so no setState in the effect body. */
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [importMsg, setImportMsg] = useState<string | null>(null);

  // Fetch current dates for every watched id once the list is known.
  const ids = useMemo(() => watching.map((w) => w.id).sort().join(","), [watching]);
  const checked = watchReady && (ids === "" || loadedFor === ids);
  useEffect(() => {
    if (!watchReady || !ids) return;
    let cancelled = false;
    (async () => {
      const list = ids.split(",");
      const prov: Prov = await fetch("/provenance.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
      const dates = await Promise.all(list.map((id) => fetchEntityDates(id)));
      if (cancelled) return;
      const out: Record<string, Now> = {};
      list.forEach((id, i) => { out[id] = { ...(dates[i] ?? {}), prov: prov[id] ? { date: prov[id].date, message: prov[id].message } : undefined }; });
      setNow(out); setLoadedFor(ids);
    })();
    return () => { cancelled = true; };
  }, [ids, watchReady]);

  const changes = (w: WatchItem) => {
    const n = now[w.id];
    if (!n) return [];
    const list = changedSince(w.seen, { asOf: n.asOf, edited: n.edited });
    if (n.prov?.date && (!w.seen.edited || n.prov.date > w.seen.edited) && !list.some((c) => c.what === "edited")) list.push({ what: "edited", from: w.seen.edited, to: n.prov.date });
    return list;
  };
  const seen = (w: WatchItem) => { const n = now[w.id]; markSeen(w.id, { asOf: n?.asOf, edited: n?.prov?.date ?? n?.edited }); };
  const changedCount = watching.filter((w) => changes(w).length).length;

  const exportAll = () => download(`onco-saved-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ exported: new Date().toISOString(), views: loadViews(), watchlist: loadWatchlist() }, null, 2), "application/json");
  const importFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const n = importSavedData(await f.text());
      setImportMsg(`Imported ${n} item${n === 1 ? "" : "s"}.`);
    } catch (error) { setImportMsg(error instanceof SavedImportStorageError ? error.message : "That file could not be read. Export from another browser first, then import the file here."); }
  };

  const ready = viewsReady && watchReady;
  const btn = "rounded-md border border-border bg-card px-2 py-1 text-xs text-muted hover:bg-surface hover:text-foreground";

  return (
    <div className="space-y-12">
      <section aria-labelledby="h-watch">
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
          <h2 id="h-watch" className="text-lg font-semibold tracking-tight">Watchlist {ready && watching.length > 0 && <span className="text-sm text-muted font-normal tabular-nums">{watching.length}</span>}</h2>
          {ready && watching.length > 0 && <span className="text-sm text-muted" aria-live="polite">{!checked ? "Checking for changes…" : changedCount ? `${changedCount} changed since you looked` : "Nothing has changed since you last looked"}</span>}
        </div>
        {!ready ? <p className="text-sm text-muted">Loading…</p> : watching.length === 0 ? (
          <div className="card p-5 text-sm text-muted">
            <p>Nothing watched yet. Every object page has a <span className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-0.5 text-xs text-foreground"><span aria-hidden>☆</span> Watch</span> button in the sidebar. Watched pages are listed here with the date their facts were last checked and the date the record last changed, so you can see what moved since your last visit.</p>
            <p className="mt-2">Try <Link className="underline" href="/drugs/trastuzumab-deruxtecan/">Enhertu</Link>, <Link className="underline" href="/cancers/tnbc/">triple-negative breast cancer</Link> or <Link className="underline" href="/targets/trop2/">TROP2</Link>.</p>
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="onco">
              <thead><tr><th scope="col">Page</th><th scope="col">Since you looked</th><th scope="col" className="hidden md:table-cell">Facts checked</th><th scope="col" className="hidden md:table-cell">Record edited</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {watching.map((w) => {
                  const ch = changes(w);
                  const n = now[w.id];
                  const kind = w.kind as Kind;
                  return (
                    <tr key={w.id}>
                      <td>
                        <div className="flex items-start gap-2">
                          {KIND_META[kind] && <span className={`chip border shrink-0 ${KIND_COLOR[kind] ?? ""}`}>{KIND_META[kind].label}</span>}
                          <div><Link href={w.route} data-row className="font-medium hover:underline">{w.name}</Link><div className="text-xs text-muted">Watching since {w.addedOn}; last seen {w.seen.on}</div></div>
                        </div>
                      </td>
                      <td>
                        {!checked ? <span className="text-muted text-xs">…</span> : ch.length === 0 ? <span className="chip bg-foreground/5">No change</span> : (
                          <div className="space-y-1">
                            {ch.map((c) => <div key={c.what} className="text-sm"><span className="chip bg-accent-soft text-accent border-accent">{c.what === "asOf" ? "Facts re-checked" : "Record edited"}</span> <span className="text-muted text-xs">{c.from ? `${c.from} → ` : ""}{c.to}</span></div>)}
                            {n?.prov?.message && <div className="text-xs text-muted line-clamp-2 max-w-md">Last commit: {n.prov.message}</div>}
                          </div>
                        )}
                      </td>
                      <td className="hidden md:table-cell text-muted tabular-nums">{n?.asOf ?? w.seen.asOf ?? <span aria-label="unknown">-</span>}</td>
                      <td className="hidden md:table-cell text-muted tabular-nums">{n?.prov?.date ?? n?.edited ?? w.seen.edited ?? <span aria-label="unknown">-</span>}</td>
                      <td className="whitespace-nowrap">
                        <span className="inline-flex gap-1">
                          {ch.length > 0 && <button type="button" onClick={() => seen(w)} className={btn} title="Record that you have seen the current version">Mark seen</button>}
                          <button type="button" onClick={() => unwatch(w.id)} className={btn} aria-label={`Stop watching ${w.name}`}>Unwatch</button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="h-views">
        <h2 id="h-views" className="text-lg font-semibold tracking-tight mb-3">Saved views {ready && views.length > 0 && <span className="text-sm text-muted font-normal tabular-nums">{views.length}</span>}</h2>
        {!ready ? <p className="text-sm text-muted">Loading…</p> : views.length === 0 ? (
          <div className="card p-5 text-sm text-muted">
            <p>No saved views yet. Every table on OnCo keeps its filters, search and sort in the URL; the <span className="rounded-md border border-border bg-card px-1.5 py-0.5 text-xs text-foreground">Save view</span> button next to the count stores that URL under a name. Views come back exactly as you left them.</p>
            <p className="mt-2">Start from <Link className="underline" href="/drugs/">treatments and tests</Link>, <Link className="underline" href="/trials/">trials</Link> or <Link className="underline" href="/institutions/">institutions</Link>.</p>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {views.map((v) => (
              <li key={v.id} className="card p-4 text-sm">
                {editing === v.id ? (
                  <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); renameView(v.id, draft); setEditing(null); }}>
                    <input value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="View name" autoFocus className="flex-1 rounded-md border border-border bg-card px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-accent/40" />
                    <button type="submit" className="rounded-md bg-foreground text-background px-2 py-1 text-xs font-medium">Save</button>
                    <button type="button" onClick={() => setEditing(null)} className={btn}>Cancel</button>
                  </form>
                ) : (
                  <Link href={v.url} data-row className="font-medium hover:underline block">{v.name}</Link>
                )}
                <div className="mt-1 text-xs text-muted break-words">{describeQuery(v.url) || "No filters"} · <span className="font-mono">{v.url.split("?")[0]}</span></div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span>Saved {v.savedOn}{v.count !== undefined ? ` · ${v.count.toLocaleString("en-GB")} ${v.noun ?? "rows"} then` : ""}</span>
                  <span className="ml-auto inline-flex gap-1">
                    <button type="button" onClick={() => { setEditing(v.id); setDraft(v.name); }} className={btn}>Rename</button>
                    <button type="button" onClick={() => removeView(v.id)} className={btn} aria-label={`Remove saved view ${v.name}`}>Remove</button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="h-move" className="card p-4 text-sm">
        <h2 id="h-move" className="kicker mb-2">Move between browsers</h2>
        <p className="text-muted">Both lists live only in this browser&apos;s storage. Export them as a file and import it elsewhere; nothing is uploaded.</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" onClick={exportAll} className={btn} disabled={!ready || (views.length === 0 && watching.length === 0)}>Export JSON</button>
          <label className={`${btn} cursor-pointer`}>Import JSON<input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => importFile(e.target.files?.[0])} /></label>
          {importMsg && <span className="text-xs text-muted" role="status">{importMsg}</span>}
        </div>
      </section>
    </div>
  );
}
