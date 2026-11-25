// Maps each search passage (a chunk of one chapter) to the verses it covers, so
// results can show "Psalm 46:8–11" and open the reader with those verses highlighted.
// The index is built by util/build-verse-ranges.mjs and served from public/data.
import type { SearchResult } from "./bible-types"

export const VERSE_RANGE_INDEX_URL = "/data/verse-ranges.json"

export interface VerseRangeIndex {
  source: string
  sourceSha256: string
  passages: number
  ranges: Record<string, [number, number]>
  legacyRanges?: Record<string, [number, number]>
}

export interface VerseRange {
  verseStart: number
  verseEnd: number
}

// Whitespace-insensitive so the hosted API and local archives produce the same key.
export function normalizePassageText(content: string): string {
  return content.replace(/\s+/g, " ").trim()
}

// 32-bit FNV-1a over UTF-16 code units. Keys are scoped to one chapter, and the
// build script fails if two different passages in a chapter share a hash.
export function passageHash(content: string): string {
  const text = normalizePassageText(content)
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

export function passageKey(book: string, chapter: number, content: string): string {
  return `${book.toLowerCase()}:${chapter}:${passageHash(content)}`
}

export function findVerseRange(
  index: VerseRangeIndex,
  book: string,
  chapter: number,
  content: string
): VerseRange | null {
  const key = passageKey(book, chapter, content)
  const range = index.ranges[key] ?? index.legacyRanges?.[key]
  return range ? { verseStart: range[0], verseEnd: range[1] } : null
}

// ":16" for one verse, ":16–18" for several, "" when unknown.
export function formatVerseRange(verseStart?: number, verseEnd?: number): string {
  if (!verseStart) return ""
  if (!verseEnd || verseEnd === verseStart) return `:${verseStart}`
  return `:${verseStart}–${verseEnd}`
}

let indexPromise: Promise<VerseRangeIndex | null> | null = null

export function loadVerseRangeIndex(): Promise<VerseRangeIndex | null> {
  if (!indexPromise) {
    indexPromise = fetch(VERSE_RANGE_INDEX_URL)
      .then((response) => (response.ok ? (response.json() as Promise<VerseRangeIndex>) : null))
      .catch((error) => {
        console.warn("Verse ranges unavailable:", error)
        return null
      })
      .then((index) => {
        if (!index) indexPromise = null // retry on the next search
        return index
      })
  }
  return indexPromise
}

export interface AttachVerseRangeOptions {
  hydrateText?: (
    book: string,
    chapter: number,
    verseStart: number,
    verseEnd: number
  ) => string | null
}

// Results keep working without ranges if the index cannot be loaded.
// When hydrateText is supplied, legacy hosted passages are hydrated with the
// canonical reader edition so displayed snippets always match BibleReader verbatim.
export async function attachVerseRanges<T extends SearchResult>(
  results: T[],
  options: AttachVerseRangeOptions = {}
): Promise<T[]> {
  const needsLookup = results.some((r) => !r.verseStart)
  const index = needsLookup ? await loadVerseRangeIndex() : null

  return results.map((result) => {
    let verseStart = result.verseStart
    let verseEnd = result.verseEnd
    if (!verseStart && index) {
      const range = findVerseRange(index, result.book, result.chapter, result.content)
      if (range) {
        verseStart = range.verseStart
        verseEnd = range.verseEnd
      }
    }

    if (!verseStart) return result

    const resolvedEnd = verseEnd ?? verseStart
    const canonicalText = options.hydrateText?.(
      result.book,
      result.chapter,
      verseStart,
      resolvedEnd
    )

    return {
      ...result,
      verseStart,
      verseEnd: resolvedEnd,
      ...(canonicalText ? { content: canonicalText } : {}),
    }
  })
}
