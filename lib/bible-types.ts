// Type definitions for Bible app

export interface BibleVerse {
  b: string  // book abbreviation
  c: string  // chapter number
  v: string  // verse number
  text: string
}

export interface EmbeddingEntry {
  content: string
  metadata: {
    book: string
    chapter: number
    testament: string
    verseStart?: number
    verseEnd?: number
  }
  embedding: number[]
}

export interface SearchResult {
  book: string
  chapter: number
  testament: string
  content: string
  similarity: number
  sentiment?: number
  verseStart?: number // first verse the passage covers, when known
  verseEnd?: number
  matchSource?: 'dense' | 'bm25' | 'hybrid'
}

export interface SummaryCitation {
  id: number
  type?: string
  documentIndex: number
  documentTitle: string
  citedText: string
  startCharIndex?: number
  endCharIndex?: number
}

export interface SummarySegment {
  text: string
  citations: SummaryCitation[]
}

export interface SummaryData {
  summary: string
  segments?: SummarySegment[]
  citations?: SummaryCitation[]
}

export interface LoadingProgress {
  stage: 'model' | 'bible' | 'embeddings' | 'complete'
  message: string
  progress: number
}
