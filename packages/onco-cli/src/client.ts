/**
 * Read-only client for the OnCo static API (https://onco.cc/api/v1/ or a local copy such as out/api/v1).
 *
 * Shared by the `onco` CLI and the `onco-mcp` server. It only uses files that scripts/build-api.ts,
 * scripts/embed.ts, scripts/build-ask.ts and scripts/build-context.ts actually write:
 *
 *   meta.json                 counts, build date, file list          search.json          compact search documents
 *   <plural>.json / .csv      every record of one kind               entities/<id>.json   one record with neighbours
 *   embeddings.json / .bin    concept-search index                   ask-index.json       Ask OnCo name index
 *   context/<id>.md           Markdown context per record
 *
 * Ask OnCo runs the same browser-safe pipeline as the site (src/lib/ask-pipeline.ts) with the record loader
 * pointed at the API, so answers match what https://onco.cc/ask/ shows. The site modules are bundled in at
 * build time (scripts/build-packages.ts); nothing here is copied by hand.
 */
import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import MiniSearch from "minisearch";
import { KINDS, KIND_META, routeFor, type Kind } from "../../../src/lib/schema";
import type { SearchDoc } from "../../../src/lib/search-index";
import { decodeSemanticIndex, fuseRanks, semanticSearch, type SemanticIndex, type SemanticMeta } from "../../../src/lib/semantic";
import { decodeAskIndex, type AskIndex, type AskIndexWire } from "../../../src/lib/ask-index";
import { answerQuestion, type AskResult } from "../../../src/lib/ask-pipeline";
import type { AskEntityRecord } from "../../../src/lib/ask-compose";
import { REGIONS, type Region } from "../../../src/data/regional-approvals";

export const SITE = "https://onco.cc";
export const DEFAULT_API = "https://onco.cc/api/v1";
/** Printed once at the end of every CLI output and included in every MCP response. */
export const ATTRIBUTION = "Data from OnCo (onco.cc), CC BY-NC 4.0; free for individual and educational use, commercial use must contact OnCo to pay";

export { KINDS, KIND_META, REGIONS, routeFor };
export type { Kind, Region, AskResult, SearchDoc };

export type ApiSource = { base: string; local: boolean };

/** One record as /api/v1/entities/<id>.json returns it. Kind-specific fields are open. */
export type Entity = { id: string; kind: Kind; name: string; tldr: string; summary: string; status?: string; asOf?: string; aka?: string[]; tags?: string[]; wikipedia?: string; links?: Array<{ label: string; url: string }> } & Record<string, unknown>;
export type Neighbour = { id: string; kind: Kind; name: string; route: string };
export type EntityRecord = { entity: Entity; route: string; neighbours: Record<string, Neighbour[]> };
export type Meta = { built: string; version: string | null; counts: Record<string, number>; total: number; license?: string; attribution?: string };
export type SearchHit = { id: string; kind: Kind; name: string; tldr: string; route: string; status?: string; url: string; matched: { words: boolean; concepts: string[] } };

export class OncoError extends Error {
  constructor(message: string, readonly code: "not-found" | "network" | "usage" = "network") { super(message); }
}

/** `--api` flag, then ONCO_API, then https://onco.cc/api/v1. Anything that is not http(s) is read from disk. */
export type Env = Record<string, string | undefined>;

export function resolveApi(flag?: string, env: Env = process.env): ApiSource {
  const raw = (flag ?? env.ONCO_API ?? DEFAULT_API).trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(raw)) return { base: raw, local: false };
  const path = raw.startsWith("file://") ? new URL(raw).pathname : raw;
  return { base: isAbsolute(path) ? path : resolve(process.cwd(), path), local: true };
}

/** "drug", "drugs", "key-papers", "Key paper" and "product" all resolve to a kind. */
export function parseKind(input: string): Kind | undefined {
  const s = input.trim().toLowerCase().replace(/^\/+|\/+$/g, "");
  if (!s) return undefined;
  for (const k of KINDS) {
    const m = KIND_META[k];
    if (s === k || s === m.plural.toLowerCase() || s === m.route || s === m.label.toLowerCase() || s === (m.title ?? "").toLowerCase()) return k;
  }
  return undefined;
}

/** Accepts an id, a site route ("/drugs/enhertu/"), a full URL or a context path and returns the id. */
export function parseId(input: string): string {
  const s = input.trim().replace(/^https?:\/\/[^/]+/i, "").replace(/\.(json|md)$/i, "");
  const parts = s.split("/").filter(Boolean);
  return (parts[parts.length - 1] ?? "").toLowerCase();
}

