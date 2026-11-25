import { formatRerankDocument, loadServerPericopeMap } from '../../lib/pericope-rerank.js';
import {
  DEFAULT_OPENAI_EMBED_DIMS,
  DEFAULT_OPENAI_EMBED_MODEL,
  DEFAULT_OPENAI_EMBED_TIMEOUT_MS,
  DEFAULT_OPENAI_EMBED_URL,
  fuseContextualAndBm25,
  loadContextualPericopeIndex,
  searchContextualPericopes,
} from '../../lib/pericope-vector-search.js';

const DEFAULT_SEARCH_API_URL = 'https://dssjon-biblos-api.hf.space';
const DEFAULT_VOYAGE_API_URL = 'https://api.voyageai.com/v1/rerank';
const DEFAULT_VOYAGE_RERANK_MODEL = 'rerank-3-lite';
const RERANK_TOP_K = 40;
const DEFAULT_RERANK_TIMEOUT_MS = 2500;

function clampLimit(rawLimit) {
  if (rawLimit === undefined || rawLimit === null || rawLimit === '') {
    return 50;
  }
  const parsed = Number(rawLimit);
  if (!Number.isFinite(parsed)) {
    return 50;
  }
  return Math.min(50, Math.max(1, Math.trunc(parsed)));
}

function normalizeCandidate(candidate, preserveExtraFields = false) {
  const base = {
    book: typeof candidate?.book === 'string' ? candidate.book : String(candidate?.book ?? ''),
    chapter: typeof candidate?.chapter === 'number' ? candidate.chapter : Number(candidate?.chapter ?? 0),
    testament: typeof candidate?.testament === 'string' ? candidate.testament : String(candidate?.testament ?? ''),
    content: typeof candidate?.content === 'string' ? candidate.content : String(candidate?.content ?? ''),
    similarity: typeof candidate?.similarity === 'number' ? candidate.similarity : Number(candidate?.similarity ?? 0),
  };

  if (preserveExtraFields) {
    return {
      ...candidate,
      ...base,
    };
  }

  if (typeof candidate?.verseStart === 'number') {
    base.verseStart = candidate.verseStart;
  }
  if (typeof candidate?.verseEnd === 'number') {
    base.verseEnd = candidate.verseEnd;
  }
  if (typeof candidate?.matchSource === 'string') {
    base.matchSource = candidate.matchSource;
  }
  return base;
}

