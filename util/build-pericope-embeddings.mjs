#!/usr/bin/env node
// Builds compact int8-quantized multilingual contextual pericope embeddings for all 4,421
// pericopes in public/data/pericopes.json paired with verbatim canonical WEB verses from
// engwebp_vpl.xml. Never alters Scripture text; outputs:
//   - public/data/pericope-embeddings.bin   (~4.3 MB flat binary: header + float32 scales + int8 vectors)
//   - public/data/pericope-embeddings.meta.json (provenance, quantization audit, cost math)
//
// Usage:
//   OPENAI_API_KEY=... node util/build-pericope-embeddings.mjs [--model text-embedding-3-large] [--dims 1024]

import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const PERICOPES_PATH = path.join(ROOT, "public", "data", "pericopes.json")
const XML_PATH = path.join(ROOT, "engwebp_vpl.xml")
const OUT_BIN_PATH = path.join(ROOT, "public", "data", "pericope-embeddings.bin")
const OUT_META_PATH = path.join(ROOT, "public", "data", "pericope-embeddings.meta.json")

const MAGIC = Buffer.from("BPE1", "ascii")
const DEFAULT_MODEL = "text-embedding-3-large"
const DEFAULT_DIMS = 1024
const DEFAULT_BATCH_SIZE = 96
const DEFAULT_CONCURRENCY = 4
const PRICE_PER_MILLION_TOKENS = {
  "text-embedding-3-large": 0.13,
  "text-embedding-3-small": 0.02,
}

const BOOK_FULL_NAMES = {
  gen: "Genesis", exo: "Exodus", lev: "Leviticus", num: "Numbers", deu: "Deuteronomy",
  jos: "Joshua", jdg: "Judges", rut: "Ruth", "1sa": "1 Samuel", "2sa": "2 Samuel",
  "1ki": "1 Kings", "2ki": "2 Kings", "1ch": "1 Chronicles", "2ch": "2 Chronicles",
  ezr: "Ezra", neh: "Nehemiah", est: "Esther", job: "Job", psa: "Psalms",
  pro: "Proverbs", ecc: "Ecclesiastes", sng: "Song of Solomon", isa: "Isaiah",
  jer: "Jeremiah", lam: "Lamentations", ezk: "Ezekiel", dan: "Daniel", hos: "Hosea",
  jol: "Joel", amo: "Amos", oba: "Obadiah", jon: "Jonah", mic: "Micah", nam: "Nahum",
  hab: "Habakkuk", zep: "Zephaniah", hag: "Haggai", zec: "Zechariah", mal: "Malachi",
  mat: "Matthew", mrk: "Mark", luk: "Luke", jhn: "John", act: "Acts", rom: "Romans",
  "1co": "1 Corinthians", "2co": "2 Corinthians", gal: "Galatians", eph: "Ephesians",
  php: "Philippians", col: "Colossians", "1th": "1 Thessalonians", "2th": "2 Thessalonians",
  "1ti": "1 Timothy", "2ti": "2 Timothy", tit: "Titus", phm: "Philemon", heb: "Hebrews",
  jas: "James", "1pe": "1 Peter", "2pe": "2 Peter", "1jn": "1 John", "2jn": "2 John",
  "3jn": "3 John", jud: "Jude", rev: "Revelation",
}

function parseArgs(argv) {
  const args = { model: DEFAULT_MODEL, dims: DEFAULT_DIMS, batchSize: DEFAULT_BATCH_SIZE, concurrency: DEFAULT_CONCURRENCY }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--model" && argv[i + 1]) args.model = argv[++i]
    else if (argv[i] === "--dims" && argv[i + 1]) args.dims = Number(argv[++i])
    else if (argv[i] === "--batch" && argv[i + 1]) args.batchSize = Number(argv[++i])
    else if (argv[i] === "--concurrency" && argv[i + 1]) args.concurrency = Number(argv[++i])
  }
  return args
}

function decodeXmlEntities(value) {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
}

