import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FEEDS, feedStatus } from "./feed-meta";
import PapersPage from "../app/papers/page";
import PreprintsPage from "../app/preprints/page";
import StatusPage from "../app/status/page";

// Keep the actual pages, filesystem readers and table markup; unrelated corpus and live feeds are fixtures.
vi.mock("@/lib/graph", () => ({ graph: () => ({ entities: [], get: () => undefined }) }));
vi.mock("../../scripts/audit", () => ({ runAudit: () => ({ staleness: [], total: 0 }) }));
vi.mock("@/lib/seo", () => ({ pageMeta: (v: unknown) => v }));
vi.mock("@/components/CitedPapers", () => ({ CitedPapers: () => null }));
vi.mock("@/components/LatestPapers", () => ({ LatestPapers: () => null }));
vi.mock("@/components/ui", () => ({
  Container: ({ children }: { children: ReactNode }) => createElement("main", null, children),
  PageHeader: ({ title, lede }: { title: string; lede: string }) => createElement("header", null, title, lede),
  GroupKicker: () => null,
}));
vi.mock("next/link", () => ({ default: ({ children, ...props }: { children: ReactNode }) => createElement("a", props, children) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({}), usePathname: () => "/status/" }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "onco-literature-dates-"));
  vi.spyOn(process, "cwd").mockReturnValue(root);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); rmSync(root, { recursive: true, force: true }); });

function fixture(feed: "papers" | "preprints", dates: Array<unknown>, ids = dates.map((_, i) => `topic-${i}`)) {
  const dir = join(root, "public", feed);
  mkdirSync(dir, { recursive: true });
  const entities = Object.fromEntries(ids.map((id) => [id, { kind: "target", name: id, counts: {}, last12: 0, prior12: 0, growth: null, total: 0, count: 0, published: 0 }]));
  writeFileSync(join(dir, "index.json"), JSON.stringify({ fetched: "2026-10-06", source: "Fixture", windowDays: 90, entities, items: [], published: [] }));
  dates.forEach((fetched, i) => { if (fetched !== "missing-file") writeFileSync(join(dir, `${ids[i]}.json`), fetched === "malformed-json" ? "{" : JSON.stringify({ fetched })); });
}

const scenarios = [
  { name: "all failed, retaining old topics", dates: ["2026-09-01", "2026-09-01"], oldest: "2026-09-01", age: 35, stale: true, label: "2026-09-01" },
  { name: "mixed successful and failed topics", dates: ["2026-10-06", "2026-09-01"], oldest: "2026-09-01", age: 35, stale: true, label: "2026-09-01 to 2026-10-06" },
  { name: "cached topics without a new retrieval", dates: ["2026-10-05", "2026-10-05"], oldest: "2026-10-05", age: 1, stale: false, label: "2026-10-05" },
  { name: "cached and failed topics", dates: ["2026-10-05", "2026-09-01"], oldest: "2026-09-01", age: 35, stale: true, label: "2026-09-01 to 2026-10-05" },
  { name: "only one topic refreshed", dates: ["2026-09-01", "2026-10-06"], oldest: "2026-09-01", age: 35, stale: true, label: "2026-09-01 to 2026-10-06" },
  { name: "healthy zero-result topics", dates: ["2026-10-06", "2026-10-06"], oldest: "2026-10-06", age: 0, stale: false, label: "2026-10-06" },
  { name: "empty collection", dates: [], oldest: undefined, age: undefined, stale: true, label: "Unknown (no topic snapshots)" },
  { name: "missing legacy file", dates: ["2026-10-06", "missing-file"], oldest: undefined, age: undefined, stale: true, label: "2026-10-06; 1 of 2 topic dates unknown" },
  { name: "missing legacy date", dates: [undefined], oldest: undefined, age: undefined, stale: true, label: "Unknown (1 topic date unknown)" },
];

describe.each(["papers", "preprints"] as const)("%s contributing retrieval dates", (feed) => {
  it.each(scenarios)("renders truthful freshness for $name", ({ dates, oldest, age, stale, label }) => {
    fixture(feed, dates);
    const status = feedStatus(FEEDS.find((f) => f.id === feed)!);
    expect(status).toMatchObject({ fetched: oldest, ageDays: age, stale, count: dates.length });
    const page = renderToStaticMarkup(createElement(feed === "papers" ? PapersPage : PreprintsPage));
    expect(page).toContain(`Topic data retrieved: <b class="text-foreground">${label}</b>`);
    expect(page).toContain("Snapshot run: <b class=\"text-foreground\">2026-10-06</b>");
    const statusHtml = renderToStaticMarkup(createElement(StatusPage));
    const row = [...statusHtml.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/g)].find(([html]) => html.includes(`${feed}/index.json`))?.[0];
    expect(row).toContain(label);
    expect(row).toContain("Snapshot run: 2026-10-06");
    expect(row).toContain(stale ? ">stale<" : ">fresh<");
    const cells = [...row!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1].replace(/<[^>]*>/g, ""));
    expect(cells[3]).toBe(age !== undefined ? `${age} d` : "-");
  });

  it.each([null, {}, 123, "not a date", "2026-02-30", "2026-13-01", "malformed-json"])("treats a bad date/file as unknown: %j", (date) => {
    fixture(feed, ["2026-10-06", date]);
    expect(feedStatus(FEEDS.find((f) => f.id === feed)!)).toMatchObject({ fetched: undefined, ageDays: undefined, stale: true });
  });

  it("ignores snapshots that do not contribute to the index", () => {
    fixture(feed, ["2026-10-06"]);
    writeFileSync(join(root, "public", feed, "unlisted.json"), JSON.stringify({ fetched: "2020-01-01" }));
    expect(feedStatus(FEEDS.find((f) => f.id === feed)!)).toMatchObject({ fetched: "2026-10-06", ageDays: 0, count: 1 });
  });

  it("does not use unsafe ids or the aggregate index as a topic snapshot", () => {
    fixture(feed, ["missing-file", "missing-file"], ["../outside", "index"]);
    writeFileSync(join(root, "public", "outside.json"), JSON.stringify({ fetched: "2026-10-06" }));
    expect(feedStatus(FEEDS.find((f) => f.id === feed)!)).toMatchObject({ fetched: undefined, ageDays: undefined, stale: true, count: 2 });
  });
});
