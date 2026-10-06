/**
 * Automated fact checks against public registries. Network. Polite (sequential, backoff), cached.
 *
 *  (a) Products with a US approval → openFDA drug label search by generic name. A product recorded
 *      as US-approved but with no openFDA label is flagged (possible error, or label not yet indexed).
 *      A product with a label but recorded status not approved is flagged the other way.
 *  (b) Products with a US approval → Drugs@FDA (openFDA drugsfda): the earliest original approval
 *      (ORIG submission, status AP) gives the first US approval year. A recorded US year earlier than
 *      that is impossible (high); a recorded first year later than it means an earlier approval is
 *      missing from approvals[] (low).
 *  (c) Trials with an NCT id → ClinicalTrials.gov v2: overallStatus, phases, primary completion date,
 *      actual enrolment and the study titles. Recorded "recruiting" vs registry completed/terminated,
 *      recorded positive/negative vs registry withdrawn, recorded phase vs registry phase, a primary
 *      completion date that has passed while we still say recruiting, an `enrolled` figure that differs
 *      from the registry's actual count, and a trial whose name appears nowhere in the registry's
 *      acronym or titles (the NCT id probably points at the wrong study).
 *
 * Responses are cached under /tmp/onco-factcheck-cache (override with FACTCHECK_CACHE; pass
 * --no-cache to refetch) so a re-run after edits costs no requests. openFDA allows 1,000 requests a day
 * per IP without a key; one label lookup per product plus one Drugs@FDA lookup per US-approved product
 * stays under that.
 *
 * Writes public/factcheck.json (mismatches, for /audit/) and public/factcheck-patches.json: concrete
 * patch proposals {id, field, current, proposed, source} where the registry value maps unambiguously
 * onto ours and the study identity is not flagged for review. Nothing is applied automatically;
 * a maintainer accepts patches with
 * `npx tsx scripts/apply-factcheck.ts <id>[.<field>] ...` (or --all), which edits the data file and
 * appends a CORRECTIONS.md line.
 *
 * Run: npm run factcheck [--trials-only | --drugs-only] [--only <id>] [--no-cache].
 * Weekly via .github/workflows/factcheck.yml.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { graph } from "../src/lib/graph";
import { routeFor, type Trial } from "../src/lib/schema";

type Mismatch = { check: string; id: string; name: string; route: string; recorded: string; registry: string; url: string; severity: "high" | "medium" | "low" };
type Report = { generated: string; checked: { drugs: number; trials: number }; mismatches: Mismatch[]; errors: string[] };
export type Patch = { id: string; kind: "trial" | "drug"; name: string; route: string; field: "status" | "phase" | "enrolled"; current: string; proposed: string; reason: string; source: string; registryValue: string; proposedOn: string };
export type PatchFile = { generated: string; patches: Patch[] };

const CACHE_DIR = process.env.FACTCHECK_CACHE ?? "/tmp/onco-factcheck-cache";
const useCache = !process.argv.includes("--no-cache");
/** Set by getJson: true when the last answer came from the on-disk cache, so the politeness delay can be skipped. */
let lastFromCache = false;
const sleep = (ms: number) => (lastFromCache ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));

function cachePath(url: string): string {
  return join(CACHE_DIR, `${createHash("sha1").update(url).digest("hex")}.json`);
}

/** GET JSON with retry and backoff; 404 is a result, not an error. Successful and 404 responses are cached on disk. */
async function getJson(url: string, attempt = 1): Promise<unknown | null | "404"> {
  const cp = cachePath(url);
  if (useCache && existsSync(cp)) {
    const c = JSON.parse(readFileSync(cp, "utf8")) as { notFound?: boolean; body?: unknown };
    lastFromCache = true;
    return c.notFound ? "404" : (c.body ?? null);
  }
  lastFromCache = false;
  try {
    const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "OnCo/1.0 (github.com/judegomila/OnCo)" } });
    if (r.status === 404) { mkdirSync(CACHE_DIR, { recursive: true }); writeFileSync(cp, JSON.stringify({ notFound: true })); return "404"; }
    if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
    if (!r.ok) return null;
    const body: unknown = await r.json();
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(cp, JSON.stringify({ body }));
    return body;
  } catch (e) {
    if (attempt >= 4) { console.warn(`  giving up ${url}: ${String(e)}`); return null; }
    await sleep(1500 * 2 ** attempt);
    return getJson(url, attempt + 1);
  }
}

