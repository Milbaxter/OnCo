import type { Metadata } from "next";
import Link from "next/link";
import { pageMeta } from "@/lib/seo";
import { feedStatuses, readPublicJson, type FeedStatus } from "@/lib/feed-meta";
import { literatureDateLabel } from "@/lib/literature-dates";
import { incidents } from "@/data/incidents";
import { Container, GroupKicker, PageHeader } from "@/components/ui";
import { runAudit } from "../../../scripts/audit";
import { StaticTable, type CellObj, type StaticColumn, type StaticRow } from "@/components/filters/StaticTable";

export const metadata: Metadata = pageMeta({ title: "Feed status: when each source last ran", description: "When each automated feed last ran, what it holds, which snapshots are stale, how many records are overdue for a re-check, and the incident log.", path: "/status/" });

const REPO = "https://github.com/judegomila/OnCo";
const WORKFLOWS: Array<{ file: string; title: string; cron: string; runs: string }> = [
  { file: "ci.yml", title: "CI", cron: "on push and pull request", runs: "validate, typecheck, lint, test, build" },
  { file: "refresh-trials.yml", title: "Trial counts and changes", cron: "Mondays 06:17 UTC", runs: "fetch-trials (with change detection)" },
  { file: "factcheck.yml", title: "Fact check, audit, provenance", cron: "Mondays 06:41 UTC", runs: "audit, provenance, factcheck" },
  { file: "refresh-papers.yml", title: "Literature snapshot", cron: "Tuesdays 05:41 UTC", runs: "fetch-papers" },
  { file: "refresh-fda.yml", title: "FDA approvals", cron: "Wednesdays 06:07 UTC", runs: "fetch-fda" },
  { file: "refresh-regional.yml", title: "EMA register check", cron: "Wednesdays 06:37 UTC", runs: "fetch-ema" },
  { file: "refresh-pulse.yml", title: "Pulse, abstracts, citations", cron: "Thursdays 05:17 UTC", runs: "fetch-pulse, fetch-abstracts, fetch-citations, fetch-openalex-papers" },
  { file: "refresh-hta.yml", title: "HTA decisions and survival", cron: "1st of the month 05:47 UTC", runs: "fetch-hta, fetch-survival" },
  { file: "propose.yml", title: "Change proposals", cron: "daily 03:23 UTC", runs: "propose-updates (opens a bot-proposal PR)" },
];

type Proposals = { generated: string; proposals: Array<{ confidence: string }> };

function Stat({ label, value, tone, sub }: { label: string; value: string | number; tone?: "rose" | "amber" | "emerald"; sub?: string }) {
  const border = tone === "rose" ? "border-rose-200 dark:border-rose-900" : tone === "amber" ? "border-amber-200 dark:border-amber-900" : tone === "emerald" ? "border-emerald-200 dark:border-emerald-900" : "";
  return <div className={`card p-3 ${border}`}><div className="text-2xl font-semibold tabular-nums leading-tight">{value}</div><div className="text-xs text-muted mt-0.5">{label}</div>{sub && <div className="text-[11px] text-muted">{sub}</div>}</div>;
}

function CiBadge() {
  return (
    <a href={`${REPO}/actions/workflows/ci.yml`} rel="noopener" className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
      {/* eslint-disable-next-line @next/next/no-img-element -- live GitHub Actions badge, not an asset */}
      <img src={`${REPO}/actions/workflows/ci.yml/badge.svg`} alt="CI status" width={90} height={20} loading="lazy" decoding="async" />
      <span>CI</span>
    </a>
  );
}

