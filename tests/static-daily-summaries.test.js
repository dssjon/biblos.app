import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import dailySummaryHandler from "../pages/api/summary-daily.js"
import {
  buildDailySummaryCacheKey,
  extractTopCommentaryExcerpts,
  resetStaticDailySummaryCache,
} from "../lib/daily-summary-cache.js"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const cacheData = JSON.parse(
  readFileSync(path.join(ROOT, "public", "daily-data", "commentary-summaries.json"), "utf8")
)

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    setHeader() {},
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

function sortLikeDailyPage(arr) {
  return [...arr].sort((a, b) =>
    String(a?.file_name || "")
      .replace(".toml", "")
      .localeCompare(String(b?.file_name || "").replace(".toml", ""), undefined, {
        numeric: true,
        sensitivity: "base",
      })
  )
}

test("commentary-summaries.json entries have valid cited summaries and clean structure", () => {
  const keys = Object.keys(cacheData.entries || {})
  assert.ok(keys.length >= 50, `Expected substantial prioritized static summaries, got ${keys.length}`)

  for (const key of keys) {
    const entry = cacheData.entries[key]
    assert.ok(typeof entry.book === "string" && entry.book.length > 0, `${key}: missing book`)
    assert.ok(Number.isInteger(entry.chapter) && entry.chapter >= 1, `${key}: invalid chapter`)
    assert.ok(typeof entry.summary === "string" && entry.summary.trim().length > 40, `${key}: empty summary`)
    assert.ok(Array.isArray(entry.segments) && entry.segments.length > 0, `${key}: missing segments`)
    assert.ok(Array.isArray(entry.citations) && entry.citations.length > 0, `${key}: missing citations`)
    for (const cit of entry.citations) {
      assert.ok(typeof cit.id === "number" && cit.id >= 1)
      assert.ok(typeof cit.documentIndex === "number" && cit.documentIndex >= 0 && cit.documentIndex < 4)
      assert.ok(typeof cit.citedText === "string" && cit.citedText.length > 0)
    }
  }
})

test("POST /api/summary-daily serves cached chapter summary in <50ms with cached:true without calling Anthropic", async (t) => {
  resetStaticDailySummaryCache()
  const origKey = process.env.ANTHROPIC_API_KEY
  delete process.env.ANTHROPIC_API_KEY
  t.after(() => {
    if (origKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = origKey
  })

  let fetchCalled = false
  t.mock.method(globalThis, "fetch", async () => {
    fetchCalled = true
    throw new Error("Live Anthropic API should NOT be called on static cache hit")
  })

  // Load real Luke 15 commentary file and test exact top-4 match
  const rawLuke15 = JSON.parse(
    readFileSync(path.join(ROOT, "public", "daily-data", "commentaries", "luke_chapter_15.json"), "utf8")
  )
  const sortedLuke15 = sortLikeDailyPage(rawLuke15)
  const excerpts = extractTopCommentaryExcerpts(sortedLuke15, "luke", 15)
  const expectedKey = buildDailySummaryCacheKey("luke", 15, excerpts)
  assert.ok(cacheData.entries[expectedKey], `Expected Luke 15 (${expectedKey}) to be pre-cached`)

  const t0 = performance.now()
  const res = createMockRes()
  await dailySummaryHandler(
    {
      method: "POST",
      body: { book: "luke", chapter: 15, commentaryData: sortedLuke15 },
    },
    res
  )
  const elapsedMs = performance.now() - t0

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.cached, true)
  assert.ok(res.body.summary.length > 40)
  assert.ok(res.body.citations.length > 0)
  assert.ok(res.body.segments.length > 0)
  assert.equal(fetchCalled, false)
  assert.ok(elapsedMs < 50, `Expected <50ms cache hit, took ${elapsedMs.toFixed(2)}ms`)
})

test("POST /api/summary-daily falls back to live Anthropic API on filtered single-Father fingerprint miss", async (t) => {
  resetStaticDailySummaryCache()
  const origKey = process.env.ANTHROPIC_API_KEY
  process.env.ANTHROPIC_API_KEY = "test-only-key"
  t.after(() => {
    if (origKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = origKey
  })

  let fetchCalls = 0
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    fetchCalls += 1
    const body = JSON.parse(options.body)
    assert.equal(body.model, "claude-opus-5-5")
    return {
      ok: true,
      json: async () => ({
        stop_reason: "end_turn",
        content: [
          {
            type: "text",
            text: "Bede reflects on the shepherd carrying the lost sheep home.",
            citations: [
              {
                type: "char_location",
                cited_text: "Bede excerpt text",
                document_index: 0,
                document_title: "Bede — Exposition of the Gospel of Luke",
                start_char_index: 0,
                end_char_index: 17,
              },
            ],
          },
        ],
      }),
    }
  })

  // Filter Luke 15 to a single Father (Bede only) -> fingerprint MUST miss and hit live API
  const rawLuke15 = JSON.parse(
    readFileSync(path.join(ROOT, "public", "daily-data", "commentaries", "luke_chapter_15.json"), "utf8")
  )
  const bedeOnly = sortLikeDailyPage(rawLuke15.filter((c) => c.father_name === "Bede"))
  assert.ok(bedeOnly.length > 0)

  const res = createMockRes()
  await dailySummaryHandler(
    {
      method: "POST",
      body: { book: "luke", chapter: 15, commentaryData: bedeOnly },
    },
    res
  )

  assert.equal(res.statusCode, 200)
  assert.equal(fetchCalls, 1)
  assert.equal(res.body.cached, undefined)
  assert.match(res.body.summary, /Bede/)
  assert.equal(res.body.citations.length, 1)
})
