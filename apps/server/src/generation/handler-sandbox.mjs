import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const workerPath = fileURLToPath(new URL("./handler-sandbox-worker.mjs", import.meta.url));
const namespaceScript = String.raw`
set -eu
ROOT="$1"
SOURCE="$ROOT.source"
NODE_BIN="$2"
HANDLER="$3"
WORKER="$4"
COMPONENT_CODE="$5"
mkdir -p "$SOURCE/app" "$SOURCE/lib" "$SOURCE/lib64"
touch "$SOURCE/node" "$SOURCE/app/handler.mjs" "$SOURCE/app/handler-sandbox-worker.mjs"
/usr/bin/mount --bind "$SOURCE" "$ROOT"
/usr/bin/mount --bind "$NODE_BIN" "$ROOT/node"
/usr/bin/mount -o remount,bind,ro "$ROOT/node"
/usr/bin/mount --rbind /usr/lib "$ROOT/lib"
/usr/bin/mount --make-rslave "$ROOT/lib"
/usr/bin/mount -o remount,bind,ro "$ROOT/lib"
if [ -d /usr/lib64 ]; then
  /usr/bin/mount --bind /usr/lib64 "$ROOT/lib64"
  /usr/bin/mount -o remount,bind,ro "$ROOT/lib64"
fi
/usr/bin/mount --bind "$HANDLER" "$ROOT/app/handler.mjs"
/usr/bin/mount -o remount,bind,ro "$ROOT/app/handler.mjs"
/usr/bin/mount --bind "$WORKER" "$ROOT/app/handler-sandbox-worker.mjs"
/usr/bin/mount -o remount,bind,ro "$ROOT/app/handler-sandbox-worker.mjs"
# Mount all required files while the staged root is writable, then make the
# complete view immutable.  Remounting the root before the nested binds makes
# mount(8) reject the later file mounts on some production kernels.
/usr/bin/mount -o remount,bind,ro "$ROOT"
exec /usr/bin/env -i PATH=/usr/bin:/usr/sbin:/bin:/sbin LANG=C.UTF-8 /usr/sbin/chroot "$ROOT" /node --experimental-vm-modules /app/handler-sandbox-worker.mjs "$COMPONENT_CODE"
`;

function ensureJsonRoundTrip(value, label) {
  let encoded;
  try { encoded = JSON.stringify(value ?? null); } catch { throw new Error(`${label}_not_json_serializable`); }
  if (encoded.length > 1024 * 1024) throw new Error(`${label}_too_large`);
  return encoded;
}

export class GeneratedHandlerSandbox {
  constructor({ handlerPath, componentCode, capabilities, timeoutMs = 60_000 }) {
    this.capabilities = capabilities;
    this.timeoutMs = timeoutMs;
    this.pending = new Map();
    this.nextId = 1;
    this.description = null;
    this.isolationEvidence = null;
    this.closed = false;
    this.sandboxRoot = null;
    this.stderr = "";
    this.child = null;
    this.ready = this.#start(handlerPath, componentCode);
  }

