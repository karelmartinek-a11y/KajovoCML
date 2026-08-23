import assert from "node:assert/strict";
import { parsePlaywrightDryRun, shouldUseSystemUnzip } from "../deploy/scripts/playwright-browser-compat.mjs";

const dryRun = `browser: chromium version 140.0.7339.186
  Install location: /opt/kcml/playwright-browsers/chromium-1193
  Download url: https://cdn.playwright.dev/dbazure/download/playwright/builds/chromium/1193/chromium-linux.zip
  Download fallback 1: https://playwright.download.prss.microsoft.com/dbazure/download/playwright/builds/chromium/1193/chromium-linux.zip
  Download fallback 2: https://cdn.playwright.dev/builds/chromium/1193/chromium-linux.zip

browser: ffmpeg
  Install location: /opt/kcml/playwright-browsers/ffmpeg-1011
`;
const plan = parsePlaywrightDryRun(dryRun);
assert.equal(plan.installLocation, "/opt/kcml/playwright-browsers/chromium-1193");
assert.deepEqual(plan.downloadUrls, [
  "https://cdn.playwright.dev/dbazure/download/playwright/builds/chromium/1193/chromium-linux.zip",
  "https://playwright.download.prss.microsoft.com/dbazure/download/playwright/builds/chromium/1193/chromium-linux.zip",
  "https://cdn.playwright.dev/builds/chromium/1193/chromium-linux.zip"
]);
assert.equal(shouldUseSystemUnzip("24.17.0"), true);
assert.equal(shouldUseSystemUnzip("24.17.1"), true);
assert.equal(shouldUseSystemUnzip("24.18.0"), false);
assert.equal(shouldUseSystemUnzip("25.0.0"), false);
assert.throws(() => parsePlaywrightDryRun("browser: ffmpeg\n"), /chromium_dry_run_missing/u);
console.log("PASS Playwright compatibility plan is strict, HTTPS-only and scoped to Node 24.17");
