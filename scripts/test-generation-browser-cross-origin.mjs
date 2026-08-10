#!/usr/bin/env node
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BrowserSession } from "../apps/server/src/generation/browser-session.mjs";

const listen = (server) => new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
let framePort = 0;
const frameServer = http.createServer((req, res) => {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(`<!doctype html><html><head><title>Cross Origin Provider Frame</title></head><body>
    <label>Frame account <input placeholder="Frame account"></label>
    <button aria-label="Cross origin action" onclick="parent.postMessage('FRAME_OK','*')">Cross origin action</button>
  </body></html>`);
});
await listen(frameServer); framePort = frameServer.address().port;

let mainPort = 0;
const mainServer = http.createServer((req, res) => {
  res.setHeader("content-type", "text/html; charset=utf-8");
  if ((req.url || "").startsWith("/popup")) {
    res.end(`<!doctype html><html><head><title>Provider Popup</title></head><body><button aria-label="Popup action" onclick="document.body.append(' POPUP_OK')">Popup action</button></body></html>`);
    return;
  }
  res.end(`<!doctype html><html><head><title>Provider Console Fixture</title></head><body>
    <h1>Provider Console</h1>
    <label>Account <input placeholder="Provider account"></label>
    <label>Secret <input type="password" aria-label="Provider secret"></label>
    <label>Role <select aria-label="Provider role"><option value="owner">Owner</option><option value="admin">Admin</option></select></label>
    <button type="button" aria-label="Reveal advanced" onclick="revealAdvanced()">Reveal advanced</button>
    <button type="button" aria-label="Continue setup" onclick="continueSetup()">Continue setup</button>
    <iframe title="Cross origin provider frame" src="http://127.0.0.1:${framePort}/frame"></iframe>
    <button type="button" aria-label="Open provider popup" onclick="open('/popup','providerPopup')">Open provider popup</button>
    <output>READY</output>
    <script>
      function revealAdvanced(){const b=document.createElement('button');b.textContent='Dynamic action';b.setAttribute('aria-label','Dynamic action');b.onclick=()=>document.querySelector('output').textContent='DYNAMIC_OK';document.body.appendChild(b)}
      function continueSetup(){document.querySelector('output').textContent='SIGNED:'+document.querySelector('input[placeholder]').value+':'+document.querySelector('select').value+':'+(document.querySelector('input[type=password]').value.length>0);history.pushState({},'', '#done')}
      addEventListener('message',(e)=>{if(e.data==='FRAME_OK')document.querySelector('output').textContent='FRAME_OK'});
    </script>
  </body></html>`);
});
await listen(mainServer); mainPort = mainServer.address().port;

const tmp = await mkdtemp(path.join(os.tmpdir(), "kcml-browser-test-"));
const chromium = process.env.CHROMIUM_BINARY || "/usr/bin/chromium";
const browser = new BrowserSession({ chromiumBinary: chromium, workspace: tmp, sessionId: "integration", allowLocal: true });
const find = (state, name) => {
  const element = state.elements.find((item) => [item.accessibleName, item.text, item.value].map(String).some((value) => value.trim() === name));
  if (!element?.locator) throw new Error(`browser_locator_missing:${name}:${JSON.stringify(state.elements).slice(0,6000)}`);
  return element.locator;
};
try {
  let state = await browser.open(`http://localhost:${mainPort}/`);
  await new Promise((resolve) => setTimeout(resolve, 500));
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
  const frameLocator = find(state, "Cross origin action");
  const frameEntry = state.elements.find((item) => item.locator === frameLocator);
  if (!String(frameLocator).startsWith("kcmlframe:")) throw new Error(`browser_cross_origin_not_oopif:${frameLocator}`);
  if (!Array.isArray(frameEntry?.framePath) || frameEntry.framePath.length < 1) throw new Error("browser_frame_context_missing");
  await browser.fill(find(state, "Frame account"), "frame-user");
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
  console.log("PASS generation browser opaque locators dynamic DOM cross-origin OOPIF popup workflow");
} finally {
  await browser.close();
  await Promise.all([new Promise((resolve) => mainServer.close(resolve)), new Promise((resolve) => frameServer.close(resolve))]);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try { await rm(tmp, { recursive: true, force: true }); break; }
    catch (error) { if (attempt === 9) throw error; await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
}
