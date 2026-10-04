/**
 * onco-mcp: a Model Context Protocol server (stdio) over the OnCo static API. No checkout, no database:
 * every tool reads https://onco.cc/api/v1/ (or ONCO_API) and returns JSON that carries the attribution line.
 *
 * Tools: search, get_entity, list_kind, ask, context, compare.   Resources: onco://kinds, onco://kinds/{kind}.
 * Prompt: onco-brief (summarise a record for a patient or a clinician).
 *
 * The in-repository server at mcp/server.ts has more tools (biomarker matching, calendar, live trials) but
 * needs the corpus on disk; this one is the `npx -y onco-mcp` route.
 */
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import { answerText } from "../../../src/lib/ask";
import { applyFilters, ATTRIBUTION, KIND_META, KINDS, kindsTable, OncoClient, OncoError, REGIONS, SITE, urlFor, type EntityRecord, type Kind } from "../../onco-cli/src/client";
import { keyFields, keyFieldValues } from "../../onco-cli/src/format";

export const VERSION = process.env.ONCO_PACKAGE_VERSION ?? "0.1.0";

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };
const ok = (data: Record<string, unknown>): ToolResult => ({ content: [{ type: "text", text: JSON.stringify({ ...data, attribution: ATTRIBUTION }, null, 2) }] });
const okText = (text: string): ToolResult => ({ content: [{ type: "text", text: `${text.trimEnd()}\n\n${ATTRIBUTION}` }] });
const fail = (message: string): ToolResult => ({ content: [{ type: "text", text: JSON.stringify({ error: message, attribution: ATTRIBUTION }, null, 2) }], isError: true });

const brief = (e: { id: string; kind: Kind; name: string; status?: string; tldr: string }) => ({ id: e.id, kind: e.kind, name: e.name, status: e.status, tldr: e.tldr, url: urlFor(e) });
const withUrls = (rec: EntityRecord) => ({ entity: rec.entity, url: SITE + rec.route, context: `${SITE}/api/v1/context/${rec.entity.id}.md`, neighbours: Object.fromEntries(Object.entries(rec.neighbours).map(([k, list]) => [k, list.map((n) => ({ id: n.id, name: n.name, url: SITE + n.route }))])) });

/** Side-by-side view of two records: differing fields, shared neighbours, whether they link to each other. Pure. */
export function compareRecords(a: EntityRecord, b: EntityRecord) {
  const fa = new Map<string, string>([["Status", a.entity.status ?? ""], ["TL;DR", a.entity.tldr], ...keyFields(a.entity)]);
  const fb = new Map<string, string>([["Status", b.entity.status ?? ""], ["TL;DR", b.entity.tldr], ...keyFields(b.entity)]);
  const rawFields = (r: EntityRecord) => new Map<string, unknown>([["Status", r.entity.status ?? ""], ["TL;DR", r.entity.tldr], ...keyFieldValues(r.entity)]);
  const va = rawFields(a), vb = rawFields(b);
  const keys = [...new Set([...fa.keys(), ...fb.keys()])];
  // CLI summaries truncate arrays and flatten objects. They are useful display text, but equality
  // must use all source values; include them so an assistant can inspect differences past the preview.
  const fields = keys.map((field) => ({
    field, a: fa.get(field) ?? null, b: fb.get(field) ?? null,
    differs: !isDeepStrictEqual(va.get(field), vb.get(field)),
    values: { a: va.get(field) ?? null, b: vb.get(field) ?? null },
  }));
  const ids = (r: EntityRecord) => new Map(Object.values(r.neighbours).flat().map((n) => [n.id, n]));
  const na = ids(a), nb = ids(b);
  const sharedNeighbours = [...na.values()].filter((n) => nb.has(n.id)).map((n) => ({ id: n.id, kind: n.kind, name: n.name, url: SITE + n.route }));
  const directlyLinked = na.has(b.entity.id) || nb.has(a.entity.id);
  return {
    a: brief(a.entity), b: brief(b.entity), sameKind: a.entity.kind === b.entity.kind, directlyLinked,
    fields, differing: fields.filter((f) => f.differs).map((f) => f.field), sharedNeighbours,
    note: a.entity.kind === b.entity.kind ? undefined : `Different kinds (${a.entity.kind} vs ${b.entity.kind}); only shared fields compare cleanly.`,
  };
}

const KIND_LIST = KINDS.join(", ");

