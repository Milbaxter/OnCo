"use client";

import { Fragment, useMemo, type ReactNode } from "react";
import Link from "next/link";
import { FilterableTable, type FilterableColumn } from "./FilterableTable";
import type { SortState } from "./ResultsTable";
import type { MoreRows } from "@/lib/static-tables";
import { RowAvatar } from "../RowAvatar";

/**
 * A filterable, sortable table for pages rendered on the server. The page computes plain rows (strings, numbers,
 * links and chips as small objects, nothing else) and this client component draws them, so no function or React
 * node crosses the server boundary. Every row is in the exported HTML (filtering only hides rows) unless the table is
 * paged with `more` (src/lib/static-tables.ts): then the HTML carries the first page and the rest is fetched on demand.
 *
 * A cell is a primitive, one `CellObj` or a list of them. `text` is what the reader sees; `v` is the value the
 * filter and the sort use when it differs (the number behind "1,234", the year behind a date). `href` makes the
 * text a link (`ext` for a plain anchor to another site); `chip` gives the chip classes; `sub` a small second line.
 */
export type CellObj = {
  text: string;
  v?: string | number;
  href?: string;
  ext?: boolean;
  sub?: string;
  chip?: string;
  mono?: boolean;
  muted?: boolean;
  strong?: boolean;
  title?: string;
  className?: string;
  /** Logo or portrait URL drawn beside the text (an empty string draws initials). */
  avatar?: string;
  round?: boolean;
  /** A 0 to 100 share drawn as a small bar before the text. */
  bar?: number;
  /** Counts drawn as a tiny bar chart (one bar each, scaled to the largest) instead of the text; `title` names them. */
  bars?: number[];
};
export type Cell = string | number | boolean | null | undefined | CellObj | CellObj[];

export type StaticColumn = {
  key: string;
  /** English header; translated through the chrome dictionary where a translation exists. */
  label: string;
  filterable?: boolean;
  sortable?: boolean;
  /** Force numeric sort (the default detects numbers) or text sort with `false`. */
  numeric?: boolean;
  /** Tailwind visibility classes, e.g. "hidden md:table-cell". */
  hide?: string;
  className?: string;
  tip?: string;
  /** Fixed pill order for the filter (unlisted values follow, by count). */
  order?: string[];
  /** Display text for a filter value, e.g. a code to a name. */
  optionLabels?: Record<string, string>;
};

export type StaticRow = { id: string } & Record<string, Cell>;

/** The strings a cell contributes to its column's filter and sort. */
export function cellValues(c: Cell): string[] {
  if (c === null || c === undefined || c === "") return [];
  if (typeof c === "boolean") return [c ? "Yes" : "No"];
  if (typeof c === "number") return [String(c)];
  if (typeof c === "string") return [c];
  if (Array.isArray(c)) return c.flatMap(cellValues);
  return [String(c.v ?? c.text)];
}

const Dash = () => <span className="text-muted">-</span>;

function Bars({ counts, title }: { counts: number[]; title?: string }) {
  const max = Math.max(1, ...counts);
  const last = counts.length - 1;
  return (
    <span role="img" className="inline-flex items-end gap-px h-5" title={title} aria-label={title ?? "counts per period"}>
      {counts.map((n, i) => <span key={i} className="w-1.5 rounded-sm bg-foreground/70" style={{ height: `${Math.max(6, Math.round((n / max) * 100))}%`, opacity: i === last ? 0.55 : 1 }} />)}
    </span>
  );
}

