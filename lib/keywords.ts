// Keyword extraction and sentiment analysis
import Sentiment from 'sentiment'
import { STOPWORDS, SENTIMENT_EXTRAS } from './bible-constants'
import type { SearchResult } from './bible-types'

const sentiment = new Sentiment()

export function extractKeywords(text: string, topN: number = 5): string[] {
  // Convert to lowercase and extract words
  const words = text.toLowerCase().match(/\b\w+\b/g)
  if (!words) return []

  // Filter out stopwords and short words
  const keywords = words.filter(
    word => !STOPWORDS.includes(word) && word.length > 3
  )

  // Count frequencies
  const frequency: Record<string, number> = {}
  keywords.forEach(word => {
    frequency[word] = (frequency[word] || 0) + 1
  })

  // Sort by frequency and return top N
  const sortedKeywords = Object.keys(frequency).sort(
    (a, b) => frequency[b] - frequency[a]
  )

  return sortedKeywords.slice(0, topN)
}

export function analyzeSentiment(text: string): number {
  const result = sentiment.analyze(text, { extras: SENTIMENT_EXTRAS })
  return mapSentimentScore(result.score)
}

function mapSentimentScore(score: number): number {
  if (score > 0) return 1
  if (score < 0) return -1
  return 0
}

export function addSentimentToResults(results: SearchResult[]): SearchResult[] {
  return results.map(result => ({
    ...result,
    sentiment: analyzeSentiment(result.content)
  }))
}
