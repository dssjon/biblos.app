// Pericope, Traditional Title, Speaker Attribution & Seeker-Query Atlas helpers.
// Used both client-side (to enrich in-memory BM25 lexical recall at 0ms / $0) and
// server-side (to enrich Voyage rerank-3-lite document headers without altering
// returned canonical Scripture text).
import { BOOK_MAPPING } from "./bible-constants.ts"

export const PERICOPE_ATLAS_URL = "/data/pericopes.json"

export interface PericopeEntry {
  book: string
  chapter: number
  verseStart: number
  verseEnd: number
  title: string
  altTitles: string[]
  genre: string
  speakers: string[]
  addressees: string[]
  speakerNote: string
  caution: string | null
  seekerQueries: string[]
  lexicalBridges: string[]
}

export interface PericopeAtlas {
  version: number
  source: string
  sourceSha256: string
  model: string
  effort: string
  books: number
  chapters: number
  pericopeCount: number
  pericopes: PericopeEntry[]
}

export type PericopeChapterMap = Map<string, PericopeEntry[]>

export function buildPericopeChapterMap(pericopes: PericopeEntry[] | null | undefined): PericopeChapterMap {
  const map: PericopeChapterMap = new Map()
  if (!Array.isArray(pericopes)) return map
  for (const entry of pericopes) {
    if (!entry || typeof entry.book !== "string") continue
    const key = `${entry.book.toLowerCase()}:${Number(entry.chapter)}`
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(entry)
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.verseStart - b.verseStart)
  }
  return map
}

export function findOverlappingPericopes(
  chapterMap: PericopeChapterMap | null | undefined,
  book: string,
  chapter: number,
  verseStart?: number,
  verseEnd?: number
): PericopeEntry[] {
  if (!chapterMap || !book) return []
  const entries = chapterMap.get(`${book.toLowerCase()}:${Number(chapter)}`)
  if (!entries || entries.length === 0) return []

  if (typeof verseStart !== "number" || !Number.isFinite(verseStart)) {
    return entries
  }
  const end = typeof verseEnd === "number" && Number.isFinite(verseEnd) ? verseEnd : verseStart

  const overlapping = entries.filter((p) => p.verseStart <= end && p.verseEnd >= verseStart)
  if (overlapping.length <= 1) return overlapping

  // Sort by descending verse overlap count, breaking ties by earlier verseStart
  return [...overlapping].sort((a, b) => {
    const overlapA = Math.min(a.verseEnd, end) - Math.max(a.verseStart, verseStart) + 1
    const overlapB = Math.min(b.verseEnd, end) - Math.max(b.verseStart, verseStart) + 1
    if (overlapB !== overlapA) return overlapB - overlapA
    return a.verseStart - b.verseStart
  })
}

export function formatPericopeBm25Text(pericopes: PericopeEntry[]): string {
  if (!pericopes || pericopes.length === 0) return ""
  const parts: string[] = []
  const seen = new Set<string>()
  const pushUnique = (val: string | null | undefined) => {
    if (!val) return
    const trimmed = val.trim()
    if (!trimmed) return
    const lower = trimmed.toLowerCase()
    if (seen.has(lower)) return
    seen.add(lower)
    parts.push(trimmed)
  }

  for (const p of pericopes) {
    pushUnique(p.title)
    for (const alt of p.altTitles || []) pushUnique(alt)
    for (const speaker of p.speakers || []) {
      if (speaker.toLowerCase() !== "narrator") pushUnique(speaker)
    }
    for (const q of p.seekerQueries || []) pushUnique(q)
    for (const bridge of p.lexicalBridges || []) pushUnique(bridge)
  }
  return parts.join(" ")
}

export function formatRerankHeader(
  book: string,
  chapter: number,
  verseStart?: number,
  verseEnd?: number,
  pericopes: PericopeEntry[] = []
): string {
  const code = String(book || "").toLowerCase()
  const bookFullName = BOOK_MAPPING[code] || code.toUpperCase()
  const verseRange =
    typeof verseStart === "number" && Number.isFinite(verseStart)
      ? typeof verseEnd === "number" && Number.isFinite(verseEnd) && verseEnd !== verseStart
        ? `:${verseStart}-${verseEnd}`
        : `:${verseStart}`
      : ""

  const base = `${bookFullName} ${chapter}${verseRange}`
  if (!pericopes || pericopes.length === 0) return base

  const primary = pericopes[0]
  const titles: string[] = []
  const seenTitles = new Set<string>()
  for (const p of pericopes.slice(0, 2)) {
    if (p.title && !seenTitles.has(p.title.toLowerCase())) {
      seenTitles.add(p.title.toLowerCase())
      titles.push(p.title)
    }
  }
  // Include a distinctive altTitle (e.g. "Sermon on the Mount", "Love Chapter") when helpful
  for (const alt of primary.altTitles || []) {
    if (titles.length >= 3) break
    if (alt && !seenTitles.has(alt.toLowerCase())) {
      seenTitles.add(alt.toLowerCase())
      titles.push(alt)
    }
  }

  const speakers: string[] = []
  const seenSpeakers = new Set<string>()
  for (const p of pericopes.slice(0, 2)) {
    for (const s of p.speakers || []) {
      if (s && !seenSpeakers.has(s.toLowerCase())) {
        seenSpeakers.add(s.toLowerCase())
        speakers.push(s)
      }
    }
  }

  const metaParts: string[] = []
  if (titles.length > 0) metaParts.push(titles.join(" / "))
  if (speakers.length > 0) metaParts.push(`Speakers: ${speakers.join(", ")}`)

  const caution = pericopes.find((p) => typeof p.caution === "string" && p.caution.trim().length > 0)?.caution
  if (caution) metaParts.push(`Caution: ${caution}`)

  return metaParts.length > 0 ? `${base} [${metaParts.join(" | ")}]` : base
}
