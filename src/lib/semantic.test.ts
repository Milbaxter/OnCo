import { describe, expect, it } from "vitest";
import { buildSemanticIndex, decodeSemanticIndex, encodeSemanticIndex, fuseRanks, semanticSearch, tokenize } from "./semantic";
import { semanticDocs } from "./semantic-docs";

describe("tokenize", () => {
  it("normalises spelling, splits compounds and stems plurals", () => {
    expect(tokenize("Tumours")).toEqual(["tumor"]);
    expect(tokenize("HER2-low breast cancers")).toEqual(["her2-low", "her2", "low", "breast", "cancer"]);
    expect(tokenize("side effects of the drug")).toContain("toxicity");
    expect(tokenize("What medicines treat kids?")).toEqual(expect.arrayContaining(["drug", "pediatric", "child"]));
  });
});

describe("semantic index", () => {
  const docs = [
    { id: "a", kind: "drug", text: "Trastuzumab deruxtecan. HER2 antibody-drug conjugate. HER2-low breast cancer. DESTINY-Breast04." },
    { id: "b", kind: "drug", text: "Sacituzumab govitecan. TROP2 antibody-drug conjugate. Triple-negative breast cancer. ASCENT." },
    { id: "c", kind: "drug", text: "Lutetium PSMA. Radioligand therapy. Prostate cancer. VISION trial." },
    { id: "d", kind: "drug", text: "Osimertinib. EGFR kinase inhibitor. Non-small-cell lung cancer. FLAURA." },
  ];
  const index = buildSemanticIndex(docs, { minDf: 1 });

  it("ranks the paraphrase target first and explains the match", () => {
    const hits = semanticSearch(index, "drug for HER2-low breast cancer");
    expect(hits[0].id).toBe("a");
    expect(hits[0].matched).toContain("her2-low");
  });

  it("round-trips through the binary encoding with the same ranking", () => {
    const { bin, meta } = encodeSemanticIndex(index);
    const copy = new Uint8Array(bin); // fresh, non-shared ArrayBuffer, as a fetch() would return
    const back = decodeSemanticIndex(copy.buffer as ArrayBuffer, meta);
    const a = semanticSearch(index, "prostate radioligand").map((h) => h.id);
    const b = semanticSearch(back, "prostate radioligand").map((h) => h.id);
    expect(b).toEqual(a);
    expect(b[0]).toBe("c");
  });

  it("returns nothing for a query with no known tokens", () => {
    expect(semanticSearch(index, "zzzz qqqq")).toEqual([]);
  });

  it("filters before the result window without changing scores or explanations", () => {
    const eligible = (id: string) => id !== "a";
    const query = "drug for HER2-low breast cancer";
    const expected = semanticSearch(index, query, index.ids.length).filter((h) => eligible(h.id)).slice(0, 2);
    expect(semanticSearch(index, query, 2, { filter: eligible })).toEqual(expected);
    expect(semanticSearch(index, query, 2, { filter: () => false })).toEqual([]);
    expect(semanticSearch(index, query, 2, { filter: () => true })).toEqual(semanticSearch(index, query, 2));
  });
});

describe("fuseRanks", () => {
  it("prefers items present in both lists", () => {
    const fused = fuseRanks([[{ id: "x" }, { id: "y" }], [{ id: "y" }, { id: "z" }]]);
    expect(fused[0].id).toBe("y");
    expect(fused[0].in).toEqual([0, 1]);
  });
});

describe("corpus index", () => {
  it("builds for the whole corpus and finds T-DXd for the HER2-low paraphrase", { timeout: 120_000 }, () => {
    const index = buildSemanticIndex(semanticDocs());
    expect(index.ids.length).toBeGreaterThan(3000);
    const top = semanticSearch(index, "drug for HER2-low breast cancer", 10).map((h) => h.id);
    expect(top).toContain("trastuzumab-deruxtecan");
  });
});
