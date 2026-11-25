import { BOOK_MAPPING } from "./bible-constants.ts"
import { buildCanonicalChunksFromVerses, type CanonicalChunk } from "./corpus-chunker.ts"
import {
  buildPericopeChapterMap,
  findOverlappingPericopes,
  formatPericopeBm25Text,
  type PericopeEntry,
} from "./pericope-atlas.ts"
import type { BibleVerse, SearchResult } from "./bible-types.ts"

const BM25_STOPWORDS = new Set([
  "a", "about", "an", "and", "are", "as", "at", "be", "but", "by",
  "can", "could", "did", "do", "does", "for", "from", "had", "has", "have",
  "he", "her", "him", "his", "how", "i", "in", "into", "is", "it", "its",
  "me", "my", "not", "of", "on", "or", "our", "said", "say", "saying",
  "she", "should", "so", "that", "the", "their", "them", "then", "there",
  "they", "this", "to", "us", "was", "we", "were", "what", "when", "where",
  "which", "who", "will", "with", "would", "you", "your",
])

const TOKEN_ALIASES: Record<string, string> = {
  psalms: "psalm",
  proverbs: "proverb",
  corinthians: "corinthian",
  thessalonians: "thessalonian",
  philippians: "philippian",
  colossians: "colossian",
  ephesians: "ephesian",
  galatians: "galatian",
  romans: "roman",
  hebrews: "hebrew",
  quick: "swift", // bridges ESV/NASB "quick to hear" and WEB "swift to hear"
}

export function tokenizeForBm25(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z0-9]+/g)
  if (!matches) return []
  const tokens: string[] = []
  for (const raw of matches) {
    if (raw.length <= 1 || BM25_STOPWORDS.has(raw)) continue
    tokens.push(TOKEN_ALIASES[raw] ?? raw)
  }
  return tokens
}

export interface Bm25Match extends CanonicalChunk {
  bm25Score: number
  matchedTerms: number
  queryTermCoverage: number
  maxMatchedIdf: number
}

interface IndexedDoc {
  chunk: CanonicalChunk
  length: number
  tf: Map<string, number>
}

export class BibleBm25Index {
  private readonly docs: IndexedDoc[]
  private readonly df: Map<string, number>
  private readonly idf: Map<string, number>
  private readonly avgDocLen: number
  private readonly k1 = 1.2
  private readonly b = 0.75

  constructor(chunks: CanonicalChunk[], pericopes?: PericopeEntry[] | null) {
    this.df = new Map()
    const pericopeMap = pericopes && pericopes.length > 0 ? buildPericopeChapterMap(pericopes) : null
    this.docs = chunks.map((chunk) => {
      const bookName = chunk.bookFullName || BOOK_MAPPING[chunk.book] || chunk.book
      const overlappingPericopes = pericopeMap
        ? findOverlappingPericopes(pericopeMap, chunk.book, chunk.chapter, chunk.verseStart, chunk.verseEnd)
        : []
      const pericopeMeta = formatPericopeBm25Text(overlappingPericopes)
      const searchableText = pericopeMeta
        ? `${bookName} ${chunk.chapter} ${pericopeMeta} ${chunk.content}`
        : `${bookName} ${chunk.chapter} ${chunk.content}`
      const tokens = tokenizeForBm25(searchableText)
      const tf = new Map<string, number>()
      for (const token of tokens) {
        tf.set(token, (tf.get(token) ?? 0) + 1)
      }
      for (const token of tf.keys()) {
        this.df.set(token, (this.df.get(token) ?? 0) + 1)
      }
      return { chunk, length: tokens.length, tf }
    })

    const totalLen = this.docs.reduce((sum, doc) => sum + doc.length, 0)
    this.avgDocLen = this.docs.length > 0 ? totalLen / this.docs.length : 1

    this.idf = new Map()
    const n = this.docs.length
    for (const [term, freq] of this.df.entries()) {
      this.idf.set(term, Math.log((n - freq + 0.5) / (freq + 0.5) + 1))
    }
  }

  get size(): number {
    return this.docs.length
  }