function parseVplChapters(xmlText) {
  const chapters = new Map()
  const pattern = /<v b="([^"]+)" c="(\d+)" v="(\d+)"\s*(?:\/>|>([\s\S]*?)<\/v>)/g
  for (const m of xmlText.matchAll(pattern)) {
    const key = `${m[1].toLowerCase()}:${Number(m[2])}`
    if (!chapters.has(key)) chapters.set(key, [])
    const decoded = m[4] === undefined ? null : decodeXmlEntities(m[4]).trim()
    chapters.get(key).push({
      verse: Number(m[3]),
      text: decoded && decoded.length > 0 ? decoded : null,
    })
  }
  return chapters
}

export function buildContextualPericopeText(pericope, chaptersMap) {
  const book = String(pericope.book).toLowerCase()
  const bookFullName = BOOK_FULL_NAMES[book] || book.toUpperCase()
  const chapter = Number(pericope.chapter)
  const vs = Number(pericope.verseStart)
  const ve = Number(pericope.verseEnd)
  const range = ve !== vs ? `${vs}-${ve}` : `${vs}`

  const chapterVerses = chaptersMap.get(`${book}:${chapter}`) || []
  const canonicalVerses = chapterVerses
    .filter((v) => v.verse >= vs && v.verse <= ve && v.text !== null)
    .map((v) => v.text)
    .join("\n")

  const altTitles = (pericope.altTitles || []).filter(Boolean).join(", ")
  const nonNarratorSpeakers = (pericope.speakers || []).filter((s) => s && s.toLowerCase() !== "narrator")
  const speakers = (nonNarratorSpeakers.length > 0 ? nonNarratorSpeakers : pericope.speakers || [])
    .filter(Boolean)
    .join(", ")
  const bridges = (pericope.lexicalBridges || []).filter(Boolean).join(", ")
  const questions = (pericope.seekerQueries || []).filter(Boolean).join("; ")

  const headerParts = [
    `${bookFullName} ${chapter}:${range} — ${pericope.title || ""}${altTitles ? ` (${altTitles})` : ""}`,
  ]
  if (speakers) headerParts.push(`Speakers: ${speakers}`)
  if (bridges) headerParts.push(`Bridges: ${bridges}`)
  if (questions) headerParts.push(`Questions: ${questions}`)

  return `${headerParts.join(" | ")}\n${canonicalVerses}`
}

function l2Normalize(vec) {
  let sumSq = 0
  for (let i = 0; i < vec.length; i++) sumSq += vec[i] * vec[i]
  const invNorm = sumSq > 0 ? 1 / Math.sqrt(sumSq) : 1
  const out = new Float32Array(vec.length)
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] * invNorm
  return out
}

function quantizeUnitVectorInt8(unitVec) {
  let maxAbs = 0
  for (let i = 0; i < unitVec.length; i++) {
    const a = Math.abs(unitVec[i])
    if (a > maxAbs) maxAbs = a
  }
  const scale = maxAbs > 0 ? maxAbs / 127 : 1 / 127
  const invScale = 1 / scale
  const q = new Int8Array(unitVec.length)
  for (let i = 0; i < unitVec.length; i++) {
    const v = Math.round(unitVec[i] * invScale)
    q[i] = v > 127 ? 127 : v < -127 ? -127 : v
  }
  return { scale, quantized: q }
}

async function fetchOpenAiEmbeddings(apiKey, model, dimensions, inputs, attempt = 1) {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, dimensions, input: inputs }),
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => "")
    if ((response.status === 429 || response.status >= 500) && attempt <= 5) {
      const delayMs = Math.min(15000, 1000 * Math.pow(2, attempt - 1))
      await new Promise((r) => setTimeout(r, delayMs))
      return fetchOpenAiEmbeddings(apiKey, model, dimensions, inputs, attempt + 1)
    }
    throw new Error(`OpenAI embeddings error ${response.status}: ${errText.slice(0, 300)}`)
  }

  const data = await response.json()
  if (!data || !Array.isArray(data.data) || data.data.length !== inputs.length) {
    throw new Error("Malformed OpenAI embeddings response")
  }
  data.data.sort((a, b) => a.index - b.index)
  return {
    vectors: data.data.map((d) => l2Normalize(d.embedding)),
    tokens: Number(data.usage?.total_tokens ?? 0),
  }
}

