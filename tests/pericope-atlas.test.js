import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { BOOKS } from "../lib/bible-constants.ts"
import { BibleBm25Index, fuseHybridResults } from "../lib/bm25-search.ts"
import { buildCanonicalChunksFromVerses, parseVplXml } from "../lib/corpus-chunker.ts"
import { buildPericopeChapterMap, findOverlappingPericopes } from "../lib/pericope-atlas.ts"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const xmlText = readFileSync(path.join(ROOT, "engwebp_vpl.xml"), "utf8")
const chaptersMap = parseVplXml(xmlText)
const atlas = JSON.parse(readFileSync(path.join(ROOT, "public", "data", "pericopes.json"), "utf8"))
const pericopeMap = buildPericopeChapterMap(atlas.pericopes)

const verses = []
for (const [key, list] of chaptersMap) {
  const [b, c] = key.split(":")
  for (const v of list) {
    if (v.text !== null) {
      verses.push({ b: b.toUpperCase(), c, v: String(v.verse), text: v.text })
    }
  }
}
const chunks = buildCanonicalChunksFromVerses(verses)
const bm25WithAtlas = new BibleBm25Index(chunks, atlas.pericopes)

test("pericopes.json covers 100% of all 66 books, 1,189 chapters, and 31,103 verse slots contiguously with zero gaps or overlaps", () => {
  assert.ok(Array.isArray(atlas.pericopes) && atlas.pericopes.length > 2000)

  const booksSeen = new Set()
  const coveredSlots = new Set()
  const errors = []

  for (const [key, chVerses] of chaptersMap) {
    const [book, chStr] = key.split(":")
    const chapter = Number(chStr)
    const maxV = chVerses[chVerses.length - 1].verse
    booksSeen.add(book)

    const list = pericopeMap.get(key)
    if (!list || list.length === 0) {
      errors.push(`Missing chapter ${key}`)
      continue
    }
    if (list[0].verseStart !== 1) {
      errors.push(`${key}: first verseStart=${list[0].verseStart} !== 1`)
    }
    if (list[list.length - 1].verseEnd !== maxV) {
      errors.push(`${key}: last verseEnd=${list[list.length - 1].verseEnd} !== ${maxV}`)
    }
    for (let i = 0; i < list.length; i++) {
      const p = list[i]
      if (!Number.isInteger(p.verseStart) || !Number.isInteger(p.verseEnd)) {
        errors.push(`${key}[${i}]: non-integer verse bounds`)
      }
      if (p.verseStart < 1 || p.verseEnd > maxV || p.verseStart > p.verseEnd) {
        errors.push(`${key}[${i}]: invalid bounds ${p.verseStart}-${p.verseEnd} (max ${maxV})`)
      }
      if (i > 0 && p.verseStart !== list[i - 1].verseEnd + 1) {
        errors.push(`${key}[${i}]: gap/overlap ${list[i - 1].verseEnd} -> ${p.verseStart}`)
      }
      if (typeof p.title !== "string" || p.title.trim().length === 0) {
        errors.push(`${key}[${i}]: missing title`)
      }
      if (!Array.isArray(p.speakers) || p.speakers.length === 0) {
        errors.push(`${key}[${i}]: missing speakers`)
      }
      for (let v = p.verseStart; v <= p.verseEnd; v++) {
        const slot = `${key}:${v}`
        if (coveredSlots.has(slot)) {
          errors.push(`Duplicate verse slot ${slot}`)
        }
        coveredSlots.add(slot)
      }
    }
  }

  assert.equal(booksSeen.size, 66)
  assert.equal(pericopeMap.size, 1189)
  assert.equal(coveredSlots.size, 31103)
  assert.deepEqual(errors, [])
})

test("antagonist, demonic, boastful, and divinely rebuked speeches carry explicit speaker caution", () => {
  const requiredCautions = [
    ["job", 4, 1, 21],
    ["job", 8, 1, 22],
    ["job", 11, 1, 20],
    ["job", 15, 1, 35],
    ["job", 18, 1, 21],
    ["job", 20, 1, 29],
    ["job", 22, 1, 30],
    ["job", 25, 1, 6],
    ["job", 32, 1, 22],
    ["job", 33, 1, 33],
    ["job", 34, 1, 37],
    ["job", 35, 1, 16],
    ["job", 36, 1, 33],
    ["job", 37, 1, 24],
    ["luk", 4, 1, 13],
    ["luk", 4, 33, 35],
    ["mat", 4, 1, 11],
    ["gen", 3, 1, 5],
    ["gen", 4, 23, 24],
  ]

  const missing = []
  for (const [book, chapter, vs, ve] of requiredCautions) {
    const overlapping = findOverlappingPericopes(pericopeMap, book, chapter, vs, ve)
    const hasCaution = overlapping.some(
      (p) => typeof p.caution === "string" && p.caution.trim().length > 10
    )
    if (!hasCaution) {
      missing.push(`${book} ${chapter}:${vs}-${ve}`)
    }
  }
  assert.deepEqual(missing, [], `Missing speaker caution on: ${missing.join(", ")}`)
})

