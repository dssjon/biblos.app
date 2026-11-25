// Builds public/data/pericopes.json — Full-Bible Pericope, Traditional Title,
// Speaker Attribution, Polarity Caution & Seeker-Query Atlas for all 1,189 chapters
// (31,103 verse slots) of canonical engwebp_vpl.xml via Anthropic Message Batches API
// (claude-opus-5-5, effort: high).
//
// Usage:
//   node util/build-pericope-atlas.mjs --submit --work-dir <dir>
//   node util/build-pericope-atlas.mjs --status --work-dir <dir>
//   node util/build-pericope-atlas.mjs --assemble --work-dir <dir>
//   node util/build-pericope-atlas.mjs --validate
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BOOK_MAPPING, BOOKS } from "../lib/bible-constants.ts";
import { parseVplXml } from "../lib/corpus-chunker.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SOURCE_FILE = "engwebp_vpl.xml";
export const OUTPUT_FILE = path.join("public", "data", "pericopes.json");
const BATCHES_URL = "https://api.anthropic.com/v1/messages/batches";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-opus-5-5";
const EFFORT = "high";

// 50%-off Anthropic Message Batches pricing for claude-opus-5-5 ($/M tokens)
const BATCH_IN_PER_M = 2.0;
const BATCH_OUT_PER_M = 10.0;

export const PERICOPE_SYSTEM = `You are a biblical scholar building a canonical pericope, traditional title, speaker-attribution, and seeker-query atlas for the World English Bible (WEB).
Given a single chapter with numbered verses 1..N, partition the ENTIRE chapter into natural scholarly pericopes (literary units / scenes / speeches / subsections; typically 1 to 6 pericopes per chapter, or natural stanza/section units for very long chapters like Psalm 119 or Numbers 7).

STRICT INVARIANTS (ZERO TOLERANCE):
1. Complete contiguous coverage of verses 1..N:
   - First pericope MUST have verseStart = 1.
   - Each subsequent pericope MUST have verseStart = previous.verseEnd + 1.
   - Last pericope MUST have verseEnd = N (if an empty text-critical verse slot is noted, include that verse number cleanly in its enclosing pericope).
   - Zero gaps, zero overlaps, zero invented or out-of-range verse numbers.
2. Traditional titles & altTitles:
   - Use standard, widely recognized English biblical pericope headings (e.g., "The Parable of the Prodigal Son", "The Beatitudes", "The Parable of the Good Samaritan", "The Road to Emmaus", "Elijah Flees to Horeb Under the Broom Tree", "The Way of Love").
   - Include well-known alternative titles and overarching discourse titles in altTitles (e.g., "Sermon on the Mount" on Matthew 5–7 pericopes; "Love Chapter" and "Paul on Love to the Corinthians" on 1 Corinthians 13; "Elijah under the juniper tree" on 1 Kings 19:1–8; "The Parable of the Prodigal Son" across Luke 15:11–32; "The Temptation of Jesus" on Matt 4:1–11 and Luke 4:1–13).
3. Speaker attribution & polarity caution (CRITICAL FOR SACRED-TEXT INTEGRITY):
   - Accurately list speakers (including epistle author like "Paul" for Pauline letters, "Jesus", "David", "Narrator", "The LORD", etc.) and addressees.
   - Set "caution" to null for normative biblical teaching or straightforward narration.
   - Set "caution" to a concise, explicit warning string WHENEVER a pericope features antagonist, satanic/demonic, deceptive, arrogant/boasting, or divinely rebuked speech that must not be mistaken for God's endorsement (e.g., Job's friends Eliphaz, Bildad, Zophar rebuked in Job 42:7 across Job 4–5, 8, 11, 15, 18, 20, 22, 25; Elihu's unendorsed human counsel in Job 32–37; Satan/Serpent/demons in Gen 3:1–5, Job 1–2, Matt 4:1–11, Luke 4:1–13 & 33–35, Mark 1 & 5; Lamech's sword-song boast in Gen 4:23–24; wicked/fool quotes like Ps 14:1; false prophets; hostile accusers/mockers).
4. Seeker queries & lexical bridges:
   - seekerQueries: 2–4 concise, natural questions/phrases real Bible readers search to find this exact passage (e.g., "lessons from the Prodigal Son", "what does Paul say about love", "Elijah depressed under the broom tree").
   - lexicalBridges: 3–8 distinctive KJV/ESV/NIV/traditional phrases or theological terms that bridge wording differences with WEB (e.g., "juniper tree" for WEB's "broom tree", "charity"/"sounding brass" for 1 Cor 13, "prodigal"/"fatted calf"/"riotous living" for Luke 15, "quick to hear" for James 1:19). Keep all terms strictly biblical/theological — no generic filler or modern non-biblical jargon.

Return ONLY valid JSON matching the requested schema.`;

