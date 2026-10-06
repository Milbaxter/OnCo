"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ResultsTable, Toolbar, type Column, type SortState } from "./ResultsTable";
import type { ColumnFilterSpec } from "./ColumnFilter";
import type { FacetOption } from "./FacetSelect";
import { readViewParams, viewParams } from "@/lib/table-view";
import { loadTableFile, TABLE_PAGE, type MoreRows } from "@/lib/static-tables";
import { useT } from "@/lib/i18n/ui";

/**
 * A column of a plain-data table. `filterable` puts the header filter on it; `sortable` the sort control.
 * The value a row has for the column defaults to `row[key]`; `value` overrides it (a nested field, a derived
 * bucket such as the year of a date). Arrays are multi-valued: a row matches when any of its values is chosen.
 * `render` defaults to the value as text, joined with commas for arrays.
 */
export type FilterableColumn<T = Record<string, unknown>> = {
  key: string;
  /** English header; translated through the chrome dictionary where a translation exists. */
  label: string;
  filterable?: boolean;
  sortable?: boolean;
  render?: (row: T, index: number) => ReactNode;
  value?: (row: T) => unknown;
  /** Display text for a filter value (the pill), e.g. a code to a name. */
  optionLabel?: (value: string) => string;
  /** Fixed pill order (unlisted values follow, by count). */
  order?: string[];
  hide?: string;
  className?: string;
  tip?: string;
  /** Sort numerically when the values are numbers (the default detects numbers; set false to force text order). */
  numeric?: boolean;
};

const toStrings = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap(toStrings) : v === undefined || v === null || v === "" ? [] : [String(v)]);

/**
 * Filter, sort and header-control state for any table built from an array of column definitions and an array of
 * row objects. Returns ready-made ResultsTable columns (each filterable one carrying its header filter), the rows
 * that pass, and the selection so a toolbar can show the same facets. With `url` the state is read from and
 * written to the query string exactly as EntityBrowser does (`?key=value`, repeating), using the column keys.
 */
