"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { FacetSelect } from "./filters/FacetSelect";
import { Toolbar } from "./filters/ResultsTable";

export type MatrixCell = { pct: number | string; value: number | null; measure?: string; source?: string };
export type MatrixTarget = { id: string; name: string; route: string; cls: string; cells: Record<string, MatrixCell> };
export type MatrixCancer = { id: string; name: string; route: string; group: string };

/** Columns the grid opens with: the cancers carrying the most targets. Eight fit a laptop without scrolling. */
export const GRID_COLUMNS = 8;

function shade(v: number | null): string {
  if (v === null) return "bg-foreground/5 text-muted";
  if (v >= 75) return "bg-violet-600 text-white";
  if (v >= 50) return "bg-violet-500/80 text-white";
  if (v >= 25) return "bg-violet-400/60";
  if (v >= 10) return "bg-violet-300/50";
  return "bg-violet-200/40";
}

/**
 * How common each target is in each cancer.
 *
 * The owner, 28 September 2026: "/prevalence/ has a table that has massive horizontal scrolling straight off
 * the bat." Measured: 207 targets by 43 cancers is 8,901 cells and **431 of them are filled, 4.8 per cent**.
 * The median target has prevalence recorded in exactly one cancer, and 22 of the 43 cancers have fewer than
 * five targets between them. So the page was not scrolling because the data is wide; it was scrolling because
 * a grid is the wrong shape for something 95 per cent empty, and most of the width was blank columns.
 *
 * The default is now a list: one target per row, its cancers beside it, ordered by how much is known. It reads
 * at any width and there is nothing to scroll past. The grid is still here behind a toggle, because comparing
 * one target across several cancers is a real question, and in that view the columns start at the cancers that
 * actually carry data; the cancer filter adds any of the others.
 */
