/**
 * Browser loader for one record with its neighbours, /api/v1/entities/<id>.json. Fetched once per id and
 * cached for the session, so Ask OnCo and the search page's "Related" strip share requests.
 */
import type { AskEntityRecord } from "./ask-compose";

const cache = new Map<string, Promise<AskEntityRecord | null>>();

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
/** Check the API envelope needed to read an answer; leave the record's clinical fields to the corpus validator. */
function recordEnvelope(value: unknown, id: string): value is AskEntityRecord {
  if (!object(value) || !object(value.entity) || !object(value.neighbours) || typeof value.route !== "string") return false;
  const entity = value.entity;
  return entity.id === id && ["kind", "name", "tldr", "summary"].every((field) => typeof entity[field] === "string");
}

/** A 404 is an unknown id. Operational failures reject and can be retried; successful requests are shared. */
export function loadEntityRecord(id: string): Promise<AskEntityRecord | null> {
  let p = cache.get(id);
  if (!p) {
    p = fetch(`/api/v1/entities/${encodeURIComponent(id)}.json`).then(async (r) => {
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const record: unknown = await r.json();
      if (!recordEnvelope(record, id)) throw new Error("Invalid record response");
      return record;
    }).catch((error) => { cache.delete(id); throw new Error("The record could not be loaded. Try asking again.", { cause: error }); });
    cache.set(id, p);
  }
  return p;
}