/** The single generic name to search openFDA for: parentheticals, isotopes and combination partners stripped. */
export function genericName(name: string, code?: string): string {
  const cleaned = name.replace(/\(.*?\)/g, "").replace(/\/.*$/, "").replace(/ (\+|&|and|plus) .*$/, "").replace(/\bF-18\b|\bLu-177\b|\bLutetium-177\b|\bActinium-225\b/gi, "").trim();
  return cleaned.split(" ").length <= 3 ? cleaned : (code?.split(",")[0].trim() || cleaned);
}

const CT_TO_OURS: Record<string, string[]> = {
  RECRUITING: ["recruiting", "active"],
  NOT_YET_RECRUITING: ["planned", "recruiting"],
  ENROLLING_BY_INVITATION: ["recruiting", "active"],
  ACTIVE_NOT_RECRUITING: ["active", "positive", "negative", "mixed", "completed", "recruiting"],
  COMPLETED: ["completed", "positive", "negative", "mixed", "historic", "active"],
  TERMINATED: ["negative", "withdrawn", "mixed", "completed"],
  WITHDRAWN: ["withdrawn", "negative"],
  SUSPENDED: ["mixed", "negative"],
  UNKNOWN: [],
};

/**
 * Where the registry status maps onto exactly one of ours given what we currently say, propose it.
 * Result statuses (positive, negative, mixed) are editorial judgements the registry cannot make, so a
 * COMPLETED registry entry only ever proposes "completed" for a trial we still call recruiting or active.
 */
export function proposeStatus(current: string | undefined, registry: string): string | null {
  if (!current) return null;
  if (registry === "WITHDRAWN" && current !== "withdrawn" && current !== "negative") return "withdrawn";
  if (registry === "COMPLETED" && (current === "recruiting" || current === "planned")) return "completed";
  if (registry === "ACTIVE_NOT_RECRUITING" && (current === "recruiting" || current === "planned")) return "active";
  if ((registry === "RECRUITING" || registry === "ENROLLING_BY_INVITATION") && current === "planned") return "recruiting";
  if (registry === "NOT_YET_RECRUITING" && current === "recruiting") return "planned";
  return null;
}

/** CT.gov `phases` array -> our phase enum, or null when it does not map (NA, early phase 1). */
export function phaseFromRegistry(phases: string[] | undefined): Trial["phase"] | null {
  if (!phases || !phases.length) return null;
  const set = new Set(phases);
  if (set.has("NA") || set.has("EARLY_PHASE1")) return null;
  const has = (p: string) => set.has(`PHASE${p}`);
  if (has("1") && has("2")) return "1/2";
  if (has("2") && has("3")) return "2/3";
  if (has("1")) return "1";
  if (has("2")) return "2";
  if (has("3")) return "3";
  if (has("4")) return "4";
  return null;
}

const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Require a complete trial name or alias in a registry title, acronym or protocol id. Punctuation
 * and spacing may differ ("KEYNOTE-522" matches "KEYNOTE 522"), but a family name, shared drug or
 * other isolated word cannot identify a study. Match within each field and keep word boundaries:
 * "KEYNOTE-522" must not match "KEYNOTE-5220". An unresolved identity stays for human review.
 */
