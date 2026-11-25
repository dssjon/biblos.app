import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { parseVplXml } from "../lib/corpus-chunker.ts"
import {
  calibrateContextualSimilarity,
  fuseContextualAndBm25,
  loadContextualPericopeIndex,
  resetContextualPericopeIndexCache,
  scorePericopeVectors,
  searchPericopeBm25,
} from "../lib/pericope-vector-search.js"
import handler from "../pages/api/search.js"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function createMockRes() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value
    },
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.body = payload
      return this
    },
  }
}

const ENV_KEYS = [
  "BIBLOS_SEARCH_API_URL",
  "OPENAI_API_KEY",
  "OPENAI_EMBED_API_URL",
  "OPENAI_EMBED_MODEL",
  "OPENAI_EMBED_DIMS",
  "OPENAI_EMBED_TIMEOUT_MS",
  "VOYAGE_API_KEY",
  "VOYAGE_API_URL",
  "VOYAGE_RERANK_MODEL",
  "VOYAGE_RERANK_TIMEOUT_MS",
]

function snapshotEnv() {
  const saved = {}
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  return () => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  }
}

test("pericope-embeddings.bin and meta.json match canonical pericopes.json, engwebp_vpl.xml, size budget, and >=98% int8 quantization fidelity", () => {
  const binPath = path.join(ROOT, "public", "data", "pericope-embeddings.bin")
  const metaPath = path.join(ROOT, "public", "data", "pericope-embeddings.meta.json")
  const pericopesPath = path.join(ROOT, "public", "data", "pericopes.json")
  const xmlPath = path.join(ROOT, "engwebp_vpl.xml")

  const binBuf = fs.readFileSync(binPath)
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"))
  const pericopesRaw = fs.readFileSync(pericopesPath, "utf8")
  const xmlRaw = fs.readFileSync(xmlPath, "utf8")

  assert.equal(meta.format, "BPE1")
  assert.equal(meta.count, 4421)
  assert.equal(meta.dimensions, 1024)
  assert.equal(binBuf.length, meta.binaryBytes)
  assert.ok(binBuf.length < 5 * 1024 * 1024, `Binary must stay compact (<5MB), got ${binBuf.length}`)

  assert.equal(
    createHash("sha256").update(binBuf).digest("hex"),
    meta.binSha256,
    "pericope-embeddings.bin SHA-256 mismatch"
  )
  assert.equal(
    createHash("sha256").update(pericopesRaw, "utf8").digest("hex"),
    meta.pericopesSha256,
    "pericopes.json SHA-256 mismatch"
  )
  assert.equal(
    createHash("sha256").update(xmlRaw, "utf8").digest("hex"),
    meta.sourceXmlSha256,
    "engwebp_vpl.xml SHA-256 mismatch"
  )
  assert.ok(
    meta.quantizationAudit.top10OverlapRate >= 0.98,
    `Expected int8 vs float32 top-10 overlap >= 0.98, got ${meta.quantizationAudit.top10OverlapRate}`
  )
})

