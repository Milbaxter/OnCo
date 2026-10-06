import type { Company, Drug } from "./schema";
import { graph } from "./graph";
import { regionalApprovals, approvedRegions } from "@/data/regional-approvals";
import trialsIndex from "../../public/trials/index.json";
import { registryDateLabel, registryDateRange } from "./registry-dates";

/**
 * OnCo company score. Deliberately simple and fully disclosed, in the spirit of the institution ranking:
 *
 *   approvedPoints  = 6 x approved products (status approved or standard of care)
 *   phase3Points    = 3 x products in phase 3
 *   earlyPoints     = 1 x products in phase 1 or 2
 *   targetPoints    = 2 x distinct targets across the company's products (capped at 20 targets)
 *   modalityPoints  = 2 x distinct modality classes across its products
 *   regionPoints    = 1 x distinct regions where at least one product is approved
 *   momentumPoints  = 2 x dated regulatory events in the last 24 months, capped at 20 points
 *   trialPoints     = round(2 x sqrt(phase 2/3 studies registered on ClinicalTrials.gov for its products)), capped at 30
 *   failurePenalty  = -3 x products recorded as negative or withdrawn
 *
 *   score = sum of the above
 *
 * "Its products" means every product linked to the company in this corpus, in either direction. The
 * score therefore also measures how well the corpus covers a company and will move as the corpus grows.
 * Registry counts come from public/trials/index.json, refreshed weekly.
 */
export type CompanyScore = {
  company: Company;
  products: Drug[];
  approved: number;
  phase3: number;
  early: number;
  targets: number;
  modalities: number;
  regions: string[];
  recentEvents: number;
  registryTrials: number;
  failures: number;
  approvedPoints: number;
  phase3Points: number;
  earlyPoints: number;
  targetPoints: number;
  modalityPoints: number;
  regionPoints: number;
  momentumPoints: number;
  trialPoints: number;
  failurePenalty: number;
  score: number;
  rank: number;
};

type IndexEntry = { total: number; byPhase: Record<string, number>; byStatus: Record<string, number>; recruiting: number; fetched: string };
const TRIALS = trialsIndex as Record<string, IndexEntry>;

/** Successful snapshot dates can differ after a partial or targeted refresh. */
const trialDates = registryDateRange(Object.values(TRIALS));
export const TRIALS_FETCHED = registryDateLabel(trialDates.oldest, trialDates.newest);

/** Collapse a free-text modality into a comparable class. */
export function modalityClass(m: string): string {
  if (/bispecific adc/i.test(m)) return "Bispecific ADC";
  if (/^adc|antibody-drug|toxin conjugate|drug conjugate/i.test(m)) return "ADC";
  if (/engager|immtac/i.test(m)) return "T-cell engager";
  if (/bispecific/i.test(m)) return "Bispecific antibody";
  if (/car-t|\btil\b|tcr-t|cell therapy|autoleucel|maraleucel|vicleucel|ciloleucel/i.test(m)) return "Cell therapy";
  if (/radioligand|alpha|theranostic|radiopharm/i.test(m)) return "Radiopharmaceutical";
  if (/pet|imaging|fluorescen|radiotracer|lymphatic mapping/i.test(m)) return "Imaging agent";
  if (/vaccine|oncolytic|dendritic|bacterial immunotherapy/i.test(m)) return "Vaccine or oncolytic";
  if (/monoclonal|antibody|fc-engineered|biosimilar/i.test(m)) return "Antibody";
  if (/degrader|protac|molecular glue|celmod|imid|cereblon/i.test(m)) return "Degrader or glue";
  if (/small[- ]molecule|inhibitor|tki|kinase|serd|serm|antagonist|agonist|analogue|antiandrogen|aromatase/i.test(m)) return "Small molecule";
  if (/cytotoxic|chemotherapy|alkylat|platinum|taxane|antimetabolite|nucleoside|anthracycline|vinca|topoisomerase|antifolate/i.test(m)) return "Chemotherapy";
  if (/test|assay|classifier|profiling|screening/i.test(m)) return "Diagnostic";
  if (/device/i.test(m)) return "Device";
  return "Other";
}