export function nameMatchesRegistry(name: string, titles: string[], aliases: string[] = []): boolean {
  return [name, ...aliases].some((candidate) => {
    const base = candidate.replace(/\(.*?\)/g, " ");
    if (compact(base).length < 4) return false;
    const parts = base.toLowerCase().match(/[a-z]+|\d+/g) ?? [];
    const pattern = new RegExp(`(?:^|[^a-z0-9])${parts.join("[^a-z0-9]*")}(?:$|[^a-z0-9])`, "i");
    return titles.some((title) => pattern.test(title));
  });
}

type DrugsFdaApp = { application_number?: string; sponsor_name?: string; openfda?: { generic_name?: string[]; brand_name?: string[] }; submissions?: Array<{ submission_type?: string; submission_status?: string; submission_status_date?: string }> };

/** Earliest ORIG approval year across every Drugs@FDA application in a result set, or null. */
export function firstApprovalYear(results: DrugsFdaApp[]): number | null {
  let best: number | null = null;
  for (const app of results) for (const s of app.submissions ?? []) {
    if (s.submission_type !== "ORIG" || s.submission_status !== "AP" || !s.submission_status_date) continue;
    const y = Number(s.submission_status_date.slice(0, 4));
    if (Number.isFinite(y) && (best === null || y < best)) best = y;
  }
  return best;
}

/** Is an openFDA generic name ours, or ours with a four-letter biologic suffix? */
const isOurName = (n: string, ql: string) => { const l = n.toLowerCase(); return l === ql || l.startsWith(`${ql}-`) || l.replace(/-[a-z]{4}$/, "") === ql; };

export type TrialProtocol = { identificationModule?: { briefTitle?: string; officialTitle?: string; acronym?: string; orgStudyIdInfo?: { id?: string }; secondaryIdInfos?: Array<{ id?: string }> }; statusModule?: { overallStatus?: string; whyStopped?: string; primaryCompletionDateStruct?: { date?: string; type?: string }; completionDateStruct?: { date?: string; type?: string } }; designModule?: { phases?: string[]; enrollmentInfo?: { count?: number; type?: string } } };

