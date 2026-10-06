"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useT } from "@/lib/i18n/ui";
import { SectionGlyph } from "./SectionGlyph";
import type { SectionGlyphName } from "@/lib/record-sections";

/**
 * `label` is the English section name; it is translated through the chrome dictionary where a translation exists.
 * A tab with `href` is a link to another page (a section that lives on its own route, or the hub from a section
 * page); a tab without one is an in-page section. `content` is rendered as a section when present; a link tab on a
 * section page carries none.
 */
export type Tab = { id: string; label: string; content?: ReactNode; count?: number; glyph?: SectionGlyphName; href?: string };

/** Below the site header (3.5rem) plus this bar (3rem): where sticky table headers should stop. */
const CONTENT_STYLE = { "--sticky-top": "calc(var(--header-h) + 3rem)" } as CSSProperties;

/** Room kept at each end of the bar when the active tab is scrolled into view, so the neighbour peeks out. */
const EDGE = 40;

/**
 * Section navigator for long object pages. All sections are rendered one after another so the
 * page reads top to bottom (and so print gets every section, see PrintButton); a sticky, high-contrast
 * bar lists the sections, highlights the one in view (scroll-spy), and scrolls to a section on click.
 * The section id is kept in the URL hash and on the bar as `data-active` for other components.
 *
 * Hub and section pages: a cancer record is one hub plus a page per large section (src/lib/record-sections.ts).
 * The same bar appears on both. On the hub a large section's tab links to its page (`href`) and its body is a
 * summary card; on a section page the current tab is the only one with content and every other tab links back to
 * the hub anchor or to its own page (`current` names the tab that starts highlighted). `anchors` maps the hashes of
 * elements that are not on this page to their address, so `/cancers/x/#care` still lands on the standard of care
 * when Treatment has moved to `/cancers/x/treating-it/`.
 *
 * Layout: the bar spans the full content width. When `aside` is given the sections and the aside form the
 * two-column grid *below* the bar (main and right column), so the tabs never share a row with the sidebar and
 * are never cut off by it; `after` renders under the sections in the main column.
 *
 * Overflow: when the tabs are wider than the bar it scrolls sideways; the overflowing edge fades and an arrow
 * at that end scrolls a step (`data-fade` carries the state for the CSS). The active tab is scrolled into view
 * whenever it changes, including on load for a `#hash`, by moving the bar's own scroll position only, so the
 * page is not scrolled vertically as a side effect.
 *
 * Accessibility: the bar is navigation (a list of links), not a tablist, because no panel is ever hidden;
 * `aria-current` marks the section in view and Left/Right/Home/End move focus between the tabs.
 * The tabs form one compact strip (shared hairline, rounded ends, active tab filled); the count on each tab
 * is hidden while it is active, since the reader is looking at the objects themselves.
 */