export function createServer(client: OncoClient): McpServer {
  const server = new McpServer({ name: "onco", version: VERSION });
  const guard = async (fn: () => Promise<ToolResult>): Promise<ToolResult> => { try { return await fn(); } catch (err) { return fail(err instanceof OncoError ? err.message : `onco-mcp: ${(err as Error).message}`); } };

  server.registerTool("search", {
    title: "Search OnCo",
    description: `Find OnCo records (cancers, drugs, targets, trials, companies, institutions, people, terms and more) by name or meaning. Runs the site's word search (names, aliases, TL;DRs, tags) and concept search (record text plus the names of linked records) and fuses them, so paraphrases such as "drug for HER2-low breast cancer" work. Returns id, kind, name, status, tldr, url and why each matched. Use the id with get_entity, context or compare. Kinds: ${KIND_LIST}.`,
    inputSchema: { query: z.string().min(1).describe("Words, a name, a code (DS-8201), a registry id (NCT...) or a paraphrase"), kind: z.enum(KINDS).optional().describe("Restrict to one kind"), limit: z.number().int().min(1).max(50).default(10) },
  }, ({ query, kind, limit }) => guard(async () => ok({ query, kind: kind ?? null, results: await client.search(query, { kind, limit }) })));

  server.registerTool("get_entity", {
    title: "Get an OnCo record",
    description: "The full record for one OnCo id (or page route or URL): every field the site has, the page URL, the Markdown context URL, and the connected records grouped by kind with their URLs. Cite the url after any fact taken from it.",
    inputSchema: { id: z.string().min(1).describe("OnCo id such as tnbc, trop2, trastuzumab-deruxtecan, or a route like /drugs/enhertu/") },
  }, ({ id }) => guard(async () => ok(withUrls(await client.entity(id)))));

  server.registerTool("list_kind", {
    title: "List records of a kind",
    description: `Every record of one kind as id, name, status, tldr and url, optionally filtered by field. Kinds: ${KIND_LIST}. Filters are key=value pairs matched case-insensitively against the record's fields; arrays match on membership, "key=" matches records where the field is empty. Examples: status=approved, modality=ADC, phase=3, targets=trop2.`,
    inputSchema: { kind: z.enum(KINDS), filter: z.array(z.string()).optional().describe('Filters such as ["status=recruiting", "cancers=tnbc"]'), limit: z.number().int().min(1).max(2000).default(100) },
  }, ({ kind, filter, limit }) => guard(async () => {
    const rows = applyFilters(await client.list(kind), filter ?? []);
    return ok({ kind, total: rows.length, shown: Math.min(rows.length, limit), results: rows.slice(0, limit).map(brief) });
  }));

  server.registerTool("ask", {
    title: "Ask OnCo (grounded, cited)",
    description: "Answer an oncology question with sentences taken from OnCo records only, each with a numbered citation and source URL. This is the same pipeline as https://onco.cc/ask/: it resolves the records the question names, classifies the intent (definition, treatments, approval, mechanism, side effects, trials, results, comparison, prognosis, who makes it, cost) and fills a template from the records' structured fields. Nothing is generated; if OnCo has no record on the point it says so. Call this before summarising anything about oncology so every claim carries an OnCo URL. Optional region (US, EU, UK, JP, CN, AU) tailors approval answers.",
    inputSchema: { question: z.string().min(3), region: z.enum(REGIONS as [string, ...string[]]).optional().describe("Regulatory region for approval questions"), pin: z.string().optional().describe("Force this record id to be the primary subject") },
  }, ({ question, region, pin }) => guard(async () => {
    const r = await client.ask(question, { region: region as (typeof REGIONS)[number] | undefined, pin });
    return ok({
      question, intent: r.intent, template: r.template, confidence: r.confidence, note: r.note,
      about: r.entities.map((e) => ({ id: e.id, kind: e.kind, name: e.name, url: urlFor(e) })),
      answer: r.sentences.map((s) => ({ text: s.text, cite: s.cite, field: s.field })),
      sources: r.sources.map((s, i) => ({ n: i + 1, id: s.id, kind: s.kind, name: s.name, url: urlFor(s) })),
      plain: answerText(r), followUps: r.followUps, readMore: r.readMore.map((m) => ({ label: m.label, url: m.href.startsWith("http") ? m.href : SITE + m.href })),
      alternates: r.alternates.map((a) => ({ id: a.id, kind: a.kind, name: a.name, url: urlFor(a) })), method: r.method,
      disclaimer: "OnCo is an orientation tool, not medical advice.",
    });
  }));

  server.registerTool("context", {
    title: "Markdown context for a record",
    description: "One clean Markdown document for a record: TL;DR, summary, structured fields, sources and connected records, ready to paste into a prompt. Same content as https://onco.cc/api/v1/context/<id>.md.",
    inputSchema: { id: z.string().min(1).describe("OnCo id") },
  }, ({ id }) => guard(async () => okText(await client.context(id))));

  server.registerTool("compare", {
    title: "Compare two records",
    description: "Two OnCo records side by side (ideally the same kind: two drugs, two trials, two cancers): each field has display summaries a/b, complete structured values.a/values.b and a differs flag comparing those complete values. Also returns the list of differing fields, the records they both connect to, and whether they link to each other directly. Use search to find ids first.",
    inputSchema: { a: z.string().min(1).describe("First id"), b: z.string().min(1).describe("Second id") },
  }, ({ a, b }) => guard(async () => {
    const [ra, rb] = await Promise.all([client.entity(a), client.entity(b)]);
    return ok(compareRecords(ra, rb));
  }));

  server.registerResource("kinds", "onco://kinds", { title: "OnCo kinds", description: "The kinds of record in OnCo with their public names, routes, one-line descriptions and record counts.", mimeType: "application/json" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ kinds: await kindsTable(client), attribution: ATTRIBUTION }, null, 1) }] }));

  server.registerResource("kind", new ResourceTemplate("onco://kinds/{kind}", {
    list: async () => ({ resources: KINDS.map((k) => ({ uri: `onco://kinds/${k}`, name: `OnCo ${KIND_META[k].plural}`, description: KIND_META[k].blurb, mimeType: "application/json" })) }),
    complete: { kind: (value) => KINDS.filter((k) => k.startsWith(value.toLowerCase())) },
  }), { title: "Records of one kind", description: `Every record of a kind as id, name, status, tldr and url. Kinds: ${KIND_LIST}.`, mimeType: "application/json" },
  async (uri, { kind }) => {
    const k = KINDS.find((x) => x === String(kind));
    if (!k) throw new Error(`Unknown kind "${kind}". Kinds: ${KIND_LIST}`);
    const rows = await client.list(k);
    return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ kind: k, total: rows.length, results: rows.map(brief), attribution: ATTRIBUTION }, null, 1) }] };
  });

  server.registerPrompt("onco-brief", {
    title: "OnCo brief",
    description: "Summarise one OnCo record for a patient (plain words, what it means for them, questions to ask) or a clinician (mechanism, evidence, approvals, toxicity, trials), with every fact cited to an OnCo URL.",
    argsSchema: { id: z.string().describe("OnCo id, e.g. tnbc, trastuzumab-deruxtecan, trop2, destiny-breast04"), audience: z.string().optional().describe("patient (default) or clinician") },
  }, ({ id, audience }) => {
    const clinician = (audience ?? "").toLowerCase().startsWith("clin");
    const shape = clinician
      ? "Write for an oncologist: what it is and its mechanism or biology; the pivotal evidence with the actual numbers OnCo holds (endpoints, hazard ratios, response rates); approvals by region and setting; grade 3+ toxicities and management notes; the trials still running and the open questions. Dense, no padding, UK spelling."
      : "Write for a patient or carer: what it is in plain words (no jargon without a one-line gloss); who it is for and when it is used; what it is meant to achieve and what the evidence says in everyday terms; the side effects to know about; three questions to ask the oncology team. Warm, honest, UK spelling, short paragraphs.";
    return { messages: [{ role: "user", content: { type: "text", text: `Prepare a brief on the OnCo record "${id}" for a ${clinician ? "clinician" : "patient"}.

Steps:
1. Call get_entity("${id}") for the record and its connected records, and context("${id}") for the Markdown version.
2. Call ask with two or three questions the audience would have about it (for a drug: what it is for, side effects, and results; for a cancer: standard of care and what is new; for a target: which drugs hit it) and use only the cited sentences that come back.
3. If a comparison is natural (a rival drug, the previous standard), call compare with the two ids.

${shape}

Rules: use only what the OnCo tools returned; put the OnCo URL after every fact; do not add numbers, dates or claims that are not in a tool result, and say "OnCo has no record of this" where something is missing. End with two lines: "OnCo is an orientation tool, not medical advice; decisions belong with the patient and their clinicians." and "${ATTRIBUTION}".` } }] };
  });

  return server;
}
