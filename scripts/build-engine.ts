/**
 * The open drug engine's JSON companions: public/api/v1/pipeline/engine/<format>.json, one per format, holding the
 * decomposed medicines, the grid cells with their states and the records behind each, the component counts, the
 * unresolved medicines and the stopped reasons (src/lib/modular.ts, formatFile); plus index.json with the counts of
 * every format. Called from scripts/build-api.ts; exported as a function so the test can write into a temporary
 * directory and compare counts.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { engine, formatFile, type Engine } from "../src/lib/modular";
import { engineFile, engineRoute } from "../src/lib/modular-formats";
import { proposedByFormat } from "../src/lib/combination-ideas-adapter";

export type EngineFile = { id: string; path: string; file: string; cells: number };

/** Write the per-format files and the index under `apiDir` (the public/api/v1 directory) and return what was written. */
export function writeEngineFiles(apiDir: string, e: Engine = engine()): EngineFile[] {
  const dir = join(apiDir, "pipeline", "engine");
  mkdirSync(dir, { recursive: true });
  const out: EngineFile[] = [];
  const proposed = proposedByFormat(e);
  for (const f of e.formats) {
    const file = join(dir, `${f.format.id}.json`);
    writeFileSync(file, JSON.stringify(formatFile(f, proposed[f.format.id]?.cells ?? [])));
    out.push({ id: f.format.id, path: engineFile(f.format.id), file, cells: f.cells.length });
  }
  const index = {
    drugs: e.drugs, fetched: e.fetched, fetchedFrom: e.fetchedFrom,
    formats: e.formats.map((f) => ({ id: f.format.id, name: f.format.name, route: engineRoute(f.format.id), file: engineFile(f.format.id), axes: f.format.axes, counts: f.counts, coverage: f.coverage })),
    outside: e.outsideByReason,
    note: "Every state is derived from corpus records named in each format file; untried means no medicine in this corpus combines the two parts. CC BY-NC 4.0, attribute Data from OnCo (onco.cc). Not medical advice.",
  };
  const file = join(dir, "index.json");
  writeFileSync(file, JSON.stringify(index));
  out.push({ id: "index", path: engineFile("index"), file, cells: e.formats.reduce((n, f) => n + f.cells.length, 0) });
  return out;
}