export function useColumnFilters<T>(rows: T[], columns: FilterableColumn<T>[], opts: { url?: boolean; urlScope?: string; defaultSort?: SortState; query?: string; initial?: Record<string, string[]> } = {}) {
  const { url = false, urlScope, defaultSort, query = "", initial } = opts;
  const [sel, setSel] = useState<Record<string, string[]>>(initial ?? {});
  const [sort, setSort] = useState<SortState | undefined>(defaultSort);
  const [synced, setSynced] = useState(!url);
  const valueOf = (c: FilterableColumn<T>, r: T): string[] => toStrings(c.value ? c.value(r) : (r as Record<string, unknown>)[c.key]);
  const filterKeys = useMemo(() => columns.filter((c) => c.filterable).map((c) => c.key), [columns]);

  // Read the URL once on mount, a frame late so the effect sets no state synchronously (the pattern the other URL-backed views use).
  useEffect(() => {
    if (!url) return;
    const raf = requestAnimationFrame(() => {
      const params = new URLSearchParams(window.location.search);
      const known = (k: string) => { const c = columns.find((x) => x.key === k); return new Set(c ? rows.flatMap((r) => valueOf(c, r)) : []); };
      const view = readViewParams(params, filterKeys, known, (k) => columns.some((c) => c.key === k && c.sortable), urlScope);
      if (Object.keys(view.sel).length) setSel(view.sel);
      if (view.sort) setSort(view.sort);
      setSynced(true);
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only: the URL seeds state, then state owns the URL
  }, []);

  useEffect(() => {
    if (!url || !synced) return;
    const u = new URL(window.location.href);
    u.search = viewParams(filterKeys, sel, query, sort, defaultSort, u.searchParams, urlScope).toString();
    const next = u.pathname + u.search + u.hash;
    if (next !== window.location.pathname + window.location.search + window.location.hash) window.history.replaceState(window.history.state, "", next);
  }, [url, urlScope, synced, sel, sort, query, defaultSort, filterKeys]);

  const setFacet = (key: string, vals: string[]) => setSel((s) => ({ ...s, [key]: vals }));
  const clear = () => setSel({});
  const active = Object.values(sel).some((v) => v.length);

  const matches = (r: T, skip?: string) => {
    const needle = query.trim().toLowerCase();
    if (needle && !columns.map((c) => valueOf(c, r).join(" ")).join(" ").toLowerCase().includes(needle)) return false;
    for (const c of columns) {
      if (!c.filterable || c.key === skip) continue;
      const want = sel[c.key]; if (!want?.length) continue;
      const has = valueOf(c, r);
      if (!want.some((w) => has.includes(w))) return false;
    }
    return true;
  };

  const filtered = useMemo(() => {
    const list = rows.filter((r) => matches(r));
    const c = sort && columns.find((x) => x.key === sort.key);
    if (c && sort) {
      const first = (r: T) => valueOf(c, r)[0] ?? "";
      const numeric = c.numeric ?? list.every((r) => { const v = first(r); return v === "" || !Number.isNaN(Number(v)); });
      list.sort((a, b) => { const x = first(a), y = first(b); return sort.dir * (numeric ? (Number(x) || 0) - (Number(y) || 0) : x.localeCompare(y)); });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, columns, sel, sort, query]);

  /** Pills per filterable column, counted over rows that pass every other filter. */
  const options = useMemo(() => {
    const out: Record<string, FacetOption[]> = {};
    for (const c of columns) {
      if (!c.filterable) continue;
      const counts = new Map<string, number>();
      for (const r of rows) if (matches(r, c.key)) for (const v of valueOf(c, r)) counts.set(v, (counts.get(v) ?? 0) + 1);
      let arr = [...counts.entries()];
      arr = c.order ? arr.sort((a, b) => (c.order!.indexOf(a[0]) + 1 || 999) - (c.order!.indexOf(b[0]) + 1 || 999) || b[1] - a[1]) : arr.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      out[c.key] = arr.map(([v, n]) => ({ value: v, label: c.optionLabel ? c.optionLabel(v) : v, count: n }));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, columns, sel, query]);

  const onSort = (key: string) => setSort((s) => (s?.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  const specFor = (key: string): ColumnFilterSpec | undefined => {
    const opts = options[key] ?? [];
    const cur = sel[key] ?? [];
    if (!opts.length && !cur.length) return undefined;
    return { options: opts, value: cur, onChange: (v) => setFacet(key, v) };
  };
  const tableColumns: Column<T>[] = columns.map((c) => ({
    key: c.key, label: c.label, sortable: c.sortable, hide: c.hide, className: c.className, tip: c.tip,
    filter: c.filterable ? specFor(c.key) : undefined,
    render: c.render ?? ((r) => { const v = valueOf(c, r); return v.length ? <span className={c.numeric ? "tabular-nums" : undefined}>{v.join(", ")}</span> : <span className="text-muted">-</span>; }),
  }));

  return { filtered, columns: tableColumns, sort, onSort, sel, setFacet, clear, active, options, specFor };
}

/**
 * The rows of a table whose first page came with the HTML and whose rest is one static file (src/lib/static-tables.ts).
 * `want()` asks for the file (the reader scrolled past the first rows, pressed Show more, or set a filter or sort
 * that needs every row); `rows` is the whole table once it has arrived and the first page until then.
 */
export function useRemoteRows<T>(first: T[], more?: MoreRows) {
  const [full, setFull] = useState<T[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [wanted, setWanted] = useState(false);
  const src = more?.src;
  const loading = !!src && wanted && !full && !failed;
  useEffect(() => {
    if (!loading || !src) return;
    let stale = false;
    void loadTableFile<T>(src).then((list) => { if (stale) return; if (list) setFull(list); else setFailed(true); });
    return () => { stale = true; };
  }, [loading, src]);
  const want = useCallback(() => setWanted(true), []);
  return { rows: full ?? first, complete: !more || !!full, loading, failed, want };
}

/**
 * A complete filterable, sortable table from plain data: column definitions and row objects, nothing else.
 * Every `filterable` column filters from its header; `url` keeps the state in the query string. Extra toolbar
 * content (a search box, a toggle) goes in `toolbar`; pass `query` when a search box outside drives the rows.
 * With `more`, `rows` are only the first page of the table (in its default order) and the rest is fetched from
 * `more.src` when needed; filters, sort and the URL state then run over the whole set.
 */
export function FilterableTable<T>({ rows: first, columns, rowKey, noun, url = false, urlScope, defaultSort, pageSize, scroll, empty, toolbar, toolbarRight, query, initial, more }: {
  rows: T[]; columns: FilterableColumn<T>[]; rowKey: (r: T) => string; noun: string; url?: boolean; defaultSort?: SortState; pageSize?: number; scroll?: boolean; empty?: string;
  /** Stable query-key prefix when several tables on one page keep independent URL state. */
  urlScope?: string;
  toolbar?: ReactNode; toolbarRight?: ReactNode; query?: string;
  /** Selection to start from before the URL (if any) is read: the server can pre-filter a table. */
  initial?: Record<string, string[]>;
  /** The rest of the table beyond `rows`: its size and the static file that holds every row. */
  more?: MoreRows;
}) {
  const remote = useRemoteRows(first, more);
  const rows = remote.rows;
  const cf = useColumnFilters(rows, columns, { url, urlScope, defaultSort, query, initial });
  const { t } = useT();
  // Anything the first page cannot answer needs every row: a filter, a search, or a sort other than the order the rows came in.
  const sortChanged = !!cf.sort && (cf.sort.key !== defaultSort?.key || cf.sort.dir !== defaultSort?.dir);
  const needAll = !remote.complete && (cf.active || !!query?.trim() || sortChanged);
  const { want } = remote;
  useEffect(() => { if (needAll) want(); }, [needAll, want]);
  const total = more?.total ?? rows.length;
  /** The whole table while its first page stands in for it; the filtered length once the file is here or a filter narrows it. */
  const shown = remote.complete || needAll ? cf.filtered.length : total;
  return (
    <div>
      <Toolbar count={shown} total={total} noun={noun}
        left={<>{toolbar}{cf.active ? (
          <button type="button" onClick={cf.clear} data-clear-filters className="chip border border-border bg-card text-sm hover:bg-accent-soft hover:text-accent hover:border-accent inline-flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
            <svg aria-hidden viewBox="0 0 12 12" width="10" height="10" className="shrink-0"><path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" /></svg>
            {t("clear")}
          </button>
        ) : null}</>}
        right={toolbarRight} />
      {needAll && remote.loading && <p className="text-xs text-muted mb-2" aria-live="polite">{t("table.loadingMore")}</p>}
      {needAll && remote.failed && <p className="text-xs text-muted mb-2">Only the first {first.length.toLocaleString("en-GB")} of {total.toLocaleString("en-GB")} rows could be filtered: the full list did not load. Check your connection and reload.</p>}
      <ResultsTable columns={cf.columns} rows={cf.filtered} rowKey={rowKey} sort={cf.sort} onSort={cf.onSort} pageSize={more ? pageSize ?? TABLE_PAGE : pageSize} scroll={scroll} empty={empty}
        more={more && !remote.complete && !remote.failed && !needAll ? { total, load: want, loading: remote.loading } : undefined} />
    </div>
  );
}
