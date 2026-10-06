"use client";

import { useEffect, useState } from "react";

/**
 * Saved table views: a name plus the URL that reproduces the filters, search and sort of a table.
 * Stored in localStorage only; nothing leaves the browser. Any URL-backed view can be saved
 * (EntityBrowser writes its whole state into the query string, so its URL is the view).
 */
export type SavedView = {
  id: string;
  name: string;
  /** Path plus query string plus hash, e.g. `/drugs/?modality=ADC&sort=-name`. */
  url: string;
  /** What the table counts, e.g. "products". */
  noun?: string;
  /** Rows matched when the view was saved, so the list can show "12 products" and later "was 12". */
  count?: number;
  savedOn: string;
};

export const SAVED_VIEWS_KEY = "onco:saved-views:v1";
const KEY = SAVED_VIEWS_KEY;
const EVENT = "onco:saved-views";

export function loadViews(): SavedView[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as SavedView[]) : [];
    return Array.isArray(list) ? list.filter((v) => v && typeof v.url === "string" && typeof v.name === "string") : [];
  } catch { return []; }
}

function persist(list: SavedView[]) {
  window.localStorage.setItem(KEY, JSON.stringify(list));
  announceSavedViews(list);
}

/** Notify this page after saved-view writes succeed. */
export function announceSavedViews(list: SavedView[]) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: list }));
}

/** Current path, query and hash: the URL a saved view stores. */
export function currentViewUrl(): string {
  if (typeof window === "undefined") return "/";
  return window.location.pathname + window.location.search + window.location.hash;
}

/** Apply the normal save rules without writing, so imports can stage the complete list. */
export function withSavedView(list: SavedView[], input: { name: string; url?: string; noun?: string; count?: number }): SavedView[] {
  const url = input.url ?? currentViewUrl();
  const view: SavedView = { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, name: input.name.trim() || url, url, noun: input.noun, count: input.count, savedOn: new Date().toISOString().slice(0, 10) };
  return [view, ...list.filter((v) => v.url !== url)].slice(0, 200);
}

export function saveView(input: { name: string; url?: string; noun?: string; count?: number }): SavedView {
  const list = withSavedView(loadViews(), input);
  persist(list);
  return list[0];
}

export function removeView(id: string) {
  persist(loadViews().filter((v) => v.id !== id));
}

export function renameView(id: string, name: string) {
  persist(loadViews().map((v) => (v.id === id ? { ...v, name: name.trim() || v.name } : v)));
}

/** Is the current URL already saved? Used to label the button "Saved". */
export function findView(url: string): SavedView | undefined {
  return loadViews().find((v) => v.url === url);
}

/** React hook: saved views, live across tabs, read after mount so server and first client render agree. */
export function useSavedViews(): [SavedView[], boolean] {
  const [views, setViews] = useState<SavedView[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => { setViews(loadViews()); setReady(true); });
    const onChange = () => setViews(loadViews());
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) setViews(loadViews()); };
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => { cancelAnimationFrame(id); window.removeEventListener(EVENT, onChange); window.removeEventListener("storage", onStorage); };
  }, []);
  return [views, ready];
}

/** A short human summary of a query string: `modality: ADC · status: approved · "her2"`. */
export function describeQuery(url: string): string {
  const q = url.indexOf("?");
  if (q < 0) return "";
  const params = new URLSearchParams(url.slice(q + 1).replace(/#.*$/, ""));
  const parts: string[] = [];
  const grouped = new Map<string, string[]>();
  for (const [k, v] of params) { if (k === "q" || k === "sort" || k === "v") continue; grouped.set(k, [...(grouped.get(k) ?? []), v]); }
  for (const [k, vs] of grouped) parts.push(`${k}: ${vs.join(", ")}`);
  const text = params.get("q"); if (text) parts.push(`"${text}"`);
  const sort = params.get("sort"); if (sort) parts.push(`sorted by ${sort.replace(/^-/, "")}${sort.startsWith("-") ? " (desc)" : ""}`);
  return parts.join(" · ");
}
