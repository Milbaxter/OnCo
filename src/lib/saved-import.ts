import { announceSavedViews, loadViews, SAVED_VIEWS_KEY, withSavedView } from "./saved-views";
import { acceptStoredWatchlist, loadWatchlist, WATCHLIST_KEY, withWatchItem, type WatchItem } from "./watchlist";

export class SavedImportStorageError extends Error {
  constructor(restored = true) {
    super(restored
      ? "Import could not be saved because browser storage is full or unavailable. Your existing lists are unchanged."
      : "Import could not be saved, and the previous lists could not be fully restored. Check your saved lists before trying again.");
  }
}

export function importSavedData(text: string): number {
  const j = JSON.parse(text) as { views?: Array<{ name: string; url: string; noun?: string; count?: number }>; watchlist?: WatchItem[] };
  let storage: Storage;
  let previousViews: string | null, previousWatchlist: string | null;
  try {
    storage = window.localStorage;
    previousViews = storage.getItem(SAVED_VIEWS_KEY);
    previousWatchlist = storage.getItem(WATCHLIST_KEY);
  } catch { throw new SavedImportStorageError(); }

  let views = loadViews(), watching = loadWatchlist();
  let hasViews = false, hasWatchlist = false;
  let n = 0;
  for (const v of j.views ?? []) if (v && typeof v.url === "string") {
    views = withSavedView(views, { name: v.name, url: v.url, noun: v.noun, count: v.count }); hasViews = true; n++;
  }
  for (const w of j.watchlist ?? []) if (w && typeof w.id === "string") {
    watching = withWatchItem(watching, { id: w.id, kind: w.kind, name: w.name, route: w.route, asOf: w.seen?.asOf, edited: w.seen?.edited }); hasWatchlist = true; n++;
  }

  const updates: Array<{ key: string; value: string; previous: string | null }> = [];
  if (hasViews) updates.push({ key: SAVED_VIEWS_KEY, value: JSON.stringify(views), previous: previousViews });
  if (hasWatchlist) updates.push({ key: WATCHLIST_KEY, value: JSON.stringify(watching), previous: previousWatchlist });
  const written: typeof updates = [];
  try {
    // Replace the real keys directly: a temporary copy could exceed quota even when replacement fits.
    for (const update of updates) { storage.setItem(update.key, update.value); written.push(update); }
  } catch {
    let restored = true;
    // setItem rejects before updating the failed key; restore earlier writes before notifying this page.
    // This is recovery for a failed import, not a cross-tab lock or a crash-safe transaction.
    for (const update of written.reverse()) {
      try {
        if (update.previous === null) storage.removeItem(update.key);
        else storage.setItem(update.key, update.previous);
      } catch { restored = false; }
    }
    throw new SavedImportStorageError(restored);
  }
  if (hasWatchlist) acceptStoredWatchlist(watching);
  if (hasViews) announceSavedViews(views);
  return n;
}