function Obj({ o }: { o: CellObj }) {
  if (o.bars) return <Bars counts={o.bars} title={o.title} />;
  const chip = o.chip !== undefined;
  const cls = [chip ? `chip ${o.chip}` : "", o.mono ? "font-mono text-xs" : "", o.muted ? "text-muted" : "", o.strong ? "font-medium" : "", o.className ?? ""].filter(Boolean).join(" ");
  const linkCls = `${cls} ${chip ? "hover:ring-2 hover:ring-accent/30" : "hover:underline"}`.trim();
  let node: ReactNode;
  if (o.href && o.ext) node = <a href={o.href} rel="noopener" className={chip ? linkCls : `${cls} underline`.trim()} title={o.title}>{o.text}</a>;
  else if (o.href) node = <Link href={o.href} className={linkCls} title={o.title}>{o.text}</Link>;
  else node = <span className={cls || undefined} title={o.title}>{o.text}</span>;
  if (o.bar !== undefined) node = (
    <span className="inline-flex items-center gap-2 tabular-nums">
      <span className="inline-block h-2 w-20 rounded bg-foreground/10 overflow-hidden" aria-hidden><span className="block h-full bg-accent" style={{ width: `${Math.max(0, Math.min(100, o.bar))}%` }} /></span>
      {node}
    </span>
  );
  const body = o.sub ? <div>{node}<div className="text-xs text-muted font-normal">{o.sub}</div></div> : node;
  if (o.avatar === undefined) return <>{body}</>;
  return <span className="flex items-center gap-2"><RowAvatar src={o.avatar || undefined} name={o.text} round={o.round} />{body}</span>;
}

/** Draw one cell: primitives as text, objects as links or chips, lists as chip rows or comma-joined links. */
export function renderCell(c: Cell, col?: StaticColumn): ReactNode {
  if (c === null || c === undefined || c === "") return <Dash />;
  if (typeof c === "boolean") return c ? "Yes" : "No";
  if (typeof c === "number") return <span className="tabular-nums">{c.toLocaleString("en-GB")}</span>;
  if (typeof c === "string") return col?.numeric ? <span className="tabular-nums">{c}</span> : c;
  if (Array.isArray(c)) {
    if (!c.length) return <Dash />;
    if (c.some((x) => x.chip !== undefined)) return <div className="flex flex-wrap gap-1.5">{c.map((x, i) => <Obj key={i} o={x} />)}</div>;
    return <span>{c.map((x, i) => <Fragment key={i}>{i > 0 && ", "}<Obj o={x} /></Fragment>)}</span>;
  }
  return <Obj o={c} />;
}

/**
 * The table. `url` keeps filters and sort in the query string; give each table a distinct `urlScope` when
 * several share a page. `noun` names the rows in the "N of M" count line. `more` (from `pageRows` in src/lib/static-tables.ts)
 * says `rows` are only the first page and names the file with every row.
 */
export function StaticTable({ rows, columns, noun, url = false, urlScope, defaultSort, pageSize, scroll, empty, toolbar, toolbarRight, initial, more }: {
  rows: StaticRow[]; columns: StaticColumn[]; noun: string; url?: boolean; defaultSort?: SortState; pageSize?: number; scroll?: boolean; empty?: string;
  urlScope?: string;
  toolbar?: ReactNode; toolbarRight?: ReactNode; initial?: Record<string, string[]>; more?: MoreRows;
}) {
  // Memoised so the filtered rows (and the table's paging window) do not rebuild on every render of this component.
  const cols = useMemo((): FilterableColumn<StaticRow>[] => columns.map((c) => ({
    key: c.key, label: c.label, filterable: c.filterable, sortable: c.sortable, numeric: c.numeric, hide: c.hide, className: c.className, tip: c.tip, order: c.order,
    optionLabel: c.optionLabels ? (v) => c.optionLabels![v] ?? v : undefined,
    value: (r) => cellValues(r[c.key]),
    render: (r) => renderCell(r[c.key], c),
  })), [columns]);
  return <FilterableTable<StaticRow> rows={rows} columns={cols} rowKey={(r) => r.id} noun={noun} url={url} urlScope={urlScope} defaultSort={defaultSort} pageSize={pageSize} scroll={scroll} empty={empty} toolbar={toolbar} toolbarRight={toolbarRight} initial={initial} more={more} />;
}
