import { execFile } from "node:child_process";
import { lstat, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Keep the browser cache boundary explicit for the release installer. */
export function resolveBrowserRoot(rawRoot, allowedRoot = "/opt/kcml/playwright-browsers") {
  const root = path.resolve(rawRoot);
  const boundary = path.resolve(allowedRoot);
  if (root !== boundary && !root.startsWith(`${boundary}${path.sep}`)) {
    throw new Error("playwright_browser_root_outside_allowed_boundary");
  }
  return root;
}

export function hasActivePlaywrightInstaller(processTable, currentPid = process.pid) {
  return processTable.split(/\r?\n/u).some((line) => {
    const match = line.trim().match(/^(\d+)\s+(.*)$/u);
    if (!match || Number(match[1]) === currentPid) return false;
    const command = match[2].toLowerCase();
    return command.includes("playwright") && command.includes("cli.js") && /\binstall\b/u.test(command);
  });
}

async function processTable() {
  const result = await execFileAsync("ps", ["-eo", "pid=,args="], { maxBuffer: 2 * 1024 * 1024 });
  return result.stdout;
}

/**
 * Playwright's directory lock can survive a killed release process. Remove it
 * only when no installer is observable; process-inspection failure fails
 * closed and never broadens the deletion target beyond __dirlock.
 */
export async function reconcilePlaywrightInstallLock(rawRoot, options = {}) {
  const root = resolveBrowserRoot(rawRoot, options.allowedRoot);
  const lockPath = path.join(root, "__dirlock");
  try {
    await lstat(lockPath);
  } catch (error) {
    if (error?.code === "ENOENT") return "absent";
    throw error;
  }

  const listing = options.processTable ?? await processTable();
  if (hasActivePlaywrightInstaller(listing, process.pid)) {
    throw new Error("playwright_browser_install_lock_active");
  }

  await rm(lockPath, { recursive: true, force: true });
  return "stale-removed";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2];
  if (!root) throw new Error("playwright_browser_root_required");
  const result = await reconcilePlaywrightInstallLock(root);
  process.stdout.write(`playwright-browser:lock=${result}\n`);
}