export function Tabs({ tabs, ariaLabel, aside, after, current, anchors }: { tabs: Tab[]; ariaLabel?: string; aside?: ReactNode; after?: ReactNode; current?: string; anchors?: Record<string, string> }) {
  const [active, setActive] = useState(current ?? tabs[0]?.id);
  const [fade, setFade] = useState<"" | "left" | "right" | "both">("");
  const { t: tT, tl } = useT();
  const bar = useRef<HTMLDivElement>(null);
  const suppress = useRef(false);
  const inPage = tabs.filter((t) => t.content !== undefined);

  const jump = (id: string, smooth = true) => {
    const el = document.getElementById(`sec-${id}`);
    if (!el) return;
    suppress.current = true;
    setActive(id);
    window.history.replaceState(null, "", `#${id}`);
    const top = el.getBoundingClientRect().top + window.scrollY - 112;
    window.scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
    setTimeout(() => { suppress.current = false; }, 700);
  };

  // Scroll-spy over the sections on this page.
  useEffect(() => {
    const els = inPage.map((t) => document.getElementById(`sec-${t.id}`)).filter((x): x is HTMLElement => !!x);
    if (els.length < 2) return;
    const io = new IntersectionObserver((entries) => {
      if (suppress.current) return;
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActive(visible[0].target.id.replace(/^sec-/, ""));
    }, { rootMargin: "-120px 0px -60% 0px", threshold: 0 });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [tabs]); // eslint-disable-line react-hooks/exhaustive-deps

  // Open on the hashed section; forward a hash whose element lives on another page of this record.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const h = window.location.hash.replace(/^#/, "");
      if (!h) return;
      if (inPage.some((t) => t.id === h)) { jump(h, false); return; }
      const bare = h.replace(/^sec-/, "");
      if (inPage.some((t) => t.id === bare)) { jump(bare, false); return; }
      if (document.getElementById(h) || document.getElementById(bare)) {
        const el = (document.getElementById(h) ?? document.getElementById(bare))!;
        window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 112, behavior: "auto" });
        return;
      }
      const to = anchors?.[h] ?? anchors?.[bare];
      if (to) window.location.replace(to);
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Left/Right/Home/End move focus between tabs; Enter or Space on a focused tab follows the link as usual. */
  const onBarKey = (e: React.KeyboardEvent) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
    const pills = [...(bar.current?.querySelectorAll<HTMLAnchorElement>("a[data-id]") ?? [])];
    if (!pills.length) return;
    const i = pills.indexOf(document.activeElement as HTMLAnchorElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? pills.length - 1 : e.key === "ArrowRight" ? (i + 1) % pills.length : (i - 1 + pills.length) % pills.length;
    e.preventDefault();
    pills[next].focus();
  };

  /** Which edges hide tabs: drives the fade and the arrows. */
  const measure = () => {
    const nav = bar.current;
    if (!nav) return;
    const overflow = nav.scrollWidth - nav.clientWidth > 1;
    if (!overflow) { setFade(""); return; }
    const left = nav.scrollLeft > 1;
    const right = nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 1;
    setFade(left && right ? "both" : left ? "left" : right ? "right" : "");
  };
  useEffect(() => {
    const nav = bar.current;
    if (!nav) return;
    const ro = new ResizeObserver(measure);
    ro.observe(nav);
    nav.addEventListener("scroll", measure, { passive: true });
    return () => { ro.disconnect(); nav.removeEventListener("scroll", measure); };
  }, [tabs]);

  // Keep the active tab in view inside the bar, scrolling the bar alone (never the page).
  useEffect(() => {
    const nav = bar.current;
    const el = nav?.querySelector<HTMLElement>(`[data-id="${active}"]`);
    if (!nav || !el) return;
    const r = el.getBoundingClientRect(), n = nav.getBoundingClientRect();
    if (r.left < n.left + EDGE) nav.scrollLeft += r.left - n.left - EDGE;
    else if (r.right > n.right - EDGE) nav.scrollLeft += r.right - n.right + EDGE;
    measure();
  }, [active]);

  const step = (dir: 1 | -1) => bar.current?.scrollBy({ left: dir * Math.max(120, (bar.current.clientWidth || 0) * 0.6), behavior: "smooth" });

  const sections = (
    <div className="pt-6 space-y-14" style={CONTENT_STYLE}>
      {inPage.map((t) => (
        <section key={t.id} id={`sec-${t.id}`} aria-labelledby={`h-${t.id}`} data-section={t.id} data-section-placement={t.href ? "summary" : "inline"} className="scroll-mt-28 print-section">
          {t.id === "overview" && <h2 id={`h-${t.id}`} className="sr-only print:not-sr-only print:text-xl print:font-semibold print:mb-3">{tl(t.label)}</h2>}
          {t.id !== "overview" && (
            <div className="flex items-baseline gap-3 mb-4 pb-2 border-b border-border">
              <h2 id={`h-${t.id}`} className="text-xl font-semibold tracking-tight inline-flex items-center gap-2">{t.glyph && <SectionGlyph name={t.glyph} className="h-5 w-5 text-accent" />}{t.href ? <Link href={t.href} className="hover:underline">{tl(t.label)}</Link> : tl(t.label)}</h2>
              {t.count !== undefined && <span className="text-sm text-muted tabular-nums">{t.count}</span>}
              {t.href && <Link href={t.href} className="text-sm text-accent hover:underline">{tl("See all")} →</Link>}
            </div>
          )}
          {t.content}
        </section>
      ))}
    </div>
  );

  return (
    <div>
      {/* The sticky wrapper spans the full content width (bleeding into the container padding); the arrows sit on it, outside the scrolling nav. */}
      <div className="tabbar-wrap sticky top-14 z-30 -mx-4 sm:-mx-6 bg-background/90 backdrop-blur border-b border-border" data-fade={fade || undefined}>
        <nav ref={bar} aria-label={ariaLabel ?? tT("sections")} data-tabbar data-active={active} onKeyDown={onBarKey}
          className="tabbar px-4 sm:px-6 h-12 flex items-center overflow-x-auto no-scrollbar">
          {/* One strip of adjoining tabs (see .tabstrip in globals.css); when wider than the bar it scrolls sideways and the active tab is kept in view. */}
          <div className="tabstrip">
            {tabs.map((t) => {
              const on = t.id === active;
              const inner = <>{t.glyph && <SectionGlyph name={t.glyph} className="h-3.5 w-3.5 shrink-0" />}<span>{tl(t.label)}</span>{t.count !== undefined && <span className="tab-count">{t.count}</span>}</>;
              // A section with content on this page scrolls to it; a section that lives elsewhere is a plain link (and on the hub its summary card is still below).
              if (t.href && t.content === undefined) return <Link key={t.id} href={t.href} data-id={t.id} data-href aria-current={on ? "page" : undefined} className="tab" title={`${tl(t.label)}: own page`}>{inner}</Link>;
              return (
                <a key={t.id} href={`#${t.id}`} data-id={t.id} onClick={(e) => { e.preventDefault(); jump(t.id); }} aria-current={on ? "true" : undefined} className="tab" title={t.href ? `${tl(t.label)}: summary here, full section on its own page` : undefined}>
                  {inner}
                </a>
              );
            })}
          </div>
        </nav>
        {(fade === "left" || fade === "both") && <button type="button" onClick={() => step(-1)} aria-label="Earlier sections" title="Earlier sections" className="tabbar-arrow start-0"><span aria-hidden>‹</span></button>}
        {(fade === "right" || fade === "both") && <button type="button" onClick={() => step(1)} aria-label="Later sections" title="Later sections" className="tabbar-arrow end-0"><span aria-hidden>›</span></button>}
      </div>
      {aside ? (
        <div className="grid gap-10 lg:grid-cols-[1fr_300px]" data-tab-grid>
          <div className="min-w-0">{sections}{after}</div>
          {aside}
        </div>
      ) : <>{sections}{after}</>}
    </div>
  );
}
