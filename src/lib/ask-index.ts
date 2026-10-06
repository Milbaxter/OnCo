/**
 * The compact entity name index Ask OnCo resolves questions against, and the curated question pairs.
 *
 * Written by scripts/build-ask.ts to public/api/v1/ask-index.json (see ask-index-build.ts for the
 * corpus-side builder). One entry per record: id, kind, name, aliases (aka, brand, code, symbol,
 * abbreviation in the name, curated aliases from ask-lexicon.ts), route, a short TL;DR for chips, status.
 * Pairs are the benchmark questions and the per-cancer patient questions with the records they point at.
 *
 * This module is pure and browser-safe.
 */
import { KINDS, routeFor, type Kind } from "./kinds";
import { ASK_ALIASES, ASK_STOP } from "./ask-lexicon";

/**
 * Small facts the browser needs without fetching the record: the evidence grade of a complementary approach
 * (`evidence:<grade>` tag or the complementary index), a company's Y Combinator batch, and the region codes a
 * product is approved in (from its approvals and the regional table), so "what did India approve for CAR-T"
 * can be answered from the index plus a handful of record fetches.
 */
export type AskIndexExtra = { grade?: string; batch?: string; regions?: string[] };

/** `tldr` is present server-side (harness, scripts); the browser index omits it to stay small and fetches records for text. */
export type AskIndexEntry = AskIndexExtra & { id: string; kind: Kind; name: string; aliases: string[]; route: string; tldr?: string; status?: string };
export type AskPair = { q: string; ids: string[]; source: "benchmark" | "questions" };
export type AskIndex = { version: 1; built?: string; entries: AskIndexEntry[]; pairs: AskPair[] };

/** Compact wire format: one row per entry, kinds by index, routes derived on load; status and extras trail only when present. */
export type AskIndexWireRow = [string, number, string, string[], string?, AskIndexExtra?];
export type AskIndexWire = { version: 1; built?: string; kinds: readonly string[]; rows: AskIndexWireRow[]; pairs: AskPair[] };

function extraOf(e: AskIndexEntry): AskIndexExtra | undefined {
  const x: AskIndexExtra = {};
  if (e.grade) x.grade = e.grade;
  if (e.batch) x.batch = e.batch;
  if (e.regions?.length) x.regions = e.regions;
  return Object.keys(x).length ? x : undefined;
}

export function encodeAskIndex(index: AskIndex): AskIndexWire {
  return {
    version: 1, built: index.built, kinds: KINDS,
    rows: index.entries.map((e) => {
      const row: AskIndexWireRow = [e.id, KINDS.indexOf(e.kind), e.name, e.aliases];
      const extra = extraOf(e);
      if (e.status || extra) row.push(e.status ?? "");
      if (extra) row.push(extra);
      return row;
    }),
    pairs: index.pairs,
  };
}

export function decodeAskIndex(w: AskIndexWire): AskIndex {
  const entries: AskIndexEntry[] = w.rows.map(([id, k, name, aliases, status, extra]) => {
    const kind = (w.kinds[k] ?? "term") as Kind;
    return { id, kind, name, aliases, route: routeFor({ kind, id }), ...(status ? { status } : {}), ...(extra ?? {}) };
  });
  return { version: 1, built: w.built, entries, pairs: w.pairs };
}

/**
 * Region code for an approval's `region` string as the corpus writes it ("US", "EU", "China", "Japan", "IN",
 * "United Kingdom", "Australia (TGA)"); undefined for anything else.
 */
export function regionCode(region: string): string | undefined {
  const s = region.trim().toLowerCase();
  if (/^(?:us|usa|fda|united states|u\.s\.)\b/.test(s)) return "US";
  if (/^(?:eu|ema|europe|european union|e\.u\.)\b/.test(s)) return "EU";
  if (/^(?:uk|mhra|united kingdom|great britain|britain)\b/.test(s)) return "UK";
  if (/^(?:jp|japan|pmda)\b/.test(s)) return "JP";
  if (/^(?:cn|china|nmpa|prc)\b/.test(s)) return "CN";
  if (/^(?:au|australia|tga)\b/.test(s)) return "AU";
  if (/^(?:in|india|cdsco|dcgi)\b/.test(s)) return "IN";
  return undefined;
}

/** "Triple-negative breast cancer (TNBC)" -> "Triple-negative breast cancer". */
export function baseName(name: string): string {
  return name.replace(/\s*\([^()]*\)\s*$/, "").trim();
}

