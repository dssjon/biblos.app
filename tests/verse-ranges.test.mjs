// Run: node --test tests/verse-ranges.test.mjs
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import JSZip from "jszip"
import {
  buildVerseRangeIndex,
  INDEX_FILE,
  loadPassages,
  parseSourceXml,
  serializeIndex,
  SOURCE_FILE,
} from "../util/build-verse-ranges.mjs"
import { findVerseRange, formatVerseRange, normalizePassageText, passageKey } from "../lib/verse-ranges.ts"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const committed = JSON.parse(readFileSync(path.join(ROOT, INDEX_FILE), "utf8"))
const sourceChapters = parseSourceXml(readFileSync(path.join(ROOT, SOURCE_FILE), "utf8"))
const passages = await loadPassages(ROOT)

test("committed index matches a fresh build from the source XML and passage archives", async () => {
  const fresh = await buildVerseRangeIndex(ROOT)
  assert.equal(readFileSync(path.join(ROOT, INDEX_FILE), "utf8"), serializeIndex(fresh),
    "Index is stale. Run: node util/build-verse-ranges.mjs")
})

test("every search passage has a verse range and preserves legacy hosted ranges", () => {
  assert.equal(committed.passages, passages.length)
  const missing = passages.filter((p) => !findVerseRange(committed, p.book, p.chapter, p.content))
  assert.deepEqual(missing.map((p) => `${p.book} ${p.chapter}`), [])
  assert.ok(
    committed.legacyRanges && Object.keys(committed.legacyRanges).length > 5000,
    "Expected legacyRanges to remain populated for backwards compatibility with hosted API"
  )
})

test("each range's verses, word for word, are exactly the passage text", () => {
  const mismatches = []
  for (const { book, chapter, content } of passages) {
    const { verseStart, verseEnd } = findVerseRange(committed, book, chapter, content)
    const verseText = sourceChapters
      .get(`${book}:${chapter}`)
      .filter((v) => v.verse >= verseStart && v.verse <= verseEnd && v.text !== null)
      .map((v) => v.text)
      .join(" ")
    if (normalizePassageText(verseText) !== normalizePassageText(content)) {
      mismatches.push(`${book} ${chapter}:${verseStart}-${verseEnd}`)
    }
  }
  assert.deepEqual(mismatches, [])
})

test("every highlighted verse exists in the reader's edition", async () => {
  const zip = await JSZip.loadAsync(readFileSync(path.join(ROOT, "public", "data", "bible.zip")))
  const readerChapters = parseSourceXml(await zip.file("bible.xml").async("string"))
  const missing = []
  for (const key of Object.keys(committed.ranges)) {
    const [book, chapter] = key.split(":")
    const [start, end] = committed.ranges[key]
    const verses = new Set((readerChapters.get(`${book}:${chapter}`) ?? []).map((v) => v.verse))
    if (!verses.has(start) || !verses.has(end)) missing.push(`${book} ${chapter}:${start}-${end}`)
  }
  assert.deepEqual(missing, [])
})

test("known passages resolve to the expected verses", () => {
  const rangesContaining = (book, chapter, verse) => {
    const hits = passages
      .filter((p) => p.book === book && p.chapter === chapter)
      .map((p) => findVerseRange(committed, p.book, p.chapter, p.content))
      .filter((r) => r.verseStart <= verse && verse <= r.verseEnd)
    assert.ok(
      hits.length >= 1 && hits.length <= 2,
      `${book} ${chapter}:${verse} should appear in 1 or 2 overlapping passages, got ${hits.length}`
    )
    return hits[0]
  }
  assert.deepEqual(rangesContaining("psa", 23, 1), { verseStart: 1, verseEnd: 6 })
  for (const [book, chapter, verse] of [["jhn", 11, 35], ["gen", 41, 1], ["jas", 1, 19], ["psa", 46, 10], ["act", 8, 36]]) {
    const range = rangesContaining(book, chapter, verse)
    assert.ok(range.verseEnd - range.verseStart < 25, `${book} ${chapter} range should be a passage, not a chapter`)
  }
})

test("lookup ignores whitespace and case differences but not text differences", () => {
  const { book, chapter, content } = passages.find((p) => p.book === "jhn" && p.chapter === 11 && p.content.includes("Jesus wept"))
  const expected = findVerseRange(committed, book, chapter, content)
  assert.ok(expected.verseStart <= 35 && 35 <= expected.verseEnd)
  assert.deepEqual(findVerseRange(committed, "JHN", chapter, `  ${content.replace(/\n/g, " \n ")} `), expected)
  assert.equal(findVerseRange(committed, book, chapter, content.replace("Jesus wept", "Jesus slept")), null)
  assert.equal(findVerseRange(committed, book, chapter + 1, content), null)
  assert.equal(passageKey("JHN", 11, "a  b"), passageKey("jhn", 11, "a b"))
})

test("verse ranges format as references", () => {
  assert.equal(formatVerseRange(16, 18), ":16–18")
  assert.equal(formatVerseRange(35, 35), ":35")
  assert.equal(formatVerseRange(35), ":35")
  assert.equal(formatVerseRange(undefined, undefined), "")
})
