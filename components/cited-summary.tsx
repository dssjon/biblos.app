"use client"

import { Fragment, useState } from "react"
import { marked } from "marked"
import type { SummaryCitation, SummarySegment } from "@/lib/bible-types"

interface CitedSummaryProps {
  summary: string
  segments?: SummarySegment[]
  citations?: SummaryCitation[]
  onCitationClick?: (citation: SummaryCitation) => void
  serif?: boolean
}

function renderInlineMarkdown(text: string): React.ReactNode[] {
  // Lightweight safe inline formatting (**bold** and *italic*) for cited segments
  const tokens = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)
  return tokens.map((token, idx) => {
    if (token.startsWith("**") && token.endsWith("**") && token.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-foreground">
          {token.slice(2, -2)}
        </strong>
      )
    }
    if (token.startsWith("*") && token.endsWith("*") && token.length > 2) {
      return (
        <em key={idx} className="italic">
          {token.slice(1, -1)}
        </em>
      )
    }
    return <Fragment key={idx}>{token}</Fragment>
  })
}

export function CitedSummary({
  summary,
  segments,
  citations,
  onCitationClick,
  serif = false,
}: CitedSummaryProps) {
  const [activeCitationId, setActiveCitationId] = useState<number | null>(null)
  const hasCitations = Boolean(citations && citations.length > 0 && segments && segments.length > 0)

  if (!hasCitations) {
    return (
      <div
        className={`text-sm text-foreground/90 leading-relaxed prose prose-sm max-w-none ${serif ? "font-serif" : ""}`}
        dangerouslySetInnerHTML={{ __html: marked.parse(summary, { breaks: true }) as string }}
      />
    )
  }

  const handleCitationActivate = (citation: SummaryCitation) => {
    setActiveCitationId((prev) => (prev === citation.id ? null : citation.id))
    onCitationClick?.(citation)
  }

  return (
    <div className={`space-y-4 ${serif ? "font-serif" : ""}`}>
      <div className="text-sm text-foreground/90 leading-relaxed whitespace-pre-line">
        {segments!.map((segment, segIdx) => (
          <Fragment key={segIdx}>
            {renderInlineMarkdown(segment.text)}
            {segment.citations.length > 0 && (
              <span className="inline-flex items-baseline gap-0.5 ml-0.5 align-super">
                {segment.citations.map((citation) => (
                  <button
                    key={`${segIdx}-${citation.id}`}
                    type="button"
                    onClick={() => handleCitationActivate(citation)}
                    title={`${citation.documentTitle}: "${citation.citedText.trim()}"`}
                    aria-label={`Citation ${citation.id}: ${citation.documentTitle}`}
                    className={`inline-flex items-center justify-center rounded px-1 py-0 text-[10px] font-medium leading-tight border transition-colors cursor-pointer ${
                      activeCitationId === citation.id
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-secondary/80 text-primary border-border hover:bg-primary/15"
                    }`}
                  >
                    {citation.id}
                  </button>
                ))}
              </span>
            )}
          </Fragment>
        ))}
      </div>

      <div className="pt-3 border-t border-border/50 space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Sources cited
        </p>
        <ol className="space-y-1.5 text-xs text-muted-foreground">
          {citations!.map((citation) => {
            const isSelected = activeCitationId === citation.id
            return (
              <li
                key={citation.id}
                className={`rounded px-2 py-1 transition-colors ${
                  isSelected ? "bg-primary/10 text-foreground" : "bg-muted/30"
                }`}
              >
                <button
                  type="button"
                  onClick={() => handleCitationActivate(citation)}
                  className="text-left w-full cursor-pointer"
                >
                  <span className="font-semibold text-primary mr-1.5">
                    [{citation.id}] {citation.documentTitle}
                  </span>
                  {citation.citedText && (
                    <span className="italic text-foreground/80">
                      “{citation.citedText.trim()}”
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}
