import { beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import RootLayout from "./layout";
import EntityPage from "./[kind]/[id]/page";
import { RecordAside } from "@/components/EntityDetail";
import { AKA_SHOWN, AKA_SHOWN_CHARS, akaShown } from "@/components/AkaLine";
import { FOLD_LEAD_PARAGRAPHS, FOLD_OVER_CHARS, splitSummary } from "@/components/ReadMore";
import { sourceGroups, sourceHost } from "@/components/SourceList";
import { FAMILY_CHIPS, familyStrip } from "@/lib/cancer-families";
import { graph } from "@/lib/graph";
import { KIND_META } from "@/lib/kinds";
import { paragraphs } from "@/lib/text";
import type { Cancer, Entity } from "@/lib/schema";

/**
 * What a reader meets first on a record page (owner, 28 September 2026, docs/CONTENT-ROADMAP.md section 8): the
 * top of the page was full of things that are not the record. Four measures are held here.
 *
 *   the family strip    at most six subtype chips, the rest behind a fold, the parent always shown
 *   the summary         about two paragraphs before a "Read more", the rest folded but still in the markup
 *   the also-known-as   a full-width line at reading size under the lede, not 11px grey text beside the title
 *   the review panel    last in the right-hand column, after the actions, not second from the top
 *
 * Nothing is removed from the page by any of them: every folded chip, name and paragraph is still in the exported
 * HTML, which is what a crawler, a reader without JavaScript and find-in-page see. The saving is attention.
 */
const SLOW_MS = Number(process.env.SLOW_TEST_MS ?? 120_000);

// next/font needs the Next compiler; the layout only reads the class-name variables.
vi.mock("next/font/google", () => ({ Geist: () => ({ variable: "font-geist-sans" }), Geist_Mono: () => ({ variable: "font-geist-mono" }) }));

const router: AppRouterInstance = { push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), bfcacheId: "static" };
const render = (el: ReactElement) => renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, createElement(RootLayout, null, el)));
const escapeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

const pages = new Map<string, string>();
async function recordHtml(id: string): Promise<string> {
  const cached = pages.get(id);
  if (cached) return cached;
  const e = graph().must(id);
  const html = render(await EntityPage({ params: Promise.resolve({ kind: KIND_META[e.kind].route, id }) }));
  pages.set(id, html);
  return html;
}

