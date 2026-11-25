"use client"

import { useState, useEffect } from "react"
import { SearchIcon, BookOpenIcon, Github, BookOpen, ExternalLink, Coffee } from "lucide-react"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { ThemeToggle } from "@/components/theme-toggle"
import { AppNav } from "@/components/navigation/app-nav"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { SearchResults } from "@/components/search-results"
import { BibleReader } from "@/components/bible-reader"
import { useReaderHistory } from "@/hooks/use-reader-history"
import { LoadingModal } from "@/components/loading-modal"
import { loadModel, searchBible, getSummaryWithCitations, logSearch } from "@/lib/bible-search"
import { loadInitialBibleData, loadEmbeddingData } from "@/lib/bible-data"
import { extractKeywords, addSentimentToResults } from "@/lib/keywords"
import { OLD_TESTAMENT_BOOKS, NEW_TESTAMENT_BOOKS, SEARCH_SUGGESTIONS } from "@/lib/bible-constants"
import type { SearchResult, SummaryData } from "@/lib/bible-types"
import { track } from '@vercel/analytics'

export default function Home() {
  const [searchQuery, setSearchQuery] = useState("")
  const [isSearching, setIsSearching] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const [showReader, setShowReader] = useReaderHistory()
  const [selectedBook, setSelectedBook] = useState<string | null>(null)
  const [selectedChapter, setSelectedChapter] = useState<number>(1)
  const [oldTestament, setOldTestament] = useState(false)
  const [newTestament, setNewTestament] = useState(true)
  const [enableSummary, setEnableSummary] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [loadingMessage, setLoadingMessage] = useState("")
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [keywords, setKeywords] = useState<string[]>([])
  const [summary, setSummary] = useState<string | null>(null)
  const [summaryData, setSummaryData] = useState<SummaryData | null>(null)
  const [selectedKeyword, setSelectedKeyword] = useState<string | null>(null)
  const [highlightVerseStart, setHighlightVerseStart] = useState<number | undefined>()
  const [highlightVerseEnd, setHighlightVerseEnd] = useState<number | undefined>()

  useEffect(() => {
    // Delay initialization to ensure LoadingModal renders first
    const timer = setTimeout(() => {
      initializeApp()
    }, 100)
    return () => clearTimeout(timer)
  }, [])

  async function initializeApp() {
    try {
      setLoadingMessage("Loading search model...")
      await loadModel("Xenova/bge-large-en-v1.5", setLoadingMessage)

      setLoadingMessage("Loading Bible data...")
      await loadInitialBibleData(setLoadingMessage)

      // Preload only New Testament embeddings for faster initial load
      setLoadingMessage("Loading New Testament embeddings...")
      await loadEmbeddingData(NEW_TESTAMENT_BOOKS, setLoadingMessage)

      setLoadingMessage("Ready!")
      setTimeout(() => setIsLoading(false), 500)
    } catch (error) {
      console.error("Initialization error:", error)
      setLoadingMessage("Error: Download interrupted. Keep screen active and retry.")
    }
  }

  const handleSearch = async () => {
    if (isSearching) return

    const query = searchQuery.trim() || getRandomSearchSuggestion()
    setSearchQuery(query)
    setIsSearching(true)
    setSummary(null)
    setSummaryData(null)

    try {
      // Log search
      logSearch(query)

      // Determine which books to search
      const selectedBooks = []
      if (oldTestament) selectedBooks.push(...OLD_TESTAMENT_BOOKS)
      if (newTestament) selectedBooks.push(...NEW_TESTAMENT_BOOKS)

      if (selectedBooks.length === 0) {
        alert("Please select at least Old Testament or New Testament")
        setIsSearching(false)
        return
      }

      // Search
      const results = await searchBible(query, selectedBooks)
      const resultsWithSentiment = addSentimentToResults(results)
      setSearchResults(resultsWithSentiment.slice(0, 3))

      // Extract keywords
      const combinedText = resultsWithSentiment.slice(0, 3).map(r => r.content).join(' ')
      const extractedKeywords = extractKeywords(combinedText)
      setKeywords(extractedKeywords)

      setShowResults(true)

      // Get summary if enabled
      if (enableSummary) {
        const citedSummary = await getSummaryWithCitations(query, resultsWithSentiment.slice(0, 3))
        setSummaryData(citedSummary)
        setSummary(citedSummary?.summary ?? null)
      }
    } catch (error) {
      console.error("Search error:", error)
    } finally {
      setIsSearching(false)
    }
  }

  const handleViewChapter = (book: string, chapter: number, verseStart?: number, verseEnd?: number) => {
    setSelectedBook(book)
    setSelectedChapter(chapter)
    setHighlightVerseStart(verseStart)
    setHighlightVerseEnd(verseEnd)
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
      <LoadingModal isOpen={isLoading} message={loadingMessage} onClose={() => setIsLoading(false)} />

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

              <div className="max-w-2xl mx-auto space-y-6 mb-6">
                <div className="flex gap-2 bg-card border border-border rounded-lg p-2 shadow-sm">
                  <Input
                    type="text"
                    placeholder="What did Jesus say about eternal life?"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    className="flex-1 border-0 bg-transparent text-base focus-visible:ring-0 focus-visible:ring-offset-0 h-11"
                  />
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

                {/* Options */}
                <div className="flex flex-wrap items-center gap-5 justify-center">
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <Checkbox
                      checked={oldTestament}
                      onCheckedChange={(checked) => setOldTestament(checked as boolean)}
                      className="border-border data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                    />
                    <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">
                      Old Testament
                    </span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <Checkbox
                      checked={newTestament}
                      onCheckedChange={(checked) => setNewTestament(checked as boolean)}
                      className="border-border data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                    />
                    <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">
                      New Testament
                    </span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <Checkbox
                      checked={enableSummary}
                      onCheckedChange={(checked) => setEnableSummary(checked as boolean)}
                      className="border-border data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                    />
                    <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">
                      Include Summary
                    </span>
                  </label>
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
                  selectedKeyword={selectedKeyword}
                  onKeywordClick={(keyword) => setSelectedKeyword(keyword === selectedKeyword ? null : keyword)}
                  onViewChapter={handleViewChapter}
                />
              )}
            </>
          ) : (
            <BibleReader
              book={selectedBook!}
              chapter={selectedChapter}
              onBack={handleBackToSearch}
              highlightVerseStart={highlightVerseStart}
              highlightVerseEnd={highlightVerseEnd}
            />
          )}
        </main>

        <footer className="border-t border-border/60 mt-20">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-3">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">
                Semantic search powered by state-of-the-art machine learning models
              </p>
              <p className="text-xs text-muted-foreground/60 italic mt-1">
                Xenova/bge-large-en-v1.5 (1024-dim)
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