export const urlFor = (e: { kind: Kind; id: string }) => SITE + routeFor(e);

export class OncoClient {
  private cache = new Map<string, Promise<unknown>>();
  constructor(readonly source: ApiSource = resolveApi()) {}

  /** Raw text of one API file, e.g. "meta.json" or "context/tnbc.md". */
  async text(path: string): Promise<string> {
    if (this.source.local) {
      try { return await readFile(join(this.source.base, path), "utf8"); }
      catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") throw new OncoError(`Not found: ${path} (under ${this.source.base})`, "not-found");
        throw new OncoError(`Cannot read ${path}: ${(err as Error).message}`);
      }
    }
    const url = `${this.source.base}/${path.split("/").map(encodeURIComponent).join("/")}`;
    let res: Response;
    try { res = await fetch(url, { headers: { "user-agent": "onco-cli (+https://onco.cc/api/)" } }); }
    catch (err) { throw new OncoError(`Cannot reach ${url}: ${(err as Error).message}`); }
    if (res.status === 404) throw new OncoError(`Not found: ${url}`, "not-found");
    if (!res.ok) throw new OncoError(`${url} returned ${res.status}`);
    return res.text();
  }

  async bytes(path: string): Promise<ArrayBuffer> {
    if (this.source.local) {
      const buf = await readFile(join(this.source.base, path)).catch((err: NodeJS.ErrnoException) => { throw new OncoError(err.code === "ENOENT" ? `Not found: ${path}` : err.message, err.code === "ENOENT" ? "not-found" : "network"); });
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    }
    const url = `${this.source.base}/${path}`;
    const res = await fetch(url).catch((err: Error) => { throw new OncoError(`Cannot reach ${url}: ${err.message}`); });
    if (res.status === 404) throw new OncoError(`Not found: ${url}`, "not-found");
    if (!res.ok) throw new OncoError(`${url} returned ${res.status}`);
    return res.arrayBuffer();
  }

  async json<T>(path: string): Promise<T> {
    const raw = await this.text(path);
    try { return JSON.parse(raw) as T; } catch { throw new OncoError(`${path} is not valid JSON`); }
  }

  /** Fetch once per process. */
  private once<T>(key: string, load: () => Promise<T>): Promise<T> {
    let p = this.cache.get(key) as Promise<T> | undefined;
    if (!p) { p = load(); this.cache.set(key, p); p.catch(() => this.cache.delete(key)); }
    return p;
  }

  meta(): Promise<Meta> { return this.once("meta", () => this.json<Meta>("meta.json")); }

  async entity(idOrRoute: string): Promise<EntityRecord> {
    const id = parseId(idOrRoute);
    if (!id) throw new OncoError("An id is required", "usage");
    try { return await this.once(`entity:${id}`, () => this.json<EntityRecord>(`entities/${id}.json`)); }
    catch (err) { if (err instanceof OncoError && err.code === "not-found") throw new OncoError(`No record with id "${id}". Try: onco search ${JSON.stringify(id)}`, "not-found"); throw err; }
  }

  /** Every record of a kind, from <plural>.json. */
  list(kind: Kind): Promise<Entity[]> { return this.once(`kind:${kind}`, () => this.json<Entity[]>(`${KIND_META[kind].plural}.json`)); }

  /** The kind's CSV exactly as published (first line is the licence comment). */
  csv(kind: Kind): Promise<string> { return this.text(`${KIND_META[kind].plural}.csv`); }

  context(idOrRoute: string): Promise<string> {
    const id = parseId(idOrRoute);
    return this.text(`context/${id}.md`).catch((err: OncoError) => { throw err.code === "not-found" ? new OncoError(`No context file for "${id}"`, "not-found") : err; });
  }

  /** Word search over search.json, with the same MiniSearch configuration as the site. */
  private lexicalIndex() {
    return this.once("lexical", async () => {
      const docs = await this.json<SearchDoc[]>("search.json");
      const ms = new MiniSearch<SearchDoc>({ fields: ["name", "aka", "tldr", "tags", "id"], storeFields: ["id", "kind", "name", "tldr", "route", "status"], searchOptions: { boost: { name: 4, aka: 3, id: 2 }, prefix: true, fuzzy: 0.2 } });
      ms.addAll(docs);
      return { ms, byId: new Map(docs.map((d) => [d.id, d])) };
    });
  }

  /** Concept search (TF-IDF over the record and its neighbours' names). Null when the index is missing. */
  private semanticIndex(): Promise<SemanticIndex | null> {
    return this.once("semantic", async () => {
      try {
        const [meta, bin] = await Promise.all([this.json<SemanticMeta>("embeddings.json"), this.bytes("embeddings.bin")]);
        return decodeSemanticIndex(bin, meta);
      } catch (err) { if (err instanceof OncoError && err.code === "not-found") return null; throw err; }
    });
  }

  askIndex(): Promise<AskIndex> { return this.once("ask-index", async () => decodeAskIndex(await this.json<AskIndexWire>("ask-index.json"))); }

  /** Word and concept search fused by reciprocal rank, the same retrieval the site and Ask OnCo use. */
  async search(query: string, opts: { kind?: Kind; limit?: number } = {}): Promise<SearchHit[]> {
    const limit = opts.limit ?? 10;
    const q = query.trim();
    if (!q) throw new OncoError("A query is required", "usage");
    const [{ ms, byId }, sem] = await Promise.all([this.lexicalIndex(), this.semanticIndex()]);
    // With a kind filter, retrieve deeper so that a narrow kind still fills the page.
    const want = opts.kind ? Math.max(limit * 6, 60) : Math.max(limit, 12);
    const lexical = ms.search(q).slice(0, want).map((h) => ({ id: String(h.id) }));
    const concept = sem ? semanticSearch(sem, q, want) : [];
    const conceptById = new Map(concept.map((h) => [h.id, h.matched.slice(0, 4)]));
    const lexIds = new Set(lexical.map((h) => h.id));
    const hits: SearchHit[] = [];
    for (const f of fuseRanks([lexical, concept])) {
      const d = byId.get(f.id);
      if (!d || d.kind === "page" || (opts.kind && d.kind !== opts.kind)) continue;
      hits.push({ id: d.id, kind: d.kind, name: d.name, tldr: d.tldr, route: d.route, status: d.status, url: SITE + d.route, matched: { words: lexIds.has(d.id), concepts: conceptById.get(d.id) ?? [] } });
      if (hits.length >= limit) break;
    }
    return hits;
  }

  /** Ask OnCo: intent, named records, templated cited answer. Identical logic to the site's /ask/ page. */
  async ask(question: string, opts: { region?: Region; pin?: string; onStep?: (s: string) => void } = {}): Promise<AskResult> {
    const q = question.trim();
    if (q.length < 3) throw new OncoError("A question is required", "usage");
    const [{ ms }, sem, index] = await Promise.all([this.lexicalIndex(), this.semanticIndex(), this.askIndex()]);
    return answerQuestion(q, {
      index,
      lexical: (text, k) => ms.search(text).slice(0, k).map((h) => String(h.id)),
      concept: (text, k) => (sem ? semanticSearch(sem, text, k).map((h) => h.id) : []),
      load: async (id) => {
        try { return (await this.entity(id)) as unknown as AskEntityRecord; }
        catch (err) {
          // An absent record is a corpus gap; a failed read must not become a successful answer.
          if (err instanceof OncoError && err.code === "not-found") return null;
          throw err;
        }
      },
      region: opts.region, pin: opts.pin, onStep: opts.onStep,
    });
  }
}

