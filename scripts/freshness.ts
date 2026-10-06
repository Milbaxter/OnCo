/**
 * Freshness SLAs: how old is "too old" for each kind of record, by review track.
 *
 * /audit/ lists staleness but says nothing about what is acceptable. This defines it. Each SLA names
 * the records it applies to, the review track that owns them (see .github/REVIEWERS.md), the maximum
 * age of `asOf` in days, and whether a breach is critical. Critical SLAs are the ones where a stale
 * record can mislead a reader today: approved products (label changes, withdrawals), recruiting trials
 * (they stop recruiting), cancer pages (standard of care moves), and the readout calendar (an event in
 * the past is not a forward-looking item any more).
 *
 * Writes public/freshness.json, rendered at /freshness/. In CI, `--check` exits 1 when the number of
 * critical stale records exceeds FRESHNESS_LIMIT (default 25, roughly five percent of the critical
 * records), so the build fails before the site quietly goes stale.
 *
 * Run: npx tsx scripts/freshness.ts [--check]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { graph } from "../src/lib/graph";
import { routeFor, type Entity } from "../src/lib/schema";
import { calendar } from "../src/data/calendar";
import { eventDate } from "./audit";

export { TRACK_META, SLAS, type Track, type Sla } from "../src/lib/review-due";
import { SLAS, TRACK_META, type Track, type Sla } from "../src/lib/review-due";

/** The readout calendar is not an entity list; an event more than 30 days in the past that is still listed is stale. */
export const CALENDAR_SLA = { id: "calendar", label: "Readout calendar (events still listed 30 days after their date)", track: "regulatory" as Track, days: 30, critical: true };

export type StaleRecord = { id: string; kind: string; name: string; route: string; asOf: string; days: number; sla: string; over: number; critical: boolean };
export type SlaReport = { id: string; label: string; track: Track; days: number; critical: boolean; checked: number; stale: number };
export type TrackReport = { track: Track; label: string; owner: string; checked: number; stale: number; criticalStale: number };
export type Freshness = { generated: string; today: string; total: number; limit: number; criticalStale: number; pass: boolean; tracks: TrackReport[]; slas: SlaReport[]; stale: StaleRecord[]; calendarStale: Array<{ date: string; title: string; kind: string; days: number }> };

export const DEFAULT_LIMIT = 25;

function daysBetween(a: string, b: Date): number {
  return Math.floor((b.getTime() - new Date(a).getTime()) / 86400000);
}

export function slaFor(e: Entity): Sla | undefined {
  return SLAS.find((s) => s.applies(e));
}

export function runFreshness(now = new Date(), limit = Number(process.env.FRESHNESS_LIMIT ?? DEFAULT_LIMIT)): Freshness {
  const g = graph();
  const today = now.toISOString().slice(0, 10);
  const slaReports = new Map<string, SlaReport>(SLAS.map((s) => [s.id, { id: s.id, label: s.label, track: s.track, days: s.days, critical: s.critical, checked: 0, stale: 0 }]));
  const stale: StaleRecord[] = [];
  for (const e of g.entities) {
    const sla = slaFor(e);
    if (!sla) continue;
    const r = slaReports.get(sla.id)!;
    r.checked++;
    const days = daysBetween(e.asOf, now);
    if (days > sla.days) {
      r.stale++;
      stale.push({ id: e.id, kind: e.kind, name: e.name, route: routeFor(e), asOf: e.asOf, days, sla: sla.id, over: days - sla.days, critical: sla.critical });
    }
  }
  const calendarStale = calendar.map((ev) => ({ date: ev.date, title: ev.title, kind: ev.kind, days: (() => { const d = eventDate(ev.date); return d ? daysBetween(d, now) : 0; })() })).filter((ev) => ev.days > CALENDAR_SLA.days).sort((a, b) => b.days - a.days);
  const calReport: SlaReport = { id: CALENDAR_SLA.id, label: CALENDAR_SLA.label, track: CALENDAR_SLA.track, days: CALENDAR_SLA.days, critical: CALENDAR_SLA.critical, checked: calendar.length, stale: calendarStale.length };
  const slas = [...slaReports.values(), calReport];
  const tracks: TrackReport[] = (Object.keys(TRACK_META) as Track[]).map((track) => {
    const mine = slas.filter((s) => s.track === track);
    return { track, label: TRACK_META[track].label, owner: TRACK_META[track].owner, checked: mine.reduce((n, s) => n + s.checked, 0), stale: mine.reduce((n, s) => n + s.stale, 0), criticalStale: mine.filter((s) => s.critical).reduce((n, s) => n + s.stale, 0) };
  });
  stale.sort((a, b) => Number(b.critical) - Number(a.critical) || b.over - a.over);
  const criticalStale = stale.filter((s) => s.critical).length + calendarStale.length;
  return { generated: now.toISOString(), today, total: g.entities.length, limit, criticalStale, pass: criticalStale <= limit, tracks, slas, stale, calendarStale };
}

if (process.argv[1]?.endsWith("freshness.ts")) {
  const check = process.argv.includes("--check");
  const f = runFreshness();
  const out = join(process.cwd(), "public");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "freshness.json"), JSON.stringify(f, null, 0));
  console.log(`freshness: ${f.stale.length} stale records and ${f.calendarStale.length} past calendar events across ${f.total} entities; ${f.criticalStale} critical (limit ${f.limit})`);
  for (const t of f.tracks) console.log(`  ${t.label.padEnd(22)} checked ${String(t.checked).padStart(5)}  stale ${String(t.stale).padStart(4)}  critical ${t.criticalStale}`);
  if (check && !f.pass) {
    console.error(`freshness: FAIL, ${f.criticalStale} critical stale records exceed the limit of ${f.limit}. Re-check the oldest records (asOf) or raise FRESHNESS_LIMIT deliberately.`);
    for (const s of f.stale.filter((s) => s.critical).slice(0, 20)) console.error(`  ${s.kind} ${s.id} asOf ${s.asOf} (${s.over} days over the ${s.sla} SLA)`);
    for (const c of f.calendarStale.slice(0, 10)) console.error(`  calendar ${c.date} ${c.title} (${c.days} days ago)`);
    process.exit(1);
  }
}
