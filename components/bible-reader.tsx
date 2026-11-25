"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ChevronLeft, ChevronRight, ArrowLeft } from "lucide-react"
import { getChapterVerses, getChapterCount, getBookFullName } from "@/lib/bible-data"
import { BOOKS, BOOK_MAPPING } from "@/lib/bible-constants"
import type { BibleVerse } from "@/lib/bible-types"

interface BibleReaderProps {
  book: string
  chapter: number
  onBack: () => void
  highlightVerseStart?: number
  highlightVerseEnd?: number
}

export function BibleReader({
  book: initialBook,
  chapter: initialChapter,
  onBack,
  highlightVerseStart,
  highlightVerseEnd
}: BibleReaderProps) {
  const [book, setBook] = useState(initialBook)
  const [chapter, setChapter] = useState(initialChapter)
  const [activeHighlightStart, setActiveHighlightStart] = useState(highlightVerseStart)
  const [activeHighlightEnd, setActiveHighlightEnd] = useState(highlightVerseEnd)
  const [verses, setVerses] = useState<BibleVerse[]>([])
  const [maxChapter, setMaxChapter] = useState(1)

  useEffect(() => {
    loadChapter(book, chapter)
  }, [book, chapter])

  // Scroll to highlighted verse after verses load
  useEffect(() => {
    if (activeHighlightStart && verses.length > 0) {
      // Small delay to ensure DOM is updated
      setTimeout(() => {
        const element = document.getElementById(`verse-${activeHighlightStart}`)
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }, 100)
    }
  }, [activeHighlightStart, verses])

  function loadChapter(selectedBook: string, selectedChapter: number) {
    const chapterVerses = getChapterVerses(selectedBook, selectedChapter)
    setVerses(chapterVerses)
    const count = getChapterCount(selectedBook)
    setMaxChapter(count)
  }

  function handlePreviousChapter() {
    if (chapter > 1) {
      setChapter(chapter - 1)
      setActiveHighlightStart(undefined)
      setActiveHighlightEnd(undefined)
    }
  }

  function handleNextChapter() {
    if (chapter < maxChapter) {
      setChapter(chapter + 1)
      setActiveHighlightStart(undefined)
      setActiveHighlightEnd(undefined)
    }
  }

  // Clear highlights when user navigates to different chapter/book
  function handleBookChange(val: string) {
    setBook(val.toLowerCase())
    setActiveHighlightStart(undefined)
    setActiveHighlightEnd(undefined)
  }

  function handleChapterChange(val: string) {
    setChapter(parseInt(val))
    setActiveHighlightStart(undefined)
    setActiveHighlightEnd(undefined)
  }

  function isVerseHighlighted(verseNum: number): boolean {
    if (!activeHighlightStart) return false
    const end = activeHighlightEnd ?? activeHighlightStart
    return verseNum >= activeHighlightStart && verseNum <= end
  }

  function renderVerses() {
    const paragraphs: JSX.Element[] = []
    let currentParagraph: JSX.Element[] = []

    verses.forEach((verse, index) => {
      const verseNum = parseInt(verse.v)
      const highlighted = isVerseHighlighted(verseNum)

      currentParagraph.push(
        <span
          key={index}
          id={`verse-${verseNum}`}
          className={highlighted ? "bg-yellow-200 dark:bg-yellow-900/50 rounded px-0.5 -mx-0.5" : ""}
        >
          <sup className="text-xs text-accent mr-1.5 font-semibold">{verseNum}</sup>
          {verse.text.trim()}{' '}
        </span>
      )

      // Start new paragraph every 5 verses
      if ((index + 1) % 5 === 0 && index !== verses.length - 1) {
        paragraphs.push(
          <p key={`p-${index}`} className="mb-4">
            {currentParagraph}
          </p>
        )
        currentParagraph = []
      }
    })

    // Add remaining verses
    if (currentParagraph.length > 0) {
      paragraphs.push(
        <p key="p-last" className="mb-4">
          {currentParagraph}
        </p>
      )
    }

    return paragraphs
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500">
      <Card className="p-4 border-border/60">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="flex gap-2 flex-1">
            <Select value={book.toUpperCase()} onValueChange={(val) => handleBookChange(val)}>
              <SelectTrigger className="w-full sm:w-[180px] bg-secondary/30 border-border/60">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-[300px]">
                {BOOKS.map(bookKey => (
                  <SelectItem key={bookKey} value={bookKey.toUpperCase()}>
                    {BOOK_MAPPING[bookKey]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={chapter.toString()} onValueChange={(val) => handleChapterChange(val)}>
              <SelectTrigger className="w-full sm:w-[120px] bg-secondary/30 border-border/60">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-[300px]">
                {Array.from({ length: maxChapter }, (_, i) => i + 1).map(num => (
                  <SelectItem key={num} value={num.toString()}>
                    Chapter {num}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={handlePreviousChapter}
              disabled={chapter <= 1}
              variant="outline"
              size="sm"
              className="flex-1 sm:flex-none bg-transparent border-border/60"
            >
              <ChevronLeft className="w-4 h-4 mr-1" strokeWidth={1.5} />
              Previous
            </Button>
            <Button
              onClick={handleNextChapter}
              disabled={chapter >= maxChapter}
              variant="outline"
              size="sm"
              className="flex-1 sm:flex-none bg-transparent border-border/60"
            >
              Next
              <ChevronRight className="w-4 h-4 ml-1" strokeWidth={1.5} />
            </Button>
            <Button onClick={onBack} variant="secondary" size="sm" className="flex-1 sm:flex-none">
              <ArrowLeft className="w-4 h-4 mr-1" strokeWidth={1.5} />
              Back
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-8 sm:p-12 border-border/60">
        <div className="prose prose-lg max-w-none">
          <h2 className="text-3xl font-bold mb-8 text-foreground">
            {getBookFullName(book)} {chapter}
          </h2>

          <div className="space-y-6 text-foreground/85 leading-relaxed">
            {verses.length > 0 ? renderVerses() : <p>Loading chapter...</p>}
          </div>
        </div>
      </Card>
    </div>
  )
}
