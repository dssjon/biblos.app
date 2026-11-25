import { expect, test } from "@playwright/test"

test("browser Back and the reader's Back button return to the same search results", async ({ page }) => {
  let searches = 0
  await page.route("https://dssjon-biblos-api.hf.space/search", route => {
    searches++
    return route.fulfill({ json: {
      results: [{ book: "jhn", chapter: 17, testament: "NT", content: "This is eternal life", similarity: 0.9 }],
    } })
  })

  await page.goto("/")
  const search = page.getByRole("textbox")
  const viewChapter = page.getByRole("button", { name: "View Chapter" })
  const chapter = page.getByRole("heading", { name: "John 17", level: 2 })
  await search.fill("eternal life")
  await search.press("Enter")
  await viewChapter.click()
  await expect(chapter).toBeVisible()

  await page.goBack()
  await expect(search).toHaveValue("eternal life")
  await expect(viewChapter).toBeVisible()
  await page.goForward()
  await expect(chapter).toBeVisible()
  await page.getByRole("button", { name: "Back", exact: true }).click()
  await expect(search).toHaveValue("eternal life")
  await expect(viewChapter).toBeVisible()
  expect(searches).toBe(1)
})

test("Back from a direct reference restores the home form and Forward restores the highlight", async ({ page }) => {
  await page.goto("/")
  const search = page.getByRole("textbox")
  await search.fill("John 3:16")
  await search.press("Enter")
  await expect(page.locator("#verse-16")).toBeVisible()
  await page.getByRole("button", { name: "Back", exact: true }).click()
  await expect(search).toHaveValue("John 3:16")
  await expect(page.getByText("No Matches Found")).toHaveCount(0)
  await page.goForward()
  await expect(page.locator("#verse-16")).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
})
