#!/usr/bin/env node
import { access } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BrowserSession } from "../apps/server/src/generation/browser-session.mjs";

const frameHtml = `<!doctype html><html><body><button aria-label="Frame action" onclick="parent.postMessage('FRAME_OK','*')">Frame action</button></body></html>`;
const frameB64 = Buffer.from(frameHtml).toString("base64");
const page = `<!doctype html><html><head><title>Provider Console Fixture</title></head><body>
<h1>Provider Console</h1>
<label>Account <input placeholder="Provider account"></label>
<label>Secret <input type="password" aria-label="Provider secret"></label>
<label>Role <select aria-label="Provider role"><option value="owner">Owner</option><option value="admin">Admin</option></select></label>
<button type="button" aria-label="Reveal advanced" onclick="revealAdvanced()">Reveal advanced</button>
<button type="button" aria-label="Continue setup" onclick="continueSetup()">Continue setup</button>
<iframe title="Embedded provider frame"></iframe>
<button type="button" aria-label="Open provider popup" onclick="openProviderPopup()">Open provider popup</button>
<output>READY</output>
<script>
function revealAdvanced(){const b=document.createElement('button');b.textContent='Dynamic action';b.setAttribute('aria-label','Dynamic action');b.onclick=()=>document.querySelector('output').textContent='DYNAMIC_OK';document.body.appendChild(b)}
function continueSetup(){document.querySelector('output').textContent='SIGNED:'+document.querySelector('input[placeholder]').value+':'+document.querySelector('select').value+':'+(document.querySelector('input[type=password]').value.length>0);history.pushState({},'', '#done')}
function openProviderPopup(){const w=open('about:blank','providerPopup');w.document.open();w.document.write('<!doctype html><html><head><title>Provider Popup</title></head><body><button aria-label="Popup action">Popup action</button><script>document.querySelector("button").onclick=()=>document.body.append(" POPUP_OK")<\\/script></body></html>');w.document.close()}
addEventListener('message',(e)=>{if(e.data==='FRAME_OK')document.querySelector('output').textContent='FRAME_OK'});
document.querySelector('iframe').srcdoc=atob('${frameB64}');
</script>
</body></html>`;

const tmp = await mkdtemp(path.join(os.tmpdir(), "kcml-browser-test-"));
const chromium = process.env.CHROMIUM_BINARY || "/usr/bin/chromium";
if (process.platform !== "linux") {
  console.log(`UNSUPPORTED generation browser integration fixture runs only on Linux CI; current platform is ${process.platform}`);
  await rm(tmp, { recursive: true, force: true });
  process.exit(0);
}
try {
  await access(chromium);
} catch {
  console.log(`UNSUPPORTED generation browser integration fixture missing Chromium binary: ${chromium}`);
  await rm(tmp, { recursive: true, force: true });
  process.exit(0);
}
const browser = new BrowserSession({ chromiumBinary: chromium, workspace: tmp, sessionId: "integration", allowLocal: true });
const find = (state, name) => {
  const element = state.elements.find((item) => [item.accessibleName, item.text, item.value].map(String).some((value) => value.trim() === name));
  if (!element?.locator) throw new Error(`browser_locator_missing:${name}:${JSON.stringify(state.elements).slice(0,3000)}`);
  return element.locator;
};
try {
  let state = await browser.loadHtmlForTest(page);
  await new Promise((resolve) => setTimeout(resolve, 250));
  state = await browser.state();
  if (state.elements.some((item) => ["Account", "Provider secret", "Provider role", "Continue setup"].includes(String(item.accessibleName)) && (item.id || item.name))) throw new Error("browser_fixture_unexpected_id_or_name");
  await browser.fill(find(state, "Account"), "karel");
  await browser.fill(find(state, "Provider secret"), "owner-credential");
  await browser.select(find(state, "Provider role"), "admin");

  await browser.click(find(state, "Reveal advanced"));
  state = await browser.state();
  const dynamic = find(state, "Dynamic action");
  await browser.wait({ locator: dynamic, timeoutMs: 3000 });
  await browser.click(dynamic);
  await browser.wait({ text: "DYNAMIC_OK", timeoutMs: 3000 });

  state = await browser.state();
  const frameLocator = find(state, "Frame action");
  const frameEntry = state.elements.find((item) => item.locator === frameLocator);
  if (!Array.isArray(frameEntry?.framePath) || frameEntry.framePath.length < 1) throw new Error("browser_frame_context_missing");
  await browser.click(frameLocator);
  await browser.wait({ text: "FRAME_OK", timeoutMs: 3000 });

  state = await browser.state();
  await browser.click(find(state, "Continue setup"));
  await browser.wait({ urlIncludes: "#done", text: "SIGNED:karel:admin:true", timeoutMs: 5000 });

  state = await browser.state();
  const mainTarget = state.targetId;
  await browser.click(find(state, "Open provider popup"));
  state = await browser.state();
  if (state.targetId === mainTarget || !state.text.includes("Popup action")) throw new Error("browser_popup_not_adopted");
  await browser.click(find(state, "Popup action"));
  await browser.wait({ text: "POPUP_OK", timeoutMs: 3000 });
  if (!state.pages.some((item) => item.targetId === mainTarget)) throw new Error("browser_main_page_missing_after_popup");

  const final = await browser.switchPage(mainTarget);
  if (!final.url.endsWith("#done") || !final.text.includes("SIGNED:karel:admin:true")) throw new Error("browser_main_state_lost");
  if (JSON.stringify(final).includes("owner-credential")) throw new Error("browser_secret_exposed_in_state");
  console.log("PASS generation browser opaque locators dynamic DOM iframe popup workflow");
} finally {
  await browser.close();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try { await rm(tmp, { recursive: true, force: true }); break; }
    catch (error) { if (attempt === 9) throw error; await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
}
