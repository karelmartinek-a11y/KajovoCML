import { chromium } from "playwright";

function safeUrl(value, allowLocal = false) {
  const url = new URL(value);
  if (allowLocal && ["http:", "https:", "data:"].includes(url.protocol)) {
    if (url.protocol === "data:" || ["localhost", "127.0.0.1", "::1"].includes(url.hostname)) return url;
  }
  if (url.protocol !== "https:") throw new Error("browser_https_required");
  if (!url.hostname || ["localhost", "127.0.0.1", "::1"].includes(url.hostname) || url.hostname.endsWith(".local")) throw new Error("browser_public_host_required");
  return url;
}

export class PlaywrightBrowserSession {
  constructor({ chromiumBinary, workspace, sessionId, allowLocal = false }) {
    this.chromiumBinary = chromiumBinary;
    this.workspace = workspace;
    this.sessionId = sessionId;
    this.allowLocal = allowLocal;
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  async start() {
    if (this.context) return;
    this.browser = await chromium.launch({ headless: true, executablePath: this.chromiumBinary || undefined });
    this.context = await this.browser.newContext({ acceptDownloads: false });
    this.page = await this.context.newPage();
    this.page.on("popup", (page) => { this.page = page; });
  }

  async open(value) { await this.start(); await this.page.goto(safeUrl(value, this.allowLocal).toString(), { waitUntil: "domcontentloaded", timeout: 30_000 }); return this.state(); }
  async loadHtmlForTest(html) { await this.start(); await this.page.setContent(String(html), { waitUntil: "domcontentloaded" }); return this.state(); }

  async state() {
    await this.start();
    const locatorData = await this.page.locator("button, input, textarea, select, [role='button'], [role='link']").evaluateAll((nodes) => nodes.slice(0, 200).map((node, index) => ({ locator: `[data-kcml-index="${index}"]`, tag: node.tagName.toLowerCase(), text: (node.getAttribute("aria-label") || node.getAttribute("placeholder") || node.textContent || "").trim().slice(0, 200), type: node.getAttribute("type") })), { timeout: 5000 }).catch(() => []);
    await this.page.locator("button, input, textarea, select, [role='button'], [role='link']").evaluateAll((nodes) => nodes.slice(0, 200).forEach((node, index) => node.setAttribute("data-kcml-index", String(index))));
    return { url: this.page.url(), title: await this.page.title(), text: (await this.page.locator("body").innerText()).slice(0, 50_000), targetId: "current", targets: [{ id: "current", url: this.page.url() }], pages: [{ targetId: "current", url: this.page.url() }], locators: locatorData, elements: locatorData.map((item) => ({ locator: item.locator, accessibleName: item.text, text: item.text, value: "" })) };
  }

  async click(locator) { await this.start(); await this.page.locator(locator).click({ timeout: 30_000 }); return this.state(); }
  async fill(locator, value) { await this.start(); await this.page.locator(locator).fill(value, { timeout: 30_000 }); return this.state(); }
  async select(locator, value) { await this.start(); await this.page.locator(locator).selectOption(value, { timeout: 30_000 }); return this.state(); }
  async readValue(locator) { await this.start(); return this.page.locator(locator).inputValue({ timeout: 30_000 }); }
  async press(key) { await this.start(); await this.page.keyboard.press(key); return this.state(); }
  async switchPage(targetId) { if (targetId !== "current") throw new Error("browser_target_not_found"); return this.state(); }
  async wait({ locator, selector, text, urlIncludes, readyState, timeoutMs = 15_000 }) {
    await this.start();
    if (locator || selector) await this.page.locator(locator || selector).waitFor({ state: "visible", timeout: timeoutMs });
    if (text) await this.page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout: timeoutMs });
    if (urlIncludes) await this.page.waitForURL((url) => url.toString().includes(urlIncludes), { timeout: timeoutMs });
    if (readyState === "complete") await this.page.waitForLoadState("load", { timeout: timeoutMs });
    return this.state();
  }
  async close() {
    const browser = this.browser;
    this.page = null; this.context = null; this.browser = null;
    void browser?.close().catch(() => undefined);
  }
}
