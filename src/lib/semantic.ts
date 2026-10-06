/**
 * Concept search: a compact, deterministic vector index over every OnCo record, computed at build time
 * and searched in the browser. No model download, no server, no external calls.
 *
 * How it works. Each record becomes a weighted bag of normalised tokens: its name, aliases, tags,
 * TL;DR, summary, kind-specific fields, and the names of everything it links to. Weights are
 * TF-IDF, L2-normalised, truncated to the strongest features. A query is tokenised the same way and
 * scored by cosine similarity. Because a product's document includes the names of the cancers, targets,
 * terms and trials it links to, a paraphrase such as "drug for HER2-low breast cancer" reaches records
 * whose own text never says "HER2-low". Every hit can explain itself by listing the tokens it matched.
 *
 * This module is pure and browser-safe. The document builder that needs the corpus lives in
 * semantic-docs.ts; scripts/embed.ts writes the index to public/api/v1/embeddings.{bin,json}.
 */

export type SemanticDoc = { id: string; kind: string; text: string; /** Optional score multiplier; thin registry-ingested records sit below 1. */ weight?: number };
export type SemanticHit = { id: string; score: number; matched: string[] };
export type SemanticMeta = { version: 1; ids: string[]; kinds: string[]; vocab: string[]; idf: number[]; weights?: number[]; built?: string; method?: string };

export type SemanticIndex = {
  ids: string[];
  kinds: string[];
  /** Per-document score multipliers (absent when every document weighs 1). */
  weights?: number[];
  vocab: string[];
  vocabIndex: Map<string, number>;
  idf: Float32Array;
  docs: Array<{ idx: Uint16Array; w: Float32Array }>;
  /** token index -> [doc index, weight] pairs; built lazily on first search. */
  postings?: Map<number, Array<[number, number]>>;
};

const STOP = new Set(("a an and are as at be but by for from has have if in into is it its of on or that the this to was were will with " +
  "what which who whom whose why how when where does do did can could should would about than then there these those their they them " +
  "any all also each such very much more most some many may might not no nor only own same so too s t you your we our me my i").split(" "));

/** UK to US spelling and a few clinical spellings, so both sides of a search agree. Applied to lower-cased text. */
const SPELL: Array<[RegExp, string]> = [
  [/tumour/g, "tumor"], [/haemat/g, "hemat"], [/haemo/g, "hemo"], [/anaem/g, "anem"], [/leukaem/g, "leukem"], [/oesophag/g, "esophag"],
  [/oestrogen/g, "estrogen"], [/paediatric/g, "pediatric"], [/programme/g, "program"], [/centre/g, "center"], [/isation/g, "ization"],
  [/ised\b/g, "ized"], [/ising\b/g, "izing"], [/diarrhoea/g, "diarrhea"], [/oedema/g, "edema"], [/foetal/g, "fetal"], [/gynaecolog/g, "gynecolog"],
];

/** Question phrasings mapped to the vocabulary records actually use. */
const PHRASES: Array<[RegExp, string]> = [
  [/how (?:does|do) (.+?) work\b/g, "$1 mechanism"], [/side[- ]effects?/g, "toxicity adverse events"], [/adverse reactions?/g, "toxicity adverse events"],
  [/how common\b/g, "incidence prevalence burden"], [/new cases/g, "incidence"], [/chance of (?:surviv|cure)\w*/g, "survival"], [/live longer/g, "overall survival"],
  [/\b(?:cost|price|afford\w*)\b/g, "access list price reimbursement"], [/\bkids?\b|children|childhood/g, "pediatric child"], [/medicines?|medications?/g, "drug"],
  [/therap(?:y|ies|eutic)\b/g, "treatment"], [/\bchemo\b/g, "chemotherapy"], [/\bimmuno\b/g, "immunotherapy"], [/second[- ]line|later lines?/g, "later-line pretreated"],
  [/first[- ]line/g, "first-line frontline"], [/\bspread\b/g, "metastatic"],
];