test("contextual pericope index loads fast, scores all 4,421 pericopes in RAM, and hydrates 100% verbatim canonical WEB Scripture", () => {
  resetContextualPericopeIndexCache()
  const index = loadContextualPericopeIndex()
  assert.ok(index, "Expected contextual pericope index to load")
  assert.equal(index.count, 4421)
  assert.equal(index.dims, 1024)

  // Verify every single pericope's hydrated text matches engwebp_vpl.xml verbatim
  const chaptersMap = parseVplXml(fs.readFileSync(path.join(ROOT, "engwebp_vpl.xml"), "utf8"))
  for (let i = 0; i < index.count; i++) {
    const p = index.pericopes[i]
    const expected = (chaptersMap.get(`${p.book}:${p.chapter}`) || [])
      .filter((v) => v.verse >= p.verseStart && v.verse <= p.verseEnd && v.text !== null)
      .map((v) => v.text)
      .join("\n")
    assert.equal(
      index.canonicalTexts[i],
      expected,
      `Canonical Scripture mismatch at ${p.book} ${p.chapter}:${p.verseStart}-${p.verseEnd}`
    )
    assert.ok(index.canonicalTexts[i].length > 0, `Empty text at ${p.book} ${p.chapter}`)
  }

  // Reconstruct a pericope's own unit vector (Luke 15:11-24 Prodigal Son) and verify it scores #1 cleanly
  const lukIdx = index.pericopes.findIndex(
    (p) => p.book === "luk" && p.chapter === 15 && p.verseStart === 11
  )
  assert.ok(lukIdx >= 0, "Expected Luke 15:11-24 pericope")
  const probeVec = new Float32Array(index.dims)
  const base = lukIdx * index.dims
  const scale = index.scales[lukIdx]
  for (let d = 0; d < index.dims; d++) probeVec[d] = index.vectors[base + d] * scale

  const t0 = performance.now()
  const scored = scorePericopeVectors(probeVec, index, { limit: 10 })
  const elapsedMs = performance.now() - t0

  assert.equal(scored.length, 10)
  assert.equal(scored[0].book, "luk")
  assert.equal(scored[0].chapter, 15)
  assert.equal(scored[0].verseStart, 11)
  assert.equal(scored[0].content, index.canonicalTexts[lukIdx])
  assert.ok(scored[0].similarity > 0.9, `Expected self-match similarity > 0.9, got ${scored[0].similarity}`)
  assert.ok(elapsedMs < 50, `Expected fast in-RAM scoring (<50ms), took ${elapsedMs.toFixed(2)}ms`)

  // Server-side Pericope BM25 recalls Prodigal Son cleanly
  const bm25Hits = searchPericopeBm25("prodigal son", index, { limit: 5 })
  assert.ok(bm25Hits.some((h) => h.book === "luk" && h.chapter === 15))

  // BM25-only abstention guard: stray coincidental keywords on a non-biblical query must stay < 0.45
  const lowDense = [
    { book: "gen", chapter: 43, testament: "OT", content: "Sample", similarity: 0.18, verseStart: 26, verseEnd: 34 },
  ]
  const codingBm25 = searchPericopeBm25("Python pandas dataframe merge inner join", index, { limit: 10 })
  const abstained = fuseContextualAndBm25(lowDense, codingBm25, { limit: 10 })
  assert.equal(
    abstained.filter((r) => r.similarity > 0.45).length,
    0,
    "Non-biblical coding query must abstain (<0.45) despite coincidental 'python'/'inner' tokens"
  )
})

test("calibrateContextualSimilarity is strictly monotonic and separates non-biblical queries (<0.45) from biblical matches (>0.45)", () => {
  // Abstention examples stay below 0.45
  assert.ok(calibrateContextualSimilarity(0.116, 3.86) < 0.45)
  assert.ok(calibrateContextualSimilarity(0.203, 3.84) < 0.45)
  assert.ok(calibrateContextualSimilarity(0.263, 3.55) < 0.45)

  // Genuine multilingual/short/paraphrase biblical matches clear 0.45
  assert.ok(calibrateContextualSimilarity(0.264, 4.86) > 0.45) // Arabic "Love"
  assert.ok(calibrateContextualSimilarity(0.287, 6.37) > 0.45) // "anxiety"
  assert.ok(calibrateContextualSimilarity(0.390, 4.64) > 0.45) // Arabic Christology
  assert.ok(calibrateContextualSimilarity(0.418, 5.09) > 0.45) // Samson donkeyhide cheek
  assert.ok(calibrateContextualSimilarity(0.733, 7.50) > 0.85) // Prodigal Son

  // Strictly monotonic in raw cosine for fixed distribution
  const mean = 0.12
  const std = 0.05
  let prev = -1
  for (let c = 0.05; c <= 0.80; c += 0.05) {
    const sim = calibrateContextualSimilarity(c, (c - mean) / std)
    assert.ok(sim > prev, `Expected monotonic calibration at c=${c}: ${sim} > ${prev}`)
    prev = sim
  }
})

