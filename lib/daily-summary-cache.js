// Shared deterministic excerpt extraction & fingerprint lookup for pre-generated
// cited patristic commentary summaries (public/daily-data/commentary-summaries.json).
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const DAILY_SUMMARY_CACHE_REL = path.join("public", "daily-data", "commentary-summaries.json");

export function normalizeCommentaryBook(book) {
  return String(book ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function extractTopCommentaryExcerpts(commentaryData, book, chapter) {
  if (!Array.isArray(commentaryData)) return [];
  return commentaryData
    .slice(0, 4)
    .filter((commentary) => commentary && typeof commentary.txt === "string" && commentary.txt.trim().length > 0)
    .map((commentary) => ({
      father_name: commentary.father_name || "Commentator",
      source_title: commentary.source_title || "Commentary",
      book: commentary.book || book,
      chapter: commentary.chapter ?? chapter,
      content: commentary.txt,
    }));
}

export function computeCommentaryFingerprint(book, chapter, commentaryExcerpts) {
  const payload = {
    book: normalizeCommentaryBook(book),
    chapter: Number(chapter),
    excerpts: (commentaryExcerpts || []).map((item) => ({
      father_name: String(item.father_name || "Commentator").trim(),
      source_title: String(item.source_title || "Commentary").trim(),
      content: String(item.content || "").trim(),
    })),
  };
  return createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex").slice(0, 16);
}

export function buildDailySummaryCacheKey(book, chapter, commentaryExcerpts) {
  const normBook = normalizeCommentaryBook(book);
  const normChapter = Number(chapter);
  const fp = computeCommentaryFingerprint(normBook, normChapter, commentaryExcerpts);
  return `${normBook}:${normChapter}:${fp}`;
}

let loadedCache = undefined;

export function loadStaticDailySummaryCache(customPath = null) {
  if (customPath) {
    if (!fs.existsSync(customPath)) return null;
    return JSON.parse(fs.readFileSync(customPath, "utf8"));
  }
  if (loadedCache !== undefined) return loadedCache;
  try {
    const filePath = path.join(process.cwd(), DAILY_SUMMARY_CACHE_REL);
    if (!fs.existsSync(filePath)) {
      loadedCache = null;
      return null;
    }
    loadedCache = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return loadedCache;
  } catch (error) {
    console.warn("Static daily commentary summaries unavailable; using live Anthropic API:", error?.message || error);
    loadedCache = null;
    return null;
  }
}

export function resetStaticDailySummaryCache() {
  loadedCache = undefined;
}

export function lookupStaticDailySummary(book, chapter, commentaryExcerpts, cacheData = undefined) {
  const cache = cacheData !== undefined ? cacheData : loadStaticDailySummaryCache();
  if (!cache || !cache.entries || typeof cache.entries !== "object") return null;
  const key = buildDailySummaryCacheKey(book, chapter, commentaryExcerpts);
  const hit = cache.entries[key];
  if (!hit || typeof hit.summary !== "string" || hit.summary.trim().length === 0) {
    return null;
  }
  return {
    summary: hit.summary,
    segments: Array.isArray(hit.segments) ? hit.segments : [],
    citations: Array.isArray(hit.citations) ? hit.citations : [],
    cached: true,
  };
}
