// Layer 1 sacred-text invariants: zero-tolerance verification of canonical Scripture,
// edition parity, chunk fidelity, embedding integrity, and daily reading/commentary assets.
// Run: npm run test:sacred
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import JSZip from "jszip"
import {
  CHUNK_MAX_CHARS,
  CHUNK_OVERLAP_VERSES,
  chunkChapterVerses,
  parseVplXml,
} from "../lib/corpus-chunker.ts"
import { normalizePassageText } from "../lib/verse-ranges.ts"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const EXPECTED_BOOK_COUNT = 66
const EXPECTED_CHAPTER_COUNT = 1189
const EXPECTED_VERSE_SLOTS = 31103
const EXPECTED_EMPTY_VERSES = ["luk 17:36", "act 8:37", "act 15:34", "act 24:7", "rom 16:25"]
const UNESCAPED_ENTITY_RE = /&(?:amp|quot|apos|lt|gt|#\d+|#x[0-9a-fA-F]+);/

const rootXmlBuf = readFileSync(path.join(ROOT, "engwebp_vpl.xml"))
const rootXmlText = rootXmlBuf.toString("utf8")
const rootChapters = parseVplXml(rootXmlText)

const bibleZip = await JSZip.loadAsync(readFileSync(path.join(ROOT, "public", "data", "bible.zip")))
const zipXmlText = await bibleZip.file("bible.xml").async("string")

test("canonical XML has exact 66 books, 1,189 chapters, 31,103 verse slots, and monotonic numbering", () => {
  const books = new Set()
  let totalSlots = 0
  const emptyVerses = []
  const orderingErrors = []

  for (const [key, verses] of rootChapters) {
    const [book, chapter] = key.split(":")
    books.add(book)
    let prev = 0
    for (const v of verses) {
      totalSlots += 1
      if (v.verse <= prev) {
        orderingErrors.push(`${book} ${chapter}:${v.verse} after ${prev}`)
      }
      prev = v.verse
      if (v.text === null) {
        emptyVerses.push(`${book} ${chapter}:${v.verse}`)
      }
    }
  }

  assert.equal(books.size, EXPECTED_BOOK_COUNT)
  assert.equal(rootChapters.size, EXPECTED_CHAPTER_COUNT)
  assert.equal(totalSlots, EXPECTED_VERSE_SLOTS)
  assert.deepEqual(orderingErrors, [])
  assert.deepEqual(emptyVerses, EXPECTED_EMPTY_VERSES)
})

test("engwebp_vpl.xml and public/data/bible.zip are 100% identical (zero edition drift)", () => {
  const rootHash = createHash("sha256").update(rootXmlText, "utf8").digest("hex")
  const zipHash = createHash("sha256").update(zipXmlText, "utf8").digest("hex")
  assert.equal(
    rootHash,
    zipHash,
    "engwebp_vpl.xml and public/data/bible.zip must be identical canonical WEBU XML"
  )
})

test("every book archive has verbatim Scripture, zero 'None' artifacts, complete verse coverage, valid overlap, and unit-normalized vectors", async () => {
  const dataDir = path.join(ROOT, "public", "data")
  const bookFiles = readdirSync(dataDir)
    .filter((f) => f.endsWith(".zip") && f !== "bible.zip")
    .sort()

  assert.equal(bookFiles.length, EXPECTED_BOOK_COUNT)

  const coveredVerses = new Set()
  let totalChunks = 0

  for (const file of bookFiles) {
    const book = file.slice(0, -4)
    const zip = await JSZip.loadAsync(readFileSync(path.join(dataDir, file)))
    const rows = JSON.parse(await zip.file(`${book}.json`).async("string"))
    assert.ok(Array.isArray(rows) && rows.length > 0, `${file} must have chunks`)

    const byChapter = new Map()
    for (const row of rows) {
      totalChunks += 1
      const { chapter, verseStart, verseEnd } = row.metadata
      assert.equal(row.metadata.book.toLowerCase(), book)
      assert.equal(typeof chapter, "number")
      assert.equal(typeof verseStart, "number", `${book} ${chapter} chunk missing verseStart`)
      assert.equal(typeof verseEnd, "number", `${book} ${chapter} chunk missing verseEnd`)
      assert.ok(verseStart >= 1 && verseEnd >= verseStart)

      // No Python None artifacts or unescaped XML entities
      const lines = row.content.split("\n")
      assert.equal(
        lines.some((line) => line.trim() === "None"),
        false,
        `${book} ${chapter}:${verseStart}-${verseEnd} contains literal 'None'`
      )
      assert.equal(
        UNESCAPED_ENTITY_RE.test(row.content),
        false,
        `${book} ${chapter}:${verseStart}-${verseEnd} contains unescaped XML entity`
      )

      // Word-for-word match against canonical XML
      const canonicalVerses = rootChapters
        .get(`${book}:${chapter}`)
        .filter((v) => v.verse >= verseStart && v.verse <= verseEnd && v.text !== null)
      assert.ok(canonicalVerses.length > 0)
      const expectedText = canonicalVerses.map((v) => v.text).join(" ")
      assert.equal(
        normalizePassageText(row.content),
        normalizePassageText(expectedText),
        `Text mismatch in ${book} ${chapter}:${verseStart}-${verseEnd}`
      )

      for (const v of canonicalVerses) {
        coveredVerses.add(`${book}:${chapter}:${v.verse}`)
      }

      // Finite, unit-normalized 1024-dim embedding
      assert.equal(row.embedding.length, 1024, `Expected 1024-dim vector in ${book} ${chapter}`)
      let normSq = 0
      for (const val of row.embedding) {
        assert.ok(Number.isFinite(val), `Non-finite embedding value in ${book} ${chapter}`)
        normSq += val * val
      }
      const norm = Math.sqrt(normSq)
      assert.ok(
        Math.abs(norm - 1) < 1e-3,
        `Vector norm ${norm} out of tolerance in ${book} ${chapter}:${verseStart}-${verseEnd}`
      )

      if (!byChapter.has(chapter)) byChapter.set(chapter, [])
      byChapter.get(chapter).push(row)
    }

    // Verify exact chunking consistency and overlap within each chapter
    for (const [chapter, chapterRows] of byChapter) {
      const expectedChunks = chunkChapterVerses(rootChapters.get(`${book}:${chapter}`), {
        maxChars: CHUNK_MAX_CHARS,
        overlapVerses: CHUNK_OVERLAP_VERSES,
      })
      assert.equal(
        chapterRows.length,
        expectedChunks.length,
        `Chunk count mismatch in ${book} ${chapter}`
      )
      for (let i = 1; i < chapterRows.length; i++) {
        assert.ok(
          chapterRows[i].metadata.verseStart <= chapterRows[i - 1].metadata.verseEnd,
          `Missing overlap between adjacent chunks in ${book} ${chapter}`
        )
      }
    }
  }

  // Every non-empty canonical verse must be covered
  let expectedNonEmpty = 0
  const uncovered = []
  for (const [key, verses] of rootChapters) {
    for (const v of verses) {
      if (v.text !== null) {
        expectedNonEmpty += 1
        if (!coveredVerses.has(`${key}:${v.verse}`)) {
          uncovered.push(`${key}:${v.verse}`)
        }
      }
    }
  }

  assert.equal(expectedNonEmpty, EXPECTED_VERSE_SLOTS - EXPECTED_EMPTY_VERSES.length)
  assert.deepEqual(uncovered, [])
  assert.ok(totalChunks > 5500 && totalChunks < 8000, `Unexpected total chunk count: ${totalChunks}`)
})

test("daily reading CSV and Church Father commentary JSON files parse cleanly with required attribution metadata", () => {
  const csv = readFileSync(path.join(ROOT, "public", "daily-data", "readings.csv"), "utf8")
  const rows = csv.trim().split("\n")
  assert.ok(rows.length >= 52, "readings.csv must have at least 52 weekly rows")

  const commentaryDir = path.join(ROOT, "public", "daily-data", "commentaries")
  const jsonFiles = readdirSync(commentaryDir).filter((f) => f.endsWith(".json"))
  assert.ok(jsonFiles.length >= 1000, "expected full patristic commentary corpus")

  const KNOWN_EMPTY_COMMENTARY_STUBS = new Set(["ephesians_chapter_4.json:Ephesians 4_14.toml"])
  let checkedEntries = 0
  const unexpectedEmpty = []
  for (const file of jsonFiles) {
    const parsed = JSON.parse(readFileSync(path.join(commentaryDir, file), "utf8"))
    const entries = Array.isArray(parsed) ? parsed : parsed.commentaries || []
    assert.ok(Array.isArray(entries), `${file} must parse to an array of commentaries`)
    for (const entry of entries) {
      checkedEntries += 1
      assert.ok(
        typeof entry.father_name === "string" && entry.father_name.trim().length > 0,
        `${file} entry missing father_name`
      )
      if (typeof entry.txt !== "string" || entry.txt.trim().length === 0) {
        const stubId = `${file}:${entry.file_name || ""}`
        if (!KNOWN_EMPTY_COMMENTARY_STUBS.has(stubId)) {
          unexpectedEmpty.push(stubId)
        }
      }
    }
  }
  assert.deepEqual(unexpectedEmpty, [], "Unexpected empty commentary entries found")
  assert.ok(checkedEntries > 1000)
})
