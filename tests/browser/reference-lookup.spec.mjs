import { expect, test } from "@playwright/test"

const hostedAPI = "https://dssjon-biblos-api.hf.space/**"
const john316 = "For God so loved the world, that he gave his only born Son, that whoever believes in him should not perish, but have eternal life."

async function lookUp(page, reference) {
  const input = page.getByRole("textbox")
  await input.fill(reference)
  await input.press("Enter")
}

test("a cold reference lookup waits for local text while hosted search is unavailable", async ({ page }) => {
  const dialogs = []
  page.on("dialog", async dialog => {
    dialogs.push(dialog.message())
    await dialog.dismiss()
  })
  await page.route(hostedAPI, route => route.abort())
  let archiveRequest
  await page.route("**/data/bible.zip", route => {
    archiveRequest = route
  })

  await page.goto("/")
  await lookUp(page, "John 3:16")
  await expect(page.getByRole("status").filter({ hasText: "Loading Bible text" })).toBeVisible()
  await expect(page.locator("#verse-16")).toHaveCount(0)
  await expect.poll(() => Boolean(archiveRequest)).toBe(true)
  await archiveRequest.continue()

  const verse = page.locator("#verse-16")
  await expect(verse).toContainText(john316)
  await expect(verse).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
  await expect(page.locator("#verse-15")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
  expect(dialogs).toEqual([])
})

test("retry opens the requested range after a failed Bible download", async ({ page }) => {
  let downloads = 0
  await page.route(hostedAPI, route => route.abort())
  await page.route("**/data/bible.zip", route => {
    downloads++
    return downloads === 1 ? route.fulfill({ status: 503, body: "" }) : route.continue()
  })

  await page.goto("/")
  await lookUp(page, "John 3:16-17")
  await expect(page.getByRole("alert").filter({ hasText: "Bible text" })).toBeVisible()
  await page.getByRole("button", { name: "Retry" }).click()
  await expect(page.locator("#verse-16")).toContainText(john316)
  await expect(page.locator("#verse-16")).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
  await expect(page.locator("#verse-17")).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
  await expect(page.locator("#verse-18")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
  expect(downloads).toBe(2)
})

test("topic search still shows results when the local Bible download fails", async ({ page }) => {
  await page.route("**/data/bible.zip", route => route.fulfill({ status: 503, body: "" }))
  await page.route(hostedAPI, route => {
    expect(new URL(route.request().url()).pathname).toBe("/search")
    expect(route.request().postDataJSON().query).toBe("eternal life")
    return route.fulfill({ json: {
      results: [{ book: "jhn", chapter: 3, testament: "NT", content: john316, similarity: 0.9 }],
    } })
  })

  await page.goto("/")
  await lookUp(page, "eternal life")
  await expect(page.getByRole("heading", { name: "John 3" })).toBeVisible()
  await expect(page.getByText(john316, { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "View Chapter" }).click()
  await expect(page.getByRole("alert").filter({ hasText: "Bible text" })).toBeVisible()
})
