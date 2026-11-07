import { defineConfig, devices } from "@playwright/test";

// live.spec: production monitoring against the live contract (Chromium).
// ui.spec: the UI on every engine and form factor, with axe, visual snapshots and failure cases.
export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: process.env.REPORT_DIR ?? "playwright-report" }]],
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}-{platform}/{arg}{ext}",
  use: { baseURL: process.env.E2E_URL ?? "https://pusaka-two.vercel.app", headless: true, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] }, testMatch: /ui\.spec/ },
    { name: "webkit", use: { ...devices["Desktop Safari"] }, testMatch: /ui\.spec/ },
    { name: "tablet", use: { ...devices["iPad (gen 7)"], browserName: "webkit" }, testMatch: /ui\.spec/ },
    { name: "phone", use: { ...devices["Pixel 7"] }, testMatch: /ui\.spec/ },
  ],
});