async function verifyQuantizationFidelity(apiKey, model, dims, floatVectors, scales, int8Flat) {
  const probes = [
    "What lessons can we learn from the Prodigal Son?",
    "What did Jesus say about eternal life?",
    "What does Paul say about love in his letters to the Corinthians?",
    "A guy who beats up his enemies with a donkeyhide cheek",
    "Is there a proverb with a pile of bones?",
    "What prophet sat under a tree asking God to die?",
    "What is the hidden manna?",
    "Which proverb verse teaches not to gossip",
    "Was Adam with Eve when she spoke to the serpent?",
    "Who was the wife of Cain?",
    "Where does it say to be quick to hear and slow to speak?",
    "A man asks what counts as a neighbor and a stranger helps",
    "Who got advice from his father-in-law to delegate judging disputes?",
    "A king's feast ends after writing appears on a wall",
    "هل قال المسيح انا هو الله؟",
    "Explicación de la parábola del hijo pródigo",
    "Que dijo Jesús sobre las pruebas?",
    "亚伯拉罕愿意牺牲自己的儿子如何理解其中的伦理议题？",
    "O quê Jesus fala sobre prosperidade",
    "Where is the slave Onesimus welcomed back as a brother?",
  ]

  const { vectors: qVecs, tokens: probeTokens } = await fetchOpenAiEmbeddings(apiKey, model, dims, probes)
  const count = floatVectors.length
  let overlapSum = 0
  let top1Exact = 0
  let maxScoreAbsErr = 0

  for (const q of qVecs) {
    const fScores = new Array(count)
    const iScores = new Array(count)
    for (let i = 0; i < count; i++) {
      const fv = floatVectors[i]
      const base = i * dims
      const scale = scales[i]
      let dotF = 0
      let dotI = 0
      for (let d = 0; d < dims; d++) {
        dotF += q[d] * fv[d]
        dotI += q[d] * int8Flat[base + d]
      }
      const scoreI = dotI * scale
      const err = Math.abs(dotF - scoreI)
      if (err > maxScoreAbsErr) maxScoreAbsErr = err
      fScores[i] = { i, s: dotF }
      iScores[i] = { i, s: scoreI }
    }
    fScores.sort((a, b) => b.s - a.s)
    iScores.sort((a, b) => b.s - a.s)

    if (fScores[0].i === iScores[0].i) top1Exact += 1
    const top10F = new Set(fScores.slice(0, 10).map((x) => x.i))
    let shared = 0
    for (const x of iScores.slice(0, 10)) {
      if (top10F.has(x.i)) shared += 1
    }
    overlapSum += shared / 10
  }

  return {
    probeCount: probes.length,
    probeTokens,
    top1ExactMatchRate: Number((top1Exact / probes.length).toFixed(4)),
    top10OverlapRate: Number((overlapSum / probes.length).toFixed(4)),
    maxCosineAbsError: Number(maxScoreAbsErr.toFixed(6)),
  }
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.error("ERROR: OPENAI_API_KEY is required")
    process.exit(1)
  }

  const args = parseArgs(process.argv.slice(2))
  const pericopesRaw = fs.readFileSync(PERICOPES_PATH, "utf8")
  const xmlRaw = fs.readFileSync(XML_PATH, "utf8")
  const atlas = JSON.parse(pericopesRaw)
  const chaptersMap = parseVplChapters(xmlRaw)

  const pericopes = atlas.pericopes
  if (!Array.isArray(pericopes) || pericopes.length === 0) {
    throw new Error("public/data/pericopes.json has no pericopes array")
  }

  const contextualTexts = pericopes.map((p) => buildContextualPericopeText(p, chaptersMap))
  console.log(
    `Embedding ${pericopes.length} contextual pericopes with ${args.model} (${args.dims}d, batch=${args.batchSize}, concurrency=${args.concurrency})...`
  )

  const batches = []
  for (let start = 0; start < contextualTexts.length; start += args.batchSize) {
    batches.push({ start, texts: contextualTexts.slice(start, start + args.batchSize) })
  }

  const floatVectors = new Array(pericopes.length)
  let totalTokens = 0
  let completedBatches = 0
  const startedAt = Date.now()

  let nextIdx = 0
  async function worker() {
    while (true) {
      const idx = nextIdx++
      if (idx >= batches.length) break
      const batch = batches[idx]
      const { vectors, tokens } = await fetchOpenAiEmbeddings(apiKey, args.model, args.dims, batch.texts)
      for (let j = 0; j < vectors.length; j++) {
        floatVectors[batch.start + j] = vectors[j]
      }
      totalTokens += tokens
      completedBatches += 1
      if (completedBatches % 10 === 0 || completedBatches === batches.length) {
        const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
        console.log(`  [${completedBatches}/${batches.length}] batches done (${totalTokens.toLocaleString()} tokens, ${elapsed}s)`)
      }
    }
  }

  await Promise.all(Array.from({ length: args.concurrency }, () => worker()))

  // Quantize to per-vector scaled int8 binary:
  // Header (16 bytes): magic "BPE1" (4) + count uint32LE (4) + dims uint32LE (4) + flags uint32LE (4)
  // Scales (count * 4 bytes): Float32Array
  // Vectors (count * dims bytes): Int8Array
  const count = pericopes.length
  const dims = args.dims
  const scales = new Float32Array(count)
  const int8Flat = new Int8Array(count * dims)

  for (let i = 0; i < count; i++) {
    const { scale, quantized } = quantizeUnitVectorInt8(floatVectors[i])
    scales[i] = scale
    int8Flat.set(quantized, i * dims)
  }

  console.log("Verifying int8 vs float32 retrieval fidelity on 20 multilingual + pastoral probes...")
  const fidelity = await verifyQuantizationFidelity(apiKey, args.model, dims, floatVectors, scales, int8Flat)
  console.log("Quantization audit:", fidelity)
  if (fidelity.top10OverlapRate < 0.98) {
    throw new Error(`Quantization fidelity below 0.98 threshold: ${fidelity.top10OverlapRate}`)
  }

  const header = Buffer.alloc(16)
  MAGIC.copy(header, 0)
  header.writeUInt32LE(count, 4)
  header.writeUInt32LE(dims, 8)
  header.writeUInt32LE(1, 12) // flags=1 => per-vector float32 scale + symmetric int8

  const scalesBuf = Buffer.from(scales.buffer, scales.byteOffset, scales.byteLength)
  const vectorsBuf = Buffer.from(int8Flat.buffer, int8Flat.byteOffset, int8Flat.byteLength)
  const binBuffer = Buffer.concat([header, scalesBuf, vectorsBuf])
  fs.writeFileSync(OUT_BIN_PATH, binBuffer)

  const pricePerMillion = PRICE_PER_MILLION_TOKENS[args.model] ?? 0.13
  const buildCostUsd = Number(((totalTokens / 1_000_000) * pricePerMillion).toFixed(4))
  const estimatedCostPer1kQueriesUsd = Number(((20 * 1000 / 1_000_000) * pricePerMillion).toFixed(4))

  const meta = {
    version: 1,
    format: "BPE1",
    quantization: "per-vector-symmetric-int8",
    provider: "openai",
    model: args.model,
    dimensions: dims,
    count,
    binaryBytes: binBuffer.length,
    pericopesSha256: createHash("sha256").update(pericopesRaw, "utf8").digest("hex"),
    sourceXmlSha256: createHash("sha256").update(xmlRaw, "utf8").digest("hex"),
    binSha256: createHash("sha256").update(binBuffer).digest("hex"),
    template: "{BookFullName} {chapter}:{verseStart}-{verseEnd} — {title} ({altTitles}) | Speakers: {speakers} | Bridges: {lexicalBridges} | Questions: {seekerQueries}\\n{canonical WEB verses}",
    buildUsage: {
      totalTokens,
      pricePerMillionTokensUsd: pricePerMillion,
      oneTimeBuildCostUsd: buildCostUsd,
      estimatedRuntimeCostPer1kQueriesUsd: estimatedCostPer1kQueriesUsd,
      elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
    },
    quantizationAudit: fidelity,
  }

  fs.writeFileSync(OUT_META_PATH, JSON.stringify(meta, null, 2) + "\n", "utf8")
  console.log(`Wrote ${OUT_BIN_PATH} (${(binBuffer.length / (1024 * 1024)).toFixed(2)} MB) and ${OUT_META_PATH}`)
  console.log(`Total tokens: ${totalTokens.toLocaleString()} | One-time cost: $${buildCostUsd} | Runtime: ~$${estimatedCostPer1kQueriesUsd}/1k queries`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
