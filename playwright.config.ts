import { defineConfig, devices } from "@playwright/test";

// Browser tests run against the production build of the demo served with a strict CSP.
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://localhost:4180", viewport: { width: 1600, height: 900 } },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1600, height: 900 } } }],
  webServer: {
    command: "pnpm demo:build && pnpm demo:preview",
    url: "http://localhost:4180",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
