// Builds public/daily-data/commentary-summaries.json — Pre-generated cited patristic
// commentary summaries via Anthropic Message Batches API (claude-opus-5-5, effort: high,
// native Citations API) matching the exact contract of pages/api/summary-daily.js.
//
// Usage:
//   node util/build-daily-summaries.mjs --submit --max-chapters <N> --include-augustine-top <M> --work-dir <dir> --env-file <env>
//   node util/build-daily-summaries.mjs --status --work-dir <dir> --env-file <env>
//   node util/build-daily-summaries.mjs --assemble --work-dir <dir> --env-file <env>
//   node util/build-daily-summaries.mjs --validate
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDocumentBlock, parseAnthropicCitedResponse } from "../lib/anthropic-summary.js";
import {
  buildDailySummaryCacheKey,
  extractTopCommentaryExcerpts,
  normalizeCommentaryBook,
} from "../lib/daily-summary-cache.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const COMMENTARIES_DIR = path.join("public", "daily-data", "commentaries");
export const OUTPUT_FILE = path.join("public", "daily-data", "commentary-summaries.json");
const BATCHES_URL = "https://api.anthropic.com/v1/messages/batches";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-opus-5-5";
const EFFORT = "high";

const BATCH_IN_PER_M = 2.0;
const BATCH_OUT_PER_M = 10.0;

// Priority order per user guidance (#59): Gospels -> Acts -> Epistles -> Psalms -> Genesis/Isaiah -> Rest
const BOOK_PRIORITY_ORDER = [
  // Gospels
  "matthew", "mark", "luke", "john",
  // Acts & Pauline Epistles
  "acts", "romans", "1corinthians", "2corinthians", "galatians", "ephesians",
  "philippians", "colossians", "1thessalonians", "2thessalonians",
  "1timothy", "2timothy", "titus", "philemon",
  // General Epistles & Revelation
  "hebrews", "james", "1peter", "2peter", "1john", "2john", "3john", "jude", "revelation",
  // Key OT books
  "genesis", "psalms", "isaiah", "exodus", "proverbs", "job", "ecclesiastes",
  "daniel", "jeremiah", "ezekiel", "deuteronomy", "1samuel", "2samuel",
  "1kings", "2kings", "joshua", "judges", "ruth", "esther", "jonah", "micah",
];

function getArg(flag, fallback = null) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : fallback;
}