export const PERICOPE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["pericopes"],
  properties: {
    pericopes: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "verseStart",
          "verseEnd",
          "title",
          "altTitles",
          "genre",
          "speakers",
          "addressees",
          "speakerNote",
          "caution",
          "seekerQueries",
          "lexicalBridges",
        ],
        properties: {
          verseStart: { type: "integer" },
          verseEnd: { type: "integer" },
          title: { type: "string" },
          altTitles: { type: "array", items: { type: "string" } },
          genre: {
            type: "string",
            enum: [
              "narrative",
              "parable",
              "discourse",
              "law",
              "poetry",
              "psalm",
              "proverb",
              "prophecy",
              "epistle",
              "apocalyptic",
              "genealogy",
              "prayer",
              "dialogue",
              "wisdom",
            ],
          },
          speakers: { type: "array", items: { type: "string" } },
          addressees: { type: "array", items: { type: "string" } },
          speakerNote: { type: "string" },
          caution: { type: ["string", "null"] },
          seekerQueries: { type: "array", items: { type: "string" } },
          lexicalBridges: { type: "array", items: { type: "string" } },
        },
      },
    },
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
  throw new Error("ANTHROPIC_API_KEY not found (set env or pass --env-file)");
}

export function formatChapterPrompt(book, chapter, verses) {
  const bookName = BOOK_MAPPING[book] || book.toUpperCase();
  const maxV = verses[verses.length - 1].verse;
  const lines = verses.map((v) =>
    v.text === null
      ? `[v${v.verse}] (empty text-critical slot in WEB; include verse ${v.verse} in enclosing pericope)`
      : `[v${v.verse}] ${v.text}`
  );
  return `Book: ${bookName} (${book})\nChapter: ${chapter}\nTotal verse slots: 1..${maxV}\n\n${lines.join("\n")}`;
}

export function validateChapterPericopes(book, chapter, maxV, pericopes) {
  const errors = [];
  if (!Array.isArray(pericopes) || pericopes.length === 0) {
    return [`${book} ${chapter}: empty pericopes array`];
  }
  if (pericopes[0].verseStart !== 1) {
    errors.push(`${book} ${chapter}: first verseStart=${pericopes[0].verseStart} !== 1`);
  }
  if (pericopes[pericopes.length - 1].verseEnd !== maxV) {
    errors.push(`${book} ${chapter}: last verseEnd=${pericopes[pericopes.length - 1].verseEnd} !== ${maxV}`);
  }
  for (let i = 0; i < pericopes.length; i++) {
    const p = pericopes[i];
    if (!Number.isInteger(p.verseStart) || !Number.isInteger(p.verseEnd)) {
      errors.push(`${book} ${chapter}[${i}]: non-integer verse bounds`);
    }
    if (p.verseStart < 1 || p.verseEnd > maxV || p.verseStart > p.verseEnd) {
      errors.push(`${book} ${chapter}[${i}]: invalid range ${p.verseStart}-${p.verseEnd} (max ${maxV})`);
    }
    if (i > 0 && p.verseStart !== pericopes[i - 1].verseEnd + 1) {
      errors.push(
        `${book} ${chapter}[${i}]: discontinuity prevEnd=${pericopes[i - 1].verseEnd} -> start=${p.verseStart}`
      );
    }
    if (typeof p.title !== "string" || p.title.trim().length === 0) {
      errors.push(`${book} ${chapter}[${i}]: missing title`);
    }
    if (!Array.isArray(p.speakers) || p.speakers.length === 0) {
      errors.push(`${book} ${chapter}[${i}]: missing speakers`);
    }
    if (!Array.isArray(p.seekerQueries) || p.seekerQueries.length === 0) {
      errors.push(`${book} ${chapter}[${i}]: missing seekerQueries`);
    }
    if (!Array.isArray(p.lexicalBridges)) {
      errors.push(`${book} ${chapter}[${i}]: missing lexicalBridges`);
    }
  }
  return errors;
}

