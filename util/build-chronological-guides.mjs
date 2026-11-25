// Builds public/daily-data/chronological-guides.json — Grounded daily study guides
// for all 365 days of the Blue Letter Chronological Bible Year reading plan via
// Anthropic Message Batches API (claude-opus-5-5, effort: high).
//
// Usage:
//   node util/build-chronological-guides.mjs --submit --schedule ./lib/reading-plans.js --work-dir <dir>
//   node util/build-chronological-guides.mjs --status --work-dir <dir>
//   node util/build-chronological-guides.mjs --assemble --schedule ./lib/reading-plans.js --work-dir <dir>
//   node util/build-chronological-guides.mjs --validate
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BOOK_MAPPING } from "../lib/bible-constants.ts";
import { parseVplXml } from "../lib/corpus-chunker.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SOURCE_FILE = "engwebp_vpl.xml";
export const OUTPUT_FILE = path.join("public", "daily-data", "chronological-guides.json");
const BATCHES_URL = "https://api.anthropic.com/v1/messages/batches";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-opus-5-5";
const EFFORT = "high";

const BATCH_IN_PER_M = 2.0;
const BATCH_OUT_PER_M = 10.0;

const NAME_TO_CODE = Object.fromEntries(
  Object.entries(BOOK_MAPPING).map(([code, name]) => [name.toLowerCase(), code])
);
NAME_TO_CODE["psalm"] = "psa";

export const GUIDE_SYSTEM = `You are a biblical scholar writing concise, deeply grounded daily study guides for a 365-day Chronological Bible Reading Plan.
Given the exact chapters assigned for one day (with their canonical World English Bible text), produce a clear, accessible, reverent study guide grounded strictly in the assigned chapters.

STRICT ACCURACY RULES:
1. Ground every detail strictly in the assigned day's chapters — do NOT invent events, names, quotations, or verse numbers absent from the reading.
2. keyVerseRef MUST cite a real chapter and verse that actually appears in today's assigned reading (e.g., "Genesis 3:15", "Luke 15:24", "Psalms 23:1").
3. historicalContext: 2–3 clear sentences anchoring the historical, geographical, and literary context of today's chapters within the chronological era.
4. redemptiveArc: 2 clear sentences tracing how today's reading advances God's covenant/redemptive story across Scripture.
5. keyThemes: 3–5 concise, specific themes grounded in today's text.
6. reflectionQuestion: 1 thoughtful, grounded question inviting faithful reflection on today's passage.

Return ONLY valid JSON matching the schema.`;

export const GUIDE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "historicalContext", "redemptiveArc", "keyThemes", "keyVerseRef", "reflectionQuestion"],
  properties: {
    title: { type: "string" },
    historicalContext: { type: "string" },
    redemptiveArc: { type: "string" },
    keyThemes: { type: "array", items: { type: "string" } },
    keyVerseRef: { type: "string" },
    reflectionQuestion: { type: "string" },
  },
};

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
    if (m) {
      return m[1].trim().replace(/^["']|["']$/g, "").replace(/\\n$/g, "").trim();
    }
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

const BOOK_NAMES_BY_LEN = Object.keys(NAME_TO_CODE).sort((a, b) => b.length - a.length);

export function parsePassageToChapters(passage) {
  const units = [];
  for (const rawSeg of passage.split(";")) {
    const seg = rawSeg.trim();
    const lower = seg.toLowerCase();
    const matchedName = BOOK_NAMES_BY_LEN.find(
      (name) => lower === name || lower.startsWith(`${name} `)
    );
    if (!matchedName) throw new Error(`Unrecognized book in chronological segment: "${seg}"`);
    const code = NAME_TO_CODE[matchedName];
    const rest = seg.slice(matchedName.length).trim();
    const m = rest.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) throw new Error(`Invalid chapter range in segment: "${seg}"`);
    const start = Number(m[1]);
    const end = m[2] ? Number(m[2]) : start;
    for (let ch = start; ch <= end; ch++) {
      units.push({ book: code, bookName: BOOK_MAPPING[code], chapter: ch });
    }
  }
  return units;
}

async function loadChronologicalDays(schedulePath) {
  const mod = await import(pathToFileURL(schedulePath).href);
  const plan = mod.CHRONOLOGICAL_READING_PLAN;
  const days = [];
  for (const week of plan.weeks) {
    for (const d of week.days) {
      days.push({
        day: d.dayOfPlan,
        passage: d.passage,
        era: d.era,
        chapters: parsePassageToChapters(d.passage),
      });
    }
  }
  if (days.length !== 365) throw new Error(`Expected 365 days, got ${days.length}`);
  return days;
}

function formatDayPrompt(dayObj, chaptersMap) {
  const sections = dayObj.chapters.map(({ book, bookName, chapter }) => {
    const verses = chaptersMap.get(`${book}:${chapter}`);
    if (!verses) throw new Error(`Missing chapter ${book}:${chapter} in XML`);
    const lines = verses
      .filter((v) => v.text !== null)
      .map((v) => `[v${v.verse}] ${v.text}`);
    return `### ${bookName} ${chapter}\n${lines.join("\n")}`;
  });

  return `Day ${dayObj.day} of 365 | Era: ${dayObj.era}\nAssigned Reading: ${dayObj.passage}\n\nProvide a concise, grounded study guide for this day's reading:\n- title: Short descriptive day title (4–8 words)\n- historicalContext: 2–3 sentences grounding the historical and literary setting of these chapters\n- redemptiveArc: 2 sentences showing how this reading connects to the broader biblical story of redemption\n- keyThemes: 3–5 concise themes\n- keyVerseRef: One anchor verse reference from today's assigned reading\n- reflectionQuestion: One thoughtful, grounded reflection question\n\nCANONICAL TEXT:\n${sections.join("\n\n")}`;
}

async function submitBatch(apiKey, schedulePath, workDir, onlyDays = null) {
  const xml = fs.readFileSync(path.join(ROOT, SOURCE_FILE), "utf8");
  const chaptersMap = parseVplXml(xml);
  const days = await loadChronologicalDays(schedulePath);

  const requests = days
    .filter((d) => !onlyDays || onlyDays.has(d.day))
    .map((d) => ({
      custom_id: `chron_day_${String(d.day).padStart(3, "0")}`,
      params: {
        model: MODEL,
        max_tokens: 16000,
        system: [
          {
            type: "text",
            text: GUIDE_SYSTEM,
            cache_control: { type: "ephemeral" },
          },
        ],
        output_config: {
          effort: EFFORT,
          format: { type: "json_schema", schema: GUIDE_SCHEMA },
        },
        messages: [{ role: "user", content: formatDayPrompt(d, chaptersMap) }],
      },
    }));

  console.log(`Submitting Chronological Guides batch: ${requests.length} days (model=${MODEL}, effort=${EFFORT})...`);
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
  const metaPath = path.join(workDir, "batch2-meta.json");
  const history = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, "utf8")) : { batches: [] };
  history.batches.push({
    id: batch.id,
    submittedAt: new Date().toISOString(),
    count: requests.length,
    isRetry: Boolean(onlyDays),
    status: batch.processing_status,
  });
  history.latestBatchId = batch.id;
  fs.writeFileSync(metaPath, JSON.stringify(history, null, 2));
  console.log(`Submitted Batch ID: ${batch.id} (${requests.length} requests), status=${batch.processing_status}`);
  return batch;
}