/** Check a single registry response; network and corpus lookup stay in the caller. */
export function checkRegistryTrial(t: Trial, ps: TrialProtocol | undefined, today: string): { mismatches: Mismatch[]; patches: Patch[] } {
  const registryUrl = `https://clinicaltrials.gov/study/${t.nct}`;
  const mismatches: Mismatch[] = [];
  const patches: Patch[] = [];

  const im = ps?.identificationModule ?? {};
  // Acronym, titles and the sponsor's own protocol ids (COG "ACNS0331", "RTOG 0129", "ISG-STS 1001"), which the titles often omit.
  const titles = [im.acronym ?? "", im.briefTitle ?? "", im.officialTitle ?? "", im.orgStudyIdInfo?.id ?? "", ...(im.secondaryIdInfos ?? []).map((s) => s.id ?? "")];
  const hasIdentity = titles.some((title) => compact(title).length > 0);
  if (!hasIdentity || !nameMatchesRegistry(t.name, titles, t.aka)) {
    mismatches.push({ check: "nct-title-mismatch", id: t.id, name: t.name, route: routeFor(t), recorded: `${t.nct}: "${t.name}"`, registry: hasIdentity ? `${im.acronym ? `${im.acronym}: ` : ""}${(im.briefTitle ?? im.officialTitle ?? "").slice(0, 120)}` : "registry returned no study title or identifier", url: registryUrl, severity: "medium" });
    // The registry may describe another study. Keep the identity warning for a person to resolve,
    // but do not offer its phase, enrolment or status as corrections to this record (including --all).
    // Missing acronyms can also cause this warning; withholding a patch is not a claim the id is wrong.
    return { mismatches, patches };
  }

  const status = ps?.statusModule?.overallStatus ?? "UNKNOWN";
  const ok = [...(CT_TO_OURS[status] ?? [])];
  // A trial the registry calls TERMINATED because an interim analysis met its endpoint is a positive trial stopped early.
  if (status === "TERMINATED" && /efficacy|benefit|superior|met its|primary endpoint|early for|positive/i.test(ps?.statusModule?.whyStopped ?? "")) ok.push("positive");
  if (t.status && ok.length && !ok.includes(t.status)) {
    mismatches.push({ check: "trial-status-vs-registry", id: t.id, name: t.name, route: routeFor(t), recorded: t.status, registry: status, url: registryUrl, severity: status === "WITHDRAWN" || status === "TERMINATED" ? "high" : "medium" });
  }
  const proposed = proposeStatus(t.status, status);
  if (proposed && proposed !== t.status) patches.push({ id: t.id, kind: "trial", name: t.name, route: routeFor(t), field: "status", current: t.status!, proposed, reason: `ClinicalTrials.gov overall status is ${status}${ps?.statusModule?.whyStopped ? ` (${ps.statusModule.whyStopped.slice(0, 100)})` : ""}`, source: registryUrl, registryValue: status, proposedOn: today });

  const regPhase = phaseFromRegistry(ps?.designModule?.phases);
  if (regPhase && regPhase !== t.phase && t.phase !== "platform" && t.phase !== "observational") {
    mismatches.push({ check: "trial-phase-vs-registry", id: t.id, name: t.name, route: routeFor(t), recorded: `phase ${t.phase}`, registry: (ps?.designModule?.phases ?? []).join("/"), url: registryUrl, severity: "medium" });
    patches.push({ id: t.id, kind: "trial", name: t.name, route: routeFor(t), field: "phase", current: t.phase, proposed: regPhase, reason: `ClinicalTrials.gov lists phases ${(ps?.designModule?.phases ?? []).join(", ")}`, source: registryUrl, registryValue: (ps?.designModule?.phases ?? []).join("/"), proposedOn: today });
  }

  const pc = ps?.statusModule?.primaryCompletionDateStruct;
  if (pc?.date && pc.type === "ACTUAL" && pc.date < today && (t.status === "recruiting" || t.status === "planned")) {
    mismatches.push({ check: "primary-completion-passed", id: t.id, name: t.name, route: routeFor(t), recorded: t.status, registry: `primary completion ${pc.date} (actual)`, url: registryUrl, severity: "medium" });
    if (!patches.some((p) => p.id === t.id && p.field === "status")) patches.push({ id: t.id, kind: "trial", name: t.name, route: routeFor(t), field: "status", current: t.status!, proposed: status === "COMPLETED" ? "completed" : "active", reason: `Primary completion date ${pc.date} has passed (actual) and the registry status is ${status}`, source: registryUrl, registryValue: `${status}; primary completion ${pc.date}`, proposedOn: today });
  }

  // Enrolment: the registry's actual count is the primary source for `enrolled`. An estimate is only worth a note when far off.
  const en = ps?.designModule?.enrollmentInfo;
  if (en?.count && t.enrolled !== undefined && en.count !== t.enrolled) {
    const rel = Math.abs(en.count - t.enrolled) / Math.max(en.count, t.enrolled);
    if (en.type === "ACTUAL") {
      mismatches.push({ check: "enrolled-vs-registry", id: t.id, name: t.name, route: routeFor(t), recorded: `enrolled ${t.enrolled}`, registry: `enrolment ${en.count} (actual)`, url: registryUrl, severity: rel > 0.1 ? "medium" : "low" });
      patches.push({ id: t.id, kind: "trial", name: t.name, route: routeFor(t), field: "enrolled", current: String(t.enrolled), proposed: String(en.count), reason: `ClinicalTrials.gov actual enrolment is ${en.count}`, source: registryUrl, registryValue: `${en.count} (ACTUAL)`, proposedOn: today });
    } else if (rel > 0.25) {
      mismatches.push({ check: "enrolled-vs-registry", id: t.id, name: t.name, route: routeFor(t), recorded: `enrolled ${t.enrolled}`, registry: `enrolment ${en.count} (estimated)`, url: registryUrl, severity: "low" });
    }
  }
  return { mismatches, patches };
}

