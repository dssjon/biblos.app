// Tests BM25 lexical recall, overlapping canonical chunking, and weighted hybrid RRF fusion.
// Run: node --test tests/bm25-hybrid.test.mjs
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { buildCanonicalChunksFromVerses, parseVplXml } from "../lib/corpus-chunker.ts"
import { BibleBm25Index, fuseHybridResults } from "../lib/bm25-search.ts"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const xml = readFileSync(path.join(ROOT, "engwebp_vpl.xml"), "utf8")
const chapters = parseVplXml(xml)

const verses = []
for (const [key, list] of chapters) {
  const [b, c] = key.split(":")
  for (const v of list) {
    if (v.text !== null) {
      verses.push({ b: b.toUpperCase(), c, v: String(v.verse), text: v.text })
    }
  }
}

const chunks = buildCanonicalChunksFromVerses(verses)
const bm25 = new BibleBm25Index(chunks)

test("overlapping chunks keep Philemon's Onesimus and 'beloved brother' together", () => {
  const phmCombined = chunks.filter(
    (c) =>
      c.book === "phm" &&
      c.content.includes("Onesimus") &&
      c.content.includes("beloved brother")
  )
  assert.ok(
    phmCombined.length >= 1,
    "Expected at least one Philemon chunk containing both Onesimus and beloved brother"
  )
})

test("BM25 recalls exact/cross-translation wording (James 1:19) and named people (Onesimus)", () => {
  const quickToHear = bm25.search("Where does it say to be quick to hear and slow to speak?", { limit: 10 })
  assert.ok(quickToHear.length > 0)
  assert.equal(quickToHear[0].book, "jas")
  assert.equal(quickToHear[0].chapter, 1)
  assert.ok(quickToHear[0].verseStart <= 19 && 19 <= quickToHear[0].verseEnd)

  const onesimus = bm25.search("Where is the slave Onesimus welcomed back as a brother?", { limit: 10 })
  assert.ok(onesimus.length > 0)
  assert.equal(onesimus[0].book, "phm")
  assert.equal(onesimus[0].chapter, 1)
  assert.ok(onesimus[0].verseStart <= 16 && 16 <= onesimus[0].verseEnd)
})

test("BM25 respects book-scoped queries using indexed book/chapter headers", () => {
  const corinthians = bm25.search("What does Paul say about love in his letters to the Corinthians?", { limit: 15 })
  const has1Cor13 = corinthians.some((r) => r.book === "1co" && r.chapter === 13)
  assert.ok(has1Cor13, "Expected 1 Corinthians 13 in top BM25 candidates")
})

test("fuseHybridResults rescues BM25-only exact hits while rejecting unrelated out-of-domain queries", () => {
  // Simulate dense search missing James 1:19 (returning Proverbs + adjacent James 1:22-27)
  const denseMissed = [
    {
      book: "pro",
      chapter: 25,
      testament: "OT",
      content: "Don't be hasty in bringing charges to court.",
      similarity: 0.56,
      verseStart: 8,
      verseEnd: 11,
    },
    {
      book: "jas",
      chapter: 1,
      testament: "NT",
      content: "But be doers of the word, and not only hearers, deluding your own selves.",
      similarity: 0.52,
      verseStart: 22,
      verseEnd: 27,
    },
  ]
  const bm25Hits = bm25.search("Where does it say to be quick to hear and slow to speak?", { limit: 20 })
  const fused = fuseHybridResults(denseMissed, bm25Hits, { limit: 20 })

  const jasIdx = fused.findIndex(
    (r) => r.book === "jas" && r.chapter === 1 && r.verseStart <= 19 && 19 <= r.verseEnd
  )
  assert.ok(jasIdx >= 0 && jasIdx < 3, `Hybrid fusion should rescue James 1:19 into top 3, got rank ${jasIdx + 1}`)
  assert.ok(fused[jasIdx].similarity > 0.45, `Rescued James 1:19 should clear 0.45 cutoff, got ${fused[jasIdx].similarity}`)

  // Out-of-domain negatives with sub-0.45 dense scores must stay strictly below 0.45
  for (const negQuery of [
    "What voltage does USB-C Power Delivery use?",
    "How do I reset my Wi-Fi password?",
    "Kubernetes pod CrashLoopBackOff",
  ]) {
    const negDense = [
      {
        book: "exo",
        chapter: 1,
        testament: "OT",
        content: "Now these are the names of the sons of Israel.",
        similarity: 0.41,
        verseStart: 1,
        verseEnd: 5,
      },
    ]
    const negBm25 = bm25.search(negQuery, { limit: 20 })
    const negFused = fuseHybridResults(negDense, negBm25, { limit: 20 })
    const passing = negFused.filter((r) => r.similarity > 0.45)
    assert.deepEqual(
      passing,
      [],
      `Out-of-domain query "${negQuery}" should not pass 0.45 cutoff`
    )
  }
})
