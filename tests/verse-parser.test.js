import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { parseVplXml } from "../lib/corpus-chunker.ts"
import {
  BOOK_CHAPTER_VERSE_COUNTS,
  getBookChapterCount,
  getChapterVerseCount,
  looksLikeVerseReference,
  parseVerseReference,
} from "../lib/verse-parser.ts"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

test("BOOK_CHAPTER_VERSE_COUNTS matches canonical engwebp_vpl.xml across all 66 books and 1,189 chapters", () => {
  const xml = readFileSync(path.join(ROOT, "engwebp_vpl.xml"), "utf8")
  const chaptersMap = parseVplXml(xml)

  assert.equal(Object.keys(BOOK_CHAPTER_VERSE_COUNTS).length, 66)

  let totalChapters = 0
  for (const [book, counts] of Object.entries(BOOK_CHAPTER_VERSE_COUNTS)) {
    totalChapters += counts.length
    assert.equal(getBookChapterCount(book), counts.length)
    for (let ch = 1; ch <= counts.length; ch++) {
      const verses = chaptersMap.get(`${book}:${ch}`)
      assert.ok(verses && verses.length > 0, `Missing ${book} ${ch} in XML`)
      const expectedMax = verses[verses.length - 1].verse
      assert.equal(
        getChapterVerseCount(book, ch),
        expectedMax,
        `Verse count mismatch for ${book} ${ch}`
      )
    }
  }
  assert.equal(totalChapters, 1189)
})

test("parses canonical standard verse references and ranges", () => {
  assert.deepEqual(parseVerseReference("John 3:16"), {
    book: "jhn",
    bookFullName: "John",
    chapter: 3,
    verseStart: 16,
  })
  assert.deepEqual(parseVerseReference("1 Corinthians 10:13"), {
    book: "1co",
    bookFullName: "1 Corinthians",
    chapter: 10,
    verseStart: 13,
  })
  assert.deepEqual(parseVerseReference("1 Peter 4:7-11"), {
    book: "1pe",
    bookFullName: "1 Peter",
    chapter: 4,
    verseStart: 7,
    verseEnd: 11,
  })
  assert.deepEqual(parseVerseReference("Psalm 23"), {
    book: "psa",
    bookFullName: "Psalms",
    chapter: 23,
  })
  assert.deepEqual(parseVerseReference("I Timothy 6:10"), {
    book: "1ti",
    bookFullName: "1 Timothy",
    chapter: 6,
    verseStart: 10,
  })
})

test("parses messy real-world punctuation, spacing, dashes, chapter/verse words, and translation suffixes", () => {
  const cases = [
    ["Genesis 32 : 28", { book: "gen", bookFullName: "Genesis", chapter: 32, verseStart: 28 }],
    ["exodus 32 : 25", { book: "exo", bookFullName: "Exodus", chapter: 32, verseStart: 25 }],
    ["joel 2;21-27", { book: "jol", bookFullName: "Joel", chapter: 2, verseStart: 21, verseEnd: 27 }],
    ["1 Cor. 13:4-7", { book: "1co", bookFullName: "1 Corinthians", chapter: 13, verseStart: 4, verseEnd: 7 }],
    ["Matt.24:28", { book: "mat", bookFullName: "Matthew", chapter: 24, verseStart: 28 }],
    ["2 Tim. 3:5", { book: "2ti", bookFullName: "2 Timothy", chapter: 3, verseStart: 5 }],
    ["Luke 24:13–35", { book: "luk", bookFullName: "Luke", chapter: 24, verseStart: 13, verseEnd: 35 }],
    ["Romans 7:17—20", { book: "rom", bookFullName: "Romans", chapter: 7, verseStart: 17, verseEnd: 20 }],
    ["Hebrews Chapter 10:18-23 NIV", { book: "heb", bookFullName: "Hebrews", chapter: 10, verseStart: 18, verseEnd: 23 }],
    ["Hebrews ch. 10:18-23 (ESV)", { book: "heb", bookFullName: "Hebrews", chapter: 10, verseStart: 18, verseEnd: 23 }],
    ["Ezra chapter 3", { book: "ezr", bookFullName: "Ezra", chapter: 3 }],
    ["Acts  chapter 2: 42 to 47", { book: "act", bookFullName: "Acts", chapter: 2, verseStart: 42, verseEnd: 47 }],
    ["Acts  chapter 2 42 to 47", { book: "act", bookFullName: "Acts", chapter: 2, verseStart: 42, verseEnd: 47 }],
    ["Matthew  12 verse 38", { book: "mat", bookFullName: "Matthew", chapter: 12, verseStart: 38 }],
    ["Matthew chapter 12 verse 38", { book: "mat", bookFullName: "Matthew", chapter: 12, verseStart: 38 }],
    ["John 3:16 KJV", { book: "jhn", bookFullName: "John", chapter: 3, verseStart: 16 }],
    ["Rom 8:28 NKJV", { book: "rom", bookFullName: "Romans", chapter: 8, verseStart: 28 }],
    ["Psalm 91:1-2 NLT", { book: "psa", bookFullName: "Psalms", chapter: 91, verseStart: 1, verseEnd: 2 }],
    ["Isaiah 40:31 NASB", { book: "isa", bookFullName: "Isaiah", chapter: 40, verseStart: 31 }],
    ["Proverbs 3:5-6 CSB", { book: "pro", bookFullName: "Proverbs", chapter: 3, verseStart: 5, verseEnd: 6 }],
    ["Genesis 1:1 WEB", { book: "gen", bookFullName: "Genesis", chapter: 1, verseStart: 1 }],
    ["Philippians 4:13 AMP", { book: "php", bookFullName: "Philippians", chapter: 4, verseStart: 13 }],
    ["Matthew 11:28 MSG", { book: "mat", bookFullName: "Matthew", chapter: 11, verseStart: 28 }],
    ["Math 1,1", { book: "mat", bookFullName: "Matthew", chapter: 1, verseStart: 1 }],
  ]

  for (const [input, expected] of cases) {
    assert.equal(looksLikeVerseReference(input), true, `looksLikeVerseReference(${JSON.stringify(input)})`)
    assert.deepEqual(parseVerseReference(input), expected, `parseVerseReference(${JSON.stringify(input)})`)
  }
})

