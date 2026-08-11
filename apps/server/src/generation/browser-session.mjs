import { spawn } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function publicHttpsUrl(value, allowLocal) {
  const url = new URL(value);
  if (allowLocal && url.protocol === "data:") return url;
  if (allowLocal && ["http:", "https:"].includes(url.protocol) && ["127.0.0.1", "localhost", "::1"].includes(url.hostname)) return url;
  if (url.protocol !== "https:") throw new Error("browser_https_required");
  if (!url.hostname || ["localhost", "127.0.0.1", "::1"].includes(url.hostname) || url.hostname.endsWith(".local")) throw new Error("browser_public_host_required");
  return url;
}

export class BrowserSession {
  constructor({ chromiumBinary, workspace, sessionId, allowLocal = false }) {
    this.chromiumBinary = chromiumBinary;
    this.workspace = workspace;
    this.sessionId = sessionId;
    this.allowLocal = allowLocal;
    this.profileDir = path.join(workspace, ".browser-sessions", sessionId);
    this.process = null;
    this.ws = null;
    this.pending = new Map();
    this.events = new Map();
    this.nextId = 1;
    this.port = null;
    this.targetId = null;
    this.seenTargets = new Set();
    this.attachedTargets = new Map();
    this.frameContexts = new Map();
  }

