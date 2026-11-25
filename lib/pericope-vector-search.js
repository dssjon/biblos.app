// Server-side contextual multilingual pericope vector search + canonical WEB hydration
// + server-side Pericope BM25 fusion.
// Loads public/data/pericope-embeddings.bin (~4.33 MB int8 flat binary) into RAM once
// (<10 ms), scores all 4,421 pericopes in <3 ms, and ALWAYS hydrates exact verbatim
// canonical WEB Scripture from engwebp_vpl.xml (never altering Scripture text).

import fs from "node:fs";
import path from "node:path";

export const DEFAULT_OPENAI_EMBED_URL = "https://api.openai.com/v1/embeddings";
export const DEFAULT_OPENAI_EMBED_MODEL = "text-embedding-3-large";
export const DEFAULT_OPENAI_EMBED_DIMS = 1024;
export const DEFAULT_OPENAI_EMBED_TIMEOUT_MS = 4000;

const MAGIC_STR = "BPE1";

const NT_BOOKS = new Set([
  "mat", "mrk", "luk", "jhn", "act", "rom", "1co", "2co", "gal", "eph",
  "php", "col", "1th", "2th", "1ti", "2ti", "tit", "phm", "heb", "jas",
  "1pe", "2pe", "1jn", "2jn", "3jn", "jud", "rev",
]);

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
};

const BM25_STOPWORDS = new Set([
  "a", "about", "an", "and", "are", "as", "at", "be", "but", "by",
  "can", "could", "did", "do", "does", "for", "from", "had", "has", "have",
  "he", "her", "him", "his", "how", "i", "in", "into", "is", "it", "its",
  "me", "my", "not", "of", "on", "or", "our", "said", "say", "saying",
  "she", "should", "so", "that", "the", "their", "them", "then", "there",
  "they", "this", "to", "us", "was", "we", "were", "what", "when", "where",
  "which", "who", "will", "with", "would", "you", "your",
]);

const TOKEN_ALIASES = {
  psalms: "psalm",
  proverbs: "proverb",
  corinthians: "corinthian",
  thessalonians: "thessalonian",
  philippians: "philippian",
  colossians: "colossian",
  ephesians: "ephesian",
  galatians: "galatian",
  romans: "roman",
  hebrews: "hebrew",
  quick: "swift",
};

function decodeXmlEntities(value) {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function parseVplChapters(xmlText) {
  const chapters = new Map();
  const pattern = /<v b="([^"]+)" c="(\d+)" v="(\d+)"\s*(?:\/>|>([\s\S]*?)<\/v>)/g;
  for (const m of xmlText.matchAll(pattern)) {
    const key = `${m[1].toLowerCase()}:${Number(m[2])}`;
    if (!chapters.has(key)) chapters.set(key, []);
    const decoded = m[4] === undefined ? null : decodeXmlEntities(m[4]).trim();
    chapters.get(key).push({
      verse: Number(m[3]),
      text: decoded && decoded.length > 0 ? decoded : null,
    });
  }
  return chapters;
}

export function tokenizeForServerBm25(text) {
  const matches = String(text ?? "").toLowerCase().match(/[a-z0-9]+/g);
  if (!matches) return [];
  const tokens = [];
  for (const raw of matches) {
    if (raw.length <= 1 || BM25_STOPWORDS.has(raw)) continue;
    tokens.push(TOKEN_ALIASES[raw] ?? raw);
  }
  return tokens;
}

function buildPericopeBm25(pericopes, canonicalTexts) {
  const df = new Map();
  const docs = pericopes.map((p, idx) => {
    const bookName = BOOK_FULL_NAMES[p.book] || p.book;
    const metaParts = [
      p.title || "",
      ...(p.altTitles || []),
      ...(p.speakers || []).filter((s) => s && s.toLowerCase() !== "narrator"),
      ...(p.seekerQueries || []),
      ...(p.lexicalBridges || []),
    ];
    const searchable = `${bookName} ${p.chapter} ${metaParts.join(" ")} ${canonicalTexts[idx]}`;
    const searchableLower = searchable.toLowerCase().replace(/\s+/g, " ");
    const tokens = tokenizeForServerBm25(searchable);
    const tf = new Map();
    for (const tok of tokens) {
      tf.set(tok, (tf.get(tok) ?? 0) + 1);
    }
    for (const tok of tf.keys()) {
      df.set(tok, (df.get(tok) ?? 0) + 1);
    }
    return { idx, length: tokens.length, tf, searchableLower };
  });

  const totalLen = docs.reduce((s, d) => s + d.length, 0);
  const avgDocLen = docs.length > 0 ? totalLen / docs.length : 1;
  const idf = new Map();
  const n = docs.length;
  for (const [term, freq] of df.entries()) {
    idf.set(term, Math.log((n - freq + 0.5) / (freq + 0.5) + 1));
  }
  return { docs, idf, avgDocLen, k1: 1.2, b: 0.75 };
}