function loadApiKey(envFile) {
  if (process.env.ANTHROPIC_API_KEY) {
    return process.env.ANTHROPIC_API_KEY.trim().replace(/^["']|["']$/g, "").replace(/\\n$/g, "").trim();
  }
  if (envFile && fs.existsSync(envFile)) {
    const raw = fs.readFileSync(envFile, "utf8");
    const m = raw.match(/^ANTHROPIC_API_KEY=(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "").replace(/\\n$/g, "").trim();
  }
  throw new Error("ANTHROPIC_API_KEY not found");
}

function calcBatchCost(usage) {
  const inp = usage.input_tokens || 0;
  const cacheCreate = usage.cache_creation_input_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const out = usage.output_tokens || 0;
  return (
    (inp * BATCH_IN_PER_M +
      cacheCreate * BATCH_IN_PER_M * 1.25 +
      cacheRead * BATCH_IN_PER_M * 0.1 +
      out * BATCH_OUT_PER_M) /
    1_000_000
  );
}

function capitalizeFirstLetter(str) {
  if (!str || typeof str !== "string") return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function sortCommentariesLikeDailyPage(arr) {
  return [...arr].sort((a, b) => {
    const aName = String(a?.file_name || "").replace(".toml", "");
    const bName = String(b?.file_name || "").replace(".toml", "");
    return aName.localeCompare(bName, undefined, { numeric: true, sensitivity: "base" });
  });
}

function buildInstruction(book, chapter) {
  const capBook = capitalizeFirstLetter(book);
  return `You are a biblical scholar and theologian. Please provide a concise summary of the most insightful and impactful commentaries from the provided excerpts related to the Book of ${capBook}, Chapter ${chapter}. Focus on capturing the key theological insights presented by each commentator.

Base your summary strictly on the provided commentary excerpts. Attribute each insight only to the commentator who wrote it, and do not add outside claims, fabricated Scripture quotations, or unprovided sources. If an excerpt does not clearly address the chapter, note that honestly rather than extrapolating.

Please structure the summary in a clear and organized manner, highlighting the main points from each commentator. Ensure that the language is accessible to someone familiar with the Bible but not necessarily with scholarly commentaries. Avoid unnecessary repetition and maintain a respectful tone appropriate for theological discussion.`;
}

function parseCommentaryFile(fileName) {
  const m = fileName.match(/^(.+)_chapter_(\d+)\.json$/);
  if (!m) return null;
  return { book: normalizeCommentaryBook(m[1]), chapter: Number(m[2]), fileName };
}

function prioritizeFiles(files) {
  const prio = new Map(BOOK_PRIORITY_ORDER.map((b, i) => [b, i]));
  return files
    .map(parseCommentaryFile)
    .filter(Boolean)
    .sort((a, b) => {
      const pa = prio.has(a.book) ? prio.get(a.book) : 999;
      const pb = prio.has(b.book) ? prio.get(b.book) : 999;
      if (pa !== pb) return pa - pb;
      if (a.book !== b.book) return a.book.localeCompare(b.book);
      return a.chapter - b.chapter;
    });
}

function buildWorkItems(maxChapters, includeAugustineTop) {
  const cDir = path.join(ROOT, COMMENTARIES_DIR);
  const files = fs.readdirSync(cDir).filter((f) => f.endsWith(".json"));
  const prioritized = prioritizeFiles(files);
  const selected = maxChapters > 0 ? prioritized.slice(0, maxChapters) : prioritized;

  const items = [];
  const seenKeys = new Set();

  // Always include Augustine of Hippo (the default /daily UI filter) for top priority chapters
  // starting with Genesis 1-3 (Week 1 Day 1) + Gospels/Epistles up to includeAugustineTop!
  const augustinePriority = [
    ...prioritized.filter((f) => f.book === "genesis" && f.chapter <= 5),
    ...prioritized.filter((f) => f.book !== "genesis"),
  ];

  let augAdded = 0;
  for (const f of augustinePriority) {
    if (augAdded >= includeAugustineTop) break;
    const raw = JSON.parse(fs.readFileSync(path.join(cDir, f.fileName), "utf8"));
    const augSorted = sortCommentariesLikeDailyPage(
      raw.filter((c) => c && c.father_name === "Augustine of Hippo")
    );
    const excerpts = extractTopCommentaryExcerpts(augSorted, f.book, f.chapter);
    if (excerpts.length === 0) continue;
    const cacheKey = buildDailySummaryCacheKey(f.book, f.chapter, excerpts);
    if (seenKeys.has(cacheKey)) continue;
    seenKeys.add(cacheKey);
    items.push({
      customId: `comm_aug_${f.book}_${f.chapter}`,
      book: f.book,
      chapter: f.chapter,
      fatherFilter: "Augustine of Hippo",
      cacheKey,
      excerpts,
    });
    augAdded++;
  }

  for (const f of selected) {
    const raw = JSON.parse(fs.readFileSync(path.join(cDir, f.fileName), "utf8"));
    const sorted = sortCommentariesLikeDailyPage(raw);
    const excerpts = extractTopCommentaryExcerpts(sorted, f.book, f.chapter);
    if (excerpts.length === 0) continue;
    const cacheKey = buildDailySummaryCacheKey(f.book, f.chapter, excerpts);
    if (seenKeys.has(cacheKey)) continue;
    seenKeys.add(cacheKey);
    items.push({
      customId: `comm_all_${f.book}_${f.chapter}`,
      book: f.book,
      chapter: f.chapter,
      fatherFilter: null,
      cacheKey,
      excerpts,
    });
  }

  return items;
}

async function submitBatch(apiKey, workDir, maxChapters, includeAugustineTop) {
  const items = buildWorkItems(maxChapters, includeAugustineTop);
  const requests = items.map((item) => {
    const documents = item.excerpts.map((ex) =>
      buildDocumentBlock({
        data: ex.content,
        title: `${ex.father_name} — ${ex.source_title}`,
        context: `${capitalizeFirstLetter(ex.book)} Chapter ${ex.chapter} patristic commentary`,
      })
    );
    return {
      custom_id: item.customId,
      params: {
        model: MODEL,
        max_tokens: 16000,
        output_config: { effort: EFFORT },
        messages: [
          {
            role: "user",
            content: [...documents, { type: "text", text: buildInstruction(item.book, item.chapter) }],
          },
        ],
      },
    };
  });

  // Estimate input tokens before submitting
  const estInTokens = items.reduce(
    (sum, it) => sum + Math.round(it.excerpts.reduce((s, e) => s + e.content.length, 0) / 4) + 300,
    0
  );
  console.log(
    `Submitting Commentary Summaries batch: ${requests.length} items (${items.filter((i) => !i.fatherFilter).length} chapter-wide + ${items.filter((i) => i.fatherFilter).length} Augustine-default), estInTokens=${estInTokens} (~$${((estInTokens * BATCH_IN_PER_M) / 1e6).toFixed(2)} in)...`
  );

  const res = await fetch(BATCHES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({ requests }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Batch submit failed ${res.status}: ${text.slice(0, 600)}`);
  const batch = JSON.parse(text);

  fs.mkdirSync(workDir, { recursive: true });
  const manifestPath = path.join(workDir, "batch4-manifest.json");
  const manifest = Object.fromEntries(
    items.map((it) => [
      it.customId,
      { book: it.book, chapter: it.chapter, fatherFilter: it.fatherFilter, cacheKey: it.cacheKey },
    ])
  );
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const metaPath = path.join(workDir, "batch4-meta.json");
  const history = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, "utf8")) : { batches: [] };
  history.batches.push({
    id: batch.id,
    submittedAt: new Date().toISOString(),
    count: requests.length,
    status: batch.processing_status,
  });
  history.latestBatchId = batch.id;
  fs.writeFileSync(metaPath, JSON.stringify(history, null, 2));
  console.log(`Submitted Batch 4 ID: ${batch.id} (${requests.length} requests), status=${batch.processing_status}`);
  return batch;
}

async function checkBatchStatus(apiKey, batchId) {
  const res = await fetch(`${BATCHES_URL}/${batchId}`, {
    headers: { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Batch status failed ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

async function downloadAndAssemble(apiKey, workDir) {
  const metaPath = path.join(workDir, "batch4-meta.json");
  const manifestPath = path.join(workDir, "batch4-manifest.json");
  const history = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  const entries = {};
  let totalIn = 0, totalCacheCreate = 0, totalCacheRead = 0, totalOut = 0, totalCost = 0;
  const failures = [];

  for (const b of history.batches) {
    const rawFile = path.join(workDir, `batch4-${b.id}.jsonl`);
    if (!fs.existsSync(rawFile)) {
      const info = await checkBatchStatus(apiKey, b.id);
      if (info.processing_status !== "ended") {
        throw new Error(`Batch ${b.id} not ended yet: ${info.processing_status}`);
      }
      const dl = await fetch(info.results_url, {
        headers: { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION },
      });
      if (!dl.ok) throw new Error(`Download failed: ${dl.status}`);
      fs.writeFileSync(rawFile, await dl.text());
    }

    const lines = fs.readFileSync(rawFile, "utf8").trim().split("\n").filter(Boolean);
    for (const line of lines) {
      const rec = JSON.parse(line);
      const meta = manifest[rec.custom_id];
      if (!meta) continue;
      if (rec.result?.type !== "succeeded") {
        failures.push({ id: rec.custom_id, reason: JSON.stringify(rec.result).slice(0, 200) });
        continue;
      }
      const msg = rec.result.message;
      const u = msg.usage || {};
      totalIn += u.input_tokens || 0;
      totalCacheCreate += u.cache_creation_input_tokens || 0;
      totalCacheRead += u.cache_read_input_tokens || 0;
      totalOut += u.output_tokens || 0;
      totalCost += calcBatchCost(u);

      try {
        const parsed = parseAnthropicCitedResponse(msg);
        entries[meta.cacheKey] = {
          book: meta.book,
          chapter: meta.chapter,
          ...(meta.fatherFilter ? { fatherFilter: meta.fatherFilter } : {}),
          summary: parsed.summary,
          segments: parsed.segments,
          citations: parsed.citations,
        };
      } catch (err) {
        failures.push({ id: rec.custom_id, reason: err.message });
      }
    }
  }

  const entryCount = Object.keys(entries).length;
  const output = {
    version: 1,
    model: MODEL,
    effort: EFFORT,
    entryCount,
    entries,
  };
  const outPath = path.join(ROOT, OUTPUT_FILE);
  fs.writeFileSync(outPath, `${JSON.stringify(output)}\n`);

  const usageReport = {
    totalIn,
    totalCacheCreate,
    totalCacheRead,
    totalOut,
    exactCost: Number(totalCost.toFixed(4)),
    entryCount,
    failures,
  };
  fs.writeFileSync(path.join(workDir, "batch4-usage.json"), JSON.stringify(usageReport, null, 2));
  console.log(
    `Batch 4 Usage: in=${totalIn}, out=${totalOut}, exactCost=$${totalCost.toFixed(4)} | entries=${entryCount}, failures=${failures.length} (${(fs.statSync(outPath).size / 1024 / 1024).toFixed(2)} MB)`
  );
  return usageReport;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const workDir = getArg("--work-dir", path.join(ROOT, ".batch-work"));
  const envFile = getArg("--env-file", null);
  const maxChapters = Number(getArg("--max-chapters", "0"));
  const includeAugustineTop = Number(getArg("--include-augustine-top", "25"));

  if (process.argv.includes("--dry-run")) {
    const items = buildWorkItems(maxChapters, includeAugustineTop);
    const estIn = items.reduce(
      (sum, it) => sum + Math.round(it.excerpts.reduce((s, e) => s + e.content.length, 0) / 4) + 300,
      0
    );
    const estOut = items.length * 2350;
    const estCost = (estIn * BATCH_IN_PER_M + estOut * BATCH_OUT_PER_M) / 1e6;
    console.log(
      JSON.stringify({
        totalItems: items.length,
        chapterWide: items.filter((i) => !i.fatherFilter).length,
        augustineDefault: items.filter((i) => i.fatherFilter).length,
        estInTokens: estIn,
        estOutTokens: estOut,
        estCostDollars: Number(estCost.toFixed(2)),
      })
    );
  } else if (process.argv.includes("--submit")) {
    await submitBatch(loadApiKey(envFile), workDir, maxChapters, includeAugustineTop);
  } else if (process.argv.includes("--status")) {
    const meta = JSON.parse(fs.readFileSync(path.join(workDir, "batch4-meta.json"), "utf8"));
    const info = await checkBatchStatus(loadApiKey(envFile), meta.latestBatchId);
    console.log(JSON.stringify({ id: info.id, status: info.processing_status, counts: info.request_counts }));
  } else if (process.argv.includes("--assemble")) {
    await downloadAndAssemble(loadApiKey(envFile), workDir);
  } else if (process.argv.includes("--validate")) {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, OUTPUT_FILE), "utf8"));
    const keys = Object.keys(data.entries || {});
    if (keys.length === 0) throw new Error("No cached commentary entries found");
    for (const k of keys) {
      const e = data.entries[k];
      if (!e.summary || !Array.isArray(e.segments) || !Array.isArray(e.citations)) {
        throw new Error(`Invalid entry ${k}`);
      }
    }
    console.log(`Validation PASSED: ${keys.length} pre-generated cited commentary summaries.`);
  }
}
