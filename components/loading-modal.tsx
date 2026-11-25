"use client"

import { useEffect, useState } from "react"
import { BookOpenIcon, Database, BookText, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"

interface LoadingModalProps {
  isOpen: boolean
  message: string
  onClose: () => void
}

export function LoadingModal({ isOpen, message, onClose }: LoadingModalProps) {
  const [progress, setProgress] = useState(0)
  const isError = message.includes("Error")

  useEffect(() => {
    if (!isOpen) {
      setProgress(0)
      return
    }

    // Simulate progress based on message content
    if (message.includes("Ready")) {
      setProgress(100)
      setTimeout(onClose, 500)
    } else if (message.includes("Bible data")) {
      setProgress(70)
    } else if (message.includes("model")) {
      setProgress(40)
    } else if (isError) {
      setProgress(0)
    } else {
      setProgress(10)
    }
  }, [isOpen, message, onClose, isError])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-background/98 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full space-y-8 text-center">
        <div className="relative mx-auto w-20 h-20">
          <div className="absolute inset-0 bg-primary/10 border-2 border-primary/20 rounded-lg" />
          <div className="absolute inset-2 bg-card rounded flex items-center justify-center">
            <BookOpenIcon className="w-10 h-10 text-primary" strokeWidth={1.5} />
          </div>
        </div>

        <div className="space-y-3">
          <h2 className="text-3xl font-bold tracking-tight">Welcome to Biblos</h2>
          <p className="text-lg text-muted-foreground">Semantic Bible Search & Summary</p>
        </div>

        <div className="space-y-3 text-left">
          <div className="flex items-start gap-3 p-3 rounded-lg bg-card border border-border/60">
            <Database className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" strokeWidth={1.5} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">Loading Scripture Database</p>
              <p className="text-xs text-muted-foreground">Complete biblical text</p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-3 rounded-lg bg-card border border-border/60">
            <BookText className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" strokeWidth={1.5} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">Initializing Search Engine</p>
              <p className="text-xs text-muted-foreground">Semantic search models</p>
            </div>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="h-2 bg-secondary rounded-full overflow-hidden border border-border/40">
            <div className="h-full bg-accent transition-all duration-300 ease-out" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-sm text-muted-foreground">
            {message || "Loading resources..."}
          </p>
          <p className="text-xs text-muted-foreground/70 italic pt-2">
          This may take a minute on your first visit as we load the models and data.
          </p>
        </div>

        {/* Retry button */}
        {isError && (
          <Button
            onClick={() => window.location.reload()}
            className="w-full"
            variant="outline"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Retry
          </Button>
        )}
      </div>
    </div>
  )
}