let cachedIndex = undefined;

export function resetContextualPericopeIndexCache() {
  cachedIndex = undefined;
}

export function loadContextualPericopeIndex(customPaths = null) {
  if (!customPaths && cachedIndex !== undefined) {
    return cachedIndex;
  }

  // Use static path.join(process.cwd(), ...) literals directly so Next.js / @vercel/nft
  // traces these exact 4 assets into the /api/search serverless bundle without dragging
  // in public/data/*.zip archives.
  const binPath =
    customPaths?.binPath ||
    (customPaths?.root
      ? path.join(customPaths.root, "public", "data", "pericope-embeddings.bin")
      : path.join(process.cwd(), "public", "data", "pericope-embeddings.bin"));
  const pericopesPath =
    customPaths?.pericopesPath ||
    (customPaths?.root
      ? path.join(customPaths.root, "public", "data", "pericopes.json")
      : path.join(process.cwd(), "public", "data", "pericopes.json"));
  const xmlPath =
    customPaths?.xmlPath ||
    (customPaths?.root
      ? path.join(customPaths.root, "engwebp_vpl.xml")
      : path.join(process.cwd(), "engwebp_vpl.xml"));
  const metaPath =
    customPaths?.metaPath ||
    (customPaths?.root
      ? path.join(customPaths.root, "public", "data", "pericope-embeddings.meta.json")
      : path.join(process.cwd(), "public", "data", "pericope-embeddings.meta.json"));

  if (!fs.existsSync(binPath) || !fs.existsSync(pericopesPath) || !fs.existsSync(xmlPath)) {
    if (!customPaths) cachedIndex = null;
    return null;
  }

  try {
    const binBuf = fs.readFileSync(binPath);
    if (binBuf.length < 16 || binBuf.subarray(0, 4).toString("ascii") !== MAGIC_STR) {
      throw new Error("Invalid pericope-embeddings.bin header");
    }

    const count = binBuf.readUInt32LE(4);
    const dims = binBuf.readUInt32LE(8);
    const flags = binBuf.readUInt32LE(12);
    const expectedBytes = 16 + count * 4 + count * dims;
    if (binBuf.length !== expectedBytes) {
      throw new Error(`Unexpected binary size: got ${binBuf.length}, expected ${expectedBytes}`);
    }

    // Read little-endian float32 scales explicitly (alignment- and endianness-safe)
    const scales = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      scales[i] = binBuf.readFloatLE(16 + i * 4);
    }
    const vectors = new Int8Array(binBuf.buffer, binBuf.byteOffset + 16 + count * 4, count * dims);

    const atlas = JSON.parse(fs.readFileSync(pericopesPath, "utf8"));
    const pericopes = atlas?.pericopes;
    if (!Array.isArray(pericopes) || pericopes.length !== count) {
      throw new Error(`Pericope count mismatch: atlas=${pericopes?.length}, bin=${count}`);
    }

    const chaptersMap = parseVplChapters(fs.readFileSync(xmlPath, "utf8"));
    const canonicalTexts = new Array(count);
    const normalizedPericopes = new Array(count);

    for (let i = 0; i < count; i++) {
      const p = pericopes[i];
      const book = String(p.book).toLowerCase();
      const chapter = Number(p.chapter);
      const verseStart = Number(p.verseStart);
      const verseEnd = Number(p.verseEnd);
      const chVerses = chaptersMap.get(`${book}:${chapter}`) || [];
      const text = chVerses
        .filter((v) => v.verse >= verseStart && v.verse <= verseEnd && v.text !== null)
        .map((v) => v.text)
        .join("\n");

      canonicalTexts[i] = text;
      normalizedPericopes[i] = {
        book,
        chapter,
        testament: NT_BOOKS.has(book) ? "NT" : "OT",
        verseStart,
        verseEnd,
        title: p.title || "",
        altTitles: p.altTitles || [],
        speakers: p.speakers || [],
        seekerQueries: p.seekerQueries || [],
        lexicalBridges: p.lexicalBridges || [],
      };
    }

    let meta = null;
    if (fs.existsSync(metaPath)) {
      meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    }

    const index = {
      count,
      dims,
      flags,
      scales,
      vectors,
      pericopes: normalizedPericopes,
      canonicalTexts,
      meta,
      bm25: null, // built lazily on first server-side BM25 search
    };

    if (!customPaths) cachedIndex = index;
    return index;
  } catch (error) {
    console.warn("Contextual pericope vector index unavailable:", error?.message || error);
    if (!customPaths) cachedIndex = null;
    return null;
  }
}