test("/api/search uses contextual-pericope vector search + Voyage rerank when OPENAI_API_KEY is configured, without calling HF Space", async (t) => {
  const origFetch = globalThis.fetch
  const restoreEnv = snapshotEnv()
  t.after(() => {
    globalThis.fetch = origFetch
    restoreEnv()
  })

  const index = loadContextualPericopeIndex()
  const jdgIdx = index.pericopes.findIndex(
    (p) => p.book === "jdg" && p.chapter === 15 && p.verseStart === 9
  )
  assert.ok(jdgIdx >= 0)
  const jdgVec = Array.from({ length: index.dims }, (_, d) => index.vectors[jdgIdx * index.dims + d] * index.scales[jdgIdx])

  process.env.OPENAI_API_KEY = "openai-test-key"
  process.env.OPENAI_EMBED_API_URL = "https://openai.example/v1/embeddings"
  process.env.VOYAGE_API_KEY = "voyage-test-key"
  process.env.VOYAGE_API_URL = "https://voyage.example/v1/rerank"
  process.env.BIBLOS_SEARCH_API_URL = "https://hf-should-not-be-called.example"

  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push(url)
    if (url === "https://openai.example/v1/embeddings") {
      assert.equal(options.headers.Authorization, "Bearer openai-test-key")
      const body = JSON.parse(options.body)
      assert.equal(body.model, "text-embedding-3-large")
      assert.equal(body.dimensions, 1024)
      return new Response(JSON.stringify({ data: [{ index: 0, embedding: jdgVec }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
    if (url === "https://voyage.example/v1/rerank") {
      const body = JSON.parse(options.body)
      assert.equal(body.documents.length, 40)
      assert.ok(body.documents[0].startsWith("Judges 15:9-17"))
      return new Response(
        JSON.stringify({
          data: body.documents.map((_, i) => ({
            index: i,
            relevance_score: Number((0.95 - i * 0.01).toFixed(4)),
          })),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    }
    throw new Error(`Unexpected URL called: ${url}`)
  }

  const res = createMockRes()
  await handler(
    { method: "POST", body: { query: "Samson strikes enemies with a jawbone", limit: 50 } },
    res
  )

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.retrievalSource, "contextual-pericope")
  assert.equal(res.body.reranked, true)
  assert.equal(res.body.results.length, 50)
  assert.equal(res.body.results[0].book, "jdg")
  assert.equal(res.body.results[0].chapter, 15)
  assert.equal(res.body.results[0].verseStart, 9)
  assert.equal(res.body.results[0].content, index.canonicalTexts[jdgIdx])
  assert.deepEqual(calls, [
    "https://openai.example/v1/embeddings",
    "https://voyage.example/v1/rerank",
  ])
})

test("/api/search gracefully falls back to HF Space BGE when OPENAI_API_KEY is missing, errors, or times out", async (t) => {
  const origFetch = globalThis.fetch
  const origWarn = console.warn
  const restoreEnv = snapshotEnv()
  console.warn = () => {}
  t.after(() => {
    globalThis.fetch = origFetch
    console.warn = origWarn
    restoreEnv()
  })

  delete process.env.VOYAGE_API_KEY
  process.env.BIBLOS_SEARCH_API_URL = "https://upstream.example"
  process.env.OPENAI_EMBED_API_URL = "https://openai.example/v1/embeddings"

  const hfResults = [
    { book: "jhn", chapter: 3, testament: "NT", content: "For God so loved the world...", similarity: 0.78 },
  ]

  // Case 1: Missing OPENAI_API_KEY -> straight to HF Space
  delete process.env.OPENAI_API_KEY
  let openaiCalled = false
  globalThis.fetch = async (url) => {
    if (url.includes("openai.example")) {
      openaiCalled = true
      throw new Error("Should not call OpenAI when key is missing")
    }
    return new Response(JSON.stringify({ results: hfResults }), { status: 200 })
  }
  const resMissing = createMockRes()
  await handler({ method: "POST", body: { query: "eternal life" } }, resMissing)
  assert.equal(resMissing.statusCode, 200)
  assert.equal(resMissing.body.retrievalSource, "hf-bge")
  assert.equal(resMissing.body.reranked, false)
  assert.equal(openaiCalled, false)

  // Case 2: OpenAI 500 error -> falls back cleanly to HF Space
  process.env.OPENAI_API_KEY = "openai-test-key"
  globalThis.fetch = async (url) => {
    if (url === "https://openai.example/v1/embeddings") {
      return new Response("Internal Server Error", { status: 500 })
    }
    if (url === "https://upstream.example/search") {
      return new Response(JSON.stringify({ results: hfResults }), { status: 200 })
    }
    throw new Error(`Unexpected URL: ${url}`)
  }
  const resErr = createMockRes()
  await handler({ method: "POST", body: { query: "eternal life" } }, resErr)
  assert.equal(resErr.statusCode, 200)
  assert.equal(resErr.body.retrievalSource, "hf-bge")
  assert.equal(resErr.body.results[0].book, "jhn")

  // Case 3: OpenAI timeout abort -> falls back cleanly to HF Space
  process.env.OPENAI_EMBED_TIMEOUT_MS = "20"
  let sawAbort = false
  globalThis.fetch = async (url, options) => {
    if (url === "https://openai.example/v1/embeddings") {
      return new Promise((_, reject) => {
        options.signal.addEventListener("abort", () => {
          sawAbort = true
          reject(new DOMException("Aborted", "AbortError"))
        })
      })
    }
    if (url === "https://upstream.example/search") {
      return new Response(JSON.stringify({ results: hfResults }), { status: 200 })
    }
    throw new Error(`Unexpected URL: ${url}`)
  }
  const resTimeout = createMockRes()
  await handler({ method: "POST", body: { query: "eternal life" } }, resTimeout)
  assert.equal(sawAbort, true)
  assert.equal(resTimeout.statusCode, 200)
  assert.equal(resTimeout.body.retrievalSource, "hf-bge")
})
