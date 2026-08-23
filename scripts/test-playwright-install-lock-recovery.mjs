import assert from "node:assert/strict";
import { mkdtemp, mkdir, stat, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hasActivePlaywrightInstaller, reconcilePlaywrightInstallLock } from "../deploy/scripts/playwright-lock-recovery.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "kcml-playwright-lock-"));
try {
  await mkdir(path.join(root, "__dirlock"));
  assert.equal(await reconcilePlaywrightInstallLock(root, {
    allowedRoot: root,
    processTable: "1234 node /release/node_modules/playwright/cli.js install --with-deps chromium\n"
  }).catch((error) => error.message), "playwright_browser_install_lock_active");
  await stat(path.join(root, "__dirlock"));

  assert.equal(hasActivePlaywrightInstaller("1234 node /release/node_modules/playwright/cli.js install chromium\n", 999), true);
  assert.equal(hasActivePlaywrightInstaller("1234 node /release/node_modules/playwright/cli.js run-server\n", 999), false);

  assert.equal(await reconcilePlaywrightInstallLock(root, {
    allowedRoot: root,
    processTable: "1234 node /release/apps/server/dist/server.js\n"
  }), "stale-removed");
  await assert.rejects(() => stat(path.join(root, "__dirlock")), { code: "ENOENT" });
  assert.equal(await reconcilePlaywrightInstallLock(root, { allowedRoot: root, processTable: "" }), "absent");
} finally {
  await rm(root, { recursive: true, force: true });
}
console.log("PASS Playwright installer removes only stale locks and fails closed for active installers");
