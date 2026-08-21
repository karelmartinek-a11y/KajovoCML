// Compatibility entrypoint for existing generation callers. The runtime is
// Playwright-owned; no CDP or direct Chromium process control is exposed.
export { PlaywrightBrowserSession as BrowserSession } from "./playwright-session.mjs";