  search(
    query: string,
    options: { books?: string[]; limit?: number } = {}
  ): Bm25Match[] {
    const limit = options.limit ?? 50
    const bookFilter = options.books
      ? new Set(options.books.map((b) => b.toLowerCase()))
      : null
    const queryTerms = Array.from(new Set(tokenizeForBm25(query)))
    if (queryTerms.length === 0 || this.docs.length === 0) return []

    const scored: Bm25Match[] = []
    for (const doc of this.docs) {
      if (bookFilter && !bookFilter.has(doc.chunk.book)) continue

      let score = 0
      let matchedTerms = 0
      let maxMatchedIdf = 0

      for (const term of queryTerms) {
        const freq = doc.tf.get(term)
        if (!freq) continue
        const termIdf = this.idf.get(term) ?? 0
        matchedTerms += 1
        if (termIdf > maxMatchedIdf) maxMatchedIdf = termIdf
        const denom = freq + this.k1 * (1 - this.b + (this.b * doc.length) / this.avgDocLen)
        score += termIdf * ((freq * (this.k1 + 1)) / denom)
      }

      if (score > 0) {
        scored.push({
          ...doc.chunk,
          bm25Score: score,
          matchedTerms,
          queryTermCoverage: matchedTerms / queryTerms.length,
          maxMatchedIdf,
        })
      }
    }

    scored.sort((a, b) => b.bm25Score - a.bm25Score)
    return scored.slice(0, limit)
  }
}

export interface HybridFusionOptions {
  denseWeight?: number
  bm25Weight?: number
  rrfK?: number
  limit?: number
  minDenseThreshold?: number
  minBm25OnlyScore?: number
  minBm25OnlyTerms?: number
  minBm25RareIdf?: number
}

function passageOverlapRatio(a: SearchResult, b: SearchResult): number {
  if (a.book.toLowerCase() !== b.book.toLowerCase() || a.chapter !== b.chapter) {
    return 0
  }
  if (!a.verseStart || !a.verseEnd || !b.verseStart || !b.verseEnd) {
    return a.content.trim() === b.content.trim() ? 1 : 0
  }
  const start = Math.max(a.verseStart, b.verseStart)
  const end = Math.min(a.verseEnd, b.verseEnd)
  if (end < start) return 0
  const overlap = end - start + 1
  const unionStart = Math.min(a.verseStart, b.verseStart)
  const unionEnd = Math.max(a.verseEnd, b.verseEnd)
  const unionSpan = unionEnd - unionStart + 1
  return overlap / unionSpan
}