function state(s: FeedStatus): CellObj {
  if (!s.present) return { text: "not run", chip: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" };
  if (s.stale) return { text: "stale", chip: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200" };
  if ((s.ageDays ?? 0) > s.cadenceDays) return { text: "due", chip: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" };
  return { text: "fresh", chip: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" };
}

const FEED_COLUMNS: StaticColumn[] = [
  { key: "feed", label: "Feed" },
  { key: "state", label: "State", filterable: true, order: ["fresh", "due", "stale", "not run"] },
  { key: "fetched", label: "Fetched", sortable: true, numeric: false },
  { key: "age", label: "Age", sortable: true, numeric: true, className: "text-right text-muted" },
  { key: "count", label: "Count", sortable: true, numeric: true, className: "text-right" },
  { key: "snapshot", label: "Snapshot", hide: "hidden md:table-cell", className: "text-xs" },
  { key: "schedule", label: "Source and schedule", hide: "hidden lg:table-cell", className: "text-xs text-muted" },
  { key: "how", label: "Runs", filterable: true, hide: "hidden xl:table-cell", className: "text-xs text-muted" },
];

export default function StatusPage() {
  const now = new Date();
  const built = now.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const feeds = feedStatuses(now);
  const audit = runAudit(now);
  const over60 = audit.staleness.filter((s) => s.days > 60).length;
  const over180 = audit.staleness.filter((s) => s.days > 180).length;
  const proposals = readPublicJson<Proposals>("proposals/latest.json");
  const present = feeds.filter((f) => f.present);
  const stale = feeds.filter((f) => f.present && f.stale);
  const missing = feeds.filter((f) => !f.present);
  const open = incidents.filter((i) => i.status === "open");
  const feedRows: StaticRow[] = feeds.map((f) => ({
    id: f.id,
    feed: { text: f.label, strong: true, sub: f.script },
    state: state(f),
    fetched: f.retrieval ? { text: literatureDateLabel(f.retrieval), v: f.fetched ?? "", sub: f.snapshotRun ? `Snapshot run: ${f.snapshotRun}` : undefined, mono: true, className: "text-xs" }
      : f.fetched ? { text: f.fetched, mono: true, className: "text-xs" } : undefined,
    age: f.ageDays !== undefined ? { text: `${f.ageDays} d`, v: f.ageDays } : undefined,
    count: f.count !== undefined ? { text: f.count.toLocaleString("en-GB"), v: f.count, sub: f.note } : f.note ? { text: "", v: -1, sub: f.note } : undefined,
    snapshot: f.present ? { text: f.path, href: `/${f.path}`, ext: true } : { text: f.path, muted: true },
    schedule: `${f.source}. Every ${f.cadenceDays} days${f.workflow ? ", automatically" : ", by hand"}.`,
    how: f.workflow ? { text: "automatically", href: `${REPO}/actions/workflows/${f.workflow}`, ext: true } : "by hand",
  }));

  return (
    <>
      <PageHeader kicker={<GroupKicker id="intel" />} title="Feed status: when each source last ran"
        lede={`Built ${built}. ${present.length === feeds.length ? `All ${feeds.length} automated feeds have a snapshot` : `${present.length} of ${feeds.length} automated feeds have a snapshot`}${stale.length ? `; ${stale.length} ${stale.length === 1 ? "is" : "are"} stale` : ", none is stale"}${missing.length ? ` and ${missing.length} ${missing.length === 1 ? "has" : "have"} never run` : ""}. ${over60 ? `${over60} of ${audit.total.toLocaleString("en-GB")} records have not been checked in 60 days` : `Every one of the ${audit.total.toLocaleString("en-GB")} records has been checked within the last 60 days`}. Each feed is a script that runs on a schedule, saves what it fetched and opens a pull request; the site reads those snapshots when it is built, so nothing here is live.`}
        right={<CiBadge />} />
      <Container className="pb-16 space-y-10">
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Feeds with a snapshot" value={`${present.length}/${feeds.length}`} tone={missing.length ? "amber" : "emerald"} />
          <Stat label="Stale snapshots" value={stale.length} tone={stale.length ? "rose" : "emerald"} sub="older than twice their cadence" />
          <Stat label="Records over 60 days" value={over60} tone={over60 ? "amber" : undefined} sub={`of ${audit.total}`} />
          <Stat label="Records over 180 days" value={over180} tone={over180 ? "rose" : undefined} />
          <Stat label="Open proposals" value={proposals?.proposals.length ?? 0} sub={proposals ? `drafted ${proposals.generated}` : "none drafted yet"} />
          <Stat label="Open incidents" value={open.length} tone={open.length ? "amber" : "emerald"} />
        </div>

        <section>
          <h2 className="text-xl font-semibold mb-3">Feeds</h2>
          <StaticTable rows={feedRows} columns={FEED_COLUMNS} noun="feeds" url />
          <p className="text-xs text-muted mt-2">A feed is <em>due</em> once it is older than its cadence and <em>stale</em> at twice the cadence. Counts are the headline number each snapshot carries; details on the pages that use the feed: <Link className="underline" href="/regulatory/">regulatory</Link>, <Link className="underline" href="/calendar/">calendar</Link>, <Link className="underline" href="/digests/">digests</Link>, <Link className="underline" href="/pulse/">pulse</Link>, <Link className="underline" href="/papers/">papers</Link>, <Link className="underline" href="/hta/">HTA</Link>, <Link className="underline" href="/survival/">survival</Link>, <Link className="underline" href="/audit/">audit</Link>.</p>
        </section>

        <section className="grid lg:grid-cols-2 gap-6">
          <div>
            <h2 className="text-xl font-semibold mb-3">Schedules</h2>
            <div className="card overflow-x-auto">
              <table className="onco">
                <thead><tr><th>Workflow</th><th>When</th><th className="hidden sm:table-cell">Runs</th></tr></thead>
                <tbody>{WORKFLOWS.map((w) => <tr key={w.file}><td><a className="font-medium hover:underline" href={`${REPO}/actions/workflows/${w.file}`} rel="noopener">{w.title}</a><div className="text-xs text-muted"><code>{w.file}</code></div></td><td className="text-muted whitespace-nowrap">{w.cron}</td><td className="hidden sm:table-cell text-muted">{w.runs}</td></tr>)}</tbody>
              </table>
            </div>
            <p className="text-xs text-muted mt-2">Scheduled workflows open a pull request with the changed snapshots; a maintainer merges after review. The proposal bot never merges.</p>
          </div>
          <div>
            <h2 className="text-xl font-semibold mb-3">Incident log</h2>
            <ol className="space-y-3">
              {incidents.map((i) => (
                <li key={`${i.date}-${i.feed}`} className="card p-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2 text-xs mb-1">
                    <span className="font-mono text-muted">{i.date}</span>
                    <span className={`chip ${i.status === "open" ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"}`}>{i.status === "open" ? "open" : `resolved ${i.resolved ?? ""}`}</span>
                    <span className="chip bg-foreground/5 text-muted">{i.feed}</span>
                  </div>
                  <div className="font-medium">{i.title}</div>
                  <p className="text-muted mt-1">{i.detail}</p>
                  {i.ref && <a className="text-xs underline text-muted mt-1 inline-block" href={i.ref.url} rel="noopener">{i.ref.label}</a>}
                </li>
              ))}
            </ol>
            <p className="text-xs text-muted mt-2">Every incident carries a date and a pointer you can check. Spotted a feed that is wrong or behind? <Link className="underline" href="/suggest/">Tell us</Link>.</p>
          </div>
        </section>

        <section className="card p-5 text-sm text-muted max-w-3xl">
          <div className="kicker mb-1">Stale records</div>
          <p>{over60 ? `${over60} records were last checked more than 60 days ago and ${over180} more than 180 days ago` : "No record was last checked more than 60 days ago"} (every record carries the date it was last checked). {over60 ? "The oldest are listed on the " : "When any fall behind they are listed on the "}<Link className="underline" href="/audit/">audit page</Link>; oncology moves weekly, so anything over 60 days is due. Raw data: <a className="underline" href="/audit.json">audit.json</a>.</p>
        </section>
      </Container>
    </>
  );
}