/** The abbreviation in a trailing parenthetical, if it looks like one: "(TNBC)" -> "TNBC"; "(computed tomography)" -> undefined. */
export function abbreviation(name: string): string | undefined {
  const m = name.match(/\(([A-Za-z0-9\-/&.+ ]{2,14})\)\s*$/)?.[1]?.trim();
  if (!m) return undefined;
  if (/^[a-z ]+$/.test(m) && m.length > 6) return undefined; // a gloss, not an abbreviation
  // Two or more words with lower-case letters ("Tata Memorial", "KEGG map", "PAM50 assay") gloss the name rather than abbreviate it.
  if (/\s/.test(m) && /[a-z]/.test(m)) return undefined;
  if (/^(generic|and biosimilars|oral|SC|EU|US|UK|fibrosis|NSCLC, EU)$/i.test(m)) return undefined;
  return m;
}

/** What to call a record in a generated sentence or follow-up: the abbreviation for cancers when there is one, else the base name. */
export function shortName(e: { kind: Kind; name: string }): string {
  const abbr = abbreviation(e.name);
  if (abbr && (e.kind === "cancer" || e.kind === "term" || e.kind === "technology") && /^[A-Z0-9\-/]{2,8}$/.test(abbr)) return abbr;
  const base = baseName(e.name);
  // "Gastric & gastro-oesophageal junction cancer" -> keep; "Sarcomas (soft tissue, bone, GIST)" -> "Sarcomas".
  return base || e.name;
}

/** Split a brand string such as "Keytruda / Keytruda Qlex (SC)" or "Tafinlar + Mekinist" into names. */
function splitBrand(brand: string): string[] {
  return brand.split(/\s*[\/;]\s*|\s+\+\s+/).map((s) => s.replace(/\s*\([^)]*\)\s*/g, " ").trim()).filter((s) => s.length >= 3 && !/^(and|or)$/i.test(s));
}

export type AliasSource = { id: string; kind: Kind; name: string; aka?: string[]; brand?: string; code?: string; symbol?: string; nct?: string };

/** Every string that should resolve to this record, deduplicated case-insensitively, name first. */
export function deriveAliases(e: AliasSource): string[] {
  const out: string[] = [];
  const base = baseName(e.name);
  const min = e.kind === "term" ? 3 : 4;
  const push = (s?: string, curated = false) => {
    if (!s) return;
    const t = s.trim();
    // Two capitals ("YC", "EV") count only as curated aliases; everything else needs three characters.
    if (t.length < 3 && !(curated && /^[A-Z0-9]{2}$/.test(t))) return;
    if (/^\d+$/.test(t) || ASK_STOP.has(t.toLowerCase())) return;
    if (t.length < min && !/[A-Z0-9]/.test(t)) return;
    out.push(t);
  };
  push(base);
  // A registry title such as "Tepotinib Phase II in NSCLC Harboring MET Alterations (VISION)" must not claim the acronym: only a
  // trial whose name is the acronym itself ("VISION") resolves from it.
  if (!(e.kind === "trial" && e.name.length > 40)) push(abbreviation(e.name));
  // Glossary entries that name two things ("HER2-low and HER2-ultralow", "Hot vs cold tumours") resolve from each half.
  if (e.kind === "term") for (const h of base.split(/\s+(?:and|or|vs\.?|versus|\/|&)\s+/)) if (h !== base && h.length >= 4) push(h);
  // Slash-separated names ("PI3K / AKT / mTOR") also resolve from the compact form.
  if (/\s\/\s/.test(base)) push(base.replace(/\s\/\s/g, "/"));
  // Glossary phrase aliases about approval itself ("approved in the UK", "EU approval") would swallow the region or
  // the verb of an approval question; the intent rules read those words instead.
  for (const a of e.aka ?? []) {
    if (e.kind === "term" && /\b(?:approved|approval|authori[sz]ation)\b/i.test(a)) continue;
    push(a);
    // KEGG maps: "KEGG hsa05219" also resolves from the bare map code.
    const kegg = /^KEGG\s+(hsa\d{5})$/i.exec(a);
    if (kegg) push(kegg[1]);
  }
  if (e.brand) for (const b of splitBrand(e.brand)) push(b);
  if (e.code) for (const c of e.code.split(/\s*[,;\/]\s*/)) push(c);
  push(e.symbol);
  push(e.nct);
  for (const a of ASK_ALIASES[e.id] ?? []) push(a, true);
  const seen = new Set<string>();
  return out.filter((a) => { const k = a.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

/** First sentence of a TL;DR, capped, for chips and "not what you meant" rows. */
export function shortTldr(tldr: string, max = 160): string {
  const first = tldr.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+(?=[A-Z0-9"(])/)[0] ?? "";
  return first.length <= max ? first : `${first.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
}

let cache: Promise<AskIndex | null> | null = null;

/** Browser loader; null means absent or unavailable. Cache a missing build (404), but let failed loads retry. */
export function loadAskIndex(): Promise<AskIndex | null> {
  if (!cache) {
    cache = fetch("/api/v1/ask-index.json").then(async (r) => {
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`Ask index HTTP ${r.status}`);
      return decodeAskIndex((await r.json()) as AskIndexWire);
    }).catch(() => { cache = null; return null; });
  }
  return cache;
}
