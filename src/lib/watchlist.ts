"use client";

import { useEffect, useState } from "react";

/**
 * Watchlist: entities the reader has starred, with the record dates they last saw. A static site cannot
 * push notifications, but it can compare what is published now against what you saw last time: the /saved/
 * page fetches `/api/v1/entities/<id>.json` (asOf, provenance) and `/provenance.json` (last commit per id)
 * and flags anything newer than `seen`. Stored in localStorage only.
 */
export type WatchItem = {
  id: string;
  kind: string;
  name: string;
  route: string;
  addedOn: string;
  /** Dates of the record as last seen by the reader: `asOf` from the record, `edited` from git provenance. */
  seen: { asOf?: string; edited?: string; on: string };
};

export const WATCHLIST_KEY = "onco:watchlist:v1";
const KEY = WATCHLIST_KEY;
const EVENT = "onco:watchlist";

export function loadWatchlist(): WatchItem[] {
  if (typeof window === "undefined") return [];
  if (memory && storageBlocked) return memory;
  try {
    const raw = window.localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as WatchItem[]) : [];
    return Array.isArray(list) ? list.filter((w) => w && typeof w.id === "string") : [];
  } catch { return []; }
}

/** In-memory copy for browsers that block storage (private windows, strict tracking settings); the star still toggles for this visit. */
let memory: WatchItem[] | null = null;
export let storageBlocked = false;

/** Accept a successfully persisted import without running the visit-only fallback. */
export function acceptStoredWatchlist(list: WatchItem[]) {
  memory = list;
  storageBlocked = false;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: list }));
}

function persist(list: WatchItem[]) {
  memory = list;
  try { window.localStorage.setItem(KEY, JSON.stringify(list)); storageBlocked = false; }
  catch { storageBlocked = true; }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: list }));
}

export const isWatched = (id: string) => loadWatchlist().some((w) => w.id === id);

/** Replace the whole list (used when merging an account's list into this browser). */
export function replaceWatchlist(list: WatchItem[]) { persist(list.filter((w) => w && typeof w.id === "string")); }

type WatchInput = Omit<WatchItem, "addedOn" | "seen"> & { asOf?: string; edited?: string };

/** Apply the normal watch rules without changing storage or the visit-only copy. */
export function withWatchItem(list: WatchItem[], item: WatchInput): WatchItem[] {
  const today = new Date().toISOString().slice(0, 10);
  return [{ id: item.id, kind: item.kind, name: item.name, route: item.route, addedOn: today, seen: { asOf: item.asOf, edited: item.edited, on: today } }, ...list.filter((w) => w.id !== item.id)].slice(0, 500);
}

export function watch(item: WatchInput) {
  persist(withWatchItem(loadWatchlist(), item));
}

export function unwatch(id: string) {
  persist(loadWatchlist().filter((w) => w.id !== id));
}

/** Record that the reader has now seen the current version of a watched entity. */
export function markSeen(id: string, dates: { asOf?: string; edited?: string }) {
  const list = loadWatchlist();
  const i = list.findIndex((w) => w.id === id);
  if (i < 0) return;
  const cur = list[i];
  const next = { ...cur, seen: { asOf: dates.asOf ?? cur.seen.asOf, edited: dates.edited ?? cur.seen.edited, on: new Date().toISOString().slice(0, 10) } };
  if (JSON.stringify(next.seen) === JSON.stringify(cur.seen)) return;
  list[i] = next;
  persist(list);
}

/** Which of the current dates is newer than what the reader saw, if any. */
export function changedSince(seen: WatchItem["seen"], now: { asOf?: string; edited?: string }): Array<{ what: "asOf" | "edited"; from?: string; to: string }> {
  const out: Array<{ what: "asOf" | "edited"; from?: string; to: string }> = [];
  if (now.asOf && (!seen.asOf || now.asOf > seen.asOf)) out.push({ what: "asOf", from: seen.asOf, to: now.asOf });
  if (now.edited && (!seen.edited || now.edited > seen.edited)) out.push({ what: "edited", from: seen.edited, to: now.edited });
  return out;
}

/** React hook: the watchlist, live across tabs, read after mount so server and first client render agree. */
export function useWatchlist(): [WatchItem[], boolean] {
  const [list, setList] = useState<WatchItem[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => { setList(loadWatchlist()); setReady(true); });
    const onChange = () => setList(loadWatchlist());
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) setList(loadWatchlist()); };
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => { cancelAnimationFrame(id); window.removeEventListener(EVENT, onChange); window.removeEventListener("storage", onStorage); };
  }, []);
  return [list, ready];
}

/** The dates of an entity as published now: `asOf` from the JSON API, `edited` from the record's provenance field. */
export async function fetchEntityDates(id: string): Promise<{ asOf?: string; edited?: string } | null> {
  try {
    const r = await fetch(`/api/v1/entities/${id}.json`);
    if (!r.ok) return null;
    const j = (await r.json()) as { entity?: { asOf?: string; provenance?: { editedOn?: string } } };
    return { asOf: j.entity?.asOf, edited: j.entity?.provenance?.editedOn };
  } catch { return null; }
}
