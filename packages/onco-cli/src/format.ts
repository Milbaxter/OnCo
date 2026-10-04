/** Plain-text renderers for the CLI: records, tables, search hits and Ask answers. Pure, so they are unit tested. */
import { answerText } from "../../../src/lib/ask";
import { INTENT_LABEL } from "../../../src/lib/ask-intent";
import { KIND_META, SITE, urlFor, type AskResult, type Entity, type EntityRecord, type SearchHit } from "./client";

/** Base fields every record has; printed in their own sections rather than under "Fields". */
const BASE_FIELDS = new Set(["id", "kind", "name", "aka", "tldr", "summary", "status", "asOf", "wikipedia", "links", "tags", "notes", "simple"]);
/** Relationship arrays hold ids; the neighbours section shows them with names instead. */
const RELATION_FIELDS = new Set(["related", "cancers", "sections", "technologies", "targets", "drugs", "companies", "institutions", "pathways", "terms", "trials", "people", "bottlenecks", "keyPapers", "journals", "dependsOn", "pipeline"]);

const humanise = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());

/** Provenance keys inside nested rows are URLs or id lists; the human view leaves them out (they stay in --json). */
const PROVENANCE_KEYS = new Set(["source", "sources", "refs", "ref", "url"]);
const entries = (o: object) => Object.entries(o as Record<string, unknown>).filter(([k, val]) => val !== undefined && val !== null && val !== "" && !PROVENANCE_KEYS.has(k));

/** One line for a value: scalars as-is, string lists joined, object lists as compact "a: b, c: d" rows (first few). */
export function formatValue(v: unknown, max = 6): string | undefined {
  if (v === undefined || v === null || v === "" || v === false) return undefined;
  if (Array.isArray(v)) {
    if (!v.length) return undefined;
    if (v.every((x) => typeof x !== "object")) return v.slice(0, max).map(String).join("; ") + (v.length > max ? ` (+${v.length - max} more)` : "");
    const rows = v.slice(0, max).map((x) => (typeof x === "object" && x !== null ? entries(x).map(([k, val]) => `${k} ${Array.isArray(val) ? val.map((y) => (typeof y === "object" ? JSON.stringify(y) : String(y))).join("/") : typeof val === "object" ? JSON.stringify(val) : String(val)}`).join(", ") : String(x)));
    return rows.map((r) => `\n    - ${r}`).join("") + (v.length > max ? `\n    (+${v.length - max} more)` : "");
  }
  if (typeof v === "object") return entries(v).map(([k, val]) => `${k} ${String(val)}`).join("; ");
  return String(v);
}

/** Complete kind-specific values, with the same labels and field selection as the human view. */
export function keyFieldValues(e: Entity): Array<[string, unknown]> {
  return Object.entries(e).filter(([k]) => !BASE_FIELDS.has(k) && !RELATION_FIELDS.has(k)).map(([k, v]) => [humanise(k), v]);
}

/** Kind-specific fields of a record, in the order the record lists them. */
export function keyFields(e: Entity): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [label, v] of keyFieldValues(e)) {
    const s = formatValue(v);
    if (s !== undefined) out.push([label, s]);
  }
  return out;
}

