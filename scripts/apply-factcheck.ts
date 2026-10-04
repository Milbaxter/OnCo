/**
 * Apply accepted fact-check patches to the data files.
 *
 * Reads public/factcheck-patches.json (written by scripts/factcheck.ts), applies the patches you name,
 * bumps the record's `asOf` to today where it is written inline, and appends one CORRECTIONS.md row per
 * patch under today's heading, citing the registry URL. Nothing runs without an explicit selection.
 *
 *   npx tsx scripts/apply-factcheck.ts keynote-522.status imvigor011.phase   # by id.field
 *   npx tsx scripts/apply-factcheck.ts keynote-522                            # every patch on a record
 *   npx tsx scripts/apply-factcheck.ts --all                                  # everything proposed
 *   npx tsx scripts/apply-factcheck.ts --list                                 # show proposals, change nothing
 *   add --dry-run to print the edits without writing
 *
 * The record is found by its `id: "<id>"` line in src/data; the field is replaced within that record's
 * braces. Records whose field comes from a helper or a spread (for example a status set by a wrapper)
 * are reported as not applied so a human can edit them.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { Patch, PatchFile } from "./factcheck";
import ts from "typescript";

const root = process.cwd();

/** Every TypeScript data file, recursively. */
export function dataFiles(dir = join(root, "src", "data")): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...dataFiles(p));
    else if (f.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Named, direct properties only: nested objects, comments and string contents are not fields. */
function propertyName(property: ts.ObjectLiteralElementLike): string | undefined {
  const name = property.name;
  return name && (ts.isIdentifier(name) || ts.isStringLiteral(name)) ? name.text : undefined;
}

function parsedRecord(source: string, id: string): { file: ts.SourceFile; record: ts.ObjectLiteralExpression } | null {
  const file = ts.createSourceFile("data.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const records: ts.ObjectLiteralExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const ids = node.properties.filter((p) => propertyName(p) === "id");
      const ownId = ids[0];
      if (ids.length === 1 && ts.isPropertyAssignment(ownId) && ts.isStringLiteral(ownId.initializer)
        && ownId.initializer.text === id && node.properties.some((p) => ["name", "kind"].includes(propertyName(p) ?? ""))) records.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  // Ambiguous identities need a human; never silently edit the first of two copies.
  return records.length === 1 ? { file, record: records[0] } : null;
}

/** Find an unambiguous record by its own literal id, independent of formatting. */
export function findRecord(source: string, id: string): { start: number; end: number } | null {
  const parsed = parsedRecord(source, id);
  return parsed ? { start: parsed.record.getStart(parsed.file), end: parsed.record.end } : null;
}

export type ApplyResult = { applied: boolean; source: string; reason?: string };

/** Replace only a direct literal field and inline date, leaving all other source bytes untouched. */
export function applyPatchToSource(source: string, patch: Pick<Patch, "id" | "field" | "current" | "proposed">, today: string): ApplyResult {
  const parsed = parsedRecord(source, patch.id);
  if (!parsed) return { applied: false, source, reason: "record not found in this file or id is ambiguous" };
  const { file, record } = parsed;
  const direct = (name: string) => record.properties.filter((p) => propertyName(p) === name);
  const field = direct(patch.field);
  const property = field[0];
  if (field.length !== 1 || !ts.isPropertyAssignment(property)) {
    return { applied: false, source, reason: `field ${patch.field} is not written inline unambiguously on this record (set by a helper or spread); edit by hand` };
  }
  // A later spread or computed key can replace the selected field or even the record's identity.
  const identity = direct("id")[0];
  if (record.properties.some((p) => p.pos > Math.min(identity.pos, property.pos)
    && (ts.isSpreadAssignment(p) || (p.name && ts.isComputedPropertyName(p.name))))) {
    return { applied: false, source, reason: "a spread or computed field may override the record id or patched field; edit by hand" };
  }
  const value = property.initializer;
  const isString = ts.isStringLiteral(value);
  const isNumber = ts.isNumericLiteral(value);
  if (!isString && !isNumber) return { applied: false, source, reason: `field ${patch.field} is not written inline as a literal; edit by hand` };
  if (value.text !== patch.current) return { applied: false, source, reason: `field is "${value.text}", not "${patch.current}"; re-run the fact check` };
  if (isNumber && !/^\d+$/.test(patch.proposed)) return { applied: false, source, reason: "proposed numeric value is invalid" };
  const edits = [{ start: value.getStart(file), end: value.end, value: isString ? JSON.stringify(patch.proposed) : patch.proposed }];
  const dates = direct("asOf");
  const date = dates[0];
  if (dates.length === 1 && ts.isPropertyAssignment(date) && ts.isStringLiteral(date.initializer)
    && /^\d{4}-\d{2}-\d{2}$/.test(date.initializer.text)) {
    edits.push({ start: date.initializer.getStart(file), end: date.initializer.end, value: JSON.stringify(today) });
  }
  for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.value + source.slice(edit.end);
  return { applied: true, source };
}

/** Append a row to CORRECTIONS.md under today's heading (creating the heading if needed), keeping newest first. */
export function appendCorrection(md: string, today: string, row: string): string {
  const heading = `## ${today}`;
  const table = `| Date | Entity | What was wrong | How found | Fix |\n|---|---|---|---|---|`;
  if (md.includes(heading)) {
    const idx = md.indexOf(heading);
    const tableEnd = md.indexOf("\n\n", md.indexOf("|---|", idx));
    const insertAt = tableEnd < 0 ? md.length : tableEnd;
    return md.slice(0, insertAt) + `\n${row}` + md.slice(insertAt);
  }
  // Insert the new day before the first existing day heading.
  const firstDay = md.search(/^## \d{4}-\d{2}-\d{2}/m);
  const block = `${heading}\n\n${table}\n${row}\n\n`;
  return firstDay < 0 ? md.trimEnd() + `\n\n${block}` : md.slice(0, firstDay) + block + md.slice(firstDay);
}

function main() {
  const argv = process.argv.slice(2);
  const dry = argv.includes("--dry-run");
  const list = argv.includes("--list");
  const all = argv.includes("--all");
  const selected = argv.filter((a) => !a.startsWith("--"));
  const path = join(root, "public", "factcheck-patches.json");
  if (!existsSync(path)) { console.error("No public/factcheck-patches.json. Run npm run factcheck first."); process.exit(1); }
  const file = JSON.parse(readFileSync(path, "utf8")) as PatchFile;
  if (list || (!all && !selected.length)) {
    console.log(`${file.patches.length} proposed patches (generated ${file.generated.slice(0, 10)}):`);
    for (const p of file.patches) console.log(`  ${p.id}.${p.field}: "${p.current}" -> "${p.proposed}"  (${p.reason})`);
    if (!list) console.log("\nName patches as id or id.field, or pass --all.");
    return;
  }
  const chosen = all ? file.patches : file.patches.filter((p) => selected.includes(p.id) || selected.includes(`${p.id}.${p.field}`));
  if (!chosen.length) { console.error("No proposed patch matches the selection."); process.exit(1); }
  const today = new Date().toISOString().slice(0, 10);
  const files = dataFiles();
  const sources = new Map<string, string>(files.map((f) => [f, readFileSync(f, "utf8")]));
  let corrections = readFileSync(join(root, "CORRECTIONS.md"), "utf8");
  const applied: Patch[] = [];
  for (const p of chosen) {
    let done = false;
    for (const f of files) {
      const src = sources.get(f)!;
      if (!src.includes(p.id)) continue;
      const r = applyPatchToSource(src, p, today);
      if (r.applied) { sources.set(f, r.source); console.log(`applied ${p.id}.${p.field}: "${p.current}" -> "${p.proposed}" in ${relative(root, f)}`); done = true; break; }
      if (r.reason && !r.reason.startsWith("record not found")) console.warn(`skipped ${p.id}.${p.field}: ${r.reason} (${relative(root, f)})`);
    }
    if (!done) { console.warn(`not applied ${p.id}.${p.field}: no inline field found in src/data`); continue; }
    applied.push(p);
    const route = p.route;
    corrections = appendCorrection(corrections, today, `| ${today} | [${p.id}](${route}) | \`${p.field}\` was "${p.current}"; the registry says ${p.registryValue}. | Weekly registry fact check ([source](${p.source})) | set to "${p.proposed}" via apply-factcheck |`);
  }
  if (dry) { console.log(`dry run: ${applied.length} patches would be applied; nothing written`); return; }
  for (const [f, src] of sources) if (src !== readFileSync(f, "utf8")) writeFileSync(f, src);
  if (applied.length) writeFileSync(join(root, "CORRECTIONS.md"), corrections);
  // Drop applied patches from the proposals file so the next run starts clean.
  const remaining = file.patches.filter((p) => !applied.includes(p));
  writeFileSync(path, JSON.stringify({ ...file, patches: remaining }, null, 0));
  console.log(`${applied.length} patches applied, ${remaining.length} remain. Run npm run validate, then commit with the CORRECTIONS.md rows.`);
}

if (process.argv[1]?.endsWith("apply-factcheck.ts")) main();
