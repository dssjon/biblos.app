"use client"

import { useEffect, useRef, useState } from "react"

export function useReaderHistory() {
  const [showReader, setVisible] = useState(false)
  const readerEntry = useRef<number | null>(null)

  useEffect(() => {
    function restore(event: PopStateEvent) {
      // Only this search page still holds the selection for its reader entry.
      setVisible(readerEntry.current !== null && event.state?.biblosReader === readerEntry.current)
    }
    window.addEventListener("popstate", restore)
    return () => window.removeEventListener("popstate", restore)
  }, [])

  function setShowReader(open: boolean) {
    if (open === showReader) return
    if (open) {
      readerEntry.current = Date.now()
      window.history.pushState({ biblosReader: readerEntry.current }, "")
      setVisible(true)
    } else {
      window.history.back()
    }
  }

  return [showReader, setShowReader] as const
}
