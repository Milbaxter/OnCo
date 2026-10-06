import { describe, expect, it } from "vitest";
import { readViewParams, viewParams } from "./table-view";

const keys = ["cancers", "status"];
const known = (key: string) => new Set(key === "cancers" ? ["tnbc", "nsclc", "A, B"] : ["recruiting", "approved"]);
const read = (params: URLSearchParams, scope?: string) => readViewParams(params, keys, known, (key) => ["drug", "enrolled"].includes(key), scope);

describe("table URL state", () => {
  it("preserves the existing unscoped filter, search and sort format", () => {
    const params = viewParams(keys, { cancers: ["tnbc", "nsclc"] }, "alpha", { key: "drug", dir: -1 }, undefined, "utm=fixture&v=old");
    expect(params.toString()).toBe("utm=fixture&cancers=tnbc&cancers=nsclc&q=alpha&sort=-drug");
    expect(read(params)).toEqual({ sel: { cancers: ["tnbc", "nsclc"] }, q: "alpha", sort: { key: "drug", dir: -1 } });
  });

  it("round-trips independent filters, searches and sorts for sibling tables", () => {
    let params = viewParams(keys, { cancers: ["tnbc"] }, "alpha", { key: "drug", dir: -1 }, undefined, "utm=fixture&utm=second&q=page&sort=page&v=page-view", "phase3");
    params = viewParams(keys, { cancers: ["nsclc"] }, "beta", { key: "enrolled", dir: 1 }, undefined, params, "trials");
    expect(read(params, "phase3")).toEqual({ sel: { cancers: ["tnbc"] }, q: "alpha", sort: { key: "drug", dir: -1 } });
    expect(read(params, "trials")).toEqual({ sel: { cancers: ["nsclc"] }, q: "beta", sort: { key: "enrolled", dir: 1 } });
    expect(params.get("q")).toBe("page");
    expect(params.get("sort")).toBe("page");
    expect(params.get("v")).toBe("page-view");
    expect(params.getAll("utm")).toEqual(["fixture", "second"]);
  });

  it.each([["phase3", "trials"], ["trials", "phase3"]])("reads legacy links regardless of sibling write order: %s then %s", (first, second) => {
    let params = new URLSearchParams("cancers=tnbc&sort=-drug&utm=fixture");
    const firstView = read(params, first);
    params = viewParams(keys, firstView.sel, firstView.q, firstView.sort, undefined, params, first);
    const secondView = read(params, second);
    expect(secondView).toEqual(firstView);
    params = viewParams(keys, secondView.sel, secondView.q, secondView.sort, undefined, params, second);
    // Clear one table and restore both from the resulting shared URL.
    params = viewParams(keys, {}, "", undefined, undefined, params, first);
    expect(read(params, first)).toEqual({ sel: {}, q: "", sort: undefined });
    expect(read(params, second)).toEqual(firstView);
    expect(params.get("cancers")).toBe("tnbc");
    expect(params.get("utm")).toBe("fixture");
  });

  it("treats scoped state as a whole view instead of merging legacy filters back in", () => {
    const params = new URLSearchParams("cancers=tnbc&status=approved&sort=-drug&phase3.cancers=nsclc");
    expect(read(params, "phase3")).toEqual({ sel: { cancers: ["nsclc"] }, q: "", sort: undefined });
    expect(read(params, "trials").sel).toEqual({ cancers: ["tnbc"], status: ["approved"] });
  });

  it("does not let an empty sibling erase a restored table's sort or filters", () => {
    const before = new URLSearchParams("phase3.cancers=tnbc&phase3.sort=-drug&utm=fixture");
    const after = viewParams(keys, {}, "", undefined, undefined, before, "trials");
    expect(after.toString()).toBe(before.toString());
    expect(read(after, "phase3").sort).toEqual({ key: "drug", dir: -1 });
  });

  it("keeps repeated and comma-containing scoped values intact", () => {
    const params = viewParams(keys, { cancers: ["A, B", "tnbc"] }, "", undefined, undefined, undefined, "phase3");
    expect(read(params, "phase3").sel).toEqual({ cancers: ["A, B", "tnbc"] });
  });

  it("can clear a new scoped view without changing unrelated parameters or the hash", () => {
    const url = new URL("https://onco.cc/modalities/adc/?utm=fixture#phase3");
    url.search = viewParams(keys, { cancers: ["tnbc"] }, "", { key: "drug", dir: -1 }, undefined, url.searchParams, "phase3").toString();
    url.search = viewParams(keys, {}, "", undefined, undefined, url.searchParams, "phase3").toString();
    expect(url.href).toBe("https://onco.cc/modalities/adc/?utm=fixture#phase3");
  });
});
