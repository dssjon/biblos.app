"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { BookOpen, Search } from "lucide-react"
import { cn } from "@/lib/utils"

export function AppNav() {
  const pathname = usePathname()

  const baseDaily = '/daily'

  const isDailyActive = pathname?.startsWith('/daily')
  const isSearchActive = !isDailyActive

  return (
    <div className="inline-flex items-center gap-1 p-1 bg-secondary/50 rounded-lg border border-border/60 font-serif">
      <Link
        href="/"
        className={cn(
          "inline-flex items-center gap-1.5 px-2 sm:px-3 py-1.5 text-sm font-medium font-serif rounded-md transition-all",
          isSearchActive
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground hover:bg-background/50"
        )}
        title="Semantic Search"
      >
        <Search className="w-4 h-4" strokeWidth={1.5} />
        <span className="hidden sm:inline">Semantic Search</span>
        <span className="sm:hidden">Search</span>
      </Link>
      <Link
        href={baseDaily}
        className={cn(
          "inline-flex items-center gap-1.5 px-2 sm:px-3 py-1.5 text-sm font-medium font-serif rounded-md transition-all",
          isDailyActive
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground hover:bg-background/50"
        )}
        title="Daily Readings"
      >
        <BookOpen className="w-4 h-4" strokeWidth={1.5} />
        <span className="hidden sm:inline">Daily Readings</span>
        <span className="sm:hidden">Daily</span>
      </Link>
    </div>
  )
}