export function l2Normalize(vec) {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) sumSq += vec[i] * vec[i];
  const inv = sumSq > 0 ? 1 / Math.sqrt(sumSq) : 1;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] * inv;
  return out;
}

// Calibrates text-embedding-3-large (1024d) raw cosine + corpus z-score onto Biblos's
// [0, 0.995] similarity scale where 0.45 is the UI abstention threshold.
// Strictly monotonic in rawCosine for any fixed query (preserves exact cosine ranking).
export function calibrateContextualSimilarity(rawCosine, zScore = 0) {
  const zBonus = 0.03 * Math.min(4.0, Math.max(0, zScore - 4.0));
  const effective = rawCosine + zBonus;
  const threshold = 0.275;
  if (effective <= threshold) {
    return Number(Math.max(0, (effective / threshold) * 0.445).toFixed(4));
  }
  const scaled = 0.455 + ((effective - threshold) / (0.95 - threshold)) * 0.52;
  return Number(Math.min(0.995, scaled).toFixed(4));
}

// Scores all 4,421 int8 contextual pericope vectors in RAM (<3 ms) with 8x unrolled inner loop
// and hydrates exact verbatim canonical WEB Scripture on every returned candidate.
export function scorePericopeVectors(queryVector, index, options = {}) {
  const limit = Math.min(200, Math.max(1, Number(options.limit ?? 50)));
  const bookFilter =
    Array.isArray(options.books) && options.books.length > 0
      ? new Set(options.books.map((b) => String(b).toLowerCase()))
      : null;

  const { count, dims, scales, vectors, pericopes, canonicalTexts } = index;
  if (!queryVector || queryVector.length !== dims) {
    throw new Error(`Query vector dim mismatch: got ${queryVector?.length}, expected ${dims}`);
  }

  const q = l2Normalize(queryVector);
  const rawScores = new Float32Array(count);

  let sum = 0;
  const dimsUnrolled = dims - (dims % 8);
  for (let i = 0; i < count; i++) {
    const base = i * dims;
    let dot0 = 0, dot1 = 0, dot2 = 0, dot3 = 0;
    let d = 0;
    for (; d < dimsUnrolled; d += 8) {
      const b = base + d;
      dot0 += q[d] * vectors[b] + q[d + 1] * vectors[b + 1];
      dot1 += q[d + 2] * vectors[b + 2] + q[d + 3] * vectors[b + 3];
      dot2 += q[d + 4] * vectors[b + 4] + q[d + 5] * vectors[b + 5];
      dot3 += q[d + 6] * vectors[b + 6] + q[d + 7] * vectors[b + 7];
    }
    let dot = dot0 + dot1 + dot2 + dot3;
    for (; d < dims; d++) {
      dot += q[d] * vectors[base + d];
    }
    const score = dot * scales[i];
    rawScores[i] = score;
    sum += score;
  }

  const mean = sum / count;
  let varSum = 0;
  for (let i = 0; i < count; i++) {
    const diff = rawScores[i] - mean;
    varSum += diff * diff;
  }
  const std = Math.sqrt(varSum / count) || 1;

  // Maintain top-K indices without sorting all 4,421 objects
  const top = [];
  for (let i = 0; i < count; i++) {
    if (bookFilter && !bookFilter.has(pericopes[i].book)) continue;
    const sc = rawScores[i];
    if (top.length < limit) {
      top.push({ idx: i, raw: sc });
      if (top.length === limit) top.sort((a, b) => b.raw - a.raw);
    } else if (sc > top[limit - 1].raw) {
      // Insertion into sorted small top-K array
      let pos = limit - 1;
      while (pos > 0 && sc > top[pos - 1].raw) {
        top[pos] = top[pos - 1];
        pos--;
      }
      top[pos] = { idx: i, raw: sc };
    }
  }
  if (top.length < limit) top.sort((a, b) => b.raw - a.raw);

  return top.map(({ idx, raw }) => {
    const p = pericopes[idx];
    const z = (raw - mean) / std;
    return {
      book: p.book,
      chapter: p.chapter,
      testament: p.testament,
      content: canonicalTexts[idx],
      similarity: calibrateContextualSimilarity(raw, z),
      rawCosine: Number(raw.toFixed(6)),
      verseStart: p.verseStart,
      verseEnd: p.verseEnd,
      matchSource: "dense",
    };
  });
}

