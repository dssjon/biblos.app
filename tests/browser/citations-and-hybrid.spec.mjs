import { expect, test } from "@playwright/test"

const hostedAPI = "https://dssjon-biblos-api.hf.space/**"

test("BM25 hybrid rescues James 1:19 into top 3 and renders clickable cited summary", async ({ page }) => {
  await page.route(hostedAPI, (route) => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname === "/health") return route.fulfill({ json: { status: "ok" } })
    // Simulate hosted dense search missing James 1:19 completely
    return route.fulfill({
      json: {
        results: [
          {
            book: "pro",
            chapter: 25,
            testament: "OT",
            content: "Don’t be hasty in bringing charges to court.",
            similarity: 0.61,
          },
          {
            book: "jas",
            chapter: 1,
            testament: "NT",
            content: "But be doers of the word, and not only hearers, deluding your own selves.",
            similarity: 0.54,
          },
        ],
      },
    })
  })

  await page.route("**/api/summary", (route) => {
    const body = route.request().postDataJSON()
    const first = body.searchResults[0]
    expect(first.book).toBe("jas")
    expect(first.chapter).toBe(1)
    expect(first.verseStart).toBeLessThanOrEqual(19)
    expect(first.verseEnd).toBeGreaterThanOrEqual(19)

    const citation = {
      id: 1,
      type: "char_location",
      documentIndex: 0,
      documentTitle: `JAS 1:${first.verseStart}–${first.verseEnd}`,
      citedText: "So, then, my beloved brothers, let every man be swift to hear, slow to speak, and slow to anger;",
      startCharIndex: 310,
      endCharIndex: 406,
    }

    return route.fulfill({
      json: {
        summary: "**Key Insight:** James urges believers to be swift to hear, slow to speak, and slow to anger.",
        segments: [
          { text: "**Key Insight:** James urges believers to be ", citations: [] },
          { text: "swift to hear, slow to speak, and slow to anger", citations: [citation] },
          { text: ".", citations: [] },
        ],
        citations: [citation],
      },
    })
  })

  await page.goto("/")
  // Wait for bible.zip to finish loading so BM25 index builds cleanly
  await page.waitForLoadState("networkidle")

  await page.getByRole("checkbox").first().click()
  const input = page.getByRole("textbox")
  await input.fill("Where does it say to be quick to hear and slow to speak?")
  await input.press("Enter")

  // Card 0 should be James 1:16–24 containing v. 19
  const firstCard = page.locator("#search-result-0")
  await expect(firstCard.locator("h3")).toContainText("James 1:16–24")
  await expect(firstCard).toContainText("swift to hear, slow to speak")

  // Cited summary renders inline pill + verbatim Sources cited footer
  const citationBtn = page.locator('button[aria-label^="Citation 1:"]').first()
  await expect(citationBtn).toBeVisible()
  await expect(page.getByText("Sources cited")).toBeVisible()
  await expect(page.locator("ol li").getByText(/let every man be swift to hear, slow to speak/)).toBeVisible()

  // Clicking the citation pill highlights the matching passage card
  await citationBtn.click()
  await expect(firstCard).toHaveClass(/ring-2/)

  // Clicking View Chapter opens James 1 with verse 19 highlighted
  await firstCard.getByRole("button", { name: /View Chapter/i }).click()
  await expect(page.locator("#verse-19")).toContainText("swift to hear, slow to speak")
  await expect(page.locator("#verse-19")).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
})

test("out-of-domain query returns No Matches Found without triggering summary", async ({ page }) => {
  let summaryCalled = false
  await page.route(hostedAPI, (route) => {
    return route.fulfill({
      json: {
        results: [
          {
            book: "exo",
            chapter: 1,
            testament: "OT",
            content: "Now these are the names of the sons of Israel.",
            similarity: 0.41,
          },
        ],
      },
    })
  })
  await page.route("**/api/summary", (route) => {
    summaryCalled = true
    return route.fulfill({ status: 500, json: { error: "should not be called" } })
  })

  await page.goto("/")
  await page.waitForLoadState("networkidle")
  await page.getByRole("checkbox").first().click()
  const input = page.getByRole("textbox")
  await input.fill("What voltage does USB-C Power Delivery use?")
  await input.press("Enter")

  await expect(page.getByText("No Matches Found")).toBeVisible()
  expect(summaryCalled).toBe(false)
})
