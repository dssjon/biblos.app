// Bible data loading and IndexedDB management
import { openDB, type IDBPDatabase } from 'idb'
import JSZip from 'jszip'
import type { BibleVerse, EmbeddingEntry } from './bible-types'
import { BOOK_MAPPING } from './bible-constants'
import { PERICOPE_ATLAS_URL, type PericopeAtlas, type PericopeEntry } from './pericope-atlas'

let db: IDBPDatabase | null = null

export async function initIndexedDB() {
  if (db) return db

  db = await openDB('bibleDB', 3, {
    upgrade(database, oldVersion) {
      // Clear old cache when upgrading to version 3 (unified canonical WEB overlapping embeddings)
      if (oldVersion < 3) {
        if (database.objectStoreNames.contains('bibleStore')) {
          database.deleteObjectStore('bibleStore')
        }
      }
      if (!database.objectStoreNames.contains('bibleStore')) {
        database.createObjectStore('bibleStore')
      }
    },
  })
  return db
}

export async function getFromIndexedDB(key: string): Promise<any> {
  if (!db) await initIndexedDB()
  return await db!.get('bibleStore', key)
}

export async function saveToIndexedDB(key: string, value: any): Promise<void> {
  if (!db) await initIndexedDB()
  await db!.put('bibleStore', value, key)
}

// Bible verse data (for reading)
let bibleVerses: BibleVerse[] = []

// Static pericope/title/speaker/seeker-query atlas (for 0ms BM25 recall enrichment)
let loadedPericopes: PericopeEntry[] | null = null
let pericopeLoadPromise: Promise<PericopeEntry[] | null> | null = null

export function loadPericopeAtlas(): Promise<PericopeEntry[] | null> {
  if (loadedPericopes) return Promise.resolve(loadedPericopes)
  if (!pericopeLoadPromise) {
    pericopeLoadPromise = fetch(PERICOPE_ATLAS_URL)
      .then((response) => (response.ok ? (response.json() as Promise<PericopeAtlas>) : null))
      .then((atlas) => {
        if (atlas && Array.isArray(atlas.pericopes) && atlas.pericopes.length > 0) {
          loadedPericopes = atlas.pericopes
          return loadedPericopes
        }
        pericopeLoadPromise = null
        return null
      })
      .catch((error) => {
        console.warn("Pericope atlas unavailable; continuing with text-only BM25:", error)
        pericopeLoadPromise = null
        return null
      })
  }
  return pericopeLoadPromise
}

export function getLoadedPericopes(): PericopeEntry[] | null {
  return loadedPericopes
}

// Embedding data (for searching) - keyed by book
let embeddingData: Record<string, EmbeddingEntry[]> = {}

export async function loadInitialBibleData(
  onProgress?: (message: string) => void
): Promise<BibleVerse[]> {
  if (bibleVerses.length > 0) return bibleVerses

  const storageKey = 'initial_bible_data'
  let xmlContent = await getFromIndexedDB(storageKey)

  if (!xmlContent) {
    try {
      onProgress?.("Downloading Bible text...")
      const zipResponse = await fetch('/data/bible.zip')
      if (!zipResponse.ok) throw new Error("Could not fetch bible.zip")

      const blob = await zipResponse.blob()
      const zip = await JSZip.loadAsync(blob)

      const bibleXmlFile = zip.file("bible.xml")
      if (!bibleXmlFile) throw new Error("bible.xml not found in the ZIP file")

      xmlContent = await bibleXmlFile.async("string")
      await saveToIndexedDB(storageKey, xmlContent)
      onProgress?.("Bible text loaded and cached")
    } catch (error) {
      console.error('Error fetching bible.zip:', error)
      throw error
    }
  } else {
    onProgress?.("Loaded Bible text from cache")
  }

  // Parse XML
  const parser = new DOMParser()
  const xmlDoc = parser.parseFromString(xmlContent, "text/xml")
  bibleVerses = Array.from(xmlDoc.getElementsByTagName("v")).map(v => ({
    b: v.getAttribute("b") || "",
    c: v.getAttribute("c") || "",
    v: v.getAttribute("v") || "",
    text: v.textContent?.trim() || ""
  }))

  // Warm the static pericope atlas in the background for BM25 lexical recall
  void loadPericopeAtlas()

  return bibleVerses
}

export function getChapterVerses(book: string, chapter: number): BibleVerse[] {
  return bibleVerses
    .filter(verse =>
      verse.b.toLowerCase() === book.toLowerCase() &&
      verse.c === chapter.toString()
    )
    .sort((a, b) => parseInt(a.v) - parseInt(b.v))
}

export function getLoadedBibleVerses(): BibleVerse[] {
  return bibleVerses
}

export function getVerseRangeText(
  book: string,
  chapter: number,
  verseStart?: number,
  verseEnd?: number
): string | null {
  if (!verseStart || bibleVerses.length === 0) return null
  const end = verseEnd ?? verseStart
  const matched = getChapterVerses(book, chapter)
    .filter((v) => {
      const num = parseInt(v.v, 10)
      return num >= verseStart && num <= end && v.text.trim().length > 0
    })
    .map((v) => v.text.trim())
  return matched.length > 0 ? matched.join("\n") : null
}

export function getChapterCount(book: string): number {
  const chapters = new Set(
    bibleVerses
      .filter(v => v.b.toLowerCase() === book)
      .map(v => parseInt(v.c))
  )
  return Math.max(...Array.from(chapters))
}

export function getBookFullName(abbreviation: string): string {
  return BOOK_MAPPING[abbreviation.toLowerCase()] || abbreviation.toUpperCase()
}

// Load embedding data for specific books
export async function loadEmbeddingData(
  books: string[],
  onProgress?: (message: string) => void,
): Promise<void> {
  const embeddingPath = 'data'
  const storagePrefix = 'bible'

  for (const book of books) {
    if (embeddingData[book]) continue // Already loaded

    onProgress?.(`Loading ${book} embeddings...`)

    const zipFileName = `${book}.zip`
    const zipFilePath = `/${embeddingPath}/${zipFileName}`
    const storageKey = `${storagePrefix}_${book}`

    let fileData = await getFromIndexedDB(storageKey)

    if (!fileData) {
      try {
        const zipResponse = await fetch(zipFilePath)
        if (!zipResponse.ok) throw new Error(`Could not fetch ${zipFilePath}`)

        const blob = await zipResponse.blob()
        const zip = await JSZip.loadAsync(blob)

        const jsonFileName = `${book}.json`
        const jsonFile = zip.file(jsonFileName)

        if (jsonFile) {
          fileData = await jsonFile.async("string")
          await saveToIndexedDB(storageKey, fileData)
        }
      } catch (error) {
        console.error(`Error loading ${book}:`, error)
        continue
      }
    }

    if (fileData) {
      const data = JSON.parse(fileData)
      const entries = Array.isArray(data) ? data : [data]
      embeddingData[book] = entries.filter(entry =>
        isValidEmbedding(entry.embedding)
      )
      onProgress?.(`Loaded ${embeddingData[book].length} entries for ${book}`)
    }
  }
}

export function getEmbeddingData(book: string): EmbeddingEntry[] {
  return embeddingData[book] || []
}

function isValidEmbedding(embedding: any): boolean {
  return (
    Array.isArray(embedding) &&
    embedding.every(num => typeof num === "number" && !isNaN(num) && isFinite(num))
  )
}