  async #connectTarget(target) {
    const previous = this.ws;
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("browser_websocket_timeout")), 5000);
      ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("browser_websocket_failed")); }, { once: true });
    });
    this.ws = ws;
    this.targetId = String(target.id);
    this.attachedTargets.clear();
    this.frameContexts.clear();
    ws.addEventListener("message", (event) => this.#onMessage(event));
    ws.addEventListener("close", () => { if (this.ws === ws) this.#failAll(new Error("browser_websocket_closed")); });
    if (previous && previous !== ws) { try { previous.close(); } catch { /* closing the old socket is best-effort */ } }
    await this.send("Page.enable");
    await this.send("Runtime.enable");
    await this.send("Network.enable");
    await this.send("DOM.enable");
    await this.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  }

  async #targets() {
    if (!this.port) return [];
    const response = await fetch(`http://127.0.0.1:${this.port}/json/list`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`browser_targets_${response.status}`);
    return (await response.json()).filter((target) => target.type === "page" && target.webSocketDebuggerUrl);
  }

  async #adoptNewPopup() {
    const targets = await this.#targets();
    const fresh = targets.find((target) => !this.seenTargets.has(String(target.id)));
    for (const target of targets) this.seenTargets.add(String(target.id));
    if (fresh) { await this.#connectTarget(fresh); return true; }
    return false;
  }

  async #ensureActiveTarget() {
    const targets = await this.#targets();
    if (targets.some((target) => String(target.id) === this.targetId)) return;
    const fallback = targets[0];
    if (fallback) await this.#connectTarget(fallback);
  }

  async start() {
    if (this.ws) return;
    await mkdir(this.profileDir, { recursive: true, mode: 0o700 });
    await rm(path.join(this.profileDir, "DevToolsActivePort"), { force: true });
    this.process = spawn(this.chromiumBinary, [
      "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--site-per-process",
      "--remote-debugging-port=0", `--user-data-dir=${this.profileDir}`,
      "--disable-background-networking", "--disable-component-update", "--disable-default-apps",
      "--no-first-run", "--no-default-browser-check", "about:blank"
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let cdpOutput = "";
    let outputPort;
    const capture = (chunk) => {
      cdpOutput = `${cdpOutput}${String(chunk)}`.slice(-16_384);
      outputPort ??= cdpOutput.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d{1,5})\//)?.[1];
    };
    this.process.stdout.on("data", capture);
    this.process.stderr.on("data", capture);
    this.process.on("exit", (code) => { if (this.ws) this.#failAll(new Error(`browser_process_exited_${code}`)); });
    const activePort = path.join(this.profileDir, "DevToolsActivePort");
    let lines = null;
    for (let attempt = 0; attempt < 300; attempt += 1) {
      try {
        lines = (await readFile(activePort, "utf8")).trim().split(/\r?\n/);
        if (lines[0]) break;
      } catch { /* continue polling until Chromium writes its dynamically assigned CDP port */ }
      if (this.process.exitCode !== null) break;
      await sleep(50);
    }
    // Chrome normally writes the dynamically selected port to its profile, but
    // the GitHub-hosted Linux image can expose CDP first and omit that file.
    // Its own stderr still reports the loopback-only endpoint; the HTTP probe
    // below remains the authority before a session is connected.
    this.port = Number(lines?.[0] ?? outputPort);
    if (!Number.isInteger(this.port) || this.port < 1 || this.port > 65535) {
      await this.close();
      throw new Error(`browser_cdp_not_ready:${cdpOutput.slice(-1500)}`);
    }
    let cdpReady = false;
    for (let attempt = 0; attempt < 300; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${this.port}/json/version`, { signal: AbortSignal.timeout(500) });
        if (response.ok) { cdpReady = true; break; }
      } catch { /* DevToolsActivePort precedes the CDP HTTP listener on some CI starts */ }
      if (this.process.exitCode !== null) break;
      await sleep(50);
    }
    if (!cdpReady) {
      await this.close();
      throw new Error(`browser_cdp_not_ready:${cdpOutput.slice(-1500)}`);
    }
    const created = await fetch(`http://127.0.0.1:${this.port}/json/new?about:blank`, { method: "PUT", signal: AbortSignal.timeout(5000) });
    if (!created.ok) throw new Error(`browser_target_create_${created.status}`);
    const target = await created.json();
    if (!target.webSocketDebuggerUrl) throw new Error("browser_target_websocket_missing");
    await this.#connectTarget(target);
    for (const item of await this.#targets()) this.seenTargets.add(String(item.id));
  }

  #onMessage(event) {
    const message = JSON.parse(String(event.data));
    const eventSessionId = message.sessionId ? String(message.sessionId) : null;
    if (message.method === "Target.attachedToTarget") {
      const sessionId = String(message.params?.sessionId ?? "");
      const targetInfo = message.params?.targetInfo ?? {};
      if (sessionId && ["iframe", "page"].includes(String(targetInfo.type ?? ""))) {
        this.attachedTargets.set(sessionId, targetInfo);
        void this.send("Runtime.enable", {}, 5000, sessionId).catch(() => undefined);
      }
    } else if (message.method === "Target.detachedFromTarget") {
      const sessionId = String(message.params?.sessionId ?? "");
      if (sessionId) {
        this.attachedTargets.delete(sessionId);
        for (const [key, value] of this.frameContexts) if (value.sessionId === sessionId) this.frameContexts.delete(key);
      }
    } else if (message.method === "Runtime.executionContextCreated") {
      const context = message.params?.context;
      const auxData = context?.auxData ?? {};
      if (context?.id && auxData?.frameId && auxData?.isDefault !== false) {
        const key = `${eventSessionId ?? "root"}:${context.id}`;
        this.frameContexts.set(key, { sessionId: eventSessionId, contextId: Number(context.id), frameId: String(auxData.frameId), origin: String(context.origin ?? ""), name: String(context.name ?? "") });
      }
    } else if (message.method === "Runtime.executionContextDestroyed") {
      const contextId = Number(message.params?.executionContextId);
      this.frameContexts.delete(`${eventSessionId ?? "root"}:${contextId}`);
    } else if (message.method === "Runtime.executionContextsCleared") {
      for (const [key, value] of this.frameContexts) if ((value.sessionId ?? null) === eventSessionId) this.frameContexts.delete(key);
    }
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`browser_cdp_${message.error.code}:${message.error.message}`));
      else pending.resolve(message.result ?? {});
      return;
    }
    if (message.method) {
      const waiters = this.events.get(message.method) ?? [];
      this.events.set(message.method, []);
      for (const resolve of waiters) resolve(message.params ?? {});
    }
  }

  #failAll(error) { for (const pending of this.pending.values()) pending.reject(error); this.pending.clear(); }

  async send(method, params = {}, timeoutMs = 10000, sessionId = null) {
    await this.start();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`browser_cdp_timeout:${method}`)); }, timeoutMs);
      this.pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
      this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    });
  }

  async evaluate(expression, returnByValue = true) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue, userGesture: true });
    if (result.exceptionDetails) throw new Error(`browser_evaluate_failed:${result.exceptionDetails.text ?? "exception"}`);
    return result.result?.value;
  }

  async #withDocumentHandle(callback) {
    const documentHandle = await this.send("Runtime.evaluate", {
      expression: "document",
      returnByValue: false,
      userGesture: true
    });
    const objectId = documentHandle?.result?.objectId;
    if (!objectId) throw new Error("browser_document_unavailable");
    try {
      return await callback(objectId);
    } finally {
      await this.send("Runtime.releaseObject", { objectId }).catch(() => undefined);
    }
  }

  async #querySelectorHandle(selector) {
    return this.#withDocumentHandle(async (documentObjectId) => {
      const result = await this.send("Runtime.callFunctionOn", {
        objectId: documentObjectId,
        functionDeclaration: "function(selector){ return this.querySelector(String(selector)); }",
        arguments: [{ value: String(selector) }],
        returnByValue: false,
        userGesture: true
      });
      const objectId = result?.result?.subtype === "null" ? null : result?.result?.objectId;
      return objectId ? { objectId } : null;
    });
  }

  async #selectorExists(selector) {
    return this.#withDocumentHandle(async (documentObjectId) => {
      const result = await this.send("Runtime.callFunctionOn", {
        objectId: documentObjectId,
        functionDeclaration: "function(selector){ return Boolean(this.querySelector(String(selector))); }",
        arguments: [{ value: String(selector) }],
        returnByValue: true,
        userGesture: true
      });
      return Boolean(result?.result?.value);
    });
  }

  async open(value) {
    const url = publicHttpsUrl(value, this.allowLocal);
    const navigation = await this.send("Page.navigate", { url: url.toString() });
    if (navigation?.errorText) throw new Error(`browser_navigation_failed:${navigation.errorText}`);
    await this.wait({ readyState: "complete", urlIncludes: url.protocol === "data:" ? "data:" : url.origin, timeoutMs: 30000 });
    return this.state();
  }

  async loadHtmlForTest(html) {
    if (!this.allowLocal) throw new Error("browser_test_content_forbidden");
    await this.start();
    const tree = await this.send("Page.getFrameTree");
    const frameId = tree?.frameTree?.frame?.id;
    if (!frameId) throw new Error("browser_main_frame_missing");
    await this.send("Page.setDocumentContent", { frameId, html: String(html) });
    await this.wait({ readyState: "complete", timeoutMs: 5000 });
    return this.state();
  }


  async state() {
    await this.start();
    await this.#ensureActiveTarget();
    const base = await this.evaluate(`(() => ({url:location.href,title:document.title,readyState:document.readyState,text:(document.body?.innerText||'').slice(0,50000)}))()`);
    const targetId = this.targetId;
    const elements = await this.evaluate(`(() => {
      const registry = new Map(); globalThis.__kcmlLocatorRegistry = registry;
      const result = []; let sequence = 0;
      const interactiveSelector = 'input,textarea,select,button,a,[role="button"],[role="textbox"],[role="combobox"]';
      const describe = (el, framePath) => {
        const key = 'e' + (++sequence); registry.set(key, el);
        const labels = el.labels ? Array.from(el.labels).map((x) => x.innerText || x.textContent || '').join(' ') : '';
        const text = (el.innerText || el.textContent || '').trim().slice(0, 500);
        const accessibleName = String(el.getAttribute?.('aria-label') || labels || text || el.getAttribute?.('placeholder') || el.getAttribute?.('title') || '').trim().slice(0, 500);
        const value = el.tagName === 'INPUT' && el.type === 'password' ? '[SECRET]' : (typeof el.value === 'string' ? el.value.slice(0, 1000) : null);
        result.push({ index: result.length, tag: el.tagName.toLowerCase(), type: el.getAttribute?.('type'), name: el.getAttribute?.('name'), id: el.id || null, role: el.getAttribute?.('role'), text, accessibleName, value, selector: null, framePath, locator: 'kcmlref:${targetId}:' + key });
      };
      const visit = (doc, framePath) => {
        for (const el of Array.from(doc.querySelectorAll(interactiveSelector)).slice(0, 500 - result.length)) describe(el, framePath);
        let frameIndex = 0;
        for (const frame of Array.from(doc.querySelectorAll('iframe,frame'))) {
          if (result.length >= 500) break;
          try {
            const child = frame.contentDocument;
            if (child) visit(child, [...framePath, String(frame.getAttribute('title') || frame.getAttribute('name') || frameIndex)]);
          } catch { /* cross-origin/OOPIF frames are represented by their page target when Chromium exposes one */ }
          frameIndex += 1;
        }
      };
      visit(document, []); return result;
    })()`);
    const frameTree = await this.send("Page.getFrameTree");
    const mainFrameId = String(frameTree?.frameTree?.frame?.id ?? "");
    for (const context of [...this.frameContexts.values()]) {
      if (!context.frameId || context.frameId === mainFrameId) continue;
      const sessionId = context.sessionId ?? null;
      try {
        const locatorSession = sessionId ?? "root";
        const frameResult = await this.send("Runtime.evaluate", {
          contextId: context.contextId,
          expression: `(() => {
            const registry = new Map(); globalThis.__kcmlLocatorRegistry = registry;
            const result = []; let sequence = 0;
            const interactiveSelector = 'input,textarea,select,button,a,[role="button"],[role="textbox"],[role="combobox"]';
            for (const el of Array.from(document.querySelectorAll(interactiveSelector)).slice(0,500)) {
              const key = 'e' + (++sequence); registry.set(key, el);
              const labels = el.labels ? Array.from(el.labels).map((x) => x.innerText || x.textContent || '').join(' ') : '';
              const text = (el.innerText || el.textContent || '').trim().slice(0,500);
              const accessibleName = String(el.getAttribute?.('aria-label') || labels || text || el.getAttribute?.('placeholder') || el.getAttribute?.('title') || '').trim().slice(0,500);
              const value = el.tagName === 'INPUT' && el.type === 'password' ? '[SECRET]' : (typeof el.value === 'string' ? el.value.slice(0,1000) : null);
              result.push({index:result.length,tag:el.tagName.toLowerCase(),type:el.getAttribute?.('type'),name:el.getAttribute?.('name'),id:el.id||null,role:el.getAttribute?.('role'),text,accessibleName,value,selector:null,framePath:[String(location.origin),String(location.href)],locator:'kcmlframe:${targetId}:${locatorSession}:${context.contextId}:'+key});
            }
            return {url:location.href,title:document.title,readyState:document.readyState,elements:result};
          })()`,
          awaitPromise: true, returnByValue: true, userGesture: true
        }, 5000, sessionId);
        const frameValue = frameResult?.result?.value;
        if (frameValue?.elements?.length) elements.push(...frameValue.elements);
      } catch {
        // A frame may navigate or detach between state collection and action; the next
        // browser_state call rebuilds opaque locators from the new execution context.
      }
    }
    const pages = (await this.#targets()).map((target) => ({ targetId: String(target.id), title: String(target.title || ""), url: String(target.url || ""), active: String(target.id) === this.targetId }));
    return { ...base, targetId: this.targetId, pages, elements };
  }

  async switchPage(targetId) {
    const target = (await this.#targets()).find((item) => String(item.id) === String(targetId));
    if (!target) throw new Error(`browser_target_not_found:${targetId}`);
    await this.#connectTarget(target);
    this.seenTargets.add(String(target.id));
    return this.state();
  }

  async #withElement(locator, functionDeclaration, args = []) {
    if (String(locator).startsWith("kcmlframe:")) {
      const match = /^kcmlframe:([^:]+):([^:]+):(\d+):(.+)$/.exec(String(locator));
      if (!match) throw new Error(`browser_locator_invalid:${locator}`);
      if (match[1] !== this.targetId) await this.switchPage(match[1]);
      const sessionId = match[2] === "root" ? null : match[2];
      const contextId = Number(match[3]);
      if (sessionId && !this.attachedTargets.has(sessionId)) throw new Error(`browser_frame_detached:${locator}`);
      const resolved = await this.send("Runtime.evaluate", { contextId, expression: `globalThis.__kcmlLocatorRegistry?.get(${JSON.stringify(match[4])})`, returnByValue: false, userGesture: true }, 5000, sessionId);
      const objectId = resolved?.result?.objectId;
      if (!objectId) throw new Error(`browser_element_not_found:${locator}`);
      try {
        const result = await this.send("Runtime.callFunctionOn", { objectId, functionDeclaration, arguments: args.map((value) => ({ value })), returnByValue: true, userGesture: true }, 10000, sessionId);
        if (result.exceptionDetails) throw new Error("browser_element_action_failed");
        return result.result?.value;
      } finally { await this.send("Runtime.releaseObject", { objectId }, 5000, sessionId).catch(() => undefined); }
    }
    if (String(locator).startsWith("kcmlref:")) {
      const match = /^kcmlref:([^:]+):(.+)$/.exec(String(locator));
      if (!match) throw new Error(`browser_locator_invalid:${locator}`);
      if (match[1] !== this.targetId) await this.switchPage(match[1]);
      const resolved = await this.send("Runtime.evaluate", { expression: `globalThis.__kcmlLocatorRegistry?.get(${JSON.stringify(match[2])})`, returnByValue: false, userGesture: true });
      const objectId = resolved?.result?.objectId;
      if (!objectId) throw new Error(`browser_element_not_found:${locator}`);
      try {
        const result = await this.send("Runtime.callFunctionOn", { objectId, functionDeclaration, arguments: args.map((value) => ({ value })), returnByValue: true, userGesture: true });
        if (result.exceptionDetails) throw new Error("browser_element_action_failed");
        return result.result?.value;
      } finally { await this.send("Runtime.releaseObject", { objectId }).catch(() => undefined); }
    }
    if (String(locator).startsWith("kcml:")) {
      const match = /^kcml:([^:]+):(\d+)$/.exec(String(locator));
      if (!match) throw new Error(`browser_locator_invalid:${locator}`);
      if (match[1] !== this.targetId) await this.switchPage(match[1]);
      const resolved = await this.send("DOM.resolveNode", { backendNodeId: Number(match[2]) });
      const objectId = resolved?.object?.objectId;
      if (!objectId) throw new Error(`browser_element_not_found:${locator}`);
      try {
        const result = await this.send("Runtime.callFunctionOn", { objectId, functionDeclaration, arguments: args.map((value) => ({ value })), returnByValue: true, userGesture: true });
        if (result.exceptionDetails) throw new Error("browser_element_action_failed");
        return result.result?.value;
      } finally { await this.send("Runtime.releaseObject", { objectId }).catch(() => undefined); }
    }
    const resolved = await this.#querySelectorHandle(locator);
    const objectId = resolved?.objectId;
    if (!objectId) throw new Error(`browser_element_not_found:${locator}`);
    try {
      const result = await this.send("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration,
        arguments: args.map((value) => ({ value })),
        returnByValue: true,
        userGesture: true
      });
      if (result.exceptionDetails) throw new Error("browser_element_action_failed");
      if (!result.result?.value?.ok) throw new Error(`browser_element_not_found:${locator}`);
      return result.result.value;
    } finally {
      await this.send("Runtime.releaseObject", { objectId }).catch(() => undefined);
    }
  }

  async click(locator) {
    const result = await this.#withElement(locator, `function(){if(!this.isConnected)return {ok:false};this.scrollIntoView({block:'center'});this.click();return {ok:true};}`);
    if (!result?.ok) throw new Error(`browser_element_not_found:${locator}`);
    await sleep(100);
    await this.#adoptNewPopup();
    return this.state();
  }

  async fill(locator, value) {
    const result = await this.#withElement(locator, `function(value){if(!this.isConnected)return {ok:false};this.focus();const proto=this instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;const descriptor=Object.getOwnPropertyDescriptor(proto,'value');if(descriptor?.set)descriptor.set.call(this,String(value));else this.value=String(value);this.dispatchEvent(new Event('input',{bubbles:true}));this.dispatchEvent(new Event('change',{bubbles:true}));return {ok:true};}`, [String(value)]);
    if (!result?.ok) throw new Error(`browser_element_not_found:${locator}`);
    return { ok: true, locator };
  }

  async readValue(locator) {
    const value = await this.#withElement(locator, `function(){if(!this.isConnected)return {ok:false};const value=(typeof this.value==='string'?this.value:(this.textContent||''));return {ok:true,value:String(value)};}`);
    if (!value?.ok) throw new Error(`browser_element_not_found:${locator}`);
    return value.value;
  }

  async select(locator, value) {
    const result = await this.#withElement(locator, `function(value){if(!(this instanceof HTMLSelectElement))return {ok:false};this.value=String(value);this.dispatchEvent(new Event('input',{bubbles:true}));this.dispatchEvent(new Event('change',{bubbles:true}));return {ok:true,value:this.value};}`, [String(value)]);
    if (!result?.ok) throw new Error(`browser_select_not_found:${locator}`);
    return result;
  }

  async press(key) {
    const map = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39 };
    const keyCode = map[key] ?? (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
    await this.send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
    return this.state();
  }

  async wait({ locator = null, selector = null, text = null, urlIncludes = null, readyState = null, timeoutMs = 15000 }) {
    const deadline = Date.now() + Math.min(Math.max(Number(timeoutMs) || 15000, 100), 60000);
    while (Date.now() < deadline) {
      try {
        await this.#ensureActiveTarget();
        const state = await this.evaluate("(() => ({url:location.href,readyState:document.readyState,text:(document.body?.innerText||'').slice(0,100000)}))()");
        state.selector = selector ? await this.#selectorExists(selector) : true;
        let locatorOk = true;
        if (locator) { try { locatorOk = Boolean((await this.#withElement(locator, `function(){return {ok:Boolean(this.isConnected)}}`))?.ok); } catch { locatorOk = false; } }
        if (locatorOk && (!selector || state.selector) && (!text || state.text.includes(text)) && (!urlIncludes || state.url.includes(urlIncludes)) && (!readyState || state.readyState === readyState)) return state;
      } catch { /* transient navigation and frame churn are expected while waiting */ }
      await sleep(100);
    }
    throw new Error("browser_wait_timeout");
  }

  async close() {
    const ws = this.ws; this.ws = null;
    try { ws?.close(); } catch { /* browser session may already be closed */ }
    const child = this.process;
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await Promise.race([new Promise((resolve) => child.once("exit", resolve)), sleep(2000)]);
      if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await Promise.race([new Promise((resolve) => child.once("exit", resolve)), sleep(2000)]); }
    }
    this.process = null;
    // Chromium may briefly keep profile helper processes alive after the main
    // process exits. Give them a bounded drain window so job/workspace cleanup
    // cannot race profile writes.
    await sleep(250);
  }
}
