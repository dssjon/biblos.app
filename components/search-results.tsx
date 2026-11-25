"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ExternalLink } from "lucide-react"
import { getBookFullName } from "@/lib/bible-data"
import type { SearchResult, SummaryCitation, SummaryData } from "@/lib/bible-types"
import { formatVerseRange } from "@/lib/verse-ranges"
import { CitedSummary } from "@/components/cited-summary"

interface SearchResultsProps {
  query: string
  results: SearchResult[]
  keywords: string[]
  summary: string | null
  summaryData?: SummaryData | null
  summaryLoading?: boolean
  selectedKeyword: string | null
  onKeywordClick: (keyword: string) => void
  onViewChapter: (book: string, chapter: number, verseStart?: number, verseEnd?: number) => void
  onShowMore?: () => void
  hasMoreResults?: boolean
}

export function SearchResults({ query, results, keywords, summary, summaryData, summaryLoading, selectedKeyword, onKeywordClick, onViewChapter, onShowMore, hasMoreResults }: SearchResultsProps) {
  const [highlightedResultIndex, setHighlightedResultIndex] = useState<number | null>(null)

  const handleCitationClick = (citation: SummaryCitation) => {
    const idx = citation.documentIndex
    if (idx < 0 || idx >= results.length) return
    setHighlightedResultIndex(idx)
    const el = document.getElementById(`search-result-${idx}`)
    el?.scrollIntoView({ behavior: "smooth", block: "center" })
  }

  const effectiveSummary = summaryData?.summary || summary

  const highlightKeyword = (text: string, keyword: string | null) => {
    if (!keyword) return text

    const regex = new RegExp(`(${keyword})`, 'gi')
    const parts = text.split(regex)

    return parts.map((part, index) =>
      regex.test(part)
        ? `<mark class="bg-yellow-300 dark:bg-yellow-600">${part}</mark>`
        : part
    ).join('')
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Status */}
      <div className="text-center">
        <p className="text-sm text-muted-foreground italic">
          Search complete • Found {results.length} relevant passage{results.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Keywords */}
      {keywords.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 justify-center">
          <span className="text-sm font-semibold text-foreground">Keywords:</span>
          {keywords.map((keyword) => (
            <Badge
              key={keyword}
              variant="secondary"
              onClick={() => onKeywordClick(keyword)}
              className={`px-3 py-1 cursor-pointer transition-colors capitalize font-normal border ${
                selectedKeyword === keyword
                  ? 'bg-yellow-300 dark:bg-yellow-600 border-yellow-400 dark:border-yellow-500 text-foreground'
                  : 'bg-secondary hover:bg-secondary/80 border-border/50'
              }`}
            >
              {keyword}
            </Badge>
          ))}
        </div>
      )}

      {summaryLoading && (
        <Card className="p-6 bg-accent/5 border-accent/30">
          <div className="space-y-3">
            <h3 className="text-lg font-bold text-foreground">Summary</h3>
            <div className="space-y-2 animate-pulse">
              <div className="h-4 bg-muted rounded w-full"></div>
              <div className="h-4 bg-muted rounded w-11/12"></div>
              <div className="h-4 bg-muted rounded w-10/12"></div>
              <div className="h-4 bg-muted rounded w-full"></div>
              <div className="h-4 bg-muted rounded w-9/12"></div>
            </div>
          </div>
        </Card>
      )}

      {!summaryLoading && effectiveSummary && (
        <Card className="p-6 bg-accent/5 border-accent/30">
          <div className="space-y-3">
            <h3 className="text-lg font-bold text-foreground">Summary</h3>
            <CitedSummary
              summary={effectiveSummary}
              segments={summaryData?.segments}
              citations={summaryData?.citations}
              onCitationClick={handleCitationClick}
            />
          </div>
        </Card>
      )}

      {results.length === 0 ? (
        <Card className="p-8 bg-muted/20 border-muted">
          <div className="text-center space-y-2">
            <p className="text-lg font-semibold text-muted-foreground">No Matches Found</p>
            <p className="text-sm text-muted-foreground">
              We couldn't find passages that closely match your search. Try using different keywords or rephrasing your query.
            </p>
          </div>
        </Card>
      ) : (
        <>
          <div className="space-y-4">
            {results.map((result, index) => (
              <Card
                key={index}
                id={`search-result-${index}`}
                className={`group hover:border-accent/50 hover:shadow-md transition-all duration-300 ${
                  highlightedResultIndex === index ? "ring-2 ring-primary border-primary" : ""
                }`}
              >
                <div className="p-6 space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <h3 className="text-2xl font-bold text-foreground">
                      {getBookFullName(result.book)} {result.chapter}{formatVerseRange(result.verseStart, result.verseEnd)}
                    </h3>
                    <Button
                      onClick={() => onViewChapter(result.book, result.chapter, result.verseStart, result.verseEnd)}
                      variant="ghost"
                      size="sm"
                      className="hover:bg-accent/10 hover:text-accent"
                    >
                      <ExternalLink className="w-4 h-4 mr-2" strokeWidth={1.5} />
                      View Chapter
                    </Button>
                  </div>
                  <div className="prose max-w-none">
                    <p
                      className="text-foreground/80 leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: highlightKeyword(result.content, selectedKeyword) }}
                    />
                  </div>
                </div>
              </Card>
            ))}
          </div>

          {hasMoreResults && (
            <div className="flex justify-center mt-6">
              <Button
                onClick={onShowMore}
                variant="outline"
                size="lg"
                className="px-8"
              >
                Show More Results
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