/** Normalise the free-text region strings used in `approvals[]`. */
function regionKey(r: string): string {
  const s = r.trim().toLowerCase();
  if (/^(us|usa|united states|fda)/.test(s)) return "US";
  if (/^(eu|europe|ema|european)/.test(s)) return "EU";
  if (/^(uk|united kingdom|mhra)/.test(s)) return "UK";
  if (/^(jp|japan|pmda)/.test(s)) return "JP";
  if (/^(cn|china|nmpa)/.test(s)) return "CN";
  if (/^(au|australia|tga)/.test(s)) return "AU";
  return r.trim();
}

/** Parse the loose dates in regulatoryEvents (YYYY, YYYY-MM, YYYY-Qn, YYYY-MM-DD) into a comparable ISO day. */
export function eventDay(date: string): string | null {
  const q = date.match(/^(\d{4})-Q([1-4])$/);
  if (q) return `${q[1]}-${String(Number(q[2]) * 3).padStart(2, "0")}-28`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  if (/^\d{4}-\d{2}$/.test(date)) return `${date}-15`;
  if (/^\d{4}$/.test(date)) return `${date}-06-30`;
  return null;
}

function daysAgo(asOf: string, days: number): string {
  const d = new Date(`${asOf}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function scoreCompanies(asOf: string): CompanyScore[] {
  const g = graph();
  const since = daysAgo(asOf, 730);
  const rows = g.kind("company").map((company) => {
    const products = (g.neighbours(company.id).get("drug") ?? []) as Drug[];
    let approved = 0, phase3 = 0, early = 0, failures = 0, recentEvents = 0, registryTrials = 0;
    const targets = new Set<string>();
    const modalities = new Set<string>();
    const regions = new Set<string>();
    for (const d of products) {
      if (d.status === "approved" || d.status === "standard-of-care") approved++;
      else if (d.status === "phase-3") phase3++;
      else if (d.status === "phase-2" || d.status === "phase-1") early++;
      if (d.status === "negative" || d.status === "withdrawn") failures++;
      for (const t of d.targets) targets.add(t);
      modalities.add(modalityClass(d.modality));
      for (const a of d.approvals) regions.add(regionKey(a.region));
      const side = regionalApprovals[d.id];
      if (side) for (const r of approvedRegions(side)) regions.add(r);
      for (const ev of d.regulatoryEvents) { const day = eventDay(ev.date); if (day && day >= since && day <= asOf) recentEvents++; }
      registryTrials += TRIALS[d.id]?.total ?? 0;
    }
    const approvedPoints = 6 * approved;
    const phase3Points = 3 * phase3;
    const earlyPoints = early;
    const targetPoints = 2 * Math.min(20, targets.size);
    const modalityPoints = 2 * modalities.size;
    const regionPoints = regions.size;
    const momentumPoints = Math.min(20, 2 * recentEvents);
    const trialPoints = Math.min(30, Math.round(2 * Math.sqrt(registryTrials)));
    const failurePenalty = -3 * failures;
    const score = approvedPoints + phase3Points + earlyPoints + targetPoints + modalityPoints + regionPoints + momentumPoints + trialPoints + failurePenalty;
    return { company, products, approved, phase3, early, targets: targets.size, modalities: modalities.size, regions: [...regions].sort(), recentEvents, registryTrials, failures, approvedPoints, phase3Points, earlyPoints, targetPoints, modalityPoints, regionPoints, momentumPoints, trialPoints, failurePenalty, score, rank: 0 };
  });
  rows.sort((a, b) => b.score - a.score || b.approved - a.approved || a.company.name.localeCompare(b.company.name));
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

export function scoreCompany(id: string, asOf: string): CompanyScore | undefined {
  return scoreCompanies(asOf).find((r) => r.company.id === id);
}