  async #start(handlerPath, componentCode) {
    this.sandboxRoot = await mkdtemp(join(tmpdir(), "kcml-handler-sandbox-"));
    const runningAsRoot = typeof process.getuid === "function" && process.getuid() === 0;
    const shouldUseSudo = process.platform === "linux" && process.env.CI === "true" && !runningAsRoot;
    const namespaceFlags = runningAsRoot
      ? ["--mount", "--net", "--ipc", "--uts", "--pid", "--fork", "--kill-child=SIGKILL"]
      : ["--user", "--map-root-user", "--mount", "--net", "--ipc", "--uts", "--pid", "--fork", "--kill-child=SIGKILL"];
    const unshareArgs = [
      ...namespaceFlags,
      "/bin/sh", "-eu", "-c", namespaceScript, "kcml-handler-sandbox",
      this.sandboxRoot, process.execPath, handlerPath, workerPath, componentCode
    ];
    const command = shouldUseSudo ? "/usr/bin/sudo" : "/usr/bin/unshare";
    const args = shouldUseSudo ? ["-n", "/usr/bin/unshare", ...unshareArgs] : unshareArgs;
    this.child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { PATH: "/usr/bin:/usr/sbin:/bin:/sbin", LANG: "C.UTF-8" }
    });
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => { this.stderr = `${this.stderr}${chunk}`.slice(-32768); });
    const rl = readline.createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    rl.on("line", (line) => { void this.#onLine(line); });
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("generated_handler_sandbox_start_timeout")), 10_000);
      this._readyResolve = (description) => { clearTimeout(timer); resolve(description); };
      this._readyReject = (error) => { clearTimeout(timer); reject(error); };
      this.child.once("error", (error) => this._readyReject?.(error));
      this.child.once("exit", (code, signal) => {
        if (!this.description) this._readyReject?.(new Error(`generated_handler_sandbox_exit_${code ?? "null"}_${signal ?? "none"}:${this.stderr.trim().slice(-1000)}`));
        for (const [, pending] of this.pending) pending.reject(new Error("generated_handler_sandbox_exited"));
        this.pending.clear();
      });
    });
    try {
      return await ready;
    } catch (error) {
      await this.close().catch(() => undefined);
      throw error;
    }
  }

  #send(message) {
    if (!this.child?.stdin?.writable || this.closed) throw new Error("generated_handler_sandbox_closed");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  async #onLine(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message?.type === "ready") {
      this.description = message.description;
      this.isolationEvidence = message.isolation ?? null;
      this._readyResolve?.(message.description);
      return;
    }
    if (message?.type === "capability") {
      const operation = String(message.operation || "");
      try {
        const payload = JSON.parse(String(message.payloadJson || "null"));
        let result;
        if (operation === "secret") result = await this.capabilities.secret(payload.name);
        else if (operation === "callComponent") result = await this.capabilities.callComponent(payload);
        else if (operation === "callExternal") result = await this.capabilities.callExternal(payload);
        else if (operation === "state.get") result = await this.capabilities.stateGet(payload.key);
        else if (operation === "state.set") result = await this.capabilities.stateSet(payload.key, payload.value);
        else if (operation === "state.delete") result = await this.capabilities.stateDelete(payload.key);
        else throw new Error("sandbox_capability_not_allowed");
        this.#send({ type: "capability-result", id: message.id, ok: true, payloadJson: ensureJsonRoundTrip(result, "sandbox_capability_result") });
      } catch (error) {
        this.#send({ type: "capability-result", id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }
    if (message?.type === "dispatch-result") {
      const pending = this.pending.get(Number(message.id));
      if (!pending) return;
      this.pending.delete(Number(message.id));
      clearTimeout(pending.timer);
      if (!message.ok) pending.reject(new Error(String(message.error || "generated_handler_failed")));
      else {
        try { pending.resolve(JSON.parse(String(message.payloadJson || "null"))); }
        catch { pending.reject(new Error("generated_handler_result_invalid_json")); }
      }
    }
  }

  async dispatch(kind, payload = {}) {
    await this.ready;
    if (this.closed) throw new Error("generated_handler_sandbox_closed");
    const id = this.nextId++;
    const payloadJson = ensureJsonRoundTrip(payload, "sandbox_dispatch_payload");
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.child?.kill("SIGKILL");
        reject(new Error(`generated_handler_timeout:${kind}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.#send({ type: "dispatch", id, kind, payloadJson }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const [, pending] of this.pending) { clearTimeout(pending.timer); pending.reject(new Error("generated_handler_sandbox_closed")); }
    this.pending.clear();
    if (this.child && this.child.exitCode === null && this.child.signalCode === null) {
      const child = this.child;
      child.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => child.once("exit", resolve)),
        new Promise((resolve) => setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); resolve(); }, 1000))
      ]);
    }
    if (this.sandboxRoot) {
      await rm(this.sandboxRoot, { recursive: true, force: true }).catch(() => undefined);
      await rm(`${this.sandboxRoot}.source`, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
