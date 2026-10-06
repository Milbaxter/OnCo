import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";
import Link from "next/link";
import { Container, GroupKicker, PageHeader } from "@/components/ui";
import { PulseTable, readPulse } from "@/components/PapersPulse";
import { CitedPapers } from "@/components/CitedPapers";
import { literatureDates, literatureDateLabel } from "@/lib/literature-dates";

export const metadata: Metadata = pageMeta({ title: "Publishing trends", description: "Fastest-growing topics in the cancer literature, computed weekly from Europe PMC for every product, target, cancer, and technology in OnCo.", path: "/papers/" });

const KINDS: Array<{ kind: string; label: string; minPrior: number }> = [
  { kind: "technology", label: "Technologies", minPrior: 30 },
  { kind: "drug", label: "Products", minPrior: 15 },
  { kind: "target", label: "Targets", minPrior: 20 },
  { kind: "cancer", label: "Cancers", minPrior: 100 },
];

export default function PapersPage() {
  const index = readPulse();
  const n = index ? Object.keys(index.entities).length : 0;
  return (
    <>
      <PageHeader kicker={<GroupKicker id="intel" />} title="Publishing trends"
        lede="Every object in OnCo has a literature query. Once a week we ask Europe PMC how many papers matched it in each year and in the last twelve months, then rank topics by how fast they are growing. This is the pulse of research effort, not of results: a surge in papers is a surge in attention." />

      <Container className="pb-16 space-y-10">
        {!index && <p className="card p-4 text-sm text-muted">The literature snapshot is not part of this build yet; it appears after the next weekly refresh. Every object page still carries a live &ldquo;Latest papers&rdquo; feed from Europe PMC.</p>}
        {index && (
          <>
            <div className="text-sm text-muted flex flex-wrap gap-x-4 gap-y-1">
              <span>Topic data retrieved: <b className="text-foreground">{literatureDateLabel(literatureDates("papers", index.entities))}</b></span>
              <span>Snapshot run: <b className="text-foreground">{index.fetched}</b></span>
              <span>Objects tracked: <b className="text-foreground">{n.toLocaleString()}</b></span>
              <span>Source: {index.source}</span>
              <span>Refreshed weekly by <a className="underline" href="https://github.com/judegomila/OnCo/blob/main/.github/workflows/refresh-papers.yml" rel="noopener">GitHub Actions</a></span>
            </div>

            <section id="sec-rising" className="space-y-3">
              <h2 className="text-xl font-semibold">Rising fastest, all kinds</h2>
              <p className="text-sm text-muted">Papers in the last 12 months against the 12 months before, for topics with at least 20 prior papers so a small base cannot fake a surge.</p>
              <PulseTable index={index} limit={30} minPrior={20} />
            </section>

            {KINDS.map((k) => (
              <section key={k.kind} id={`sec-${k.kind}`} className="space-y-3">
                <h2 className="text-xl font-semibold">{k.label}</h2>
                <PulseTable index={index} kind={k.kind} limit={15} minPrior={k.minPrior} />
              </section>
            ))}

            <section id="sec-cited" className="space-y-3">
              <h2 className="text-xl font-semibold">Most cited key papers</h2>
              <CitedPapers limit={25} />
            </section>

            <section id="sec-volume" className="space-y-3">
              <h2 className="text-xl font-semibold">Most published, last 12 months</h2>
              <PulseTable index={index} limit={20} minPrior={0} sort="last12" />
            </section>

            <section id="sec-method" className="card p-5 text-sm space-y-2">
              <h2 className="text-lg font-semibold">Method and caveats</h2>
              <ul className="list-disc pl-5 space-y-1">
                <li>Queries search title and abstract for the object&rsquo;s name, brand, code, or curated phrases, and require a cancer word unless the object is a cancer. Query strings are shown on each object page under &ldquo;Latest papers&rdquo;.</li>
                <li>Counts use Europe PMC&rsquo;s first-publication date (<code>FIRST_PDATE</code>), so preprints and ahead-of-print articles count when they first appear. Europe PMC covers PubMed, PMC, Agricola, and major preprint servers.</li>
                <li>Growth is (last 12 months − prior 12 months) / prior 12 months. Objects with fewer prior papers than the threshold are excluded from growth rankings but appear in the volume table.</li>
                <li>Name collisions inflate some counts (a code like &ldquo;MK-2870&rdquo; is precise; a word like &ldquo;PET&rdquo; is not). Treat the ranking as a prompt to look, not as a measurement.</li>
                <li>The current year is partial, so its bar is drawn lighter.</li>
              </ul>
              <p className="text-muted">Related: <Link className="underline" href="/digests/">weekly digests</Link>, <Link className="underline" href="/universities/">who publishes where</Link>.</p>
            </section>
          </>
        )}
      </Container>
    </>
  );
}
