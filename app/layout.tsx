import type React from "react"
import type { Metadata } from "next"
import { Crimson_Text } from "next/font/google"
import { GeistMono } from "geist/font/mono"
import { Analytics } from "@vercel/analytics/next"
import { Suspense } from "react"
import { ThemeProvider } from "@/components/theme-provider"
import "./globals.css"

const crimsonText = Crimson_Text({
  weight: ["400", "600", "700"],
  subsets: ["latin"],
  variable: "--font-crimson",
  display: "swap",
})

export const metadata: Metadata = {
  title: "Bible Reader and Semantic Search",
  description: "Search and read the Bible with semantic understanding and insightful summaries",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`font-serif ${crimsonText.variable} ${GeistMono.variable} antialiased`}>
        <ThemeProvider defaultTheme="light" storageKey="bible-theme">
          <Suspense fallback={null}>{children}</Suspense>
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  )
}
