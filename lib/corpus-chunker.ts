import { BOOK_MAPPING, NEW_TESTAMENT_BOOKS } from "./bible-constants.ts"
import type { BibleVerse } from "./bible-types.ts"

export const CHUNK_MAX_CHARS = 900
export const CHUNK_OVERLAP_VERSES = 1

export interface ParsedSourceVerse {
  verse: number
  text: string | null
}

export interface CanonicalChunk {
  book: string
  bookFullName: string
  chapter: number
  testament: "OT" | "NT"
  verseStart: number
  verseEnd: number
  content: string
}

const NT_SET = new Set<string>(NEW_TESTAMENT_BOOKS)

export function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
}

// Parses eBible.org VPL XML (<v b="GEN" c="1" v="1">...</v> or self-closing <v ... />)
// preserving exact file order and returning null for empty text-critical verse slots.
export function parseVplXml(xml: string): Map<string, ParsedSourceVerse[]> {
  const chapters = new Map<string, ParsedSourceVerse[]>()
  const pattern = /<v b="([^"]+)" c="(\d+)" v="(\d+)"\s*(?:\/>|>([\s\S]*?)<\/v>)/g
  for (const match of xml.matchAll(pattern)) {
    const key = `${match[1].toLowerCase()}:${Number(match[2])}`
    if (!chapters.has(key)) chapters.set(key, [])
    const raw = match[4]
    const decoded = raw === undefined ? null : decodeXmlEntities(raw).trim()
    chapters.get(key)!.push({
      verse: Number(match[3]),
      text: decoded && decoded.length > 0 ? decoded : null,
    })
  }
  return chapters
}

// Deterministic verse-aware chunking with configurable overlap.
// Skips empty verse slots (never emits Python's literal "None") and never splits a verse.
export function chunkChapterVerses(
  verses: ParsedSourceVerse[],
  options: { maxChars?: number; overlapVerses?: number } = {}
): Array<{ verseStart: number; verseEnd: number; content: string }> {
  const maxChars = options.maxChars ?? CHUNK_MAX_CHARS
  const overlapVerses = options.overlapVerses ?? CHUNK_OVERLAP_VERSES

  const nonEmpty = verses
    .filter((v): v is { verse: number; text: string } => typeof v.text === "string" && v.text.trim().length > 0)
    .map((v) => ({ verse: v.verse, text: v.text.trim() }))

  const chunks: Array<{ verseStart: number; verseEnd: number; content: string }> = []
  const n = nonEmpty.length
  let i = 0

  while (i < n) {
    let end = i
    let curLen = 0
    while (end < n) {
      const addLen = nonEmpty[end].text.length + (end > i ? 1 : 0)
      if (end > i && curLen + addLen > maxChars) {
        break
      }
      curLen += addLen
      end += 1
    }

    const slice = nonEmpty.slice(i, end)
    chunks.push({
      verseStart: slice[0].verse,
      verseEnd: slice[slice.length - 1].verse,
      content: slice.map((v) => v.text).join("\n"),
    })

    if (end >= n) break

    const stepBack = Math.min(overlapVerses, end - i - 1)
    const nextI = end - stepBack
    i = nextI > i ? nextI : end
  }

  return chunks
}

export function buildCanonicalChunksFromVerses(
  verses: BibleVerse[],
  options: { maxChars?: number; overlapVerses?: number } = {}
): CanonicalChunk[] {
  const byChapter = new Map<string, { book: string; chapter: number; verses: ParsedSourceVerse[] }>()
  for (const v of verses) {
    const book = v.b.toLowerCase()
    const chapter = Number(v.c)
    const verse = Number(v.v)
    const key = `${book}:${chapter}`
    if (!byChapter.has(key)) {
      byChapter.set(key, { book, chapter, verses: [] })
    }
    const text = v.text?.trim() || null
    byChapter.get(key)!.verses.push({ verse, text })
  }

  const chunks: CanonicalChunk[] = []
  for (const { book, chapter, verses: chapterVerses } of byChapter.values()) {
    chapterVerses.sort((a, b) => a.verse - b.verse)
    const bookFullName = BOOK_MAPPING[book] || book.toUpperCase()
    const testament: "OT" | "NT" = NT_SET.has(book) ? "NT" : "OT"
    for (const chunk of chunkChapterVerses(chapterVerses, options)) {
      chunks.push({
        book,
        bookFullName,
        chapter,
        testament,
        verseStart: chunk.verseStart,
        verseEnd: chunk.verseEnd,
        content: chunk.content,
      })
    }
  }
  return chunks
}

export function formatEmbeddingHeader(
  bookFullName: string,
  chapter: number,
  verseStart: number,
  verseEnd: number
): string {
  const range = verseEnd !== verseStart ? `${verseStart}-${verseEnd}` : `${verseStart}`
  return `${bookFullName} ${chapter}:${range}`
}
