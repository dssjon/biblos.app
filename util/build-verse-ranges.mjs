// Builds public/data/verse-ranges.json: for every search passage in public/data/<book>.zip,
// the first and last verse it covers in the canonical source XML, while preserving
// legacyRanges so un-updated hosted API responses continue resolving verse highlights.
//
//   node util/build-verse-ranges.mjs           write the index
//   node util/build-verse-ranges.mjs --check   fail if the committed index is stale
//
// Re-run whenever engwebp_vpl.xml or the passage archives are regenerated.
import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import JSZip from "jszip"
import { parseVplXml } from "../lib/corpus-chunker.ts"
import { normalizePassageText, passageKey } from "../lib/verse-ranges.ts"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
export const SOURCE_FILE = "engwebp_vpl.xml"
export const INDEX_FILE = path.join("public", "data", "verse-ranges.json")

export function parseSourceXml(xml) {
  return parseVplXml(xml)
}

export async function loadPassages(root = ROOT) {
  const dataDir = path.join(root, "public", "data")
  const passages = []
  const files = readdirSync(dataDir).filter((f) => f.endsWith(".zip") && f !== "bible.zip").sort()
  for (const file of files) {
    const stem = file.slice(0, -4)
    const zip = await JSZip.loadAsync(readFileSync(path.join(dataDir, file)))
    const rows = JSON.parse(await zip.file(`${stem}.json`).async("string"))
    for (const row of rows) {
      passages.push({
        book: stem,
        chapter: row.metadata.chapter,
        verseStart: row.metadata.verseStart,
        verseEnd: row.metadata.verseEnd,
        content: row.content,
      })
    }
  }
  return passages
}

function loadPreservedLegacyRanges(root = ROOT) {
  const indexPath = path.join(root, INDEX_FILE)
  if (!existsSync(indexPath)) return {}
  try {
    const existing = JSON.parse(readFileSync(indexPath, "utf8"))
    if (existing.legacyRanges && Object.keys(existing.legacyRanges).length > 0) {
      return existing.legacyRanges
    }
    // Preserve pre-unification ranges if migrating from a legacy non-overlapping index
    if (existing.ranges && Object.keys(existing.ranges).length > 0) {
      return existing.ranges
    }
  } catch {
    // Ignore malformed existing file when regenerating
  }
  return {}
}

export async function buildVerseRangeIndex(root = ROOT, options = {}) {
  const xml = readFileSync(path.join(root, SOURCE_FILE))
  const chapters = parseSourceXml(xml.toString("utf8"))
  const legacyRanges = options.legacyRanges ?? loadPreservedLegacyRanges(root)

  const layout = new Map()
  for (const [key, verses] of chapters) {
    const nonEmpty = verses.filter((v) => v.text !== null)
    let text = ""
    const spans = nonEmpty.map(({ verse, text: verseText }) => {
      const start = text.length
      text += `${verseText}\n`
      return { verse, start, end: start + verseText.length }
    })
    layout.set(key, { text, spans, verses: nonEmpty })
  }

  const ranges = {}
  const passages = await loadPassages(root)
  for (const { book, chapter, verseStart, verseEnd, content } of passages) {
    const chapterLayout = layout.get(`${book}:${chapter}`)
    if (!chapterLayout) throw new Error(`No source chapter for passage in ${book} ${chapter}`)

    let range
    if (typeof verseStart === "number" && typeof verseEnd === "number") {
      // Verify metadata range matches canonical chapter text word-for-word
      const expectedText = chapterLayout.verses
        .filter((v) => v.verse >= verseStart && v.verse <= verseEnd)
        .map((v) => v.text)
        .join(" ")
      if (normalizePassageText(expectedText) !== normalizePassageText(content)) {
        throw new Error(
          `Metadata verse range mismatch in ${book} ${chapter}:${verseStart}-${verseEnd}`
        )
      }
      range = [verseStart, verseEnd]
    } else {
      const start = chapterLayout.text.indexOf(content)
      if (start < 0) {
        throw new Error(`Passage not found in source text: ${book} ${chapter}: ${content.slice(0, 60)}`)
      }
      const end = start + content.length
      const covered = chapterLayout.spans.filter((s) => s.start < end && s.end > start)
      if (covered.length === 0) throw new Error(`Passage covers no verse text: ${book} ${chapter}`)
      range = [covered[0].verse, covered[covered.length - 1].verse]
    }

    const key = passageKey(book, chapter, content)
    const existing = ranges[key]
    if (existing && (existing[0] !== range[0] || existing[1] !== range[1])) {
      throw new Error(`Hash collision or duplicate passage with different verses: ${key}`)
    }
    ranges[key] = range
  }

  // Only keep legacy entries that do not collide with new canonical hashes
  const cleanLegacy = {}
  for (const [key, value] of Object.entries(legacyRanges)) {
    if (!(key in ranges)) {
      cleanLegacy[key] = value
    }
  }

  return {
    source: SOURCE_FILE,
    sourceSha256: createHash("sha256").update(xml).digest("hex"),
    passages: passages.length,
    ranges,
    legacyRanges: cleanLegacy,
  }
}

export function serializeIndex(index) {
  return `${JSON.stringify(index)}\n`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const index = await buildVerseRangeIndex()
  const outFile = path.join(ROOT, INDEX_FILE)
  const serialized = serializeIndex(index)
  if (process.argv.includes("--check")) {
    const current = readFileSync(outFile, "utf8")
    if (current !== serialized) {
      console.error(`${INDEX_FILE} is out of date. Run: node util/build-verse-ranges.mjs`)
      process.exit(1)
    }
    console.log(`${INDEX_FILE} is current (${index.passages} passages, ${Object.keys(index.legacyRanges).length} legacy entries).`)
  } else {
    writeFileSync(outFile, serialized)
    console.log(`Wrote ${INDEX_FILE} (${index.passages} passages, ${Object.keys(index.legacyRanges).length} legacy entries).`)
  }
}
