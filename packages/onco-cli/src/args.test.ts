import { describe, expect, it } from "vitest";
import { bool, int, list, parseArgs, str } from "./args";
import { parseId, parseKind, resolveApi, applyFilters } from "./client";

describe("parseArgs", () => {
  it("separates command, positionals and flags in both --key value and --key=value forms", () => {
    const p = parseArgs(["search", "HER2-low", "breast", "--kind", "drug", "--limit=5", "--json"]);
    expect(p.command).toBe("search");
    expect(p.positionals).toEqual(["HER2-low", "breast"]);
    expect(str(p.flags, "kind")).toBe("drug");
    expect(int(p.flags, "limit", 10)).toBe(5);
    expect(bool(p.flags, "json")).toBe(true);
  });
  it("collects repeated --filter flags and treats switches as booleans even when followed by a word", () => {
    const p = parseArgs(["list", "trial", "--filter", "status=recruiting", "--filter", "phase=3", "--json", "extra"]);
    expect(list(p.flags, "filter")).toEqual(["status=recruiting", "phase=3"]);
    expect(p.positionals).toEqual(["trial", "extra"]);
  });
  it("stops parsing flags after --", () => {
    const p = parseArgs(["ask", "--", "--what", "is", "this"]);
    expect(p.positionals).toEqual(["--what", "is", "this"]);
  });
  it("rejects a non-numeric --limit", () => {
    expect(() => int(parseArgs(["list", "drug", "--limit", "many"]).flags, "limit", 1)).toThrow(/positive integer/);
  });
});

describe("resolveApi", () => {
  it("defaults to onco.cc and honours ONCO_API", () => {
    expect(resolveApi(undefined, {})).toEqual({ base: "https://onco.cc/api/v1", local: false });
    expect(resolveApi(undefined, { ONCO_API: "https://example.org/api/v1/" })).toEqual({ base: "https://example.org/api/v1", local: false });
  });
  it("treats a directory as a local copy and the flag beats the environment", () => {
    const r = resolveApi("out/api/v1", { ONCO_API: "https://example.org" });
    expect(r.local).toBe(true);
    expect(r.base.endsWith("/out/api/v1")).toBe(true);
    expect(resolveApi("/tmp/api", {})).toEqual({ base: "/tmp/api", local: true });
  });
});

describe("parseKind and parseId", () => {
  it("accepts singular, plural, route and label", () => {
    expect(parseKind("drug")).toBe("drug");
    expect(parseKind("drugs")).toBe("drug");
    expect(parseKind("key-papers")).toBe("paper");
    expect(parseKind("Key paper")).toBe("paper");
    expect(parseKind("fronts")).toBe("section");
    expect(parseKind("widgets")).toBeUndefined();
  });
  it("reduces routes, URLs and file names to the id", () => {
    expect(parseId("tnbc")).toBe("tnbc");
    expect(parseId("/drugs/trastuzumab-deruxtecan/")).toBe("trastuzumab-deruxtecan");
    expect(parseId("https://onco.cc/cancers/TNBC/")).toBe("tnbc");
    expect(parseId("/api/v1/context/trop2.md")).toBe("trop2");
  });
  it.each([
    "https://onco.cc/cancers/tnbc/#standard-of-care",
    "https://onco.cc/cancers/tnbc?region=UK#sources",
    "/cancers/tnbc/?return=/drugs/example/#sources",
    "/api/v1/entities/tnbc.json?download=1",
    "https://onco.cc/api/v1/context/tnbc.md#sources",
  ])("reads the record path from %s without query or fragment text", (input) => {
    expect(parseId(input)).toBe("tnbc");
  });
});

describe("applyFilters", () => {
  const rows = [{ id: "a", status: "approved", tags: ["adc"], phase: "3" }, { id: "b", status: "phase-3", tags: [], phase: "3" }];
  it("matches scalars case-insensitively, array membership and empties", () => {
    expect(applyFilters(rows, ["status=Approved"]).map((r) => r.id)).toEqual(["a"]);
    expect(applyFilters(rows, ["tags=adc"]).map((r) => r.id)).toEqual(["a"]);
    expect(applyFilters(rows, ["tags="]).map((r) => r.id)).toEqual(["b"]);
    expect(applyFilters(rows, ["phase=3", "status=phase-3"]).map((r) => r.id)).toEqual(["b"]);
  });
  it("rejects malformed filters", () => {
    expect(() => applyFilters(rows, ["status"])).toThrow(/key=value/);
  });
});