describe("the family strip", () => {
  beforeAll(() => { graph(); }, 240_000);

  // tnbc has 14 children, sarcoma 26 (the largest family), gallbladder 8; pancreatic 17 with the deepest subtypes.
  for (const id of ["tnbc", "sarcoma", "pancreatic"]) {
    it(`${id}: six chips, the parent, and the rest in a fold`, { timeout: SLOW_MS }, async () => {
      const c = graph().must(id) as Cancer;
      const html = await recordHtml(id);
      const strip = html.slice(html.indexOf("data-family"), html.indexOf("data-family") + 20_000);
      const fold = strip.indexOf('data-fold="family"');
      expect(fold, `${id} folds`).toBeGreaterThan(0);
      const above = strip.slice(0, fold);
      for (const x of strip ? familyStrip(c).shown : []) expect(above, `${x.id} above the fold`).toContain(escapeText(x.name));
      // Six chips at most above the fold, and the chips below it are the rest of the family, not a repeat.
      const chipsAbove = (above.match(/\/cancers\/[a-z0-9-]+\/"/g) ?? []).length;
      expect(chipsAbove, `${id} chips above the fold`).toBeLessThanOrEqual(FAMILY_CHIPS + (c.parent ? 1 : 0));
      for (const x of familyStrip(c).folded) {
        expect(strip.slice(fold), `${x.id} inside the fold`).toContain(escapeText(x.name));
        expect(above, `${x.id} not above the fold`).not.toContain(escapeText(x.name));
      }
      // Nothing is dropped: every child of the family is still in the page.
      for (const x of graph().kind("cancer").filter((k) => k.parent === id)) expect(html, `${x.id} still on the page`).toContain(escapeText(x.name));
    });
  }

  it("the parent chip is never folded", { timeout: SLOW_MS }, async () => {
    const html = await recordHtml("tnbc");
    const strip = html.slice(html.indexOf("data-family"));
    const parent = graph().must((graph().must("tnbc") as Cancer).parent!);
    expect(strip.slice(0, strip.indexOf('data-fold="family"'))).toContain(escapeText(parent.name));
  });
});

describe("the summary fold", () => {
  it("splits a long summary and leaves a short one alone", () => {
    const short = "One paragraph.\n\nAnd a second.";
    expect(splitSummary(short)).toEqual({ lead: ["One paragraph.", "And a second."], rest: [] });
    const long = `${"a".repeat(600)}\n\n${"b".repeat(600)}\n\n${"c".repeat(700)}`;
    const split = splitSummary(long);
    expect(long.length).toBeGreaterThan(FOLD_OVER_CHARS);
    expect(split.lead).toHaveLength(FOLD_LEAD_PARAGRAPHS);
    expect(split.rest).toHaveLength(1);
    // A first paragraph that is already a screenful stands alone: two of those is the wall the fold removes.
    const wall = `${"a".repeat(1400)}\n\n${"b".repeat(600)}`;
    expect(splitSummary(wall).lead).toHaveLength(1);
    expect(splitSummary(wall).rest).toHaveLength(1);
  });

  it("every record's paragraphs are either in the lead or in the fold, never lost", () => {
    for (const e of graph().entities) {
      if (!e.summary) continue;
      const { lead, rest } = splitSummary(e.summary);
      expect([...lead, ...rest], e.id).toEqual(paragraphs(e.summary));
      if (e.summary.length <= FOLD_OVER_CHARS) expect(rest, `${e.id} is short and must not fold`).toHaveLength(0);
      if (rest.length) expect(lead.length, `${e.id} lead`).toBeLessThanOrEqual(FOLD_LEAD_PARAGRAPHS);
    }
  });

  for (const id of ["tnbc", "pancreatic"]) {
    it(`${id}: two paragraphs before the fold, the other ten inside it`, { timeout: SLOW_MS }, async () => {
      const e = graph().must(id);
      const { lead, rest } = splitSummary(e.summary);
      expect(rest.length, `${id} folds paragraphs`).toBeGreaterThan(5);
      const html = await recordHtml(id);
      // Term hovers wrap words inside a paragraph, so the paragraphs are counted rather than matched as strings.
      const prose = html.indexOf("prose-onco text-[15px]");
      const fold = html.indexOf('data-fold="summary"', prose);
      expect(prose, `${id} renders its summary`).toBeGreaterThan(0);
      expect(fold, `${id} renders a summary fold`).toBeGreaterThan(prose);
      expect((html.slice(prose, fold).match(/<p>/g) ?? []).length, "paragraphs above the fold").toBe(lead.length);
      const inside = html.slice(fold, html.indexOf("</details>", fold));
      expect((inside.match(/<p>/g) ?? []).length, "paragraphs still shipped inside the fold").toBe(rest.length);
      expect(html, "the fold offers the count").toContain(`${rest.length} more paragraphs`);
    });
  }
});

describe("the also-known-as line", () => {
  it("reads at body size under the lede, with every name in the markup", { timeout: SLOW_MS }, async () => {
    const e = graph().must("tnbc");
    expect(e.aka.length).toBeGreaterThan(0);
    const html = await recordHtml("tnbc");
    const main = html.slice(html.indexOf('<main id="main"'));
    const aka = main.indexOf("data-aka");
    expect(aka, "the line is on the page").toBeGreaterThan(0);
    expect(aka, "under the title").toBeGreaterThan(main.indexOf("<h1"));
    expect(aka, "above the first section").toBeLessThan(main.indexOf('id="sec-'));
    const line = main.slice(main.lastIndexOf("<", aka), main.indexOf(">", aka));
    expect(line, "not the smallest type on the page").not.toContain("text-xs");
    expect(line, "not right-aligned in a narrow column").not.toContain("text-end");
    expect(line, "not a narrow column").not.toContain("max-w-xs");
    expect(line).toContain("text-[15px]");
    for (const a of e.aka) expect(main, `${a} present`).toContain(escapeText(a));
  });

  it("shows at most six names and at most 160 characters of them", () => {
    expect(akaShown(["TNBC"])).toBe(1);
    expect(akaShown(Array(20).fill("TNBC"))).toBe(AKA_SHOWN);
    // A 139-character subtype description in `aka` does not take the line with it, and never leaves it empty.
    expect(akaShown(["a".repeat(200), "b", "c"])).toBe(1);
    expect(akaShown(["a".repeat(100), "b".repeat(100), "c"])).toBe(1);
    const six = Array(6).fill("a".repeat(20));
    expect(six.join("").length).toBeLessThanOrEqual(AKA_SHOWN_CHARS);
    expect(akaShown(six)).toBe(6);
  });

  it("folds past the cap and keeps the rest in the markup", { timeout: SLOW_MS }, async () => {
    const many = graph().entities.filter((x) => x.aka.length > AKA_SHOWN);
    expect(many.length, "records with more than six names").toBeGreaterThan(500);
    // A term page: the shape is the same on every kind and a light page keeps this suite inside its budget.
    const e = graph().must("seven-plus-three");
    expect(e.aka.length, "the sample still carries more than six names").toBeGreaterThan(AKA_SHOWN);
    const n = akaShown(e.aka);
    const html = await recordHtml(e.id);
    const aka = html.slice(html.indexOf("data-aka"));
    const fold = aka.indexOf('data-fold="aka"');
    expect(fold, `${e.id} folds its names`).toBeGreaterThan(0);
    for (const a of e.aka.slice(0, n)) expect(aka.slice(0, fold), `${a} shown`).toContain(escapeText(a));
    for (const a of e.aka.slice(n)) expect(aka.slice(fold), `${a} folded but shipped`).toContain(escapeText(a));
  });
});

describe("the review panel", () => {
  const aside = (e: Entity) => renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, createElement(RecordAside, { e })));

  // tnbc carries a model panel and pembrolizumab does not; a company page is the third shape of the column.
  for (const id of ["tnbc", "pembrolizumab", "gilead"]) {
    it(`${id}: the panel is the last card in the right-hand column`, () => {
      const html = aside(graph().must(id));
      const review = html.indexOf("data-review");
      expect(review, "the panel is in the column").toBeGreaterThan(0);
      expect(review, "after the suggest-an-edit card").toBeGreaterThan(html.indexOf("issues/new"));
      const quick = html.indexOf("data-quick-links");
      if (quick > 0) expect(review, "after the quick links").toBeGreaterThan(quick);
      // Nothing of the column's own follows it.
      expect(html.slice(review), "nothing after the panel").not.toContain("issues/new?template=suggest-edit");
    });
  }

  it("the panel's foot names the state of the page and links to the review issue for it", () => {
    const html = aside(graph().must("tnbc"));
    expect(html).toContain("Model panel");
    expect(html).toContain("No human has checked this page.");
    expect(html).toContain("template=review.yml");
    // The invitation with nowhere to go is gone.
    expect(html).not.toContain("Human reviews sit on top of the panel");
  });
});

