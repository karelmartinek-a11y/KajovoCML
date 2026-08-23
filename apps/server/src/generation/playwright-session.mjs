import { chromium } from "playwright";

function privateHost(host) {
  const value = String(host).toLowerCase().replace(/\.$/, "");
  if (["localhost", "::1"].includes(value) || value.endsWith(".local")) return true;
  if (/^(10|127)\./.test(value) || /^192\.168\./.test(value)) return true;
  const match = value.match(/^172\.(\d{1,3})\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

function safeUrl(value, allowLocal = false) {
  const url = new URL(value);
  if (allowLocal && ["http:", "https:", "data:"].includes(url.protocol)) {
    if (url.protocol === "data:" || ["localhost", "127.0.0.1", "::1"].includes(url.hostname)) return url;
  }
  if (url.protocol !== "https:") throw new Error("browser_https_required");
  if (!url.hostname || privateHost(url.hostname)) throw new Error("browser_public_host_required");
  return url;
}

function locatorFor(page, value) {
  if (typeof value === "string" && value.trim()) return page.locator(value);
  const locator = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  if (typeof locator.role === "string" && locator.role.trim()) return page.getByRole(locator.role, typeof locator.name === "string" ? { name: locator.name, exact: locator.exact === true } : undefined);
  if (typeof locator.label === "string" && locator.label.trim()) return page.getByLabel(locator.label, { exact: locator.exact === true });
  if (typeof locator.placeholder === "string" && locator.placeholder.trim()) return page.getByPlaceholder(locator.placeholder, { exact: locator.exact === true });
  if (typeof locator.testId === "string" && locator.testId.trim()) return page.getByTestId(locator.testId);
  if (typeof locator.text === "string" && locator.text.trim()) return page.getByText(locator.text, { exact: locator.exact === true });
  if (typeof locator.css === "string" && locator.css.trim()) return page.locator(locator.css);
  throw new Error("browser_locator_invalid");
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
    this.context = await this.browser.newContext({ acceptDownloads: true });
    this.page = await this.context.newPage();
    this.page.on("popup", (page) => { this.page = page; });
    if (!this.allowLocal) {
      await this.context.route("**/*", async (route) => {
        try {
          const url = new URL(route.request().url());
          if (["http:", "https:"].includes(url.protocol) && privateHost(url.hostname)) return route.abort("blockedbyclient");
        } catch { /* non-HTTP resources are handled by Chromium */ }
        return route.continue();
      });
    }
  }

  async open(value) { await this.start(); await this.page.goto(safeUrl(value, this.allowLocal).toString(), { waitUntil: "domcontentloaded", timeout: 30_000 }); return this.state(); }
  async loadHtmlForTest(html) { await this.start(); await this.page.setContent(String(html), { waitUntil: "domcontentloaded" }); return this.state(); }

  async state() {
    await this.start();
    const locatorData = await this.page.locator("button, input, textarea, select, [role='button'], [role='link']").evaluateAll((nodes) => nodes.slice(0, 200).map((node, index) => ({ locator: `[data-kcml-index="${index}"]`, tag: node.tagName.toLowerCase(), text: (node.getAttribute("aria-label") || node.getAttribute("placeholder") || node.textContent || "").trim().slice(0, 200), type: node.getAttribute("type") })), { timeout: 5000 }).catch(() => []);
    await this.page.locator("button, input, textarea, select, [role='button'], [role='link']").evaluateAll((nodes) => nodes.slice(0, 200).forEach((node, index) => node.setAttribute("data-kcml-index", String(index))));
    return { url: this.page.url(), title: await this.page.title(), text: (await this.page.locator("body").innerText()).slice(0, 50_000), targetId: "current", targets: [{ id: "current", url: this.page.url() }], pages: [{ targetId: "current", url: this.page.url() }], locators: locatorData, elements: locatorData.map((item) => ({ locator: item.locator, accessibleName: item.text, text: item.text, value: "" })) };
  }

  async click(locator) { await this.start(); await locatorFor(this.page, locator).click({ timeout: 30_000 }); return this.state(); }
  async fill(locator, value) { await this.start(); await locatorFor(this.page, locator).fill(value, { timeout: 30_000 }); return this.state(); }
  async fillSecret(locator, value) { return this.fill(locator, value); }
  async select(locator, value) { await this.start(); await locatorFor(this.page, locator).selectOption(value, { timeout: 30_000 }); return this.state(); }
  async check(locator) { await this.start(); await locatorFor(this.page, locator).check({ timeout: 30_000 }); return this.state(); }
  async uncheck(locator) { await this.start(); await locatorFor(this.page, locator).uncheck({ timeout: 30_000 }); return this.state(); }
  async readValue(locator) { await this.start(); return locatorFor(this.page, locator).inputValue({ timeout: 30_000 }); }
  async readText(locator) { await this.start(); return (await locatorFor(this.page, locator).innerText({ timeout: 30_000 })).slice(0, 50_000); }
  async press(locatorOrKey, key) {
    await this.start();
    const locator = key === undefined ? "body" : locatorOrKey;
    const actualKey = key === undefined ? locatorOrKey : key;
    await locatorFor(this.page, locator ?? "body").press(actualKey, { timeout: 30_000 });
    return this.state();
  }
  async upload(locator, filePath) { await this.start(); await locatorFor(this.page, locator).setInputFiles(filePath, { timeout: 30_000 }); return this.state(); }
  async download(locator, destination) {
    await this.start();
    const downloadPromise = this.page.waitForEvent("download", { timeout: 30_000 });
    await locatorFor(this.page, locator).click({ timeout: 30_000 });
    const download = await downloadPromise;
    await download.saveAs(destination);
    return { suggestedFilename: download.suggestedFilename(), failure: await download.failure() };
  }
  async switchPage(targetId) { if (targetId !== "current") throw new Error("browser_target_not_found"); return this.state(); }
  async wait({ locator, selector, text, urlIncludes, readyState, timeoutMs = 15_000 }) {
    await this.start();
    if (locator || selector) await locatorFor(this.page, locator || selector).waitFor({ state: "visible", timeout: timeoutMs });
    if (text) await this.page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout: timeoutMs });
    if (urlIncludes) await this.page.waitForURL((url) => url.toString().includes(urlIncludes), { timeout: timeoutMs });
    if (readyState === "complete") await this.page.waitForLoadState("load", { timeout: timeoutMs });
    return this.state();
  }
  async observe(predicate) {
    await this.start();
    const value = predicate && typeof predicate === "object" && !Array.isArray(predicate) ? predicate : {};
    if (typeof value.urlIncludes === "string") return this.page.url().includes(value.urlIncludes);
    const target = locatorFor(this.page, value.locator);
    if (value.visible === true) return target.first().isVisible();
    if (value.hidden === true) return target.first().isHidden();
    if (typeof value.textIncludes === "string") return (await target.first().innerText()).includes(value.textIncludes);
    if (typeof value.valueEquals === "string") return (await target.first().inputValue()) === value.valueEquals;
    if (value.count !== undefined) return await target.count() === Number(value.count);
    if (value.attribute && typeof value.attribute === "object") {
      const name = String(value.attribute.name ?? "");
      const expected = value.attribute.equals === undefined ? null : String(value.attribute.equals);
      return (await target.first().getAttribute(name)) === expected;
    }
    throw new Error("browser_predicate_invalid");
  }
  async close() {
    const browser = this.browser;
    this.page = null; this.context = null; this.browser = null;
    void browser?.close().catch(() => undefined);
  }
}
