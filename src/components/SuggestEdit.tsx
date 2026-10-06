import type { Kind } from "@/lib/kinds";
import type { SourceLocation } from "@/lib/source-location";
import { issueUrl, suggestEditUrl, entityRef, pageUrl } from "@/lib/issue-links";
import { WatchButton } from "./WatchButton";
import { T } from "./T";

type Props = { id: string; kind: Kind; name: string; fields?: string[]; source?: SourceLocation; recordJson?: string; /** Page path and record date for the watch button; optional. */ route?: string; asOf?: string };

/**
 * Suggest an edit via a GitHub issue form, prefilled with the object and page. There is no form
 * on the site and, deliberately, no link that edits the record directly: every correction and
 * improvement enters through the issue gate so it can be safety-checked, sourced and validated
 * before a maintainer merges it. The record's read-only location goes into the issue body so the
 * maintainer can find the line; contributors who can code say so in the issue.
 */
export function SuggestEdit({ id, kind, name, source, route, asOf }: Props) {
  const e = { id, kind, name };
  const suggest = suggestEditUrl(e, { recordUrl: source?.url });
  const entity = `${entityRef(kind, id)} · ${name}`;
  const page = pageUrl(kind, id);
  const stale = issueUrl("stale-fact", { entity, page }, { title: `stale: ${id}` });
  const readout = kind === "trial" ? issueUrl("trial-readout", { trial: entity, page }, { title: `readout: ${id}` }) : null;
  const approval = kind === "drug" ? issueUrl("regional-approval", { product: entity, page }, { title: `approval: ${id}` }) : null;
  return (
    <div className="card p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3 pb-3 border-b border-border no-print">
        <div className="kicker"><T k="suggest.follow" /></div>
        <WatchButton id={id} kind={kind} name={name} route={route} asOf={asOf} />
      </div>
      <div className="kicker mb-1"><T k="suggest.wrong" /></div>
      <p className="text-muted"><T k="suggest.body" /></p>
      {/* One way in. There were two, an edit form and a discussion thread, and the owner asked for a single
          entry point: "i only want a single entry point to improve the page". */}
      <div className="mt-2">
        <a href={suggest} rel="noopener" className="rounded-lg bg-foreground text-background px-3 py-1.5 text-xs font-medium hover:brightness-110"><T k="suggest.cta" /></a>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
        <li><a className="underline" href={stale} rel="noopener"><T k="suggest.stale" /></a></li>
        {readout && <li><a className="underline" href={readout} rel="noopener"><T k="suggest.readout" /></a></li>}
        {approval && <li><a className="underline" href={approval} rel="noopener"><T k="suggest.approval" /></a></li>}
      </ul>
    </div>
  );
}
