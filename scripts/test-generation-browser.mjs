#!/usr/bin/env node
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PlaywrightBrowserSession } from "../apps/server/src/generation/playwright-session.mjs";

const tmp = await mkdtemp(path.join(os.tmpdir(), "kcml-playwright-browser-"));
const browser = new PlaywrightBrowserSession({ workspace: tmp, sessionId: "integration", allowLocal: true });
const html = `<!doctype html><html><body><form><label>Account <input aria-label="Account"></label><label>Role <select aria-label="Role"><option value="owner">Owner</option><option value="admin">Admin</option></select></label><button type="button" aria-label="Reveal advanced">Reveal advanced</button><button type="submit" aria-label="Continue setup">Continue setup</button><output>READY</output></form><script>document.querySelector('[aria-label="Reveal advanced"]').onclick=()=>{const b=document.createElement('button');b.textContent='Dynamic action';b.setAttribute('aria-label','Dynamic action');b.onclick=()=>document.querySelector('output').textContent='DYNAMIC_OK';document.body.append(b)};document.querySelector('form').onsubmit=(e)=>{e.preventDefault();document.querySelector('output').textContent='SIGNED:'+document.querySelector('[aria-label="Account"]').value+':'+document.querySelector('[aria-label="Role"]').value}</script></body></html>`;
try {
  let state = await browser.loadHtmlForTest(html);
  const find = (name) => state.elements.find((item) => String(item.accessibleName).trim() === name)?.locator;
  await browser.fill(find("Account"), "karel");
  await browser.select(find("Role"), "admin");
  await browser.click(find("Reveal advanced"));
  state = await browser.state();
  await browser.click(find("Dynamic action"));
  await browser.wait({ text: "DYNAMIC_OK", timeoutMs: 3000 });
  await browser.click(find("Continue setup"));
  await browser.wait({ text: "SIGNED:karel:admin", timeoutMs: 3000 });
  state = await browser.state();
  if (!state.text.includes("SIGNED:karel:admin")) throw new Error("playwright_fixture_submission_failed");
  if (state.text.includes("owner-credential")) throw new Error("playwright_sensitive_state_leak");
  console.log("PASS generation Playwright managed browser dynamic DOM and semantic interaction");
} finally {
  await browser.close();
  await rm(tmp, { recursive: true, force: true });
}
