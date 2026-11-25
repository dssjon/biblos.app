import { defineConfig } from "@playwright/test"

const baseURL = "http://127.0.0.1:3317"

export default defineConfig({
  testDir: "./tests/browser",
  use: { baseURL },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3317",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
})
