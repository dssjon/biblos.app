import { buildDocumentBlock, requestCitedSummary } from "../../lib/anthropic-summary.js";
import {
  extractTopCommentaryExcerpts,
  lookupStaticDailySummary,
} from "../../lib/daily-summary-cache.js";

export const config = {
  maxDuration: 60, // Set maximum execution time to 60 seconds
};

// Helper function to capitalize the first letter
function capitalizeFirstLetter(string) {
  if (!string || typeof string !== "string") return "";
  return string.charAt(0).toUpperCase() + string.slice(1);
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { book, chapter, commentaryData } = req.body || {};

    if (!Array.isArray(commentaryData)) {
      return res.status(400).json({ error: "commentaryData must be an array" });
    }

    // Construct Commentary Excerpts (limit to top 4 with non-empty text)
    const commentaryExcerpts = extractTopCommentaryExcerpts(commentaryData, book, chapter);

    if (commentaryExcerpts.length === 0) {
      return res.status(400).json({ error: "commentaryData must include at least one excerpt" });
    }

    // Serve pre-generated cited patristic summary in <5 ms at $0 runtime cost when
    // book + chapter + exact top-4 excerpt fingerprint matches the static cache.
    const cachedSummary = lookupStaticDailySummary(book, chapter, commentaryExcerpts);
    if (cachedSummary) {
      return res.status(200).json(cachedSummary);
    }

    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

    if (!ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: "Anthropic API key is not configured" });
    }

    const documents = commentaryExcerpts.map((item) =>
      buildDocumentBlock({
        data: item.content,
        title: `${item.father_name} — ${item.source_title}`,
        context: `${capitalizeFirstLetter(item.book)} Chapter ${item.chapter} patristic commentary`,
      })
    );

    const instruction = `You are a biblical scholar and theologian. Please provide a concise summary of the most insightful and impactful commentaries from the provided excerpts related to the Book of ${capitalizeFirstLetter(
      book
    )}, Chapter ${chapter}. Focus on capturing the key theological insights presented by each commentator.

Base your summary strictly on the provided commentary excerpts. Attribute each insight only to the commentator who wrote it, and do not add outside claims, fabricated Scripture quotations, or unprovided sources. If an excerpt does not clearly address the chapter, note that honestly rather than extrapolating.

Please structure the summary in a clear and organized manner, highlighting the main points from each commentator. Ensure that the language is accessible to someone familiar with the Bible but not necessarily with scholarly commentaries. Avoid unnecessary repetition and maintain a respectful tone appropriate for theological discussion.`;

    const result = await requestCitedSummary({
      apiKey: ANTHROPIC_API_KEY,
      maxTokens: 16000,
      documents,
      instruction,
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error("Error calling Anthropic API:", error);
    return res.status(500).json({ error: "An error occurred while generating the summary." });
  }
}
