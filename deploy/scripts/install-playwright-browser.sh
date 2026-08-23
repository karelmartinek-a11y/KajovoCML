#!/usr/bin/env bash
set -Eeuo pipefail
umask 022

source_dir="${1:?verified release source required}"
case "$source_dir" in
  /*) ;;
  *) echo "release source must be absolute" >&2; exit 2 ;;
esac
playwright_package="$source_dir/apps/server/node_modules/playwright"
lock_recovery="$source_dir/deploy/scripts/playwright-lock-recovery.mjs"
compatibility_helper="$source_dir/deploy/scripts/playwright-browser-compat.mjs"
test -d "$playwright_package"
playwright_cli="$playwright_package/cli.js"
test -f "$playwright_cli"
test -f "$lock_recovery"
test -f "$compatibility_helper"
echo "playwright-browser:module=present" >&2
echo "playwright-browser:cli=file" >&2

browser_root="${PLAYWRIGHT_BROWSERS_PATH:-/opt/kcml/playwright-browsers}"
case "$browser_root" in
  /opt/kcml/playwright-browsers|/opt/kcml/playwright-browsers/*) ;;
  *) echo "PLAYWRIGHT_BROWSERS_PATH must stay under /opt/kcml/playwright-browsers" >&2; exit 2 ;;
esac

install -d -m 0755 "$browser_root"
test -w "$browser_root"
command -v flock >/dev/null
echo "playwright-browser:root=ready" >&2
chromium_binary="$(
  cd "$source_dir"
  PLAYWRIGHT_BROWSERS_PATH="$browser_root" node --input-type=module -e \
    'import { chromium } from "./apps/server/node_modules/playwright/index.mjs"; process.stdout.write(chromium.executablePath())'
)"
test -n "$chromium_binary"
chromium_install_dir="$(dirname "$(dirname "$chromium_binary")")"
chromium_marker="$chromium_install_dir/INSTALLATION_COMPLETE"
if test -x "$chromium_binary" && test -f "$chromium_marker"; then
  echo "playwright-browser:reuse=existing" >&2
else
  echo "playwright-browser:install=chromium" >&2
  install_lock="$browser_root/.kcml-playwright-install.lock"
  exec 9>"$install_lock"
  flock -n 9 || { echo "playwright-browser:lock=kcml-installer-active" >&2; exit 1; }
  node "$lock_recovery" "$browser_root"
  node_version="$(node -p 'process.versions.node')"
  echo "playwright-browser:node-version=$node_version" >&2
  if node "$compatibility_helper" needs-system-unzip "$node_version"; then
    echo "playwright-browser:compatibility-extractor=system-unzip" >&2
    PLAYWRIGHT_BROWSERS_PATH="$browser_root" node "$compatibility_helper" install "$source_dir" "$playwright_cli" "$browser_root" "$chromium_binary"
  else
    PLAYWRIGHT_BROWSERS_PATH="$browser_root" node "$playwright_cli" install --with-deps chromium >&2
  fi
  echo "playwright-browser:install=complete" >&2
fi
test -x "$chromium_binary"
test -f "$chromium_marker"
echo "playwright-browser:binary=executable" >&2

# Browser files are immutable deployment data, not application credentials.
# Keep them readable/executable by kcml while retaining root ownership.
chown -R root:kcml "$browser_root"
find "$browser_root" -type d -exec chmod 0755 {} +
find "$browser_root" -type f -exec chmod a+rX {} +
test -x "$chromium_binary"
printf '%s\n' "$chromium_binary"