export function searchPericopeBm25(query, index, options = {}) {
  const limit = Math.min(100, Math.max(1, Number(options.limit ?? 50)));
  const bookFilter =
    Array.isArray(options.books) && options.books.length > 0
      ? new Set(options.books.map((b) => String(b).toLowerCase()))
      : null;

  const queryTerms = Array.from(new Set(tokenizeForServerBm25(query)));
  if (queryTerms.length === 0) return [];

  if (!index.bm25) {
    index.bm25 = buildPericopeBm25(index.pericopes, index.canonicalTexts);
  }

  const { docs, idf, avgDocLen, k1, b } = index.bm25;
  const normalizedPhrase = String(query ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const phraseWords = normalizedPhrase ? normalizedPhrase.split(" ") : [];
  const checkExactPhrase =
    normalizedPhrase.length >= 6 && phraseWords.length >= 2 && phraseWords.length <= 6;
  const scored = [];

  for (const doc of docs) {
    const p = index.pericopes[doc.idx];
    if (bookFilter && !bookFilter.has(p.book)) continue;

    let score = 0;
    let matchedTerms = 0;
    let maxMatchedIdf = 0;

    for (const term of queryTerms) {
      const freq = doc.tf.get(term);
      if (!freq) continue;
      const termIdf = idf.get(term) ?? 0;
      matchedTerms += 1;
      if (termIdf > maxMatchedIdf) maxMatchedIdf = termIdf;
      const denom = freq + k1 * (1 - b + (b * doc.length) / avgDocLen);
      score += termIdf * ((freq * (k1 + 1)) / denom);
    }

    const exactPhraseMatch =
      checkExactPhrase && matchedTerms === queryTerms.length && doc.searchableLower.includes(normalizedPhrase);
    if (exactPhraseMatch) {
      score += 6.0;
    }

    if (score > 0) {
      scored.push({
        book: p.book,
        chapter: p.chapter,
        testament: p.testament,
        content: index.canonicalTexts[doc.idx],
        similarity: 0,
        verseStart: p.verseStart,
        verseEnd: p.verseEnd,
        bm25Score: score,
        matchedTerms,
        queryTermCoverage: matchedTerms / queryTerms.length,
        maxMatchedIdf,
        exactPhraseMatch,
        matchSource: "bm25",
      });
    }
  }

  scored.sort((a, b) => b.bm25Score - a.bm25Score);
  return scored.slice(0, limit);
}

function passageOverlapRatio(a, b) {
  if (String(a.book || "").toLowerCase() !== String(b.book || "").toLowerCase() || Number(a.chapter) !== Number(b.chapter)) {
    return 0;
  }
  if (!a.verseStart || !a.verseEnd || !b.verseStart || !b.verseEnd) {
    return String(a.content || "").trim() === String(b.content || "").trim() ? 1 : 0;
  }
  const start = Math.max(a.verseStart, b.verseStart);
  const end = Math.min(a.verseEnd, b.verseEnd);
  if (end < start) return 0;
  const overlap = end - start + 1;
  const unionSpan = Math.max(a.verseEnd, b.verseEnd) - Math.min(a.verseStart, b.verseStart) + 1;
  return overlap / unionSpan;
}

export function fuseContextualAndBm25(denseResults, bm25Results, options = {}) {
  const denseWeight = options.denseWeight ?? 0.82;
  const bm25Weight = options.bm25Weight ?? 0.18;
  const rrfK = options.rrfK ?? 60;
  const limit = options.limit ?? 50;
  const minThreshold = options.minThreshold ?? 0.45;
  const minBm25OnlyScore = options.minBm25OnlyScore ?? 11.5;
  const minBm25OnlyTerms = options.minBm25OnlyTerms ?? 2;
  const minBm25RareIdf = options.minBm25RareIdf ?? 6.5;

  const candidates = denseResults.map((raw, idx) => ({
    result: {
      book: String(raw.book).toLowerCase(),
      chapter: Number(raw.chapter),
      testament: raw.testament || (NT_BOOKS.has(String(raw.book).toLowerCase()) ? "NT" : "OT"),
      content: raw.content,
      similarity: Number(raw.similarity),
      ...(typeof raw.verseStart === "number" ? { verseStart: raw.verseStart } : {}),
      ...(typeof raw.verseEnd === "number" ? { verseEnd: raw.verseEnd } : {}),
      matchSource: "dense",
    },
    denseRank: idx + 1,
    denseSim: Number(raw.similarity),
    bm25Rank: undefined,
    bm25Score: 0,
    bm25Terms: 0,
    bm25Coverage: 0,
    bm25MaxIdf: 0,
    bm25ExactPhrase: false,
  }));

  for (let idx = 0; idx < (bm25Results?.length || 0); idx++) {
    const bm = bm25Results[idx];
    if (!bm || !bm.book || !bm.content) continue;
    const bmAsResult = {
      book: String(bm.book).toLowerCase(),
      chapter: Number(bm.chapter),
      testament: bm.testament || (NT_BOOKS.has(String(bm.book).toLowerCase()) ? "NT" : "OT"),
      content: bm.content,
      similarity: 0,
      ...(typeof bm.verseStart === "number" ? { verseStart: bm.verseStart } : {}),
      ...(typeof bm.verseEnd === "number" ? { verseEnd: bm.verseEnd } : {}),
      matchSource: "bm25",
    };

    const existing = candidates.find((c) => passageOverlapRatio(c.result, bmAsResult) >= 0.55);
    if (existing) {
      if (existing.bm25Rank === undefined) {
        existing.bm25Rank = idx + 1;
        existing.bm25Score = Number(bm.bm25Score ?? 0);
        existing.bm25Terms = Number(bm.matchedTerms ?? 0);
        existing.bm25Coverage = Number(bm.queryTermCoverage ?? 0);
        existing.bm25MaxIdf = Number(bm.maxMatchedIdf ?? 0);
        existing.bm25ExactPhrase = Boolean(bm.exactPhraseMatch);
        existing.result.matchSource = "hybrid";
      }
    } else {
      candidates.push({
        result: bmAsResult,
        denseRank: undefined,
        denseSim: 0,
        bm25Rank: idx + 1,
        bm25Score: Number(bm.bm25Score ?? 0),
        bm25Terms: Number(bm.matchedTerms ?? 0),
        bm25Coverage: Number(bm.queryTermCoverage ?? 0),
        bm25MaxIdf: Number(bm.maxMatchedIdf ?? 0),
        bm25ExactPhrase: Boolean(bm.exactPhraseMatch),
      });
    }
  }

  const maxRrf = denseWeight / (rrfK + 1) + bm25Weight / (rrfK + 1);
  const topDenseSim = denseResults.length > 0 ? Number(denseResults[0].similarity) : 0;

  const scored = candidates.map((c) => {
    const exactLexicalHit =
      (c.bm25Coverage >= 0.75 && c.bm25Terms >= 3 && c.bm25Score >= 14.0) ||
      (c.bm25ExactPhrase && topDenseSim >= minThreshold);
    const effectiveBm25Weight = exactLexicalHit ? Math.max(denseWeight + 0.05, 0.85) : bm25Weight;

    const rrf =
      (c.denseRank !== undefined ? denseWeight / (rrfK + c.denseRank) : 0) +
      (c.bm25Rank !== undefined ? effectiveBm25Weight / (rrfK + c.bm25Rank) : 0);

    // Guard BM25-only rescues: if the multilingual dense model sees no biblical signal
    // (topDenseSim < minThreshold), require >=60% query-term coverage so stray coincidental
    // terms (e.g., "python" + "inner" in a coding query) never bypass abstention.
    const strongBm25 =
      c.bm25Score >= minBm25OnlyScore &&
      (c.bm25Terms >= minBm25OnlyTerms || c.bm25MaxIdf >= minBm25RareIdf) &&
      (topDenseSim >= minThreshold || c.bm25Coverage >= 0.60);

    let similarity;
    if (c.denseRank !== undefined) {
      const bm25Lift =
        c.bm25Rank !== undefined && (c.denseSim > minThreshold || strongBm25)
          ? Math.min(0.06, ((bm25Weight / (rrfK + c.bm25Rank)) / maxRrf) * 0.2)
          : 0;
      similarity = Number(Math.min(0.995, c.denseSim + bm25Lift).toFixed(4));
    } else if (strongBm25) {
      const baseFloor = Math.max(minThreshold + 0.02, Math.min(topDenseSim, 0.70));
      const lexicalNorm = Math.min(1, c.bm25Score / 22);
      similarity = Number(Math.min(0.92, baseFloor + lexicalNorm * 0.12).toFixed(4));
    } else {
      similarity = Number(
        Math.min(minThreshold - 0.01, (c.bm25Score / minBm25OnlyScore) * 0.35).toFixed(4)
      );
    }

    return {
      rrf,
      result: {
        ...c.result,
        similarity,
      },
    };
  });

  scored.sort((a, b) => {
    const aPass = a.result.similarity > minThreshold ? 1 : 0;
    const bPass = b.result.similarity > minThreshold ? 1 : 0;
    if (aPass !== bPass) return bPass - aPass;
    if (b.rrf !== a.rrf) return b.rrf - a.rrf;
    return b.result.similarity - a.result.similarity;
  });

  return scored.slice(0, limit).map((s) => s.result);
}

export async function embedQueryOpenAI(query, options = {}) {
  const apiKey = options.apiKey;
  if (!apiKey || String(apiKey).trim().length === 0) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  const apiUrl = options.apiUrl || DEFAULT_OPENAI_EMBED_URL;
  const model = options.model || DEFAULT_OPENAI_EMBED_MODEL;
  const dimensions = Number(options.dimensions || DEFAULT_OPENAI_EMBED_DIMS);
  const timeoutMs =
    Number.isFinite(Number(options.timeoutMs)) && Number(options.timeoutMs) > 0
      ? Number(options.timeoutMs)
      : DEFAULT_OPENAI_EMBED_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        dimensions,
        input: String(query).trim(),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`OpenAI embedding request failed with status ${response.status}`);
    }

    const payload = await response.json();
    const vec = payload?.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length !== dimensions) {
      throw new Error("OpenAI embedding response missing valid vector");
    }
    return vec;
  } finally {
    clearTimeout(timer);
  }
}

export async function searchContextualPericopes(query, options = {}) {
  const index = options.index ?? loadContextualPericopeIndex();
  if (!index) {
    throw new Error("Contextual pericope vector index unavailable");
  }

  const limit = Math.min(100, Math.max(1, Number(options.limit ?? 50)));
  const model = options.model || index.meta?.model || DEFAULT_OPENAI_EMBED_MODEL;
  const dimensions = Number(options.dimensions || index.dims || DEFAULT_OPENAI_EMBED_DIMS);

  const queryVec = await embedQueryOpenAI(query, {
    apiKey: options.apiKey,
    apiUrl: options.apiUrl,
    model,
    dimensions,
    timeoutMs: options.timeoutMs,
  });

  const denseResults = scorePericopeVectors(queryVec, index, {
    limit,
    books: options.books,
  });

  const bm25Results =
    Array.isArray(options.bm25Candidates) && options.bm25Candidates.length > 0
      ? options.bm25Candidates
      : searchPericopeBm25(query, index, { limit, books: options.books });

  const fused = fuseContextualAndBm25(denseResults, bm25Results, { limit });
  return {
    results: fused,
    denseCount: denseResults.length,
    bm25Count: bm25Results.length,
  };
}