test("parses common user book-name typos and ordinal prefixes cleanly", () => {
  const cases = [
    ["Mathew 28:19", "mat", 28, 19, undefined],
    ["Pslam 23:1-4", "psa", 23, 1, 4],
    ["Revelations 21:4", "rev", 21, 4, undefined],
    ["1 Corinthans 13:4-7", "1co", 13, 4, 7],
    ["1 Corithians 12:1", "1co", 12, 1, undefined],
    ["Phillipians 4:6-7", "php", 4, 6, 7],
    ["Galations 5:22-23", "gal", 5, 22, 23],
    ["Genisis 1:1", "gen", 1, 1, undefined],
    ["Exodous 14:14", "exo", 14, 14, undefined],
    ["Ezekial 37:1-10", "ezk", 37, 1, 10],
    ["Deuteronmy 6:4-5", "deu", 6, 4, 5],
    ["2nd Thessolonians 3:3", "2th", 3, 3, undefined],
    ["1st Thessolonians 5:16-18", "1th", 5, 16, 18],
    ["Hebrew 10:18-23", "heb", 10, 18, 23],
  ]

  for (const [input, book, chapter, verseStart, verseEnd] of cases) {
    const parsed = parseVerseReference(input)
    assert.ok(parsed, `Expected ${JSON.stringify(input)} to parse`)
    assert.equal(parsed.book, book)
    assert.equal(parsed.chapter, chapter)
    assert.equal(parsed.verseStart, verseStart)
    assert.equal(parsed.verseEnd, verseEnd)
  }
})

test("enforces canonical chapter and verse upper bounds so invalid refs return null instead of hanging BibleReader", () => {
  const invalidRefs = [
    "John 99:99",
    "John 22:1",        // John has 21 chapters
    "John 3:37",        // John 3 has 36 verses
    "John 3:16-40",     // verseEnd exceeds 36
    "John 3:20-10",     // reversed range
    "John 0:1",
    "John 3:0",
    "Jude 2",           // Jude has 1 chapter
    "Jude 1:26",        // Jude 1 has 25 verses
    "Philemon 2",       // Philemon has 1 chapter
    "Obadiah 2",        // Obadiah has 1 chapter
    "2 John 2",         // 2 John has 1 chapter
    "3 John 2",         // 3 John has 1 chapter
    "1 John 14",        // 1 John has 5 chapters
    "Acts 42 to 47",    // Acts has 28 chapters
    "Psalm 151",        // Psalms has 150 chapters
    "Psalm 119:177",    // Psalm 119 has 176 verses
  ]

  for (const ref of invalidRefs) {
    assert.equal(parseVerseReference(ref), null, `Expected ${JSON.stringify(ref)} to return null`)
    assert.equal(looksLikeVerseReference(ref), false, `Expected looksLikeVerseReference(${JSON.stringify(ref)}) false`)
  }

  // Boundary maxima must still succeed
  assert.deepEqual(parseVerseReference("Psalm 119:176"), {
    book: "psa",
    bookFullName: "Psalms",
    chapter: 119,
    verseStart: 176,
  })
  assert.deepEqual(parseVerseReference("Jude 1:25"), {
    book: "jud",
    bookFullName: "Jude",
    chapter: 1,
    verseStart: 25,
  })
})

test("does not false-positive on questions, commentary lookups, or chapter-range queries", () => {
  const nonRefs = [
    "",
    "   ",
    "What did Jesus say about eternal life?",
    "What does Ruth 3:3 mean?",
    "What is Bildad saying in Job 8?",
    "Church fathers on Genesis 32 : 28",
    "1 Cor. 4:20 meaning",
    "2 Timothy 3:5 meaning",
    "What are all the statements in John 6 about Jesus body?",
    "Hebrews 1-13",
    "Hebrews 1 - 12",
    "Romans 1&2",
    "5 bread 2 fish",
    "2nd thessolonians",
    "What are the 10 commandments?",
    "Is there a proverb with a pile of bones?",
  ]

  for (const q of nonRefs) {
    assert.equal(parseVerseReference(q), null, `Should NOT parse question/prose: ${JSON.stringify(q)}`)
    assert.equal(looksLikeVerseReference(q), false, `looksLikeVerseReference should be false: ${JSON.stringify(q)}`)
  }
})