export default async function handler(req, res) {
  res.setHeader?.('Access-Control-Allow-Origin', '*');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body =
    typeof req.body === 'string'
      ? (() => {
          try {
            return JSON.parse(req.body);
          } catch {
            return null;
          }
        })()
      : req.body;

  const rawQuery = body?.query;
  if (typeof rawQuery !== 'string' || rawQuery.trim().length === 0) {
    return res.status(400).json({ error: 'Invalid request: non-empty query string required' });
  }

  if (body?.candidates !== undefined && !Array.isArray(body.candidates)) {
    return res.status(400).json({ error: 'Invalid request: candidates must be an array when provided' });
  }

  if (body?.bm25Candidates !== undefined && !Array.isArray(body.bm25Candidates)) {
    return res.status(400).json({ error: 'Invalid request: bm25Candidates must be an array when provided' });
  }

  const trimmedQuery = rawQuery.trim();
  const limit = clampLimit(body?.limit);
  const books = Array.isArray(body?.books) ? body.books : undefined;
  const bm25Candidates = Array.isArray(body?.bm25Candidates) ? body.bm25Candidates : undefined;

  let results = null;
  let retrievalSource = 'hf-bge';

  if (Array.isArray(body?.candidates)) {
    results = body.candidates
      .filter((item) => item && typeof item === 'object')
      .map((item) => normalizeCandidate(item, true));
    retrievalSource = 'candidates';
  } else {
    // Primary path: contextual multilingual pericope vector search in RAM (<3 ms) +
    // verbatim canonical WEB hydration + Pericope BM25 fusion.
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (OPENAI_API_KEY && OPENAI_API_KEY.trim().length > 0) {
      const contextualIndex = loadContextualPericopeIndex();
      if (contextualIndex) {
        try {
          const parsedEmbedTimeout = Number(process.env.OPENAI_EMBED_TIMEOUT_MS);
          const embedTimeoutMs =
            Number.isFinite(parsedEmbedTimeout) && parsedEmbedTimeout > 0
              ? parsedEmbedTimeout
              : DEFAULT_OPENAI_EMBED_TIMEOUT_MS;

          const contextual = await searchContextualPericopes(trimmedQuery, {
            index: contextualIndex,
            apiKey: OPENAI_API_KEY,
            apiUrl: process.env.OPENAI_EMBED_API_URL || DEFAULT_OPENAI_EMBED_URL,
            model: process.env.OPENAI_EMBED_MODEL || contextualIndex.meta?.model || DEFAULT_OPENAI_EMBED_MODEL,
            dimensions: Number(process.env.OPENAI_EMBED_DIMS || contextualIndex.dims || DEFAULT_OPENAI_EMBED_DIMS),
            timeoutMs: embedTimeoutMs,
            limit,
            books,
            bm25Candidates,
          });
          results = contextual.results;
          retrievalSource = 'contextual-pericope';
        } catch (error) {
          console.warn(
            'Contextual pericope vector search unavailable; falling back to HF Space BGE:',
            error?.message || error
          );
        }
      }
    }

    // Graceful fallback: upstream HF Space BGE + optional BM25 fusion
    if (!results) {
      const searchBaseUrl = (process.env.BIBLOS_SEARCH_API_URL || DEFAULT_SEARCH_API_URL).replace(/\/+$/, '');

      let upstreamData;
      try {
        const upstreamResponse = await fetch(`${searchBaseUrl}/search`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: trimmedQuery,
            limit,
          }),
        });

        if (!upstreamResponse.ok) {
          return res.status(502).json({ error: `Upstream search API error: ${upstreamResponse.status}` });
        }

        upstreamData = await upstreamResponse.json();
      } catch (error) {
        console.error('Upstream search API request failed:', error);
        return res.status(502).json({ error: 'Failed to fetch results from upstream search API' });
      }

      if (!upstreamData || !Array.isArray(upstreamData.results)) {
        return res.status(502).json({ error: 'Invalid response format from upstream search API' });
      }

      const normalizedUpstream = upstreamData.results
        .filter((item) => item && typeof item === 'object')
        .map((item) => normalizeCandidate(item, false));

      results =
        bm25Candidates && bm25Candidates.length > 0
          ? fuseContextualAndBm25(normalizedUpstream, bm25Candidates, { limit })
          : normalizedUpstream;
      retrievalSource = 'hf-bge';
    }
  }

  const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
  const VOYAGE_API_URL = process.env.VOYAGE_API_URL || DEFAULT_VOYAGE_API_URL;
  const VOYAGE_RERANK_MODEL = process.env.VOYAGE_RERANK_MODEL || DEFAULT_VOYAGE_RERANK_MODEL;
  const parsedTimeout = Number(process.env.VOYAGE_RERANK_TIMEOUT_MS);
  const RERANK_TIMEOUT_MS =
    Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : DEFAULT_RERANK_TIMEOUT_MS;

  if (!VOYAGE_API_KEY || VOYAGE_API_KEY.trim().length === 0 || results.length <= 1) {
    return res.status(200).json({ results, reranked: false, retrievalSource });
  }

  const head = results.slice(0, RERANK_TOP_K);
  const tail = results.slice(RERANK_TOP_K);
  const pericopeMap = loadServerPericopeMap();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), RERANK_TIMEOUT_MS);

  try {
    const rerankResponse = await fetch(VOYAGE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${VOYAGE_API_KEY}`,
      },
      body: JSON.stringify({
        model: VOYAGE_RERANK_MODEL,
        query: trimmedQuery,
        documents: head.map((item) => formatRerankDocument(item, pericopeMap)),
      }),
      signal: controller.signal,
    });

    if (!rerankResponse.ok) {
      console.warn(`Voyage rerank returned status ${rerankResponse.status}; falling back to upstream order`);
      return res.status(200).json({ results, reranked: false, retrievalSource });
    }

    const rerankData = await rerankResponse.json();
    if (!rerankData || !Array.isArray(rerankData.data) || rerankData.data.length === 0) {
      console.warn('Voyage rerank returned malformed or empty data array; falling back to upstream order');
      return res.status(200).json({ results, reranked: false, retrievalSource });
    }

    const seenIndices = new Set();
    for (const entry of rerankData.data) {
      if (
        !entry ||
        typeof entry !== 'object' ||
        typeof entry.index !== 'number' ||
        !Number.isInteger(entry.index) ||
        entry.index < 0 ||
        entry.index >= head.length ||
        seenIndices.has(entry.index) ||
        typeof entry.relevance_score !== 'number' ||
        !Number.isFinite(entry.relevance_score)
      ) {
        console.warn('Voyage rerank returned invalid entry; falling back to upstream order');
        return res.status(200).json({ results, reranked: false, retrievalSource });
      }
      seenIndices.add(entry.index);
    }

    const sortedEntries = [...rerankData.data].sort((a, b) => {
      if (b.relevance_score !== a.relevance_score) {
        return b.relevance_score - a.relevance_score;
      }
      return a.index - b.index;
    });

    const rerankedHead = sortedEntries.map((entry) => ({
      ...head[entry.index],
      rerankScore: entry.relevance_score,
    }));

    for (let i = 0; i < head.length; i += 1) {
      if (!seenIndices.has(i)) {
        rerankedHead.push(head[i]);
      }
    }

    return res.status(200).json({
      results: [...rerankedHead, ...tail],
      reranked: true,
      retrievalSource,
    });
  } catch (error) {
    console.warn('Voyage rerank failed; falling back to upstream order:', error?.message || error);
    return res.status(200).json({ results, reranked: false, retrievalSource });
  } finally {
    clearTimeout(timeoutId);
  }
}