// Weighted Reciprocal Rank Fusion combining dense semantic results with BM25 lexical recall.
// Preserves calibrated similarity scores above the 0.45 UI cutoff when backed by strong dense
// or strong multi-term/rare-term BM25 evidence, while rejecting unrelated queries cleanly.
export function fuseHybridResults(
  denseResults: SearchResult[],
  bm25Results: Bm25Match[],
  options: HybridFusionOptions = {}
): SearchResult[] {
  const denseWeight = options.denseWeight ?? 0.80
  const bm25Weight = options.bm25Weight ?? 0.20
  const rrfK = options.rrfK ?? 60
  const limit = options.limit ?? 50
  const minDenseThreshold = options.minDenseThreshold ?? 0.45
  const minBm25OnlyScore = options.minBm25OnlyScore ?? 11.5
  const minBm25OnlyTerms = options.minBm25OnlyTerms ?? 2
  const minBm25RareIdf = options.minBm25RareIdf ?? 6.5

  interface Candidate {
    result: SearchResult
    denseRank?: number
    denseSim: number
    bm25Rank?: number
    bm25Score: number
    bm25Terms: number
    bm25Coverage: number
    bm25MaxIdf: number
  }

  const candidates: Candidate[] = []

  denseResults.forEach((raw, idx) => {
    const normalized: SearchResult = {
      ...raw,
      book: raw.book.toLowerCase(),
      matchSource: "dense",
    }
    candidates.push({
      result: normalized,
      denseRank: idx + 1,
      denseSim: raw.similarity,
      bm25Score: 0,
      bm25Terms: 0,
      bm25Coverage: 0,
      bm25MaxIdf: 0,
    })
  })

  bm25Results.forEach((bm, idx) => {
    const bmAsResult: SearchResult = {
      book: bm.book.toLowerCase(),
      chapter: bm.chapter,
      testament: bm.testament,
      content: bm.content,
      similarity: 0,
      verseStart: bm.verseStart,
      verseEnd: bm.verseEnd,
      matchSource: "bm25",
    }

    // Match against an existing dense candidate only when IoU >= 0.70 so adjacent
    // overlapping chunks (e.g. James 1:16-24 vs James 1:22-27) never swallow an anchor verse.
    const existing = candidates.find(
      (c) => passageOverlapRatio(c.result, bmAsResult) >= 0.7
    )

    if (existing) {
      if (existing.bm25Rank === undefined) {
        existing.bm25Rank = idx + 1
        existing.bm25Score = bm.bm25Score
        existing.bm25Terms = bm.matchedTerms
        existing.bm25Coverage = bm.queryTermCoverage
        existing.bm25MaxIdf = bm.maxMatchedIdf
        existing.result = {
          ...existing.result,
          matchSource: "hybrid",
          // Prefer canonical overlapping chunk text & verse range when available
          content: existing.result.verseStart ? existing.result.content : bm.content,
          verseStart: existing.result.verseStart ?? bm.verseStart,
          verseEnd: existing.result.verseEnd ?? bm.verseEnd,
        }
      }
    } else {
      candidates.push({
        result: bmAsResult,
        denseSim: 0,
        bm25Rank: idx + 1,
        bm25Score: bm.bm25Score,
        bm25Terms: bm.matchedTerms,
        bm25Coverage: bm.queryTermCoverage,
        bm25MaxIdf: bm.maxMatchedIdf,
      })
    }
  })

  const maxRrf = denseWeight / (rrfK + 1) + bm25Weight / (rrfK + 1)
  const topDenseSim = denseResults.length > 0 ? denseResults[0].similarity : 0

  const scored = candidates.map((c) => {
    // High-coverage multi-term lexical match (e.g. remembered Scripture wording like
    // "quick to hear and slow to speak" matching 4/4 content terms) earns strong RRF weight
    // even when dense retrieval missed it.
    const exactLexicalHit =
      c.bm25Coverage >= 0.75 && c.bm25Terms >= 3 && c.bm25Score >= 14.0
    const effectiveBm25Weight = exactLexicalHit ? Math.max(denseWeight + 0.05, 0.85) : bm25Weight

    const rrf =
      (c.denseRank !== undefined ? denseWeight / (rrfK + c.denseRank) : 0) +
      (c.bm25Rank !== undefined ? effectiveBm25Weight / (rrfK + c.bm25Rank) : 0)

    const strongBm25 =
      c.bm25Score >= minBm25OnlyScore &&
      (c.bm25Terms >= minBm25OnlyTerms || c.bm25MaxIdf >= minBm25RareIdf)

    // Calibrate similarity cleanly against the app's 0.45 cutoff:
    // - Strong dense matches keep their cosine scale boosted slightly by BM25 agreement.
    // - BM25-only rescues (like exact wording missed by dense) clear 0.45 ONLY when backed
    //   by strong multi-term or rare-term lexical evidence, preventing false positives on
    //   out-of-domain queries.
    let similarity: number
    if (c.denseRank !== undefined) {
      const bm25Lift =
        c.bm25Rank !== undefined && (c.denseSim > minDenseThreshold || strongBm25)
          ? Math.min(0.08, (bm25Weight / (rrfK + c.bm25Rank)) / maxRrf * 0.25)
          : 0
      similarity = Math.min(0.9999, c.denseSim + bm25Lift)
    } else if (strongBm25) {
      const baseFloor = Math.max(minDenseThreshold + 0.02, Math.min(topDenseSim, 0.72))
      const lexicalNorm = Math.min(1, c.bm25Score / 22)
      similarity = Math.min(0.95, baseFloor + lexicalNorm * 0.12)
    } else {
      similarity = Math.min(minDenseThreshold - 0.01, (c.bm25Score / minBm25OnlyScore) * 0.35)
    }

    return {
      rrf,
      strongBm25,
      densePasses: c.denseSim > minDenseThreshold,
      result: {
        ...c.result,
        similarity,
      },
    }
  })

  // Sort primarily by passing status, then by calibrated hybrid order so top-3 reflects
  // combined semantic + lexical evidence while keeping weak matches below 0.45.
  scored.sort((a, b) => {
    const aPass = a.result.similarity > minDenseThreshold ? 1 : 0
    const bPass = b.result.similarity > minDenseThreshold ? 1 : 0
    if (aPass !== bPass) return bPass - aPass
    if (b.rrf !== a.rrf) return b.rrf - a.rrf
    return b.result.similarity - a.result.similarity
  })

  return scored.slice(0, limit).map((item) => item.result)
}

let cachedBm25Index: BibleBm25Index | null = null
let cachedVerseCount = 0
let cachedPericopeCount = 0

export function getOrBuildBm25Index(
  verses: BibleVerse[],
  pericopes?: PericopeEntry[] | null
): BibleBm25Index | null {
  if (!verses || verses.length === 0) return null
  const pericopeCount = pericopes?.length ?? 0
  if (
    cachedBm25Index &&
    cachedVerseCount === verses.length &&
    cachedPericopeCount === pericopeCount
  ) {
    return cachedBm25Index
  }
  const chunks = buildCanonicalChunksFromVerses(verses)
  cachedBm25Index = new BibleBm25Index(chunks, pericopes)
  cachedVerseCount = verses.length
  cachedPericopeCount = pericopeCount
  return cachedBm25Index
}

export function resetBm25IndexCache(): void {
  cachedBm25Index = null
  cachedVerseCount = 0
  cachedPericopeCount = 0
}