/**
 * A question with its function words dropped, for the word index: "Which TROP2 ADCs are approved for first-line..."
 * becomes "TROP2 ADCs approved first-line...". Spellings and punctuation are kept so MiniSearch's own tokeniser sees
 * the words it indexed. With prefix and fuzzy matching on, "what", "which", "the" and "for" otherwise out-score the
 * record names on a long question (measured 24 Sept 2026: extractive recall 0.329 with them, 0.415 without).
 */
export function contentWords(text: string): string {
  return text.split(/\s+/).filter((w) => { const x = w.toLowerCase().replace(/[^a-z0-9]/g, ""); return x.length > 0 && !STOP.has(x); }).join(" ");
}

function stem(t: string): string {
  if (t.length <= 4) return t;
  if (t.endsWith("ies")) return t.slice(0, -3) + "y";
  if (t.endsWith("sses")) return t.slice(0, -2);
  if (t.endsWith("ing") && t.length > 6) return t.slice(0, -3);
  if (t.endsWith("ed") && t.length > 5) return t.slice(0, -2);
  if (t.endsWith("s") && !t.endsWith("ss") && !t.endsWith("us") && !t.endsWith("is")) return t.slice(0, -1);
  return t;
}

/** Normalised tokens for a piece of text. Hyphenated compounds yield the compound and its parts. */
export function tokenize(text: string): string[] {
  let s = text.toLowerCase();
  for (const [re, to] of SPELL) s = s.replace(re, to);
  for (const [re, to] of PHRASES) s = s.replace(re, to);
  const out: string[] = [];
  for (const raw of s.split(/[^a-z0-9\-+/]+/)) {
    const w = raw.replace(/^[-/+]+|[-/+]+$/g, "");
    if (!w) continue;
    const parts = w.split(/[-/+]/).filter(Boolean);
    if (parts.length > 1) out.push(w);
    for (const p of parts) {
      if (p.length < 2 || STOP.has(p) || /^\d$/.test(p)) continue;
      out.push(stem(p));
    }
  }
  return out;
}

export type BuildOptions = { maxFeatures?: number; minDf?: number };

/** Build the index from documents. Deterministic: same input, same output. */
export function buildSemanticIndex(docs: SemanticDoc[], opts: BuildOptions = {}): SemanticIndex {
  const maxFeatures = opts.maxFeatures ?? 96, minDf = opts.minDf ?? 2;
  const tfs = docs.map((d) => {
    const m = new Map<string, number>();
    for (const t of tokenize(d.text)) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  });
  // Inverse document frequency is computed over the curated records only (SemanticDoc.weight 1): registry-ingested
  // trials and other thin records still get vectors and are still searched, but a wave of them naming one cancer no
  // longer flattens the weight of that cancer's words for every curated record (measured 24 Sept 2026: 284 pancreatic
  // registry trials took Ask's extractive recall from 0.413 to 0.408 when they counted in the vocabulary).
  const df = new Map<string, number>();
  const raw = new Map<string, number>();
  tfs.forEach((m, i) => { const full = (docs[i].weight ?? 1) >= 1; for (const t of m.keys()) { raw.set(t, (raw.get(t) ?? 0) + 1); if (full) df.set(t, (df.get(t) ?? 0) + 1); } });
  const vocab = [...raw.entries()].filter(([, n]) => n >= minDf).map(([t]) => t).sort();
  const vocabIndex = new Map(vocab.map((t, i) => [t, i]));
  const N = docs.filter((d) => (d.weight ?? 1) >= 1).length;
  const idf = new Float32Array(vocab.map((t) => Math.log((N + 1) / ((df.get(t) ?? 0) + 1)) + 1));
  const out: SemanticIndex["docs"] = tfs.map((m) => {
    const feats: Array<[number, number]> = [];
    for (const [t, n] of m) {
      const i = vocabIndex.get(t);
      if (i === undefined) continue;
      feats.push([i, (1 + Math.log(n)) * idf[i]]);
    }
    feats.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    const top = feats.slice(0, maxFeatures).sort((a, b) => a[0] - b[0]);
    const norm = Math.sqrt(top.reduce((s, [, w]) => s + w * w, 0)) || 1;
    return { idx: Uint16Array.from(top.map(([i]) => i)), w: Float32Array.from(top.map(([, w]) => w / norm)) };
  });
  const weights = docs.map((d) => d.weight ?? 1);
  return { ids: docs.map((d) => d.id), kinds: docs.map((d) => d.kind), ...(weights.some((w) => w !== 1) ? { weights } : {}), vocab, vocabIndex, idf, docs: out };
}

