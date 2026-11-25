// Bible search with Transformers.js + BM25 hybrid recall
import { pipeline, type FeatureExtractionPipeline } from '@xenova/transformers'
import type { SearchResult, SummaryData } from './bible-types'
import { loadEmbeddingData, getEmbeddingData, getLoadedBibleVerses, getLoadedPericopes, getVerseRangeText, loadPericopeAtlas } from './bible-data'
import { fuseHybridResults, getOrBuildBm25Index } from './bm25-search'
import { attachVerseRanges } from './verse-ranges'

const BGE_QUERY_INSTRUCTION = "Represent this sentence for searching relevant passages: "

let modelPipeline: FeatureExtractionPipeline | null = null

export async function loadModel(
  modelName: string = "Xenova/bge-large-en-v1.5",
  onProgress?: (message: string) => void
): Promise<FeatureExtractionPipeline> {
  if (modelPipeline) return modelPipeline

  try {
    onProgress?.("Loading search model...")
    modelPipeline = await pipeline('feature-extraction', modelName)
    onProgress?.("Model loaded successfully")
    return modelPipeline
  } catch (error) {
    console.error('Error loading model:', error)
    throw error
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom > 0 ? dotProduct / denom : 0
}

export async function searchBible(
  query: string,
  selectedBooks: string[],
  onProgress?: (message: string) => void
): Promise<SearchResult[]> {
  if (!modelPipeline) {
    throw new Error("Model not loaded. Call loadModel() first.")
  }

  onProgress?.("Generating query embedding...")

  // BAAI/bge-large-en-v1.5 expects CLS pooling + the retrieval query instruction
  const formattedQuery = `${BGE_QUERY_INSTRUCTION}${query.trim()}`
  const output = await modelPipeline(formattedQuery, { pooling: "cls", normalize: true })
  const queryEmbedding = Array.from(output.data as Float32Array)

  // Load embedding data for selected books
  await loadEmbeddingData(selectedBooks, onProgress)

  onProgress?.("Searching Bible...")

  let results: SearchResult[] = []

  for (const book of selectedBooks) {
    const bookEmbeddings = getEmbeddingData(book)

    if (!bookEmbeddings || bookEmbeddings.length === 0) continue

    const bookResults = bookEmbeddings.map(entry => ({
      book: book.toLowerCase(),
      chapter: entry.metadata.chapter,
      testament: entry.metadata.testament,
      content: entry.content,
      similarity: cosineSimilarity(queryEmbedding, entry.embedding),
      ...(typeof entry.metadata.verseStart === 'number' ? { verseStart: entry.metadata.verseStart } : {}),
      ...(typeof entry.metadata.verseEnd === 'number' ? { verseEnd: entry.metadata.verseEnd } : {}),
    }))

    results = results.concat(
      bookResults.filter(
        result => !isNaN(result.similarity) && isFinite(result.similarity)
      )
    )
  }

  results.sort((a, b) => b.similarity - a.similarity)
  const denseTop = await attachVerseRanges(results.slice(0, 50), {
    hydrateText: getVerseRangeText,
  })

  const pericopes = getLoadedPericopes() ?? (await loadPericopeAtlas())
  const bm25Index = getOrBuildBm25Index(getLoadedBibleVerses(), pericopes)
  const finalResults = bm25Index
    ? fuseHybridResults(
        denseTop,
        bm25Index.search(query.trim(), { books: selectedBooks, limit: 50 }),
        { denseWeight: 0.80, bm25Weight: 0.20, rrfK: 60, limit: 50 }
      )
    : denseTop

  onProgress?.("Search complete")

  return finalResults
}

export async function getSummaryWithCitations(
  query: string,
  searchResults: SearchResult[]
): Promise<SummaryData | null> {
  try {
    const response = await fetch("/api/summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, searchResults })
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    if (!data || typeof data.summary !== "string") return null
    return {
      summary: data.summary,
      segments: Array.isArray(data.segments) ? data.segments : undefined,
      citations: Array.isArray(data.citations) ? data.citations : undefined,
    }
  } catch (error) {
    console.error("Error getting summary:", error)
    return null
  }
}

export async function getSummary(
  query: string,
  searchResults: SearchResult[]
): Promise<string | null> {
  const data = await getSummaryWithCitations(query, searchResults)
  return data?.summary ?? null
}

export async function logSearch(query: string): Promise<void> {
  // Log-search disabled - no logging needed
  return
}
