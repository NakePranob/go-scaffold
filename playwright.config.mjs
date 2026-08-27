import { defineConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import path from "node:path";

// Browser checks are deliberately opt-in and dev-only. Keep all Playwright
// output outside the repository and disable media/trace capture because OAuth
// URLs and session material must never become artifacts.
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  reporter: [["line"]],
  outputDir: path.join(tmpdir(), "go-scaffold-playwright-results"),
  // Even a failed callback assertion must not leave an error-context file that
  // could contain a provider query string. Failure output stays in the test
  // runner's terminal as redacted assertion text only.
  preserveOutput: "never",
  use: {
    ignoreHTTPSErrors: true,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
});