/** Words in a query that name a kind of record. When present, records of that kind get a modest boost. */
const KIND_WORDS: Record<string, string> = {
  drug: "drug", product: "drug", treatment: "drug", adc: "drug", antibody: "drug", inhibitor: "drug", vaccine: "drug", tracer: "drug",
  trial: "trial", study: "trial", readout: "trial",
  target: "target", antigen: "target", receptor: "target", gene: "target", mutation: "target", protein: "target",
  cancer: "cancer", tumor: "cancer", carcinoma: "cancer", leukemia: "cancer", lymphoma: "cancer", sarcoma: "cancer", melanoma: "cancer", glioma: "cancer", myeloma: "cancer",
  company: "company", companies: "company", pharma: "company", biotech: "company", maker: "company", manufacturer: "company",
  hospital: "institution", institution: "institution", center: "institution", institute: "institution", university: "institution",
  doctor: "person", clinician: "person", scientist: "person", oncologist: "person", researcher: "person", who: "person",
  pathway: "pathway", signalling: "pathway", signaling: "pathway",
  paper: "paper", publication: "paper", journal: "journal",
  idea: "idea", hypothesis: "idea", bottleneck: "bottleneck", technology: "technology", technique: "technology", method: "technology", imaging: "technology", scan: "technology",
  term: "term", mean: "term", definition: "term", glossary: "term",
};

/** Kinds a query seems to ask for, from its words ("drug for..." -> drug). */
export function queryKinds(query: string): Set<string> {
  const out = new Set<string>();
  for (const t of tokenize(query)) { const k = KIND_WORDS[t]; if (k) out.add(k); }
  return out;
}

const MAGIC = 0x4f4e4353; // "ONCS"

/** Serialise to a compact binary (vectors) plus JSON (ids, vocabulary, idf). */
export function encodeSemanticIndex(index: SemanticIndex): { bin: Uint8Array; meta: SemanticMeta } {
  let bytes = 12;
  for (const d of index.docs) bytes += 2 + d.idx.length * 3;
  const buf = new ArrayBuffer(bytes);
  const v = new DataView(buf);
  let p = 0;
  v.setUint32(p, MAGIC); p += 4; v.setUint32(p, 1); p += 4; v.setUint32(p, index.docs.length); p += 4;
  for (const d of index.docs) {
    v.setUint16(p, d.idx.length); p += 2;
    for (let i = 0; i < d.idx.length; i++) { v.setUint16(p, d.idx[i]); p += 2; }
    for (let i = 0; i < d.w.length; i++) { v.setUint8(p, Math.max(1, Math.round(d.w[i] * 255))); p += 1; }
  }
  return { bin: new Uint8Array(buf), meta: { version: 1, ids: index.ids, kinds: index.kinds, ...(index.weights ? { weights: index.weights } : {}), vocab: index.vocab, idf: Array.from(index.idf, (x) => Math.round(x * 1000) / 1000) } };
}

export function decodeSemanticIndex(bin: ArrayBuffer, meta: SemanticMeta): SemanticIndex {
  const v = new DataView(bin);
  let p = 0;
  if (v.getUint32(p) !== MAGIC) throw new Error("Not an OnCo semantic index");
  p += 8;
  const n = v.getUint32(p); p += 4;
  if (n !== meta.ids.length) throw new Error("Index and metadata disagree on document count");
  const docs: SemanticIndex["docs"] = [];
  for (let d = 0; d < n; d++) {
    const len = v.getUint16(p); p += 2;
    const idx = new Uint16Array(len);
    for (let i = 0; i < len; i++) { idx[i] = v.getUint16(p); p += 2; }
    const w = new Float32Array(len);
    let norm = 0;
    for (let i = 0; i < len; i++) { w[i] = v.getUint8(p) / 255; norm += w[i] * w[i]; p += 1; }
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < len; i++) w[i] /= norm;
    docs.push({ idx, w });
  }
  return { ids: meta.ids, kinds: meta.kinds, ...(meta.weights ? { weights: meta.weights } : {}), vocab: meta.vocab, vocabIndex: new Map(meta.vocab.map((t, i) => [t, i])), idf: Float32Array.from(meta.idf), docs };
}