export function calcBatchCost(usage) {
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

function buildRequests(chaptersMap, onlyKeys = null) {
  const requests = [];
  for (const [key, verses] of chaptersMap) {
    if (onlyKeys && !onlyKeys.has(key)) continue;
    const [book, chStr] = key.split(":");
    const chapter = Number(chStr);
    const maxV = verses[verses.length - 1].verse;
    // Allow generous output ceiling for massive chapters like Psalm 119 or Numbers 7
    const maxTokens = maxV >= 80 ? 28000 : 16000;
    requests.push({
      custom_id: `pericope_${book}_${chapter}`,
      params: {
        model: MODEL,
        max_tokens: maxTokens,
        system: [
          {
            type: "text",
            text: PERICOPE_SYSTEM,
            cache_control: { type: "ephemeral" },
          },
        ],
        output_config: {
          effort: EFFORT,
          format: { type: "json_schema", schema: PERICOPE_SCHEMA },
        },
        messages: [
          {
            role: "user",
            content: formatChapterPrompt(book, chapter, verses),
          },
        ],
      },
    });
  }
  return requests;
}

async function submitBatch(apiKey, workDir, onlyKeys = null) {
  const xml = fs.readFileSync(path.join(ROOT, SOURCE_FILE), "utf8");
  const chaptersMap = parseVplXml(xml);
  const requests = buildRequests(chaptersMap, onlyKeys);
  console.log(`Submitting Pericope Atlas batch: ${requests.length} chapters (model=${MODEL}, effort=${EFFORT})...`);

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
  if (!res.ok) {
    throw new Error(`Batch submit failed ${res.status}: ${text.slice(0, 600)}`);
  }
  const batch = JSON.parse(text);
  fs.mkdirSync(workDir, { recursive: true });
  const metaPath = path.join(workDir, "batch1-meta.json");
  const history = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, "utf8")) : { batches: [] };
  history.batches.push({
    id: batch.id,
    submittedAt: new Date().toISOString(),
    count: requests.length,
    isRetry: Boolean(onlyKeys),
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

async function downloadAndAssemble(apiKey, workDir) {
  const metaPath = path.join(workDir, "batch1-meta.json");
  const history = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  const xmlBuf = fs.readFileSync(path.join(ROOT, SOURCE_FILE));
  const chaptersMap = parseVplXml(xmlBuf.toString("utf8"));

  const mergedByKey = new Map();
  let totalIn = 0;
  let totalCacheCreate = 0;
  let totalCacheRead = 0;
  let totalOut = 0;
  let totalCost = 0;
  const failures = [];

  for (const entry of history.batches) {
    const rawFile = path.join(workDir, `batch1-${entry.id}.jsonl`);
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
      const m = rec.custom_id.match(/^pericope_([a-z0-9]+)_(\d+)$/);
      if (!m) continue;
      const key = `${m[1]}:${Number(m[2])}`;

      if (rec.result?.type === "succeeded") {
        const msg = rec.result.message;
        const u = msg.usage || {};
        totalIn += u.input_tokens || 0;
        totalCacheCreate += u.cache_creation_input_tokens || 0;
        totalCacheRead += u.cache_read_input_tokens || 0;
        totalOut += u.output_tokens || 0;
        totalCost += calcBatchCost(u);

        if (msg.stop_reason !== "end_turn") {
          failures.push({ key, reason: `stop_reason=${msg.stop_reason}` });
          continue;
        }
        const tb = (msg.content || []).find((b) => b.type === "text");
        if (!tb) {
          failures.push({ key, reason: "no text block" });
          continue;
        }
        try {
          const parsed = JSON.parse(tb.text);
          const verses = chaptersMap.get(key);
          const maxV = verses[verses.length - 1].verse;
          const [book, chStr] = key.split(":");
          const chapter = Number(chStr);
          const errs = validateChapterPericopes(book, chapter, maxV, parsed.pericopes);
          if (errs.length > 0) {
            failures.push({ key, reason: errs.join("; ") });
            continue;
          }
          // Normalize pericope objects with book & chapter attached
          const normalized = parsed.pericopes.map((p) => ({
            book,
            chapter,
            verseStart: p.verseStart,
            verseEnd: p.verseEnd,
            title: p.title.trim(),
            altTitles: (p.altTitles || []).map((s) => String(s).trim()).filter(Boolean),
            genre: p.genre,
            speakers: (p.speakers || []).map((s) => String(s).trim()).filter(Boolean),
            addressees: (p.addressees || []).map((s) => String(s).trim()).filter(Boolean),
            speakerNote: String(p.speakerNote || "").trim(),
            caution: p.caution && String(p.caution).trim().length > 0 ? String(p.caution).trim() : null,
            seekerQueries: (p.seekerQueries || []).map((s) => String(s).trim()).filter(Boolean),
            lexicalBridges: (p.lexicalBridges || []).map((s) => String(s).trim()).filter(Boolean),
          }));
          mergedByKey.set(key, normalized);
        } catch (err) {
          failures.push({ key, reason: `JSON parse error: ${err.message}` });
        }
      } else {
        failures.push({ key, reason: JSON.stringify(rec.result).slice(0, 200) });
      }
    }
  }

  // Filter out failures that were fixed by a subsequent retry batch
  const unresolvedKeys = [];
  for (const key of chaptersMap.keys()) {
    if (!mergedByKey.has(key)) {
      const lastErr = failures.filter((f) => f.key === key).pop();
      unresolvedKeys.push({ key, reason: lastErr?.reason || "missing" });
    }
  }

  console.log(
    `Batch 1 Usage: in=${totalIn}, cacheCreate=${totalCacheCreate}, cacheRead=${totalCacheRead}, out=${totalOut}, exactCost=$${totalCost.toFixed(4)}`
  );
  console.log(`Valid chapters: ${mergedByKey.size}/${chaptersMap.size}, unresolved: ${unresolvedKeys.length}`);

  const usageReport = {
    totalIn,
    totalCacheCreate,
    totalCacheRead,
    totalOut,
    exactCost: Number(totalCost.toFixed(4)),
    validChapters: mergedByKey.size,
    totalChapters: chaptersMap.size,
    unresolvedKeys,
  };
  fs.writeFileSync(path.join(workDir, "batch1-usage.json"), JSON.stringify(usageReport, null, 2));

  if (unresolvedKeys.length > 0) {
    console.log("Unresolved chapters:", JSON.stringify(unresolvedKeys.slice(0, 20), null, 2));
    return usageReport;
  }

  // Emit canonical book/chapter order matching BOOKS
  const allPericopes = [];
  const bookIndex = new Map(BOOKS.map((b, i) => [b, i]));
  const orderedKeys = Array.from(chaptersMap.keys()).sort((a, b) => {
    const [ab, ac] = a.split(":");
    const [bb, bc] = b.split(":");
    const bi = (bookIndex.get(ab) ?? 999) - (bookIndex.get(bb) ?? 999);
    return bi !== 0 ? bi : Number(ac) - Number(bc);
  });

  for (const key of orderedKeys) {
    allPericopes.push(...mergedByKey.get(key));
  }

  const output = {
    version: 1,
    source: SOURCE_FILE,
    sourceSha256: createHash("sha256").update(xmlBuf).digest("hex"),
    model: MODEL,
    effort: EFFORT,
    books: BOOKS.length,
    chapters: chaptersMap.size,
    pericopeCount: allPericopes.length,
    pericopes: allPericopes,
  };

  const outPath = path.join(ROOT, OUTPUT_FILE);
  fs.writeFileSync(outPath, `${JSON.stringify(output)}\n`);
  console.log(`Wrote ${OUTPUT_FILE}: ${allPericopes.length} pericopes across ${chaptersMap.size} chapters (${(fs.statSync(outPath).size / 1024 / 1024).toFixed(2)} MB)`);
  return usageReport;
}

export function validateAtlasFile(root = ROOT) {
  const xmlBuf = fs.readFileSync(path.join(root, SOURCE_FILE));
  const chaptersMap = parseVplXml(xmlBuf.toString("utf8"));
  const atlas = JSON.parse(fs.readFileSync(path.join(root, OUTPUT_FILE), "utf8"));

  const byChapter = new Map();
  for (const p of atlas.pericopes) {
    const key = `${p.book}:${p.chapter}`;
    if (!byChapter.has(key)) byChapter.set(key, []);
    byChapter.get(key).push(p);
  }

  const allErrors = [];
  if (byChapter.size !== chaptersMap.size) {
    allErrors.push(`Chapter count mismatch: got ${byChapter.size}, expected ${chaptersMap.size}`);
  }
  for (const [key, verses] of chaptersMap) {
    const [book, chStr] = key.split(":");
    const maxV = verses[verses.length - 1].verse;
    const list = byChapter.get(key);
    allErrors.push(...validateChapterPericopes(book, Number(chStr), maxV, list));
  }
  return { ok: allErrors.length === 0, errors: allErrors, pericopeCount: atlas.pericopes.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const workDir = getArg("--work-dir", path.join(ROOT, ".batch-work"));
  const envFile = getArg("--env-file", null);

  if (process.argv.includes("--validate")) {
    const result = validateAtlasFile();
    if (!result.ok) {
      console.error("Validation FAILED:", result.errors.slice(0, 20));
      process.exit(1);
    }
    console.log(`Validation PASSED: ${result.pericopeCount} pericopes covering all 1,189 chapters / 31,103 verse slots.`);
  } else if (process.argv.includes("--submit")) {
    const apiKey = loadApiKey(envFile);
    await submitBatch(apiKey, workDir);
  } else if (process.argv.includes("--retry-failed")) {
    const apiKey = loadApiKey(envFile);
    const usage = JSON.parse(fs.readFileSync(path.join(workDir, "batch1-usage.json"), "utf8"));
    const retryKeys = new Set(usage.unresolvedKeys.map((u) => u.key));
    if (retryKeys.size === 0) {
      console.log("No failed chapters to retry.");
    } else {
      await submitBatch(apiKey, workDir, retryKeys);
    }
  } else if (process.argv.includes("--status")) {
    const apiKey = loadApiKey(envFile);
    const meta = JSON.parse(fs.readFileSync(path.join(workDir, "batch1-meta.json"), "utf8"));
    const info = await checkBatchStatus(apiKey, meta.latestBatchId);
    console.log(JSON.stringify({ id: info.id, status: info.processing_status, counts: info.request_counts }));
  } else if (process.argv.includes("--assemble")) {
    const apiKey = loadApiKey(envFile);
    await downloadAndAssemble(apiKey, workDir);
  } else {
    console.error("Specify --submit, --status, --assemble, --retry-failed, or --validate");
    process.exit(1);
  }
}
