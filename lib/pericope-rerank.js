// Server-side Pericope Atlas loader and Voyage rerank document header builder.
// Enriches ONLY the document string sent to Voyage rerank-3-lite; never alters
// returned canonical Scripture text.
import fs from "node:fs";
import path from "node:path";

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

export function buildPericopeMapFromEntries(pericopes) {
  const map = new Map();
  if (!Array.isArray(pericopes)) return map;
  for (const entry of pericopes) {
    if (!entry || typeof entry.book !== "string") continue;
    const key = `${entry.book.toLowerCase()}:${Number(entry.chapter)}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(entry);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.verseStart - b.verseStart);
  }
  return map;
}

let cachedServerPericopeMap = undefined;

export function loadServerPericopeMap(customPath = null) {
  if (customPath) {
    if (!fs.existsSync(customPath)) return new Map();
    const parsed = JSON.parse(fs.readFileSync(customPath, "utf8"));
    return buildPericopeMapFromEntries(parsed?.pericopes);
  }
  if (cachedServerPericopeMap !== undefined) return cachedServerPericopeMap;
  try {
    const atlasPath = path.join(process.cwd(), "public", "data", "pericopes.json");
    if (!fs.existsSync(atlasPath)) {
      cachedServerPericopeMap = new Map();
      return cachedServerPericopeMap;
    }
    const parsed = JSON.parse(fs.readFileSync(atlasPath, "utf8"));
    cachedServerPericopeMap = buildPericopeMapFromEntries(parsed?.pericopes);
    return cachedServerPericopeMap;
  } catch (error) {
    console.warn("Pericope atlas unavailable for rerank headers:", error?.message || error);
    cachedServerPericopeMap = new Map();
    return cachedServerPericopeMap;
  }
}

export function resetServerPericopeMapCache() {
  cachedServerPericopeMap = undefined;
}

export function findMatchingPericopes(pericopeMap, book, chapter, verseStart, verseEnd) {
  if (!pericopeMap || !book) return [];
  const list = pericopeMap.get(`${String(book).toLowerCase()}:${Number(chapter)}`);
  if (!list || list.length === 0) return [];
  if (typeof verseStart !== "number" || !Number.isFinite(verseStart)) {
    return list;
  }
  const end = typeof verseEnd === "number" && Number.isFinite(verseEnd) ? verseEnd : verseStart;
  const overlapping = list.filter((p) => p.verseStart <= end && p.verseEnd >= verseStart);
  if (overlapping.length <= 1) return overlapping;
  return [...overlapping].sort((a, b) => {
    const overlapA = Math.min(a.verseEnd, end) - Math.max(a.verseStart, verseStart) + 1;
    const overlapB = Math.min(b.verseEnd, end) - Math.max(b.verseStart, verseStart) + 1;
    if (overlapB !== overlapA) return overlapB - overlapA;
    return a.verseStart - b.verseStart;
  });
}

const MAX_RERANK_CONTENT_CHARS = 1600;
const MAX_RERANK_CAUTION_CHARS = 100;

function trimAtWordBoundary(text, maxChars) {
  const str = String(text ?? "");
  if (str.length <= maxChars) return str;
  const cut = str.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > maxChars * 0.7 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export function formatRerankDocument(candidate, pericopeMap) {
  const code = String(candidate?.book || "").toLowerCase();
  const bookFullName = BOOK_FULL_NAMES[code] || code.toUpperCase();
  const chapter = Number(candidate?.chapter || 0);
  const vs = typeof candidate?.verseStart === "number" && Number.isFinite(candidate.verseStart)
    ? candidate.verseStart
    : undefined;
  const ve = typeof candidate?.verseEnd === "number" && Number.isFinite(candidate.verseEnd)
    ? candidate.verseEnd
    : undefined;
  const verseRange =
    vs !== undefined ? (ve !== undefined && ve !== vs ? `:${vs}-${ve}` : `:${vs}`) : "";

  const baseHeader = `${bookFullName} ${chapter}${verseRange}`;
  const matching = findMatchingPericopes(pericopeMap, code, chapter, vs, ve);

  let header = baseHeader;
  if (matching.length > 0) {
    const primary = matching[0];
    const titles = [];
    const seenTitles = new Set();
    if (primary.title) {
      seenTitles.add(primary.title.toLowerCase());
      titles.push(primary.title);
    }
    for (const alt of primary.altTitles || []) {
      if (titles.length >= 2) break;
      if (alt && !seenTitles.has(alt.toLowerCase())) {
        seenTitles.add(alt.toLowerCase());
        titles.push(alt);
      }
    }

    const speakers = [];
    const seenSpeakers = new Set();
    for (const s of primary.speakers || []) {
      if (speakers.length >= 3) break;
      if (s && s.toLowerCase() !== "narrator" && !seenSpeakers.has(s.toLowerCase())) {
        seenSpeakers.add(s.toLowerCase());
        speakers.push(s);
      }
    }
    if (speakers.length === 0 && primary.speakers?.length > 0) {
      speakers.push(primary.speakers[0]);
    }

    const meta = [];
    if (titles.length > 0) meta.push(titles.join(" / "));
    if (speakers.length > 0) meta.push(`Speakers: ${speakers.join(", ")}`);
    const caution = matching.find((p) => typeof p.caution === "string" && p.caution.trim().length > 0)?.caution;
    if (caution) meta.push(`Caution: ${trimAtWordBoundary(caution.trim(), MAX_RERANK_CAUTION_CHARS)}`);

    if (meta.length > 0) {
      header = `${baseHeader} [${meta.join(" | ")}]`;
    }
  }

  // Cover full multi-verse pericopes (p90 <= 1,600 chars) so key verses near the end of a
  // pericope (e.g., "hidden manna" in Rev 2:17 or "eternal life" in John 6/10) are preserved
  // for Voyage rerank-3-lite; returned candidate.content is NEVER mutated.
  const rerankContent = trimAtWordBoundary(candidate?.content ?? "", MAX_RERANK_CONTENT_CHARS);
  return `${header}\n${rerankContent}`;
}
