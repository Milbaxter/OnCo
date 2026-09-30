import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";
import { graph } from "@/lib/graph";
import { routeFor } from "@/lib/schema";
import { Container, GroupKicker, PageHeader } from "@/components/ui";
import { PrevalenceMatrix, type MatrixCancer, type MatrixTarget } from "@/components/PrevalenceMatrix";
import { pctValue } from "@/components/PrevalenceTable";

export const metadata: Metadata = pageMeta({ title: "Biomarker prevalence matrix", description: "How common each drug target or alteration is in each cancer, sourced, as a filterable heat matrix.", path: "/prevalence/" });

export default function Prevalence() {
  const g = graph();
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
  const targets: MatrixTarget[] = g.kind("target").filter((t) => t.prevalence.length).map((t) => ({
    id: t.id, name: t.name, route: routeFor(t), cls: cap(t.targetClass.replace("-", " ")),
    cells: Object.fromEntries(t.prevalence.map((r) => [r.cancerId, { pct: r.pct, value: pctValue(r.pct), measure: r.measure, source: r.source }])),
  }));
  const cancerIds = new Set(targets.flatMap((t) => Object.keys(t.cells)));
  const cancers: MatrixCancer[] = g.kind("cancer").filter((c) => cancerIds.has(c.id)).sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name)).map((c) => ({ id: c.id, name: c.name, route: routeFor(c), group: cap(c.group) }));
  const rows = targets.reduce((n, t) => n + Object.keys(t.cells).length, 0);
  return (
    <>
      <PageHeader kicker={<GroupKicker id="map" />} title="Biomarker prevalence"
        lede={`${rows} sourced estimates across ${targets.length} targets and ${cancers.length} cancers, which is ${Math.round((rows / (targets.length * cancers.length)) * 100)} per cent of the pairs that could be filled. Each figure is the share of that cancer expressing or carrying the target or alteration, by the measure shown on hover. Population-level and approximate: use it to see how common an option is, not to decide a case.`} />
      <Container className="pb-16">
        <PrevalenceMatrix targets={targets} cancers={cancers} />
      </Container>
    </>
  );
}