async function checkBatchStatus(apiKey, batchId) {
  const res = await fetch(`${BATCHES_URL}/${batchId}`, {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Batch status failed ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

async function downloadAndAssemble(apiKey, schedulePath, workDir) {
  const metaPath = path.join(workDir, "batch2-meta.json");
  const history = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  const xmlBuf = fs.readFileSync(path.join(ROOT, SOURCE_FILE));
  const days = await loadChronologicalDays(schedulePath);
  const dayMeta = new Map(days.map((d) => [d.day, d]));

  const mergedByDay = new Map();
  let totalIn = 0;
  let totalCacheCreate = 0;
  let totalCacheRead = 0;
  let totalOut = 0;
  let totalCost = 0;
  const failures = [];

  for (const entry of history.batches) {
    const rawFile = path.join(workDir, `batch2-${entry.id}.jsonl`);
    if (!fs.existsSync(rawFile)) {
      const info = await checkBatchStatus(apiKey, entry.id);
      if (info.processing_status !== "ended") {
        throw new Error(`Batch ${entry.id} not ended yet: ${info.processing_status}`);
      }
      const dl = await fetch(info.results_url, {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
      });
      if (!dl.ok) throw new Error(`Failed downloading results for ${entry.id}: ${dl.status}`);
      fs.writeFileSync(rawFile, await dl.text());
    }

    const lines = fs.readFileSync(rawFile, "utf8").trim().split("\n").filter(Boolean);
    for (const line of lines) {
      const rec = JSON.parse(line);
      const m = rec.custom_id.match(/^chron_day_(\d+)$/);
      if (!m) continue;
      const dayNum = Number(m[1]);

      if (rec.result?.type === "succeeded") {
        const msg = rec.result.message;
        const u = msg.usage || {};
        totalIn += u.input_tokens || 0;
        totalCacheCreate += u.cache_creation_input_tokens || 0;
        totalCacheRead += u.cache_read_input_tokens || 0;
        totalOut += u.output_tokens || 0;
        totalCost += calcBatchCost(u);

        if (msg.stop_reason !== "end_turn") {
          failures.push({ day: dayNum, reason: `stop_reason=${msg.stop_reason}` });
          continue;
        }
        const tb = (msg.content || []).find((b) => b.type === "text");
        if (!tb) {
          failures.push({ day: dayNum, reason: "no text block" });
          continue;
        }
        try {
          const parsed = JSON.parse(tb.text);
          const meta = dayMeta.get(dayNum);
          if (
            !parsed.title?.trim() ||
            !parsed.historicalContext?.trim() ||
            !parsed.redemptiveArc?.trim() ||
            !Array.isArray(parsed.keyThemes) ||
            parsed.keyThemes.length === 0 ||
            !parsed.keyVerseRef?.trim() ||
            !parsed.reflectionQuestion?.trim()
          ) {
            failures.push({ day: dayNum, reason: "incomplete guide fields" });
            continue;
          }
          mergedByDay.set(dayNum, {
            day: dayNum,
            passage: meta.passage,
            era: meta.era,
            chapters: meta.chapters.map((c) => `${c.book}:${c.chapter}`),
            title: parsed.title.trim(),
            historicalContext: parsed.historicalContext.trim(),
            redemptiveArc: parsed.redemptiveArc.trim(),
            keyThemes: parsed.keyThemes.map((s) => String(s).trim()).filter(Boolean),
            keyVerseRef: parsed.keyVerseRef.trim(),
            reflectionQuestion: parsed.reflectionQuestion.trim(),
          });
        } catch (err) {
          failures.push({ day: dayNum, reason: `JSON parse error: ${err.message}` });
        }
      } else {
        failures.push({ day: dayNum, reason: JSON.stringify(rec.result).slice(0, 200) });
      }
    }
  }

  const unresolvedDays = [];
  for (let d = 1; d <= 365; d++) {
    if (!mergedByDay.has(d)) {
      const lastErr = failures.filter((f) => f.day === d).pop();
      unresolvedDays.push({ day: d, reason: lastErr?.reason || "missing" });
    }
  }

  console.log(
    `Batch 2 Usage: in=${totalIn}, cacheCreate=${totalCacheCreate}, cacheRead=${totalCacheRead}, out=${totalOut}, exactCost=$${totalCost.toFixed(4)}`
  );
  console.log(`Valid days: ${mergedByDay.size}/365, unresolved: ${unresolvedDays.length}`);

  const usageReport = {
    totalIn,
    totalCacheCreate,
    totalCacheRead,
    totalOut,
    exactCost: Number(totalCost.toFixed(4)),
    validDays: mergedByDay.size,
    totalDays: 365,
    unresolvedDays,
  };
  fs.writeFileSync(path.join(workDir, "batch2-usage.json"), JSON.stringify(usageReport, null, 2));

  if (unresolvedDays.length > 0) {
    console.log("Unresolved days:", JSON.stringify(unresolvedDays.slice(0, 20), null, 2));
    return usageReport;
  }

  const guides = Array.from({ length: 365 }, (_, i) => mergedByDay.get(i + 1));
  const output = {
    version: 1,
    planId: "blue-letter-chronological-year",
    source: SOURCE_FILE,
    sourceSha256: createHash("sha256").update(xmlBuf).digest("hex"),
    model: MODEL,
    effort: EFFORT,
    dayCount: guides.length,
    guides,
  };

  const outPath = path.join(ROOT, OUTPUT_FILE);
  fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Wrote ${OUTPUT_FILE}: ${guides.length} daily guides (${(fs.statSync(outPath).size / 1024).toFixed(1)} KB)`);
  return usageReport;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const workDir = getArg("--work-dir", path.join(ROOT, ".batch-work"));
  const envFile = getArg("--env-file", null);
  const schedulePath = getArg("--schedule", path.join(ROOT, "lib", "reading-plans.js"));

  if (process.argv.includes("--validate")) {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, OUTPUT_FILE), "utf8"));
    if (!Array.isArray(data.guides) || data.guides.length !== 365) {
      throw new Error(`Expected 365 guides, got ${data.guides?.length}`);
    }
    for (let i = 0; i < 365; i++) {
      const g = data.guides[i];
      if (g.day !== i + 1 || !g.title || !g.historicalContext || !g.redemptiveArc || !g.reflectionQuestion) {
        throw new Error(`Invalid guide at index ${i}`);
      }
    }
    console.log("Validation PASSED: 365 chronological study guides complete and grounded.");
  } else if (process.argv.includes("--submit")) {
    const apiKey = loadApiKey(envFile);
    await submitBatch(apiKey, schedulePath, workDir);
  } else if (process.argv.includes("--retry-failed")) {
    const apiKey = loadApiKey(envFile);
    const usage = JSON.parse(fs.readFileSync(path.join(workDir, "batch2-usage.json"), "utf8"));
    const retryDays = new Set(usage.unresolvedDays.map((u) => u.day));
    if (retryDays.size === 0) {
      console.log("No failed days to retry.");
    } else {
      await submitBatch(apiKey, schedulePath, workDir, retryDays);
    }
  } else if (process.argv.includes("--status")) {
    const apiKey = loadApiKey(envFile);
    const meta = JSON.parse(fs.readFileSync(path.join(workDir, "batch2-meta.json"), "utf8"));
    const info = await checkBatchStatus(apiKey, meta.latestBatchId);
    console.log(JSON.stringify({ id: info.id, status: info.processing_status, counts: info.request_counts }));
  } else if (process.argv.includes("--assemble")) {
    const apiKey = loadApiKey(envFile);
    await downloadAndAssemble(apiKey, schedulePath, workDir);
  } else {
    console.error("Specify --submit, --status, --assemble, --retry-failed, or --validate");
    process.exit(1);
  }
}
