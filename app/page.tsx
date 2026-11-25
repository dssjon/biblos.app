"use client"

import { useState, useEffect, useRef } from "react"
import { SearchIcon, BookOpenIcon, Github, Coffee } from "lucide-react"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { ThemeToggle } from "@/components/theme-toggle"
import { AppNav } from "@/components/navigation/app-nav"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { SearchResults } from "@/components/search-results"
import { BibleReader } from "@/components/bible-reader"
import { useReaderHistory } from "@/hooks/use-reader-history"
import { searchBible, getSummaryWithCitations } from "@/lib/bible-search-api"
import { loadInitialBibleData } from "@/lib/bible-data"
import { extractKeywords, addSentimentToResults } from "@/lib/keywords"
import { OLD_TESTAMENT_BOOKS, NEW_TESTAMENT_BOOKS, SEARCH_SUGGESTIONS } from "@/lib/bible-constants"
import type { SearchResult, SummaryData } from "@/lib/bible-types"
import { parseVerseReference, looksLikeVerseReference } from "@/lib/verse-parser"
import { track } from '@vercel/analytics'

export default function Home() {
  const [searchQuery, setSearchQuery] = useState("")
  const [isSearching, setIsSearching] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const [showReader, setShowReader] = useReaderHistory()
  const [selectedBook, setSelectedBook] = useState<string | null>(null)
  const [selectedChapter, setSelectedChapter] = useState<number>(1)
  const [enableSummary, setEnableSummary] = useState(false)
  const [allSearchResults, setAllSearchResults] = useState<SearchResult[]>([])
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [resultLimit, setResultLimit] = useState(3)
  const [keywords, setKeywords] = useState<string[]>([])
  const [summary, setSummary] = useState<string | null>(null)
  const [summaryData, setSummaryData] = useState<SummaryData | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [selectedKeyword, setSelectedKeyword] = useState<string | null>(null)
  const [highlightVerseStart, setHighlightVerseStart] = useState<number | undefined>()
  const [highlightVerseEnd, setHighlightVerseEnd] = useState<number | undefined>()
  const [verseLookupMessage, setVerseLookupMessage] = useState<string | null>(null)
  const [bibleStatus, setBibleStatus] = useState<"loading" | "ready" | "error">("loading")
  const bibleLoadPending = useRef(false)

  useEffect(() => {
    void loadReaderText()
  }, [])

  async function loadReaderText() {
    if (bibleLoadPending.current) return
    bibleLoadPending.current = true
    setBibleStatus("loading")
    try {
      await loadInitialBibleData()
      setBibleStatus("ready")
    } catch (error) {
      console.error("Failed to load Bible text:", error)
      setBibleStatus("error")
    } finally {
      bibleLoadPending.current = false
    }
  }

  const handleSearch = async () => {
    if (isSearching) return

    const query = searchQuery.trim() || getRandomSearchSuggestion()
    setSearchQuery(query)

    // Check if this looks like a verse reference (e.g., "John 3:16", "1 Corinthians 10:13")
    if (looksLikeVerseReference(query)) {
      const parsed = parseVerseReference(query)
      if (parsed) {
        // Track verse lookup with Vercel Analytics
        track('verse_lookup', { query, book: parsed.book, chapter: parsed.chapter })

        // Navigate directly to the Bible reader with highlighting
        setSelectedBook(parsed.book)
        setSelectedChapter(parsed.chapter)
        setHighlightVerseStart(parsed.verseStart)
        setHighlightVerseEnd(parsed.verseEnd)
        setVerseLookupMessage(`Showing ${parsed.bookFullName} ${parsed.chapter}${parsed.verseStart ? `:${parsed.verseStart}${parsed.verseEnd ? `-${parsed.verseEnd}` : ''}` : ''}`)
        setShowReader(true)
        return
      }
    }

    setIsSearching(true)
    setSummary(null)
    setSummaryData(null)
    setSummaryLoading(false)
    setResultLimit(3) // Reset to default on new search
    setVerseLookupMessage(null)

    try {
      // Track search with Vercel Analytics
      track('search', { query })

      // Search entire Bible (Old and New Testament) via API
      const allBooks = [...OLD_TESTAMENT_BOOKS, ...NEW_TESTAMENT_BOOKS]
      const results = await searchBible(query, allBooks)
      const resultsWithSentiment = addSentimentToResults(results)

      // Filter results to only show quality matches (similarity > 0.45)
      const qualityResults = resultsWithSentiment.filter(r => r.similarity > 0.45)
      setAllSearchResults(qualityResults)
      setSearchResults(qualityResults.slice(0, 3))

      // Track search results with Vercel Analytics
      track('search_complete', {
        query,
        resultsCount: qualityResults.length,
        summaryEnabled: enableSummary
      })

      // Extract keywords from displayed results
      const displayedResults = qualityResults.slice(0, 3)
      const combinedText = displayedResults.map(r => r.content).join(' ')
      const extractedKeywords = extractKeywords(combinedText)
      setKeywords(extractedKeywords)

      setShowResults(true)

      // Get summary if enabled
      if (enableSummary && displayedResults.length > 0) {
        setSummaryLoading(true)
        try {
          const citedSummary = await getSummaryWithCitations(query, displayedResults)
          setSummaryData(citedSummary)
          setSummary(citedSummary?.summary ?? null)
        } catch (summaryError) {
          console.warn("Failed to generate summary:", summaryError)
          // Continue without summary
        } finally {
          setSummaryLoading(false)
        }
      }
    } catch (error) {
      console.error("Search error:", error)
      const errorMessage = error instanceof Error ? error.message : "Unknown error"
      alert(`Search failed: ${errorMessage}\n\nPlease check your internet connection and try again.`)
    } finally {
      setIsSearching(false)
    }
  }

  const handleShowMore = () => {
    const newLimit = resultLimit * 2
    setResultLimit(newLimit)
    setSearchResults(allSearchResults.slice(0, newLimit))
  }

  const handleViewChapter = (book: string, chapter: number, verseStart?: number, verseEnd?: number) => {
    setSelectedBook(book)
    setSelectedChapter(chapter)
    setHighlightVerseStart(verseStart)
    setHighlightVerseEnd(verseEnd)
    setVerseLookupMessage(null)
    setShowReader(true)
  }

  const handleBackToSearch = () => {
    setShowReader(false)
  }

  function getRandomSearchSuggestion() {
    return SEARCH_SUGGESTIONS[Math.floor(Math.random() * SEARCH_SUGGESTIONS.length)]
  }

  return (
    <>
      <div className="min-h-screen bg-background">
        <header className="border-b border-border/60 sticky top-0 z-50 bg-background/95 backdrop-blur-sm">
          <div className="max-w-5xl mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 sm:gap-3">
                <AppNav />
              </div>
              <div className="flex items-center gap-2 sm:gap-3">
                <ThemeToggle />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <a
                      href="https://buymeacoffee.com/biblos"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-amber-500 transition-colors p-2"
                      onClick={() => track('coffee_click', { location: 'header' })}
                      onMouseEnter={() => track('coffee_hover', { location: 'header' })}
                    >
                      <Coffee className="w-5 h-5" strokeWidth={1.5} />
                    </a>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Support the development of new features and tools.</p>
                  </TooltipContent>
                </Tooltip>
                <a
                  href="https://github.com/dssjon"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition-colors p-2"
                >
                  <Github className="w-5 h-5" strokeWidth={1.5} />
                </a>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          {!showReader ? (
            <>
              <div className="text-center mb-8 sm:mb-12 space-y-3 sm:space-y-4">
                <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-balance leading-tight">
                  Explore the Scriptures
                </h2>
                <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed px-4">
                  Search and discover biblical passages with semantic understanding and contextual insights.
                </p>
              </div>

              <div className="max-w-2xl mx-auto mb-6">
                <div className="flex flex-col sm:flex-row gap-2 bg-card border border-border rounded-lg p-2 shadow-sm">
                  <Input
                    type="text"
                    placeholder="What did Jesus say about eternal life?"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    className="flex-1 border-0 bg-transparent text-base focus-visible:ring-0 focus-visible:ring-offset-0 h-11"
                  />
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-2 cursor-pointer group px-2">
                      <Checkbox
                        checked={enableSummary}
                        onCheckedChange={(checked) => setEnableSummary(checked as boolean)}
                        className="border-border data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                      />
                      <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors whitespace-nowrap">
                        Summarize
                      </span>
                    </label>
                    <Button
                      onClick={handleSearch}
                      disabled={isSearching}
                      className="bg-primary text-primary-foreground hover:bg-primary/90 h-11 px-5 font-medium"
                    >
                      {isSearching ? (
                        <>
                          <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin mr-2" />
                          Searching
                        </>
                      ) : (
                        <>
                          <SearchIcon className="w-4 h-4 mr-2" strokeWidth={2} />
                          Search
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Search Results */}
              {showResults && (
                <SearchResults
                  query={searchQuery}
                  results={searchResults}
                  keywords={keywords}
                  summary={summary}
                  summaryData={summaryData}
                  summaryLoading={summaryLoading}
                  selectedKeyword={selectedKeyword}
                  onKeywordClick={(keyword) => setSelectedKeyword(keyword === selectedKeyword ? null : keyword)}
                  onViewChapter={handleViewChapter}
                  onShowMore={handleShowMore}
                  hasMoreResults={searchResults.length < allSearchResults.length}
                />
              )}
            </>
          ) : bibleStatus !== "ready" ? (
            <div className="space-y-4 text-center">
              {bibleStatus === "loading" ? (
                <p role="status">Loading Bible text…</p>
              ) : (
                <>
                  <p role="alert">The Bible text could not be loaded.</p>
                  <Button onClick={loadReaderText}>Retry</Button>
                </>
              )}
              <div><Button variant="outline" onClick={handleBackToSearch}>Back to search</Button></div>
            </div>
          ) : (
            <>
              {verseLookupMessage && (
                <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg">
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    <span className="font-medium">{verseLookupMessage}</span>
                    <span className="text-blue-600 dark:text-blue-400 ml-2">
                      — Looking for topics or themes? Try a semantic search like "forgiveness" or "what did Jesus say about love"
                    </span>
                  </p>
                </div>
              )}
              <BibleReader
                book={selectedBook!}
                chapter={selectedChapter}
                onBack={handleBackToSearch}
                highlightVerseStart={highlightVerseStart}
                highlightVerseEnd={highlightVerseEnd}
              />
            </>
          )}
        </main>

        <footer className="border-t border-border/60 mt-20">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-3">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">
                Semantic search powered by Biblos API
              </p>
              <p className="text-xs text-muted-foreground/60 italic mt-1">
                BGE-large-en-v1.5 (1024-dim, 335M params)
              </p>
            </div>
            <p className="text-center text-xs text-muted-foreground/80">
              Made with <span className="text-red-500">♥</span> by{" "}
              <a
                href="https://github.com/dssjon"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground transition-colors underline decoration-dotted underline-offset-2"
              >
                Jon Boldt
              </a>
              {" "}-{" "}
              <Tooltip>
                <TooltipTrigger asChild>
                  <a
                    href="https://buymeacoffee.com/biblos"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-foreground transition-colors group"
                    onClick={() => track('coffee_click', { location: 'footer' })}
                    onMouseEnter={() => track('coffee_hover', { location: 'footer' })}
                  >
                    <Coffee className="w-3 h-3 inline-block align-middle group-hover:text-amber-500 transition-colors" strokeWidth={1.5} />
                  </a>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Support the development of new features and tools.</p>
                </TooltipContent>
              </Tooltip>
            </p>
          </div>
        </footer>
      </div>
    </>
  )
}
