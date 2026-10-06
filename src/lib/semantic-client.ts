/** Browser loader for the concept-search index written by scripts/embed.ts. Successful loads are cached for the session. */
import { decodeSemanticIndex, type SemanticIndex, type SemanticMeta } from "./semantic";

let cache: Promise<SemanticIndex | null> | null = null;

/** Null means absent or unavailable. Cache a missing build (404), but let failed loads retry. */
export function loadSemantic(): Promise<SemanticIndex | null> {
  if (!cache) {
    const request = Promise.all([fetch("/api/v1/embeddings.json"), fetch("/api/v1/embeddings.bin")])
      .then(async ([m, b]) => {
        // A failed endpoint must remain retryable even when its sibling returned 404.
        for (const response of [m, b]) if (!response.ok && response.status !== 404) throw new Error(`Concept index HTTP ${response.status}`);
        if (m.status === 404 || b.status === 404) return null;
        const meta = (await m.json()) as SemanticMeta;
        const bin = await b.arrayBuffer();
        return decodeSemanticIndex(bin, meta);
      })
      .catch(() => { if (cache === request) cache = null; return null; });
    cache = request;
  }
  return cache;
}
