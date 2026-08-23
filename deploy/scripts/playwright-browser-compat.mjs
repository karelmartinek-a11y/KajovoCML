import { execFile } from "node:child_process";
import { access, mkdtemp, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const COMMAND_MAX_BUFFER = 16 * 1024 * 1024;

/**
 * Node 24.17.0 on the production host was observed hanging in Playwright's
 * extract-zip pipeline while handling Chromium's crashpad binary. Keep the
 * compatibility path deliberately narrow; newer runtimes use Playwright's
 * normal installer unchanged.
 */
export function shouldUseSystemUnzip(nodeVersion = process.versions.node) {
  const match = String(nodeVersion).match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u);
  return Boolean(match && Number(match[1]) === 24 && Number(match[2]) === 17);
}

export function parsePlaywrightDryRun(output) {
  const lines = String(output).split(/\r?\n/u);
  const chromiumStart = lines.findIndex((line) => /^browser: chromium(?:\s|$)/u.test(line));
  if (chromiumStart < 0) throw new Error("playwright_chromium_dry_run_missing");
  const nextBrowser = lines.findIndex((line, index) => index > chromiumStart && /^browser: /u.test(line));
  const block = lines.slice(chromiumStart, nextBrowser < 0 ? lines.length : nextBrowser);
  const installLine = block.find((line) => /^\s+Install location:\s+/u.test(line));
  const installLocation = installLine?.replace(/^\s+Install location:\s+/u, "").trim();
  const downloadUrls = block
    .map((line) => line.match(/^\s+Download (?:url|fallback \d+):\s+(https:\/\/\S+)\s*$/u)?.[1])
    .filter((url) => Boolean(url));
  if (!installLocation || downloadUrls.length === 0) throw new Error("playwright_chromium_dry_run_incomplete");
  return { installLocation, downloadUrls };
}

function assertInstallBoundary(browserRoot, installLocation, chromiumBinary) {
  const root = path.resolve(browserRoot);
  const install = path.resolve(installLocation);
  const installRelative = path.relative(root, install);
  if (!/^chromium-[A-Za-z0-9._-]+$/u.test(installRelative)) {
    throw new Error("playwright_chromium_install_location_outside_boundary");
  }
  const binaryRelative = path.relative(install, path.resolve(chromiumBinary));
  if (!binaryRelative || path.isAbsolute(binaryRelative) || binaryRelative.startsWith("..")) {
    throw new Error("playwright_chromium_binary_outside_install_location");
  }
  return { install, binaryRelative };
}

async function run(command, args, options = {}) {
  return execFileAsync(command, args, { maxBuffer: COMMAND_MAX_BUFFER, ...options });
}

async function assertArchiveSafe(archivePath) {
  await run("unzip", ["-tq", archivePath]);
  const { stdout } = await run("unzip", ["-Z", "-1", archivePath]);
  for (const entry of stdout.split(/\r?\n/u).filter(Boolean)) {
    if (entry.startsWith("/") || entry.split("/").includes("..")) {
      throw new Error("playwright_chromium_archive_path_traversal");
    }
  }
}

export async function installChromiumWithSystemUnzip({ sourceDir, playwrightCli, browserRoot, chromiumBinary }) {
  await access(playwrightCli, fsConstants.R_OK);
  await mkdir(browserRoot, { recursive: true, mode: 0o755 });
  const dryRun = await run(process.execPath, [playwrightCli, "install", "--dry-run", "chromium"], {
    cwd: sourceDir,
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browserRoot }
  });
  const plan = parsePlaywrightDryRun(`${dryRun.stdout}\n${dryRun.stderr}`);
  const { install, binaryRelative } = assertInstallBoundary(browserRoot, plan.installLocation, chromiumBinary);

  await run(process.execPath, [playwrightCli, "install-deps", "chromium"], {
    cwd: sourceDir,
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browserRoot }
  });

  const stagingRoot = await mkdtemp(path.join(browserRoot, ".kcml-playwright-install-"));
  const archivePath = path.join(stagingRoot, "chromium.zip");
  const extractRoot = path.join(stagingRoot, "extracted");
  await mkdir(extractRoot, { recursive: true, mode: 0o755 });
  try {
    let downloaded = false;
    for (const url of plan.downloadUrls) {
      try {
        await run("curl", [
          "--fail",
          "--location",
          "--proto",
          "=https",
          "--tlsv1.2",
          "--connect-timeout",
          "30",
          "--max-time",
          "600",
          "--retry",
          "2",
          "--output",
          archivePath,
          url
        ]);
        await assertArchiveSafe(archivePath);
        downloaded = true;
        break;
      } catch {
        await rm(archivePath, { force: true });
      }
    }
    if (!downloaded) throw new Error("playwright_chromium_compat_download_failed");

    await run("unzip", ["-q", archivePath, "-d", extractRoot]);
    const stagedBinary = path.join(extractRoot, binaryRelative);
    const binaryStats = await stat(stagedBinary);
    if (!binaryStats.isFile() || (binaryStats.mode & 0o111) === 0) {
      throw new Error("playwright_chromium_compat_binary_invalid");
    }
    await writeFile(path.join(extractRoot, "INSTALLATION_COMPLETE"), "", { mode: 0o644 });
    await rm(install, { recursive: true, force: true });
    await rename(extractRoot, install);
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2];
  if (command === "needs-system-unzip") {
    process.exitCode = shouldUseSystemUnzip(process.argv[3]);
  } else if (command === "install") {
    const [, , , sourceDir, playwrightCli, browserRoot, chromiumBinary] = process.argv;
    if (!sourceDir || !playwrightCli || !browserRoot || !chromiumBinary) throw new Error("playwright_chromium_compat_arguments_required");
    await installChromiumWithSystemUnzip({ sourceDir, playwrightCli, browserRoot, chromiumBinary });
  } else {
    throw new Error("playwright_chromium_compat_command_required");
  }
}
