/**
 * The URL form of a filtered, searched and sorted table, shared by EntityBrowser and the FilterableTable hook so a
 * header filter, a toolbar facet and a shared link all produce the same address: facet values repeat per key
 * (`?group=Solid&group=Blood`), `q` is the search box and `sort` is the column key with a leading `-` for
 * descending. Pure functions, no window: the components decide when to read and write.
 */
export type SortSpec = { key: string; dir: 1 | -1 };

export const QUERY_KEY = "q";
export const SORT_KEY = "sort";
export const VIEW_KEY = "v";

const scopedKey = (key: string, scope?: string) => scope ? `${scope}.${key}` : key;

/** Rewrite only this table's keys; a scope lets several tables share one page without sharing state. */
export function viewParams(facetKeys: readonly string[], sel: Record<string, string[]>, q: string, sort: SortSpec | undefined, baseSort: SortSpec | undefined, from?: URLSearchParams | string, scope?: string): URLSearchParams {
  const p = new URLSearchParams(from);
  const key = (k: string) => scopedKey(k, scope);
  // Keep legacy keys for siblings still mounting. Mark migrated tables even when empty so Clear
  // survives reload instead of falling back to the old unscoped selection again.
  const migrated = scope && (p.has(key(VIEW_KEY)) || [...facetKeys, QUERY_KEY, SORT_KEY].some((k) => p.has(k)));
  for (const k of facetKeys) p.delete(key(k));
  p.delete(key(QUERY_KEY)); p.delete(key(SORT_KEY)); p.delete(key(VIEW_KEY));
  for (const k of facetKeys) for (const v of sel[k] ?? []) p.append(key(k), v);
  if (q.trim()) p.set(key(QUERY_KEY), q.trim());
  if (sort && (sort.key !== baseSort?.key || sort.dir !== baseSort?.dir)) p.set(key(SORT_KEY), `${sort.dir === -1 ? "-" : ""}${sort.key}`);
  if (migrated) p.set(key(VIEW_KEY), "1");
  return p;
}

/**
 * Read a view back from a query. Values repeat or are comma-separated; a raw value that is itself a known value
 * for the key is kept whole so values containing commas survive. `known` gives the values a key can take.
 */
export function readViewParams(params: URLSearchParams, facetKeys: readonly string[], known: (key: string) => Set<string>, sortable: (key: string) => boolean, scope?: string): { sel: Record<string, string[]>; q: string; sort?: SortSpec } {
  // An old unscoped link seeds each table until that table has its own complete view.
  const scoped = scope && [...facetKeys, QUERY_KEY, SORT_KEY, VIEW_KEY].some((k) => params.has(scopedKey(k, scope)));
  const key = (k: string) => scopedKey(k, scoped ? scope : undefined);
  const sel: Record<string, string[]> = {};
  for (const k of facetKeys) {
    const raw = params.getAll(key(k));
    if (!raw.length) continue;
    const ok = known(k);
    const vals = [...new Set(raw.flatMap((s) => (ok.has(s) ? [s] : s.split(",").map((x) => x.trim()).filter(Boolean))))];
    if (vals.length) sel[k] = vals;
  }
  const q = params.get(key(QUERY_KEY)) ?? "";
  const s0 = params.get(key(SORT_KEY));
  let sort: SortSpec | undefined;
  if (s0) { const key = s0.replace(/^-/, ""); if (sortable(key)) sort = { key, dir: s0.startsWith("-") ? -1 : 1 }; }
  return { sel, q, sort };
}
