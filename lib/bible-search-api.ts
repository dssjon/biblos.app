// Bible search using server contextual multilingual pericope embeddings + Pericope BM25
// + Voyage rerank-3-lite, with automatic graceful fallback to hosted HF Space BGE.
import type { SearchResult, SummaryData } from './bible-types'
import { getLoadedBibleVerses, getLoadedPericopes, getVerseRangeText, loadPericopeAtlas } from './bible-data'
import { fuseHybridResults, getOrBuildBm25Index } from './bm25-search'
import { attachVerseRanges } from './verse-ranges'

const API_BASE_URL = 'https://dssjon-biblos-api.hf.space'

// No-op for API compatibility - API doesn't require model loading
export async function loadModel(
  modelName?: string,
  onProgress?: (message: string) => void
): Promise<void> {
  onProgress?.("Connecting to search API...")

  try {
    const response = await fetch(`${API_BASE_URL}/health`)
    if (!response.ok) {
      throw new Error(`API health check failed: ${response.status}`)
    }
    onProgress?.("API connected successfully")
  } catch (error) {
    console.error('API connection error:', error)
    throw new Error('Failed to connect to search API. Please check your internet connection.')
  }
}

export async function searchBible(
  query: string,
  selectedBooks: string[],
  onProgress?: (message: string) => void
): Promise<SearchResult[]> {
  if (!query || query.trim().length === 0) {
    throw new Error("Query cannot be empty")
  }

  const trimmedQuery = query.trim()

  try {
    onProgress?.("Searching Scriptures...")

    // Primary path: call /api/search directly. When server embedding key is present, /api/search
    // scores all 4,421 contextual multilingual pericopes in RAM, hydrates exact canonical WEB
    // verses, fuses with server Pericope BM25, and runs Voyage top-40 rerank in one round-trip.
    // When key is absent or errors, /api/search gracefully falls back to HF Space BGE.
    try {
      const serverResponse = await fetch('/api/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: trimmedQuery,
          limit: 50,
          books: selectedBooks,
        }),
      })

      if (serverResponse.ok) {
        const serverData = await serverResponse.json()
        if (serverData && Array.isArray(serverData.results)) {
          if (serverData.retrievalSource === 'contextual-pericope') {
            onProgress?.("Search complete")
            return serverData.results as SearchResult[]
          }

          // Server fell back to HF Space BGE: attach verse ranges, hydrate canonical WEB text,
          // and fuse with client-side Pericope BM25 when verses are loaded.
          const denseFallback = await attachVerseRanges(serverData.results as SearchResult[], {
            hydrateText: getVerseRangeText,
          })
          const pericopes = getLoadedPericopes() ?? (await loadPericopeAtlas().catch(() => null))
          const bm25Index = getOrBuildBm25Index(getLoadedBibleVerses(), pericopes)
          const fusedFallback =
            !serverData.reranked && bm25Index
              ? fuseHybridResults(
                  denseFallback,
                  bm25Index.search(trimmedQuery, { books: selectedBooks, limit: 50 }),
                  { denseWeight: 0.80, bm25Weight: 0.20, rrfK: 60, limit: 50 }
                )
              : denseFallback
          onProgress?.("Search complete")
          return fusedFallback
        }
      }
    } catch (serverError) {
      console.warn("Primary /api/search unavailable; falling back to direct HF Space hybrid search:", serverError)
    }

    // Legacy direct HF Space BGE fallback (if /api/search itself was unreachable)
    onProgress?.("Searching Bible via API...")
    const [response, pericopes] = await Promise.all([
      fetch(`${API_BASE_URL}/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: trimmedQuery,
          limit: 50,
        }),
      }),
      getLoadedPericopes() ? Promise.resolve(getLoadedPericopes()) : loadPericopeAtlas().catch(() => null),
    ])

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.detail || `API request failed: ${response.status}`)
    }

    const data = await response.json()
    if (!data.results || !Array.isArray(data.results)) {
      throw new Error("Invalid response format from API")
    }

    const rawResults: SearchResult[] = data.results.map((result: any) => ({
      book: String(result.book || '').toLowerCase(),
      chapter: result.chapter,
      testament: result.testament,
      content: result.content,
      similarity: result.similarity,
      ...(typeof result.verseStart === 'number' ? { verseStart: result.verseStart } : {}),
      ...(typeof result.verseEnd === 'number' ? { verseEnd: result.verseEnd } : {}),
    }))

    const denseResults = await attachVerseRanges(rawResults, {
      hydrateText: getVerseRangeText,
    })

    const bm25Index = getOrBuildBm25Index(getLoadedBibleVerses(), pericopes)
    const hybridResults = bm25Index
      ? fuseHybridResults(
          denseResults,
          bm25Index.search(trimmedQuery, { books: selectedBooks, limit: 50 }),
          { denseWeight: 0.80, bm25Weight: 0.20, rrfK: 60, limit: 50 }
        )
      : denseResults

    onProgress?.("Search complete")
    return hybridResults
  } catch (error) {
    console.error("API search error:", error)
    if (error instanceof Error) {
      throw error
    }
    throw new Error("Search failed. Please try again.")
  }
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