export function formatEntity(rec: EntityRecord): string {
  const e = rec.entity;
  const lines: string[] = [];
  lines.push(`${e.name}${e.status ? `  [${e.status}]` : ""}`);
  lines.push(`${KIND_META[e.kind].label} · ${e.id} · ${SITE}${rec.route}`);
  if (e.aka?.length) lines.push(`Also known as: ${e.aka.join(", ")}`);
  if (e.asOf) lines.push(`Last checked: ${e.asOf}`);
  lines.push("", "TL;DR", `  ${e.tldr}`);
  if (e.summary) lines.push("", "Summary", ...wrap(e.summary, 100).map((l) => `  ${l}`));
  const fields = keyFields(e);
  if (fields.length) { lines.push("", "Fields"); for (const [k, v] of fields) lines.push(`  ${k}: ${v}`); }
  if (e.tags?.length) lines.push("", `Tags: ${e.tags.join(", ")}`);
  const nb = Object.entries(rec.neighbours).filter(([, list]) => list.length);
  if (nb.length) {
    lines.push("", "Connected records");
    for (const [kind, list] of nb) {
      const shown = list.slice(0, 8).map((n) => `${n.name} (${n.id})`).join(", ");
      lines.push(`  ${humanise(KIND_META[kind as keyof typeof KIND_META]?.plural ?? kind)}: ${shown}${list.length > 8 ? ` (+${list.length - 8} more)` : ""}`);
    }
  }
  const sources = [...(e.wikipedia ? [{ label: "Wikipedia", url: e.wikipedia }] : []), ...(e.links ?? [])];
  if (sources.length) { lines.push("", "Sources"); for (const l of sources) lines.push(`  ${l.label}: ${l.url}`); }
  lines.push("", `Context (Markdown): ${SITE}/api/v1/context/${e.id}.md`);
  return lines.join("\n");
}

/** Left-aligned columns, header row, widths capped so long TL;DRs do not blow up the terminal. */
export function formatTable(rows: Array<Record<string, unknown>>, columns: string[], caps: Record<string, number> = {}): string {
  if (!rows.length) return "(no rows)";
  const cell = (r: Record<string, unknown>, c: string) => { const v = r[c]; const s = v === undefined || v === null ? "" : Array.isArray(v) ? v.join("; ") : String(v); const cap = caps[c] ?? 60; return s.length > cap ? `${s.slice(0, cap - 1)}…` : s; };
  const widths = columns.map((c) => Math.max(c.length, ...rows.map((r) => cell(r, c).length)));
  const line = (cells: string[]) => cells.map((s, i) => (i === cells.length - 1 ? s : s.padEnd(widths[i]))).join("  ").trimEnd();
  return [line(columns), line(widths.map((w) => "-".repeat(w))), ...rows.map((r) => line(columns.map((c) => cell(r, c))))].join("\n");
}

export function formatSearch(hits: SearchHit[]): string {
  if (!hits.length) return "No matches.";
  return hits.map((h, i) => {
    const why = h.matched.words && h.matched.concepts.length ? `words + concepts (${h.matched.concepts.join(", ")})` : h.matched.words ? "words" : `concepts (${h.matched.concepts.join(", ")})`;
    return `${String(i + 1).padStart(2)}. ${h.name}  [${h.kind}${h.status ? `, ${h.status}` : ""}]  ${h.id}\n    ${h.tldr}\n    ${h.url}  · matched: ${why}`;
  }).join("\n");
}

export function formatAsk(r: AskResult): string {
  const lines: string[] = [];
  const named = r.entities.map((e) => `${e.name} (${e.kind})`).join(", ");
  lines.push(`Intent: ${INTENT_LABEL[r.intent] ?? r.intent}${named ? ` · About: ${named}` : ""} · Confidence: ${r.confidence}`);
  if (r.note) lines.push(`Note: ${r.note}`);
  lines.push("", answerText(r));
  if (r.alternates.length) lines.push("", `Not what you meant? ${r.alternates.map((a) => `${a.name} (${a.id})`).join(", ")}`);
  if (r.followUps.length) lines.push("", "Follow-ups", ...r.followUps.map((f) => `  - ${f}`));
  if (r.readMore.length) lines.push("", "Read more", ...r.readMore.map((m) => `  - ${m.label}: ${m.href.startsWith("http") ? m.href : SITE + m.href}`));
  lines.push("", `Method: ${r.method}`, "OnCo is an orientation tool, not medical advice.");
  return lines.join("\n");
}

/** Compact JSON for --json output: the record plus the page URL, nothing invented. */
export function entityJson(rec: EntityRecord) {
  return { ...rec, url: urlFor(rec.entity) };
}

export function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n+/)) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      if (line && line.length + 1 + word.length > width) { out.push(line); line = word; } else line = line ? `${line} ${word}` : word;
    }
    if (line) out.push(line);
  }
  return out;
}
