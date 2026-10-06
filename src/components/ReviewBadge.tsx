import Link from "next/link";
import { reviews, type Review } from "@/data/reviews";
import { graph } from "@/lib/graph";
import { dueDate } from "@/lib/review-due";
import { routeFor } from "@/lib/kinds";
import { reviewIssueUrl, reviewerCount, reviewerLevel, tracksFor, TRACK_META } from "@/lib/review-queue";
import { loadModelReviews } from "@/lib/model-reviews";
import { ModelPanel, PanelIcon } from "./ModelPanel";

const TRACK: Record<Review["track"], { label: string; cls: string }> = {
  expert: { label: "Expert-reviewed", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" },
  advocate: { label: "Patient-advocate reviewed", cls: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200" },
};

/**
 * Review state of a page, in two layers.
 *
 * Model panel (machine commentary): when public/reviews/models/<id>.json exists, one card per AI model
 * with name, version, date, confidence, summary and sourced verdicts, plus a "Models disagree" strip.
 * Human reviews: who signed the page off, on which track, when, and their declared conflicts of
 * interest, with a level chip and a link to the roster. When neither exists an "unreviewed" note is
 * shown so the absence of review is visible rather than implied, with the issue form as the way in.
 */
export function ReviewBadge({ id }: { id: string }) {
  const list = reviews[id] ?? [];
  const e = graph().get(id);
  const models = loadModelReviews(id);
  const needs = e ? tracksFor(e.kind) : [];
  const nextDue = e ? dueDate(e) : undefined;
  const due = nextDue ? nextDue.due.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : undefined;
  const issue = e && needs.length ? reviewIssueUrl(e) : undefined;

  const human = list.length ? (
    <div className="card p-3 text-xs space-y-2">
      {list.map((r, i) => {
        const n = reviewerCount(r);
        const level = reviewerLevel(n);
        const person = r.personId ? graph().get(r.personId) : undefined;
        const href = person ? routeFor(person) : r.url;
        return (
          <div key={i}>
            <span className={`chip mr-2 ${TRACK[r.track].cls}`}>{TRACK[r.track].label} {r.date}</span>
            <span className="font-medium">{href ? <a className="underline" href={href} rel={person ? undefined : "noopener"}>{r.reviewer}</a> : r.reviewer}</span>
            <span className="text-muted">, {r.role}</span>
            <Link href="/reviewers/" className="chip ml-2 bg-foreground/5 hover:bg-foreground/10" title={`${level.label}: ${n} page${n === 1 ? "" : "s"} signed off. See the roster.`}>{level.label} · {n}</Link>
            {r.note && <div className="text-muted mt-1">{r.note}</div>}
            <div className="text-muted mt-1"><span className="kicker mr-1">Conflicts of interest</span>{r.coi}</div>
          </div>
        );
      })}
      {e && <div className="text-muted"><a className="underline" href={reviewIssueUrl(e)} rel="noopener">Add a review</a> on another track or a later date.</div>}
    </div>
  ) : null;

  if (models.length) {
    return (
      <>
        <ModelPanel reviews={models} recordId={id} humanReviewUrl={issue}>
          {list.length ? <>A named reviewer signed this page off; their entry is below.</> : undefined}
        </ModelPanel>
        {human}
      </>
    );
  }

  if (human) return human;

  return (
    <div className="card p-3 text-xs text-muted">
      {/* This card is on about 19,500 pages, and it used to open "Not yet reviewed", which is the least useful
          true thing it could say about a page whose every fact carries a dated source. It now leads with what
          is true of all of them and says when the page is next due, from the same rules /freshness/ uses.
          Owner, 6 October 2026. */}
      <span className="chip bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 mr-2">Sourced, not expert-reviewed</span>
      Every fact here carries a dated source and the automated checks run on every build.{" "}
      {due ? <>Next scheduled re-check {due}. </> : null}
      No named reviewer has signed it off.{" "}
      {needs.length ? <>It is queued for {needs.map((t) => TRACK_META[t].label.toLowerCase()).join(" and ")} review. </> : null}
      {issue ? <><a className="underline" href={issue} rel="noopener">Review this page</a> or see the </> : "See the "}
      <Link className="underline" href="/review/#queue">review queue</Link> and <Link className="underline" href="/reviewers/">roster</Link>.
      <div className="mt-1.5 inline-flex items-center gap-1.5"><PanelIcon className="h-3.5 w-3.5 text-accent" /><Link className="underline" href="/review/#panel">Model panel</Link> commentary is coming to this page: machine commentary, not clinical review.</div>
    </div>
  );
}
