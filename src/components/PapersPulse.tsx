import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { KIND_META, type Kind } from "@/lib/kinds";
import { StaticTable, type StaticColumn, type StaticRow } from "@/components/filters/StaticTable";

export type PulseEntry = { kind: string; name: string; counts: Record<string, number>; last12: number; prior12: number; growth: number | null; total: number };
export type PulseIndex = { fetched: string; source: string; entities: Record<string, PulseEntry> };

/** Server-side reader for the weekly snapshot at public/papers/index.json (written by scripts/fetch-papers.ts). */
export function readPulse(): PulseIndex | null {
  const p = join(process.cwd(), "public", "papers", "index.json");
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")) as PulseIndex; } catch { return null; }
}

export function readPulseEntry(id: string): PulseEntry | null {
  return readPulse()?.entities[id] ?? null;
}

const YEARS = ["2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026"];
const CURRENT_YEAR = String(new Date().getFullYear());

/** CSS-only sparkline: one bar per year, height relative to the entity's own maximum. */
export function Sparkline({ counts, className = "" }: { counts: Record<string, number>; className?: string }) {
  const max = Math.max(1, ...YEARS.map((y) => counts[y] ?? 0));
  return (
    <span role="img" className={`inline-flex items-end gap-px h-5 ${className}`} title={YEARS.map((y) => `${y}: ${counts[y] ?? 0}`).join("\n")} aria-label="papers per year">
      {YEARS.map((y) => (
        <span key={y} className="w-1.5 rounded-sm bg-foreground/70" style={{ height: `${Math.max(6, Math.round(((counts[y] ?? 0) / max) * 100))}%`, opacity: y === CURRENT_YEAR ? 0.55 : 1 }} />
      ))}
    </span>
  );
}

function pct(g: number | null) {
  if (g === null) return "-";
  const v = Math.round(g * 100);
  return `${v > 0 ? "+" : ""}${v}%`;
}

function route(kind: string, id: string) {
  const meta = KIND_META[kind as Kind];
  return meta ? `/${meta.route}/${id}/` : `/${kind}s/${id}/`;
}

/** Table of topics ranked by growth in the last 12 months vs the 12 before. */
export function PulseTable({ index, kind, limit = 25, minPrior = 20, sort = "growth" }: { index: PulseIndex; kind?: string; limit?: number; minPrior?: number; sort?: "growth" | "last12" | "total" }) {
  const rows = Object.entries(index.entities)
    .filter(([, e]) => (!kind || e.kind === kind) && e.prior12 >= minPrior && (sort !== "growth" || e.growth !== null))
    .sort(([, a], [, b]) => sort === "growth" ? (b.growth ?? 0) - (a.growth ?? 0) : sort === "last12" ? b.last12 - a.last12 : b.total - a.total)
    .slice(0, limit);
  if (!rows.length) return <p className="text-muted text-sm">No topics meet the minimum volume yet.</p>;
  const columns: StaticColumn[] = [
    { key: "rank", label: "#", sortable: true, numeric: true, className: "text-muted" },
    { key: "topic", label: "Topic" },
    { key: "kind", label: "Kind", filterable: !kind, className: "text-muted capitalize" },
    { key: "last12", label: "Last 12 mo", sortable: true, numeric: true, className: "text-right" },
    { key: "prior12", label: "Prior 12 mo", sortable: true, numeric: true, className: "text-right text-muted" },
    { key: "growth", label: "Change", sortable: true, numeric: true, className: "text-right font-medium" },
    { key: "trend", label: "Trend", filterable: true, order: ["Growing", "Flat", "Shrinking"], hide: "hidden xl:table-cell", className: "text-xs text-muted" },
    { key: "bars", label: `${YEARS[0]} to ${YEARS[YEARS.length - 1]}` },
  ];
  const table: StaticRow[] = rows.map(([id, e], i) => ({
    id,
    rank: i + 1,
    topic: { text: e.name, href: route(e.kind, id), strong: true },
    kind: e.kind,
    last12: e.last12,
    prior12: e.prior12,
    growth: e.growth === null ? { text: "-", v: -999, muted: true } : { text: pct(e.growth), v: Math.round(e.growth * 100), className: e.growth > 0 ? "text-emerald-700 dark:text-emerald-300" : e.growth < 0 ? "text-rose-700 dark:text-rose-300" : undefined },
    trend: e.growth === null ? undefined : e.growth > 0.05 ? "Growing" : e.growth < -0.05 ? "Shrinking" : "Flat",
    bars: { text: "", bars: YEARS.map((y) => e.counts[y] ?? 0), title: YEARS.map((y) => `${y}: ${e.counts[y] ?? 0}`).join(", ") },
  }));
  return <StaticTable rows={table} columns={columns} noun="topics" defaultSort={{ key: "rank", dir: 1 }} />;
}

/** Compact strip for an entity page: yearly bars + 12-month change, from the weekly snapshot. Server component. */
export function PaperTrend({ id }: { id: string }) {
  const e = readPulseEntry(id);
  if (!e || e.total === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
      <span className="kicker">Literature trend</span>
      <Sparkline counts={e.counts} />
      <span><b className="text-foreground tabular-nums">{e.last12.toLocaleString()}</b> papers in the last 12 months</span>
      {/* The growth figure and the "How this is computed" link came off on 6 October 2026. The owner: "it
          doesnt add much value". A percentage against the previous twelve months swings wildly on a small
          base, and the explanation of it was a link away from a page nobody was asking about. The count and
          the shape of the bars are the part that reads at a glance; /papers/ still carries the method. */}
    </div>
  );
}