test("key traditional biblical pericope titles and altTitles are verified present", () => {
  const checks = [
    { book: "luk", chapter: 15, vs: 11, ve: 32, pattern: /prodigal son/i, label: "Prodigal Son (luk 15:11-32)" },
    { book: "mat", chapter: 5, vs: 1, ve: 12, pattern: /beatitudes/i, label: "Beatitudes (mat 5:1-12)" },
    { book: "mat", chapter: 5, vs: 1, ve: 48, pattern: /sermon on the mount/i, label: "Sermon on the Mount (mat 5)" },
    { book: "mat", chapter: 6, vs: 1, ve: 34, pattern: /sermon on the mount/i, label: "Sermon on the Mount (mat 6)" },
    { book: "mat", chapter: 7, vs: 1, ve: 29, pattern: /sermon on the mount/i, label: "Sermon on the Mount (mat 7)" },
    { book: "luk", chapter: 10, vs: 25, ve: 37, pattern: /good samaritan/i, label: "Good Samaritan (luk 10:25-37)" },
    { book: "luk", chapter: 24, vs: 13, ve: 35, pattern: /emmaus/i, label: "Road to Emmaus (luk 24:13-35)" },
    { book: "1ki", chapter: 19, vs: 1, ve: 8, pattern: /broom tree|juniper tree/i, label: "Elijah under broom/juniper tree (1ki 19:1-8)" },
    { book: "1co", chapter: 13, vs: 1, ve: 13, pattern: /love|paul/i, label: "Love Chapter / Paul to Corinthians (1co 13:1-13)" },
  ]

  for (const check of checks) {
    const overlapping = findOverlappingPericopes(pericopeMap, check.book, check.chapter, check.vs, check.ve)
    const blob = overlapping
      .map((p) => [p.title, ...(p.altTitles || []), ...(p.speakers || []), ...(p.lexicalBridges || [])].join(" "))
      .join(" ")
    assert.match(blob, check.pattern, `Expected traditional title match for ${check.label}`)
  }

  // Also ensure 1co 13 explicitly lists Paul as speaker
  const cor13 = findOverlappingPericopes(pericopeMap, "1co", 13, 1, 13)
  assert.ok(
    cor13.some((p) => p.speakers.some((s) => /paul/i.test(s))),
    "Expected Paul in speakers for 1 Corinthians 13"
  )
})

