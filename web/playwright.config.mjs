import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  workers: 2,
  reporter: "list",
  use: { baseURL: process.env.E2E_URL ?? "https://pusaka-two.vercel.app", browserName: "chromium", headless: true },
});