function postings(index: SemanticIndex): Map<number, Array<[number, number]>> {
  if (index.postings) return index.postings;
  const m = new Map<number, Array<[number, number]>>();
  index.docs.forEach((d, di) => { for (let i = 0; i < d.idx.length; i++) (m.get(d.idx[i]) ?? m.set(d.idx[i], []).get(d.idx[i])!).push([di, d.w[i]]); });
  index.postings = m;
  return m;
}

/** Query vector as [token index, weight] pairs, unit norm. */
export function queryVector(index: SemanticIndex, query: string): Array<[number, number]> {
  const counts = new Map<number, number>();
  for (const t of tokenize(query)) { const i = index.vocabIndex.get(t); if (i !== undefined) counts.set(i, (counts.get(i) ?? 0) + 1); }
  const feats: Array<[number, number]> = [...counts].map(([i, n]) => [i, (1 + Math.log(n)) * index.idf[i]]);
  const norm = Math.sqrt(feats.reduce((s, [, w]) => s + w * w, 0)) || 1;
  return feats.map(([i, w]) => [i, w / norm]);
}

/**
 * Cosine search. `matched` lists the query tokens each hit shares, strongest first, for the explanation line.
 * When the query names a kind ("drug for ...", "which trial ..."), records of that kind score 1.3x.
 */
export function semanticSearch(index: SemanticIndex, query: string, k = 20, opts: { kindBoost?: number; filter?: (id: string) => boolean } = {}): SemanticHit[] {
  const q = queryVector(index, query);
  if (!q.length) return [];
  const post = postings(index);
  const wanted = queryKinds(query);
  const boost = opts.kindBoost ?? 1.3;
  const scores = new Map<number, { s: number; m: Array<[string, number]> }>();
  for (const [ti, qw] of q) {
    for (const [di, dw] of post.get(ti) ?? []) {
      // Filter before accumulating scores and explanations, rather than expanding every hit
      // and truncating its kind afterwards. Accepted records retain their original scores.
      if (opts.filter && !opts.filter(index.ids[di])) continue;
      const cur = scores.get(di) ?? { s: 0, m: [] };
      cur.s += qw * dw;
      cur.m.push([index.vocab[ti], qw * dw]);
      scores.set(di, cur);
    }
  }
  // A kind named in the first two words ("drug for...", "trial of...") states what the reader wants; lift it further
  // than a kind word that appears later in the question.
  const lead = queryKinds(tokenize(query).slice(0, 2).join(" "));
  // Registry-ingested trials and pipeline products carry a title and little else; their weight keeps curated records ahead.
  if (index.weights) for (const [di, v] of scores) v.s *= index.weights[di] ?? 1;
  if (wanted.size) for (const [di, v] of scores) { const k = index.kinds[di]; if (lead.has(k)) v.s *= boost * 1.35; else if (wanted.has(k)) v.s *= boost; }
  return [...scores].sort((a, b) => b[1].s - a[1].s || a[0] - b[0]).slice(0, k)
    .map(([di, { s, m }]) => ({ id: index.ids[di], score: Math.round(s * 1000) / 1000, matched: m.sort((a, b) => b[1] - a[1]).map(([t]) => t) }));
}

/** Reciprocal-rank fusion of several ranked lists (ids). Items in more lists, and higher in each, rise. */
export function fuseRanks(lists: Array<Array<{ id: string }>>, k = 60): Array<{ id: string; score: number; in: number[] }> {
  const acc = new Map<string, { score: number; in: number[] }>();
  lists.forEach((list, li) => list.forEach((h, r) => {
    const cur = acc.get(h.id) ?? { score: 0, in: [] };
    cur.score += 1 / (k + r + 1);
    cur.in.push(li);
    acc.set(h.id, cur);
  }));
  return [...acc].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
