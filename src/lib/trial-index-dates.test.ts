import { describe, expect, it, vi } from "vitest";
import { TRIALS_FETCHED } from "./company-score";
import { engine } from "./modular";
import { writeEngineFiles } from "../../scripts/build-engine";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PipelinePage from "../app/pipeline/page";
import ScorecardsPage from "../app/scorecards/page";
import EnginePage from "../app/pipeline/engine/page";
import ModalityPage from "../app/modalities/[format]/page";
import { modalityHub } from "./modalities";

// A partial refresh replaces one snapshot and retains another. Both products have
// resolved parts in the drug engine, so both dates contribute to its evidence.
vi.mock("../../public/trials/index.json", () => ({ default: {
  "sacituzumab-govitecan": { total: 1, byPhase: { PHASE3: 1 }, byStatus: { RECRUITING: 1 }, recruiting: 1, fetched: "2026-10-06" },
  "trastuzumab-deruxtecan": { total: 1, byPhase: { PHASE3: 1 }, byStatus: { RECRUITING: 1 }, recruiting: 1, fetched: "2026-09-01" },
} }));

describe("mixed trial snapshot dates", () => {
  it("shows both dates on the rendered ADC modality page and JSON model", async () => {
    expect(modalityHub("adc")?.registry).toMatchObject({ fetched: "2026-10-06", fetchedFrom: "2026-09-01" });
    const html = renderToStaticMarkup(await ModalityPage({ params: Promise.resolve({ format: "adc" }) }));
    expect(html).toContain("fetched between 2026-09-01 and 2026-10-06 (dates differ by product)");
  });
  it("discloses both dates in the scorecard and pipeline label", () => {
    expect(TRIALS_FETCHED).toBe("between 2026-09-01 and 2026-10-06 (dates differ by product)");
  });

  it("retains the oldest contributing date alongside the engine's latest date", () => {
    expect(engine()).toMatchObject({ fetched: "2026-10-06", fetchedFrom: "2026-09-01" });
  });

  it("includes both dates in the engine's JSON companion", () => {
    const directory = mkdtempSync(join(tmpdir(), "onco-engine-dates-"));
    try {
      writeEngineFiles(directory);
      const index = JSON.parse(readFileSync(join(directory, "pipeline", "engine", "index.json"), "utf8"));
      expect(index).toMatchObject({ fetched: "2026-10-06", fetchedFrom: "2026-09-01" });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  for (const [name, Page] of [["pipeline", PipelinePage], ["scorecards", ScorecardsPage], ["drug engine", EnginePage]] as const) {
    it(`shows both snapshot dates on the rendered ${name} page`, () => {
      const html = renderToStaticMarkup(createElement(Page));
      expect(html).toContain("fetched between 2026-09-01 and 2026-10-06 (dates differ by product)");
    });
  }
});