test("pericope-enriched BM25 recalls Prodigal Son, 1 Cor 13, Elijah, Good Samaritan, and Emmaus while preserving abstention", () => {
  const prodigalShort = bm25WithAtlas.search("lessons from the Prodigal Son", { limit: 10 })
  assert.ok(prodigalShort.length > 0)
  assert.equal(prodigalShort[0].book, "luk", `Expected luk #1 for Prodigal Son, got ${prodigalShort[0].book} ${prodigalShort[0].chapter}`)
  assert.equal(prodigalShort[0].chapter, 15)

  const corLove = bm25WithAtlas.search("What does Paul say about love in his letters to the Corinthians?", { limit: 10 })
  const corIdx = corLove.findIndex((r) => r.book === "1co" && r.chapter === 13)
  assert.ok(corIdx >= 0 && corIdx < 3, `Expected 1co 13 in top 3 BM25 results, got rank ${corIdx + 1}`)

  const elijah = bm25WithAtlas.search("Elijah under the juniper tree", { limit: 10 })
  assert.ok(elijah.length > 0)
  assert.equal(elijah[0].book, "1ki")
  assert.equal(elijah[0].chapter, 19)
  assert.ok(elijah[0].verseStart <= 8)

  const samaritan = bm25WithAtlas.search("parable of the Good Samaritan", { limit: 10 })
  assert.equal(samaritan[0].book, "luk")
  assert.equal(samaritan[0].chapter, 10)

  const emmaus = bm25WithAtlas.search("Road to Emmaus", { limit: 10 })
  assert.equal(emmaus[0].book, "luk")
  assert.equal(emmaus[0].chapter, 24)

  // Out-of-domain abstention must still hold strictly below 0.45
  for (const negQuery of [
    "What voltage does USB-C Power Delivery use?",
    "How do I reset my Wi-Fi password?",
    "Kubernetes pod CrashLoopBackOff",
    "Que civilizaciones hubo en América antes del diluvio?",
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
    const negBm25 = bm25WithAtlas.search(negQuery, { limit: 20 })
    const fused = fuseHybridResults(negDense, negBm25, { limit: 20 })
    const passing = fused.filter((r) => r.similarity > 0.45)
    assert.deepEqual(passing, [], `Out-of-domain query "${negQuery}" should abstain`)
  }
})

test("chronological-guides.json covers all 365 days cleanly", () => {
  const guidesData = JSON.parse(
    readFileSync(path.join(ROOT, "public", "daily-data", "chronological-guides.json"), "utf8")
  )
  assert.equal(guidesData.guides.length, 365)
  for (let i = 0; i < 365; i++) {
    const g = guidesData.guides[i]
    assert.equal(g.day, i + 1)
    assert.ok(g.title && g.title.length > 3)
    assert.ok(g.historicalContext && g.historicalContext.length > 30)
    assert.ok(g.redemptiveArc && g.redemptiveArc.length > 30)
    assert.ok(Array.isArray(g.keyThemes) && g.keyThemes.length >= 3)
    assert.ok(g.reflectionQuestion && g.reflectionQuestion.length > 15)
  }
})

test("tests/eval-150.json and public/data/cross-references.json have 100% verified canonical references", () => {
  const validBooks = new Set(BOOKS)
  const checkRef = (ref, label) => {
    assert.ok(validBooks.has(ref.book), `${label}: invalid book ${ref.book}`)
    const chVerses = chaptersMap.get(`${ref.book}:${ref.chapter}`)
    assert.ok(chVerses, `${label}: missing chapter ${ref.book} ${ref.chapter}`)
    const maxV = chVerses[chVerses.length - 1].verse
    assert.ok(
      Number.isInteger(ref.verseStart) &&
        Number.isInteger(ref.verseEnd) &&
        ref.verseStart >= 1 &&
        ref.verseEnd >= ref.verseStart &&
        ref.verseEnd <= maxV,
      `${label}: out-of-bounds ${ref.book} ${ref.chapter}:${ref.verseStart}-${ref.verseEnd} (max ${maxV})`
    )
  }

  const evalData = JSON.parse(readFileSync(path.join(ROOT, "tests", "eval-150.json"), "utf8"))
  assert.equal(evalData.queries.length, 150)
  const abstentions = evalData.queries.filter((q) => q.shouldAbstain)
  assert.equal(abstentions.length, 20)
  const speakerTraps = evalData.queries.filter((q) => q.requiresSpeakerCaution)
  assert.ok(speakerTraps.length >= 15)

  // Verify the 4 real Vercel Analytics queries from #63 are included
  const allQueryTexts = evalData.queries.map((q) => q.query)
  assert.ok(allQueryTexts.some((q) => /donkeyhide cheek/i.test(q)), "Missing Samson donkeyhide cheek query")
  assert.ok(allQueryTexts.some((q) => /pile of bones/i.test(q)), "Missing pile of bones query")
  assert.ok(allQueryTexts.some((q) => /John 6.*Jesus body/i.test(q)), "Missing John 6 body query")
  assert.ok(allQueryTexts.some((q) => /civilizaciones.*América.*diluvio/i.test(q)), "Missing Spanish abstention query")

  for (const q of evalData.queries) {
    if (!q.shouldAbstain) {
      assert.ok(q.expectedPassages.length >= 1, `${q.id} must have expectedPassages`)
      for (const p of q.expectedPassages) checkRef(p, `eval ${q.id}`)
    }
  }

  const xrefData = JSON.parse(
    readFileSync(path.join(ROOT, "public", "data", "cross-references.json"), "utf8")
  )
  assert.ok(xrefData.entries.length >= 150, `Expected >= 150 cross-reference entries, got ${xrefData.entries.length}`)
  for (const e of xrefData.entries) {
    assert.ok(e.passages.length >= 2, `xref ${e.id} must link at least 2 passages`)
    for (const p of e.passages) checkRef(p, `xref ${e.id}`)
  }
})