/** Kinds with their public names and, when meta.json is available, counts. */
export async function kindsTable(client: OncoClient): Promise<Array<{ kind: Kind; plural: string; label: string; route: string; count: number | null; blurb: string }>> {
  const counts = await client.meta().then((m) => m.counts).catch(() => ({}) as Record<string, number>);
  return KINDS.map((k) => ({ kind: k, plural: KIND_META[k].plural, label: KIND_META[k].label, route: KIND_META[k].route, count: counts[k] ?? null, blurb: KIND_META[k].blurb }));
}

/** `--filter key=value`: scalar equality (case-insensitive), or membership for arrays; `key=` matches missing/empty. */
export function applyFilters<T extends Record<string, unknown>>(rows: T[], filters: string[]): T[] {
  const parsed = filters.map((f) => { const i = f.indexOf("="); if (i < 0) throw new OncoError(`Filter "${f}" must look like key=value`, "usage"); return { key: f.slice(0, i).trim(), value: f.slice(i + 1).trim().toLowerCase() }; });
  return rows.filter((row) => parsed.every(({ key, value }) => {
    const v = row[key];
    if (v === undefined || v === null || (Array.isArray(v) && v.length === 0)) return value === "";
    if (Array.isArray(v)) return v.some((x) => String(x).toLowerCase() === value || (typeof x === "object" && x !== null && JSON.stringify(x).toLowerCase().includes(value)));
    if (typeof v === "object") return JSON.stringify(v).toLowerCase().includes(value);
    return String(v).toLowerCase() === value;
  }));
}