export function PrevalenceMatrix({ targets, cancers }: { targets: MatrixTarget[]; cancers: MatrixCancer[] }) {
  const [sel, setSel] = useState<string[]>([]);
  const [cls, setCls] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [view, setView] = useState<"list" | "grid">("list");

  // A column earns its width. With no cancer chosen the grid shows the densest GRID_COLUMNS; the filter adds
  // any of the rest. In the list view every cancer a target carries is shown, so nothing is hidden there.
  const density = useMemo(() => {
    const n = new Map<string, number>();
    for (const t of targets) for (const id of Object.keys(t.cells)) n.set(id, (n.get(id) ?? 0) + 1);
    return n;
  }, [targets]);
  const shownCancers = useMemo(() => {
    const withData = cancers.filter((c) => (density.get(c.id) ?? 0) > 0);
    if (sel.length) return withData.filter((c) => sel.includes(c.id));
    return [...withData].sort((a, b) => (density.get(b.id) ?? 0) - (density.get(a.id) ?? 0)).slice(0, GRID_COLUMNS)
      .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  }, [cancers, sel, density]);
  const shownTargets = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const inScope = view === "grid" ? shownCancers : (sel.length ? cancers.filter((c) => sel.includes(c.id)) : cancers);
    return targets.filter((t) => (!cls.length || cls.includes(t.cls)) && (!needle || t.name.toLowerCase().includes(needle)) && inScope.some((c) => t.cells[c.id]));
  }, [targets, cls, q, shownCancers, cancers, sel, view]);
  const byId = useMemo(() => new Map(cancers.map((c) => [c.id, c])), [cancers]);

  const cancerOpts = cancers.map((c) => ({ value: c.id, label: c.name.replace(/ \(.*\)$/, ""), group: c.group }));
  const clsOpts = [...new Set(targets.map((t) => t.cls))].sort().map((v) => ({ value: v, label: v, count: targets.filter((t) => t.cls === v).length }));

  return (
    <div>
      <Toolbar count={shownTargets.length} total={targets.length} noun="targets"
        left={<>
          <FacetSelect label="Cancer" options={cancerOpts} value={sel} onChange={(v) => setSel(v as string[])} multi allLabel="All" width="w-64" />
          <FacetSelect label="Target class" options={clsOpts} value={cls} onChange={(v) => setCls(v as string[])} multi searchable={false} allLabel="All" width="w-52" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter targets…" aria-label="Filter targets" className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent/40 w-48" />
          {(sel.length || cls.length || q) ? <button type="button" onClick={() => { setSel([]); setCls([]); setQ(""); }} className="text-sm underline text-muted">Clear</button> : null}
        </>}
        right={<div className="inline-flex rounded-lg border border-border overflow-hidden text-sm" role="group" aria-label="View">
          {(["list", "grid"] as const).map((v) => (
            <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v}
              className={`px-3 py-1.5 ${view === v ? "bg-accent-soft text-accent font-medium" : "hover:bg-foreground/5"}`}>
              {v === "list" ? "By target" : "Grid"}
            </button>
          ))}
        </div>} />
      {view === "list" ? (
        <ul className="card divide-y divide-border">
          {shownTargets.map((t) => {
            const entries = Object.entries(t.cells)
              .map(([id, cell]) => ({ id, cell, cancer: byId.get(id) }))
              .filter((x) => x.cancer && (!sel.length || sel.includes(x.id)))
              .sort((a, b) => (b.cell.value ?? -1) - (a.cell.value ?? -1));
            return (
              <li key={t.id} className="p-3 sm:flex sm:items-baseline sm:gap-4">
                <div className="sm:w-56 sm:shrink-0">
                  <Link href={t.route} className="font-medium hover:underline">{t.name}</Link>
                  <div className="text-[11px] text-muted">{t.cls}</div>
                </div>
                <ul className="flex flex-wrap gap-1.5 mt-1.5 sm:mt-0 min-w-0">
                  {entries.map(({ id, cell, cancer }) => (
                    <li key={id}>
                      <Link href={t.route} className={`chip tabular-nums ${shade(cell.value)}`}
                        title={`${t.name} in ${cancer!.name}: ${typeof cell.pct === "number" ? cell.pct + "%" : cell.pct}${cell.measure ? ` (${cell.measure})` : ""}`}>
                        {cancer!.name.replace(/ \(.*\)$/, "").replace(" cancer", "")} <span className="font-medium">{typeof cell.pct === "number" ? `${cell.pct}%` : /^n\/?a$/i.test(String(cell.pct)) ? "n/a" : `${cell.pct}%`}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      ) : (
      <div className="card overflow-x-auto">
        {!sel.length && <p className="px-3 pt-3 text-xs text-muted">The {GRID_COLUMNS} cancers carrying the most targets. Choose cancers above to see any of the others; every cancer a target carries is listed in the By target view.</p>}
        <table className="onco text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 bg-card z-10">Target</th>
              {shownCancers.map((c) => <th key={c.id} className="whitespace-nowrap"><Link href={c.route} className="hover:underline">{c.name.replace(/ \(.*\)$/, "").replace(" cancer", "")}</Link></th>)}
            </tr>
          </thead>
          <tbody>
            {shownTargets.map((t) => (
              <tr key={t.id}>
                <td className="sticky left-0 bg-card z-10 whitespace-nowrap"><Link href={t.route} className="font-medium hover:underline">{t.name}</Link><div className="text-[10px] text-muted">{t.cls}</div></td>
                {shownCancers.map((c) => {
                  const cell = t.cells[c.id];
                  return (
                    <td key={c.id} className="p-1 text-center">
                      {cell ? (
                        <Link href={t.route} className={`block rounded px-1.5 py-1 tabular-nums ${shade(cell.value)}`} title={`${t.name} in ${c.name}: ${typeof cell.pct === "number" ? cell.pct + "%" : cell.pct}${cell.measure ? ` (${cell.measure})` : ""}`} aria-label={`${t.name} in ${c.name}: ${typeof cell.pct === "number" ? cell.pct + "%" : cell.pct}`}>
                          {typeof cell.pct === "number" ? `${cell.pct}%` : /^n\/?a$/i.test(String(cell.pct)) ? "n/a" : `${cell.pct}%`}
                        </Link>
                      ) : <span className="text-muted/40">·</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-3 py-2 text-xs text-muted flex flex-wrap items-center gap-2">Shade = prevalence: <span className="chip bg-violet-200/40">&lt;10%</span><span className="chip bg-violet-300/50">10-25%</span><span className="chip bg-violet-400/60">25-50%</span><span className="chip bg-violet-500/80 text-white">50-75%</span><span className="chip bg-violet-600 text-white">≥75%</span><span className="ml-2">Hover a cell for the measure; click for sources on the target page.</span></div>
      </div>
      )}
    </div>
  );
}
