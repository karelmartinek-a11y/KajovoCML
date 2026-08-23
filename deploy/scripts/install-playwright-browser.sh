#!/usr/bin/env bash
set -Eeuo pipefail
umask 022

source_dir="${1:?verified release source required}"
case "$source_dir" in
  /*) ;;
  *) echo "release source must be absolute" >&2; exit 2 ;;
esac
test -d "$source_dir/apps/server/node_modules/playwright"
playwright_cli="$source_dir/apps/server/node_modules/.bin/playwright"
test -x "$playwright_cli"

browser_root="${PLAYWRIGHT_BROWSERS_PATH:-/opt/kcml/playwright-browsers}"
case "$browser_root" in
  /opt/kcml/playwright-browsers|/opt/kcml/playwright-browsers/*) ;;
  *) echo "PLAYWRIGHT_BROWSERS_PATH must stay under /opt/kcml/playwright-browsers" >&2; exit 2 ;;
esac

install -d -m 0755 "$browser_root"
echo "playwright-browser:install=chromium" >&2
PLAYWRIGHT_BROWSERS_PATH="$browser_root" "$playwright_cli" install --with-deps chromium >&2

chromium_binary="$(
  cd "$source_dir"
  PLAYWRIGHT_BROWSERS_PATH="$browser_root" node --input-type=module -e \
    'import { chromium } from "./apps/server/node_modules/playwright/index.mjs"; process.stdout.write(chromium.executablePath())'
)"
test -n "$chromium_binary"
test -x "$chromium_binary"

# Browser files are immutable deployment data, not application credentials.
# Keep them readable/executable by kcml while retaining root ownership.
chown -R root:kcml "$browser_root"
find "$browser_root" -type d -exec chmod 0755 {} +
find "$browser_root" -type f -exec chmod a+rX {} +
test -x "$chromium_binary"
printf '%s\n' "$chromium_binary"
