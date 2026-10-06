/** Build-time retrieval dates for the topics contributing to a literature index. */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type LiteratureDates = { oldest?: string; newest?: string; unknown: number; total: number };

function calendarDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : undefined;
}

export function literatureDates(feed: "papers" | "preprints", entities: unknown, root = process.cwd()): LiteratureDates {
  const ids = entities && typeof entities === "object" && !Array.isArray(entities) ? Object.keys(entities) : [];
  const dates: string[] = [];
  for (const id of ids) {
    // Index keys are record IDs, never paths; the aggregate's own run date is not a topic retrieval.
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || id === "index") continue;
    try {
      const snapshot = JSON.parse(readFileSync(join(root, "public", feed, `${id}.json`), "utf8"));
      const date = calendarDate(snapshot?.fetched);
      if (date) dates.push(date);
    } catch { /* Missing, unreadable or malformed legacy snapshots have an unknown retrieval date. */ }
  }
  dates.sort();
  return { oldest: dates[0], newest: dates.at(-1), unknown: ids.length - dates.length, total: ids.length };
}

export function literatureDateLabel(dates: LiteratureDates): string {
  if (!dates.total) return "Unknown (no topic snapshots)";
  if (!dates.oldest) return `Unknown (${dates.unknown} topic ${dates.unknown === 1 ? "date" : "dates"} unknown)`;
  const range = dates.oldest === dates.newest ? dates.oldest : `${dates.oldest} to ${dates.newest}`;
  return dates.unknown ? `${range}; ${dates.unknown} of ${dates.total} topic dates unknown` : range;
}
