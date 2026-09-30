import { describe, expect, it } from "vitest";
import { graph } from "@/lib/graph";
import { GRID_COLUMNS } from "@/components/PrevalenceMatrix";

/**
 * The owner, 28 September 2026: "/prevalence/ has a table that has massive horizontal scrolling straight off
 * the bat."
 *
 * The cause was not that the data is wide. 207 targets by 43 cancers is 8,901 cells and 431 are filled: the
 * grid is about 95 per cent empty, the median target has prevalence in exactly one cancer, and half the
 * cancers carry fewer than five targets between them. Most of the width was blank columns.
 *
 * So the page opens on a list and the grid opens on the cancers that carry data. This test holds the reason
 * rather than the layout: if the matrix ever fills up, the sparsity assertion fails and the default should be
 * reconsidered rather than quietly kept.
 */
describe("the prevalence matrix is sparse, which is why it is not the default view", () => {
  const targets = graph().kind("target").filter((t) => t.prevalence.length);
  const cancerIds = new Set(targets.flatMap((t) => t.prevalence.map((p) => p.cancerId)));
  const filled = targets.reduce((n, t) => n + new Set(t.prevalence.map((p) => p.cancerId)).size, 0);

  it("is under a fifth full, so a grid is the wrong default shape", () => {
    const grid = targets.length * cancerIds.size;
    expect(filled / grid).toBeLessThan(0.2);
  });

  it("the median target has prevalence in only a handful of cancers", () => {
    const counts = targets.map((t) => new Set(t.prevalence.map((p) => p.cancerId)).size).sort((a, b) => a - b);
    expect(counts[Math.floor(counts.length / 2)]).toBeLessThanOrEqual(3);
  });

  it("enough cancers carry real data to fill the grid's opening columns", () => {
    const per = new Map<string, number>();
    for (const t of targets) for (const id of new Set(t.prevalence.map((p) => p.cancerId))) per.set(id, (per.get(id) ?? 0) + 1);
    const dense = [...per.values()].filter((n) => n >= 5);
    expect(dense.length).toBeGreaterThanOrEqual(GRID_COLUMNS);
  });

  it("every prevalence row names a cancer that exists", () => {
    const g = graph();
    const missing = [...cancerIds].filter((id) => !g.get(id));
    expect(missing).toEqual([]);
  });
});
