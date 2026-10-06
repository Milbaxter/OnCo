import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FEEDS, ageInDays, feedStatus, feedStatuses, readPublicJson } from "./feed-meta";
import * as feedMeta from "./feed-meta";
import StatusPage from "../app/status/page";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

describe("feed-meta", () => {
  it("defines a unique id and a public path for every feed", () => {
    const ids = FEEDS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of FEEDS) { expect(f.path.endsWith(".json"), f.id).toBe(true); expect(f.cadenceDays).toBeGreaterThan(0); }
  });

  it("reports a missing snapshot as absent and stale", () => {
    const root = mkdtempSync(join(tmpdir(), "onco-feeds-"));
    const s = feedStatus(FEEDS.find((f) => f.id === "fda")!, new Date("2026-09-09"), root);
    expect(s.present).toBe(false);
    expect(s.stale).toBe(true);
    expect(readPublicJson("fda/recent.json", root)).toBeNull();
  });

  it("reads fetched date, count and staleness from a snapshot", () => {
    const root = mkdtempSync(join(tmpdir(), "onco-feeds-"));
    mkdirSync(join(root, "public", "fda"), { recursive: true });
    writeFileSync(join(root, "public", "fda", "recent.json"), JSON.stringify({ fetched: "2026-09-01", oce: [{}, {}, {}], notInCorpus: [{}] }));
    const fresh = feedStatus(FEEDS.find((f) => f.id === "fda")!, new Date("2026-09-09"), root);
    expect(fresh.present).toBe(true);
    expect(fresh.fetched).toBe("2026-09-01");
    expect(fresh.count).toBe(3);
    expect(fresh.ageDays).toBe(8);
    expect(fresh.stale).toBe(false);
    const old = feedStatus(FEEDS.find((f) => f.id === "fda")!, new Date("2026-10-09"), root);
    expect(old.stale).toBe(true);
  });

  it("returns one status per feed against the real public folder without throwing", () => {
    const all = feedStatuses(new Date());
    expect(all.length).toBe(FEEDS.length);
  });

  it("keeps a partially refreshed trial feed stale and reports its date range", () => {
    const root = mkdtempSync(join(tmpdir(), "onco-feeds-"));
    try {
      mkdirSync(join(root, "public", "trials"), { recursive: true });
      writeFileSync(join(root, "public", "trials", "index.json"), JSON.stringify({
        current: { fetched: "2026-10-06" }, retained: { fetched: "2026-09-01" },
      }));
      const status = feedStatus(FEEDS.find((f) => f.id === "trials")!, new Date("2026-10-06"), root);
      expect(status).toMatchObject({ fetched: "2026-09-01", fetchedThrough: "2026-10-06", ageDays: 35, stale: true, count: 2 });
      const spy = vi.spyOn(feedMeta, "feedStatuses").mockReturnValue([status]);
      try {
        const html = renderToStaticMarkup(createElement(StatusPage));
        expect(html).toContain("between 2026-09-01 and 2026-10-06 (dates differ by product)");
        expect(html).toContain("1 is stale");
      } finally { spy.mockRestore(); }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("computes ages in whole days and tolerates bad dates", () => {
    expect(ageInDays("2026-09-01", new Date("2026-09-09T12:00:00Z"))).toBe(8);
    expect(ageInDays("not a date", new Date())).toBeUndefined();
    expect(ageInDays(undefined, new Date())).toBeUndefined();
  });

  it.each([
    [{ first: { fetched: "2026-10-06" }, second: { fetched: "2026-10-06" } }, "2026-10-06", false],
    [{ first: { fetched: "2026-10-06" }, second: {} }, undefined, true],
    [{}, undefined, true],
  ])("handles homogeneous and undated trial snapshots conservatively", (snapshot, fetched, stale) => {
    const root = mkdtempSync(join(tmpdir(), "onco-feeds-"));
    try {
      mkdirSync(join(root, "public", "trials"), { recursive: true });
      writeFileSync(join(root, "public", "trials", "index.json"), JSON.stringify(snapshot));
      const status = feedStatus(FEEDS.find((f) => f.id === "trials")!, new Date("2026-10-06"), root);
      expect(status.fetched).toBe(fetched);
      expect(status.stale).toBe(stale);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
