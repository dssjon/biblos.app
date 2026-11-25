export const SUMMARY_MODEL = "claude-opus-5-5";
export const SUMMARY_EFFORT = "medium";
export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";

export function buildDocumentBlock({ data, title, context }) {
  const block = {
    type: "document",
    source: {
      type: "text",
      media_type: "text/plain",
      data: String(data ?? ""),
    },
    title: String(title ?? ""),
    citations: { enabled: true },
  };
  if (context) {
    block.context = String(context);
  }
  return block;
}

export function parseAnthropicCitedResponse(data) {
  if (!data || data.stop_reason === "max_tokens" || data.stop_reason === "refusal") {
    throw new Error("Anthropic did not return a complete summary");
  }

  const contentBlocks = Array.isArray(data.content) ? data.content : [];
  const hasAnyCitations = contentBlocks.some(
    (block) =>
      block?.type === "text" &&
      Array.isArray(block.citations) &&
      block.citations.length > 0
  );

  const citationKeyToItem = new Map();
  const citations = [];
  const segments = [];
  const textParts = [];
  let sawTextBlock = false;
  let separatedByNonText = false;

  for (const block of contentBlocks) {
    if (!block || block.type !== "text" || typeof block.text !== "string") {
      if (sawTextBlock) {
        separatedByNonText = true;
      }
      continue;
    }

    const rawCitations = Array.isArray(block.citations) ? block.citations : [];
    const blockCitations = [];

    for (const raw of rawCitations) {
      if (!raw || typeof raw !== "object") continue;
      const documentIndex =
        typeof raw.document_index === "number" ? raw.document_index : 0;
      const documentTitle =
        typeof raw.document_title === "string" ? raw.document_title : "";
      const citedText =
        typeof raw.cited_text === "string" ? raw.cited_text : "";
      const startCharIndex =
        typeof raw.start_char_index === "number" ? raw.start_char_index : undefined;
      const endCharIndex =
        typeof raw.end_char_index === "number" ? raw.end_char_index : undefined;

      const dedupKey = `${documentIndex}:${startCharIndex ?? ""}:${endCharIndex ?? ""}:${citedText}`;
      let item = citationKeyToItem.get(dedupKey);
      if (!item) {
        item = {
          id: citations.length + 1,
          type: raw.type || "char_location",
          documentIndex,
          documentTitle,
          citedText,
          ...(startCharIndex !== undefined ? { startCharIndex } : {}),
          ...(endCharIndex !== undefined ? { endCharIndex } : {}),
        };
        citationKeyToItem.set(dedupKey, item);
        citations.push(item);
      }
      blockCitations.push(item);
    }

    // With native citations enabled, Claude splits single sentences across adjacent
    // text blocks; join them directly with "" so sentences are never shattered.
    // Only insert paragraph breaks when non-cited text blocks were separated by
    // thinking/non-text blocks.
    if (sawTextBlock && separatedByNonText && !hasAnyCitations) {
      textParts.push("\n\n");
    }

    textParts.push(block.text);
    segments.push({
      text: block.text,
      citations: blockCitations,
    });

    sawTextBlock = true;
    separatedByNonText = false;
  }

  const summary = textParts.join("").trim();
  if (!summary) {
    throw new Error("Anthropic did not return a complete summary");
  }

  return {
    summary,
    segments,
    citations,
  };
}

export async function requestCitedSummary({
  apiKey,
  maxTokens,
  documents,
  instruction,
  fetchImpl = globalThis.fetch,
}) {
  const response = await fetchImpl(ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: SUMMARY_MODEL,
      // Opus 5.5 always thinks, and thinking counts toward max_tokens.
      max_tokens: maxTokens,
      // Effort sets how much it thinks: low, medium (the default), high, xhigh or max.
      output_config: { effort: SUMMARY_EFFORT },
      messages: [
        {
          role: "user",
          content: [
            ...documents,
            {
              type: "text",
              text: instruction,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text?.().catch(() => "");
    if (errorText) {
      console.error("Anthropic API error:", errorText);
    }
    throw new Error(`Anthropic API error: ${response.status}`);
  }

  const data = await response.json();
  return parseAnthropicCitedResponse(data);
}