async function main() {
  const g = graph();
  const report: Report = { generated: new Date().toISOString(), checked: { drugs: 0, trials: 0 }, mismatches: [], errors: [] };
  const patches: Patch[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : undefined;
  const skipDrugs = process.argv.includes("--trials-only");
  const skipTrials = process.argv.includes("--drugs-only");

  // (a) openFDA labels and (b) Drugs@FDA original approval.
  const drugs = skipDrugs ? [] : g.kind("drug").filter((d) => !/test|assay|imaging agent|device|regimen|classifier/i.test(d.modality)).filter((d) => !only || d.id === only);
  for (const d of drugs) {
    const usRows = d.approvals.filter((a) => /^US/i.test(a.region));
    const usApproved = usRows.length > 0;
    const q = genericName(d.name, d.code);
    const url = `https://api.fda.gov/drug/label.json?search=openfda.generic_name:"${encodeURIComponent(q)}"&limit=1`;
    const res = await getJson(url);
    report.checked.drugs++;
    await sleep(300);
    if (res === null) { report.errors.push(`openFDA error for ${d.id}`); continue; }
    type LabelResult = { openfda?: { generic_name?: string[]; brand_name?: string[] } };
    const results = res !== "404" && Array.isArray((res as { results?: LabelResult[] }).results) ? (res as { results: LabelResult[] }).results : [];
    // openFDA's search is fuzzy (e.g. "DOTATATE" matches Lutathera) and biologic names carry
    // four-letter suffixes ("trastuzumab-anns", "tarlatamab-dlle"). "strong" = the name itself or
    // name + suffix; "weak" = the name appears as a whole word (combination products).
    const ql = q.toLowerCase();
    const names = results.flatMap((r) => r.openfda?.generic_name ?? []).map((n) => n.toLowerCase());
    const strong = names.some((n) => isOurName(n, ql));
    const weak = strong || names.some((n) => new RegExp(`(^|[^a-z])${ql.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(n));
    const hasLabel = strong;
    const publicUrl = `https://open.fda.gov/apis/drug/label/`;
    if (usApproved && !weak) report.mismatches.push({ check: "us-approval-no-openfda-label", id: d.id, name: d.name, route: routeFor(d), recorded: `US approval ${Math.min(...usRows.map((a) => a.year))}`, registry: `no openFDA label for "${q}"`, url: publicUrl, severity: "low" });
    if (!usApproved && hasLabel && !["approved", "standard-of-care", "withdrawn"].includes(d.status ?? "")) report.mismatches.push({ check: "openfda-label-but-not-approved", id: d.id, name: d.name, route: routeFor(d), recorded: `status ${d.status ?? "unset"}, no US approval recorded`, registry: `openFDA has a label for "${q}"`, url: publicUrl, severity: "medium" });

    if (usApproved) {
      const durl = `https://api.fda.gov/drug/drugsfda.json?search=openfda.generic_name:"${encodeURIComponent(q)}"&limit=100`;
      const dres = await getJson(durl);
      await sleep(300);
      if (dres === null) { report.errors.push(`Drugs@FDA error for ${d.id}`); continue; }
      const apps = dres !== "404" && Array.isArray((dres as { results?: DrugsFdaApp[] }).results) ? (dres as { results: DrugsFdaApp[] }).results : [];
      // Only applications whose generic name is exactly ours (or ours plus a biologic suffix), so a
      // combination product's partner or a fuzzy match does not supply the year.
      const mine = apps.filter((a) => (a.openfda?.generic_name ?? []).some((n) => isOurName(n, ql)));
      // The openfda name block is attached mostly to generics, so the earliest date across everything
      // only bounds the first approval from above: an approval recorded later than any matched
      // application is missing an earlier row.
      const fdaYear = firstApprovalYear(mine);
      const ours = Math.min(...usRows.map((a) => a.year));
      const durlPublic = `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=BasicSearch.process&searchTerm=${encodeURIComponent(q)}`;
      // The reverse claim (we say earlier than any NDA/BLA in the feed) was tried and produced no true positives:
      // discontinued, withdrawn and re-formulated originals (Iressa 2003, Mylotarg 2000, Lynparza capsules 2014) are
      // absent from the feed, so it stays out.
      if (fdaYear !== null && ours > fdaYear) report.mismatches.push({ check: "us-first-approval-missing", id: d.id, name: d.name, route: routeFor(d), recorded: `first US approval ${ours} (${usRows.filter((a) => a.year === ours).map((a) => a.indication).join("; ").slice(0, 80)})`, registry: `Drugs@FDA earliest original approval ${fdaYear}`, url: durlPublic, severity: "low" });
    }
  }

  // (c) ClinicalTrials.gov: status, phase, primary completion, enrolment, titles.
  const trials = skipTrials ? [] : g.kind("trial").filter((t) => t.nct && /^NCT\d{8}$/.test(t.nct)).filter((t) => !only || t.id === only);
  for (const t of trials) {
    const fields = ["protocolSection.identificationModule.briefTitle", "protocolSection.identificationModule.officialTitle", "protocolSection.identificationModule.acronym", "protocolSection.identificationModule.orgStudyIdInfo", "protocolSection.identificationModule.secondaryIdInfos", "protocolSection.statusModule.overallStatus", "protocolSection.statusModule.whyStopped", "protocolSection.statusModule.primaryCompletionDateStruct", "protocolSection.statusModule.completionDateStruct", "protocolSection.designModule.phases", "protocolSection.designModule.enrollmentInfo"].join(",");
    const url = `https://clinicaltrials.gov/api/v2/studies/${t.nct}?fields=${fields}`;
    const res = await getJson(url);
    report.checked.trials++;
    await sleep(250);
    const registryUrl = `https://clinicaltrials.gov/study/${t.nct}`;
    if (res === null) { report.errors.push(`CT.gov error for ${t.id}`); continue; }
    if (res === "404") { report.mismatches.push({ check: "nct-not-found", id: t.id, name: t.name, route: routeFor(t), recorded: t.nct!, registry: "not found", url: registryUrl, severity: "high" }); continue; }
    const checked = checkRegistryTrial(t, (res as { protocolSection?: TrialProtocol }).protocolSection, today);
    report.mismatches.push(...checked.mismatches);
    patches.push(...checked.patches);
  }

  const out = join(process.cwd(), "public");
  mkdirSync(out, { recursive: true });
  const sevOrder = { high: 0, medium: 1, low: 2 };
  report.mismatches.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity] || a.check.localeCompare(b.check) || a.name.localeCompare(b.name));
  writeFileSync(join(out, "factcheck.json"), JSON.stringify(report, null, 0));
  const patchFile: PatchFile = { generated: report.generated, patches };
  writeFileSync(join(out, "factcheck-patches.json"), JSON.stringify(patchFile, null, 0));
  console.log(`factcheck: ${report.checked.drugs} drugs, ${report.checked.trials} trials; ${report.mismatches.length} mismatches; ${patches.length} patch proposals; ${report.errors.length} errors`);
  for (const m of report.mismatches) console.log(`  [${m.severity}] ${m.check}: ${m.name} (${m.id}); recorded ${m.recorded}; registry ${m.registry}`);
  for (const e of report.errors) console.log(`  error: ${e}`);
  if (patches.length) console.log(`  apply accepted patches with: npx tsx scripts/apply-factcheck.ts ${patches.slice(0, 3).map((p) => `${p.id}.${p.field}`).join(" ")} ...`);
}

if (process.argv[1]?.endsWith("factcheck.ts")) main().catch((e) => { console.error(e); process.exit(1); });
