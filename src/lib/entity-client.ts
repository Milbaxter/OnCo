/**
 * Browser loader for one record with its neighbours, /api/v1/entities/<id>.json. Fetched once per id and
 * cached for the session, so Ask OnCo and the search page's "Related" strip share requests.
 */
import type { AskEntityRecord } from "./ask-compose";

const cache = new Map<string, Promise<AskEntityRecord | null>>();

/** A 404 is an unknown id. Operational failures reject and can be retried; successful requests are shared. */
export function loadEntityRecord(id: string): Promise<AskEntityRecord | null> {
  let p = cache.get(id);
  if (!p) {
    p = fetch(`/api/v1/entities/${encodeURIComponent(id)}.json`).then(async (r) => {
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`Could not load the record (HTTP ${r.status}). Try asking again.`);
      return (await r.json()) as AskEntityRecord;
    }).catch((error) => { cache.delete(id); throw error; });
    cache.set(id, p);
  }
  return p;
}
