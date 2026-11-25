import { buildDocumentBlock, requestCitedSummary } from "../../lib/anthropic-summary.js";

function formatPassageTitle(result) {
  const book = String(result.book || "").toUpperCase();
  const chapter = result.chapter ?? "";
  if (result.verseStart) {
    const range =
      result.verseEnd && result.verseEnd !== result.verseStart
        ? `:${result.verseStart}–${result.verseEnd}`
        : `:${result.verseStart}`;
    return `${book} ${chapter}${range}`;
  }
  return `${book} ${chapter}`.trim();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*"); // Adjust the origin as needed

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { query, searchResults } = req.body || {};
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

  if (!ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set");
    return res.status(500).json({ error: "API key not configured" });
  }

  if (!query || !searchResults || !Array.isArray(searchResults)) {
    return res.status(400).json({ error: "Invalid request: query and searchResults required" });
  }

  try {
    // Use only top 3 results with non-empty text for summary
    const topResults = searchResults
      .slice(0, 3)
      .filter((r) => r && typeof r.content === "string" && r.content.trim().length > 0);

    if (topResults.length === 0) {
      return res.status(400).json({ error: "Invalid request: searchResults must include passage text" });
    }

    const documents = topResults.map((result) =>
      buildDocumentBlock({
        data: result.content,
        title: formatPassageTitle(result),
        context: "Scripture passage from the World English Bible (WEB)",
      })
    );

    const instruction = `You are a concise Biblical scholar assisting a reader with their query: "${query}"

Base your response strictly on the provided Scripture passages. Do not fabricate verses, alter Scripture wording, or rely on passages that were not provided. If the provided passages do not directly address the query, say so briefly and plainly instead of inventing a connection.

Answer naturally in plain, clear prose under 100 words, grounded in conservative theology. Avoid stitching together fragmented quotes with ellipses; let the citations link back to the text. For factual or biographical questions, answer directly from the passages without forcing an extra moral at the end.`;

    const result = await requestCitedSummary({
      apiKey: ANTHROPIC_API_KEY,
      maxTokens: 8192,
      documents,
      instruction,
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error("Error generating summary:", error);
    return res.status(500).json({ error: "Failed to generate summary" });
  }
}