describe("the sources move to the foot of the page", () => {
  /**
   * The fifth of the owner's complaints about the top of a record page, 28 September 2026: "a massive link
   * panel on the right side bar is not good design eg 'Sources & links' this might be better as a table at the
   * bottom of the page. it might be ok to have the primary links eg wikipedia."
   *
   * The aside now carries one line with the count and an anchor; the list itself sits at the foot, grouped by
   * the organisation that published each source, read off the URL. Nothing is dropped: this holds that every
   * link a record carries is still in the exported HTML, because the aside used to be the only place they were.
   */
  beforeAll(() => { graph(); }, 240_000);

  for (const id of ["pancreatic", "tnbc", "gallbladder"]) {
    it(`${id}: the aside links to the foot, the foot carries every source`, { timeout: SLOW_MS }, async () => {
      const e = graph().must(id);
      const html = await recordHtml(id);
      const cited = e.links.filter((l) => l.url !== e.wikipedia);
      expect(cited.length, `${id} is one of the heavy pages`).toBeGreaterThan(20);

      // The aside carries neither the list nor a pointer to it. It said "109 sources, at the foot of the page"
      // until 6 October 2026, when the owner took that line out with the provenance and the JSON link: each was
      // a pointer above the fold to something at the foot, and the pointer cost more attention than it saved.
      const aside = renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, createElement(RecordAside, { e })));
      expect(aside).not.toContain(`href="#sources"`);
      const asideLinks = cited.filter((l) => aside.includes(l.url));
      expect(asideLinks.length, `${id}: sources still in the aside`).toBe(0);

      // Wikipedia is the record's identity and stays in the column.
      if (e.wikipedia) expect(aside, `${id} keeps Wikipedia beside the record`).toContain(e.wikipedia);

      // Every source is still on the page, at the foot, after the last section of the body.
      const foot = html.indexOf('id="sources"');
      expect(foot, `${id} has a sources section`).toBeGreaterThan(0);
      const missing = cited.filter((l) => !html.includes(escapeText(l.url)) && !html.includes(l.url));
      expect(missing.map((l) => l.url), `${id}: sources dropped from the page`).toEqual([]);
      const below = html.slice(foot);
      const late = cited.filter((l) => below.includes(l.url)).length;
      expect(late / cited.length, `${id}: share of sources at the foot`).toBeGreaterThan(0.95);
    });
  }

  it("groups by publisher, most-cited first, with the DOI reference list last", () => {
    const e = graph().must("tnbc");
    const groups = sourceGroups(e.links.filter((l) => l.url !== e.wikipedia));
    expect(groups.at(-1)?.host, "DOIs are a reference list and come last").toBe("doi.org");
    const rest = groups.slice(0, -1).map((g) => g.items.length);
    expect(rest, "the other groups descend by count").toEqual([...rest].sort((a, b) => b - a));
    // Grouping is read from the address, never curated: a host that is not in the display map shows itself.
    expect(sourceHost("https://www.cancerresearchuk.org/about-cancer/x")).toBe("cancerresearchuk.org");
    expect(sourceHost("https://gco.iarc.who.int/today")).toBe("gco.iarc.who.int");
  });
});
