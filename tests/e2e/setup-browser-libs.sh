#!/usr/bin/env bash
# Rootless Chromium runtime for hosts where you can't `sudo apt-get install`
# Playwright's browser dependencies (e.g. Debian trixie without passwordless
# sudo). Downloads the shared libraries + a font with `apt-get download` (no
# root needed) and assembles a prefix at ~/.pw-syslibs that playwright.config.js
# picks up automatically (LD_LIBRARY_PATH + FONTCONFIG_FILE) to run
# chrome-headless-shell.
#
# Usage:  bash setup-browser-libs.sh
# Then:   npx playwright install chromium   # if not already done
#         npm test
set -euo pipefail

PREFIX="$HOME/.pw-syslibs"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# soname -> providing package (Debian trixie / t64 names)
PKGS=(
  libnss3 libnspr4 libatk1.0-0t64 libatk-bridge2.0-0t64 libatspi2.0-0t64
  libgbm1 libasound2t64 libxcomposite1 libxdamage1 libxfixes3 libxkbcommon0
  libxrandr2 libdrm2 libexpat1 libwayland-client0 libxcb1 libx11-6 libxext6
  libxau6 libxdmcp6 libxi6 libxrender1 libxtst6 libpango-1.0-0 libcairo2
  libcups2t64 libfontconfig1 fonts-dejavu-core fontconfig-config
)

echo "[libs] downloading $( echo "${PKGS[@]}" | wc -w ) packages into $WORK"
cd "$WORK"
for p in "${PKGS[@]}"; do
  apt-get download "$p" >/dev/null 2>&1 && echo "  ok   $p" || echo "  MISS $p (skipped)"
done

echo "[libs] extracting into $PREFIX"
mkdir -p "$PREFIX"
for d in *.deb; do dpkg-deb -x "$d" "$WORK/root"; done
cp -rn "$WORK/root/usr" "$PREFIX/" 2>/dev/null || true
cp -rn "$WORK/root/etc" "$PREFIX/" 2>/dev/null || true

echo "[libs] writing fontconfig"
mkdir -p "$PREFIX/fontcache"
cat > "$PREFIX/fonts.conf" <<EOF
<?xml version="1.0"?>
<fontconfig>
  <dir>$PREFIX/usr/share/fonts</dir>
  <cachedir>$PREFIX/fontcache</cachedir>
</fontconfig>
EOF

MISSING=$(LD_LIBRARY_PATH="$PREFIX/usr/lib/x86_64-linux-gnu:$PREFIX/usr/lib/x86_64-linux-gnu/gbm" \
  ldd "$(ls -d "$HOME"/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell 2>/dev/null | head -1)" \
  2>/dev/null | grep -c 'not found' || true)
echo "[libs] done. chrome-headless-shell missing libs: ${MISSING:-?} (0 is good)"
echo "[libs] prefix ready at $PREFIX"
