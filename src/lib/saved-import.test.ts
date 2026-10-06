import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VIEWS = "onco:saved-views:v1", WATCH = "onco:watchlist:v1";
const view = (url = "/trials/?status=recruiting", name = "Imported trials") => ({ name, url });
const watched = (id = "alpha", name = "Imported Alpha") => ({ id, kind: "term", name, route: `/terms/${id}/`, addedOn: "2025-01-01", seen: { on: "2025-01-01", asOf: "2025-01-01" } });
let store: Map<string, string>;
let failKey: string | null;
let readBlocked: boolean;
let quota: number;
let storage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn>; removeItem: ReturnType<typeof vi.fn> };
let dispatch: ReturnType<typeof vi.fn>;
let api: typeof import("./saved-import");
let watchlist: typeof import("./watchlist");
let views: typeof import("./saved-views");
const bytes = () => Object.fromEntries(store);
const seed = () => {
  store.set(VIEWS, JSON.stringify([{ id: "original-view", ...view(undefined, "Original trials"), savedOn: "2025-01-01" }]));
  store.set(WATCH, JSON.stringify([watched("original", "Original watch")]));
};

beforeEach(async () => {
  vi.resetModules(); store = new Map(); failKey = null; readBlocked = false; quota = Infinity;
  storage = {
    getItem: vi.fn((key: string) => { if (readBlocked) throw new DOMException("blocked", "SecurityError"); return store.get(key) ?? null; }),
    setItem: vi.fn((key: string, value: string) => {
      const next = new Map(store).set(key, value);
      const size = [...next].reduce((n, [k, v]) => n + k.length + v.length, 0);
      if (key === failKey || size > quota) throw new DOMException("full", "QuotaExceededError");
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => { store.delete(key); }),
  };
  dispatch = vi.fn();
  vi.stubGlobal("window", { localStorage: storage, dispatchEvent: dispatch });
  api = await import("./saved-import"); watchlist = await import("./watchlist"); views = await import("./saved-views");
  seed();
});
afterEach(() => vi.unstubAllGlobals());

describe("saved data import persistence", () => {
  it("merges valid views and watch items using the existing duplicate and ordering rules", () => {
    const count = api.importSavedData(JSON.stringify({ views: [view(), view("/drugs/", "Drugs"), view(undefined, "Newest trials")], watchlist: [watched(), watched("beta"), watched("alpha", "Newest Alpha")] }));
    expect(count).toBe(6);
    expect(views.loadViews().map((v) => v.name)).toEqual(["Newest trials", "Drugs"]);
    expect(watchlist.loadWatchlist().map((w) => w.id)).toEqual(["alpha", "beta", "original"]);
    expect(watchlist.loadWatchlist()[0].name).toBe("Newest Alpha");
  });

  it("leaves the unrelated list's bytes alone for a views-only import", () => {
    const before = store.get(WATCH);
    expect(api.importSavedData(JSON.stringify({ views: [view()] }))).toBe(1);
    expect(store.get(WATCH)).toBe(before);
  });

  it("leaves the unrelated list's bytes alone for a watch-only import", () => {
    const before = store.get(VIEWS);
    expect(api.importSavedData(JSON.stringify({ watchlist: [watched()] }))).toBe(1);
    expect(store.get(VIEWS)).toBe(before);
  });

  it("keeps every view unchanged when a later imported view exceeds capacity", () => {
    const before = bytes(); quota = [...store].reduce((n, [k, v]) => n + k.length + v.length, 0) + 40;
    expect(() => api.importSavedData(JSON.stringify({ views: [view(), view("/drugs/", "Drugs")] }))).toThrow();
    expect(bytes()).toEqual(before); expect(dispatch).not.toHaveBeenCalled();
  });

  it("does not report a successful watch import that exists only in memory", () => {
    const before = bytes(); const list = watchlist.loadWatchlist(); failKey = WATCH;
    expect(() => api.importSavedData(JSON.stringify({ watchlist: [watched()] }))).toThrow();
    expect(bytes()).toEqual(before); expect(watchlist.loadWatchlist()).toEqual(list);
    expect(watchlist.storageBlocked).toBe(false); expect(dispatch).not.toHaveBeenCalled();
  });

  it.each([true, false])("rolls back the first key if the second fails (prior views exist: %s)", (existing) => {
    if (!existing) store.delete(VIEWS);
    const before = bytes(); failKey = WATCH;
    expect(() => api.importSavedData(JSON.stringify({ views: [view()], watchlist: [watched()] }))).toThrow();
    expect(bytes()).toEqual(before); expect(dispatch).not.toHaveBeenCalled();
    expect(watchlist.loadWatchlist().map((w) => w.id)).toEqual(["original"]);
  });

  it("preserves an existing visit-only watchlist and its blocked flag if import fails", () => {
    failKey = WATCH; watchlist.watch({ id: "temporary", kind: "term", name: "Temporary", route: "/terms/temporary/" });
    const before = bytes(); const list = watchlist.loadWatchlist(); dispatch.mockClear();
    expect(watchlist.storageBlocked).toBe(true);
    expect(() => api.importSavedData(JSON.stringify({ views: [view()], watchlist: [watched()] }))).toThrow();
    expect(bytes()).toEqual(before); expect(watchlist.loadWatchlist()).toEqual(list);
    expect(watchlist.storageBlocked).toBe(true); expect(dispatch).not.toHaveBeenCalled();
  });

  it("rejects blocked storage before changing either list", () => {
    const before = bytes(); readBlocked = true;
    expect(() => api.importSavedData(JSON.stringify({ watchlist: [watched()] }))).toThrow();
    expect(bytes()).toEqual(before); expect(storage.setItem).not.toHaveBeenCalled(); expect(dispatch).not.toHaveBeenCalled();
  });

  it("stages the whole input before changing an earlier valid view", () => {
    const before = bytes();
    expect(() => api.importSavedData(JSON.stringify({ views: [view(), { url: "/drugs/" }] }))).toThrow();
    expect(bytes()).toEqual(before); expect(dispatch).not.toHaveBeenCalled();
  });

  it("retains the normal 200-view and 500-watch caps and most-recent-first order", () => {
    api.importSavedData(JSON.stringify({ views: Array.from({ length: 203 }, (_, i) => view(`/trials/?q=${i}`, `View ${i}`)), watchlist: Array.from({ length: 503 }, (_, i) => watched(`item-${i}`)) }));
    const saved = views.loadViews(), watching = watchlist.loadWatchlist();
    expect(saved).toHaveLength(200); expect(saved[0].name).toBe("View 202"); expect(saved.at(-1)?.name).toBe("View 3");
    expect(watching).toHaveLength(500); expect(watching[0].id).toBe("item-502"); expect(watching.at(-1)?.id).toBe("item-3");
  });

  it("publishes only after both keys are saved and retains the imported data on reload", async () => {
    const published: Array<Record<string, string>> = [];
    dispatch.mockImplementation(() => { published.push(bytes()); });
    expect(api.importSavedData(JSON.stringify({ views: [view()], watchlist: [watched()] }))).toBe(2);
    expect(storage.setItem.mock.calls.map(([key]) => key)).toEqual([VIEWS, WATCH]);
    expect(published).toEqual([bytes(), bytes()]);
    vi.resetModules();
    expect((await import("./saved-views")).loadViews()[0].name).toBe("Imported trials");
    expect((await import("./watchlist")).loadWatchlist()[0].id).toBe("alpha");
  });

  it("allows replacement at capacity without reserving a temporary copy", () => {
    const original = JSON.parse(store.get(VIEWS)!); original[0].name = "Old name ".repeat(100);
    store.set(VIEWS, JSON.stringify(original));
    quota = [...store].reduce((n, [k, v]) => n + k.length + v.length, 0);
    expect(api.importSavedData(JSON.stringify({ views: [view()] }))).toBe(1);
    expect(views.loadViews()[0].name).toBe("Imported trials");
    expect(storage.setItem.mock.calls.map(([key]) => key)).toEqual([VIEWS]);
  });

  it("releases capacity from a shrinking watchlist before writing growing views", () => {
    store.set(WATCH, JSON.stringify([watched("alpha", "Old name ".repeat(550))]));
    quota = [...store].reduce((n, [k, v]) => n + k.length + v.length, 0);
    expect(api.importSavedData(JSON.stringify({ views: [view("/drugs/", "Imported products")], watchlist: [watched()] }))).toBe(2);
    expect(views.loadViews().map((v) => v.name)).toEqual(["Imported products", "Original trials"]);
    expect(watchlist.loadWatchlist().map((w) => w.name)).toEqual(["Imported Alpha"]);
    expect(storage.setItem.mock.calls.map(([key]) => key)).toEqual([WATCH, VIEWS]);
  });

  it("restores a shrinking watchlist without publishing when the later views write fails", () => {
    store.set(WATCH, JSON.stringify([watched("alpha", "Old name ".repeat(550))]));
    const before = bytes(), list = watchlist.loadWatchlist(); failKey = VIEWS;
    expect(() => api.importSavedData(JSON.stringify({ views: [view("/drugs/", "Imported products")], watchlist: [watched()] }))).toThrow("existing lists are unchanged");
    expect(storage.setItem.mock.calls.map(([key]) => key)).toEqual([WATCH, VIEWS, WATCH]);
    expect(bytes()).toEqual(before); expect(watchlist.loadWatchlist()).toEqual(list);
    expect(watchlist.storageBlocked).toBe(false); expect(dispatch).not.toHaveBeenCalled();
  });

  it("persists existing visit-only watches too when a later import succeeds", () => {
    failKey = WATCH; watchlist.watch({ id: "temporary", kind: "term", name: "Temporary", route: "/terms/temporary/" });
    failKey = null; dispatch.mockClear();
    expect(api.importSavedData(JSON.stringify({ watchlist: [watched()] }))).toBe(1);
    expect(watchlist.storageBlocked).toBe(false);
    expect(watchlist.loadWatchlist().map((w) => w.id)).toEqual(["alpha", "temporary", "original"]);
    expect(JSON.parse(store.get(WATCH)!).map((w: { id: string }) => w.id)).toEqual(["alpha", "temporary", "original"]);
  });

  it("reports blocked writes as a storage failure without changing the lists", () => {
    const before = bytes();
    storage.setItem.mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
    expect(() => api.importSavedData(JSON.stringify({ views: [view()] }))).toThrow("browser storage is full or unavailable");
    expect(bytes()).toEqual(before); expect(dispatch).not.toHaveBeenCalled();
  });

  it("does not claim restoration if storage becomes unavailable during rollback", () => {
    let calls = 0;
    storage.setItem.mockImplementation((key: string, value: string) => {
      if (++calls > 1) throw new DOMException("blocked", "SecurityError");
      store.set(key, value);
    });
    expect(() => api.importSavedData(JSON.stringify({ views: [view()], watchlist: [watched()] }))).toThrow("previous lists could not be fully restored");
    expect(dispatch).not.toHaveBeenCalled();
  });
});
