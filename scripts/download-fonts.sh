#!/usr/bin/env bash
# scripts/download-fonts.sh
#
# Fetches the three open-source font families into apps/tauri-pos/public/fonts/.
# Run once on a fresh checkout (or whenever the lockfile changes weights).
#
#   pnpm fonts:download     # alias from root package.json
#
# Sources:
#   • Cormorant Garamond — github.com/CatharsisFonts/Cormorant (SIL OFL)
#   • Inter              — rsms.me/inter (SIL OFL)
#   • JetBrains Mono     — github.com/JetBrains/JetBrainsMono (Apache 2.0)
#
# All three live in our git history (post first run) so CI builds are
# deterministic even when upstream URLs change. To force a refresh, delete
# the target directory and rerun.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${REPO_ROOT}/apps/tauri-pos/public/fonts"
mkdir -p "${TARGET}"

echo "→ fonts target: ${TARGET}"

curl_pull() {
  local url=$1 out=$2
  if [ -f "${TARGET}/${out}" ]; then
    echo "  [skip]  ${out}"
    return
  fi
  echo "  [fetch] ${out}"
  curl -fsSL --retry 3 -o "${TARGET}/${out}" "${url}"
}

# Cormorant Garamond — direct GitHub raw URLs
CORMORANT_BASE="https://raw.githubusercontent.com/CatharsisFonts/Cormorant/master/2.%20Webfonts/Cormorant%20Garamond"
curl_pull "${CORMORANT_BASE}/CormorantGaramond-Light.woff2"    CormorantGaramond-Light.woff2
curl_pull "${CORMORANT_BASE}/CormorantGaramond-Regular.woff2"  CormorantGaramond-Regular.woff2
curl_pull "${CORMORANT_BASE}/CormorantGaramond-Italic.woff2"   CormorantGaramond-Italic.woff2
curl_pull "${CORMORANT_BASE}/CormorantGaramond-Medium.woff2"   CormorantGaramond-Medium.woff2
curl_pull "${CORMORANT_BASE}/CormorantGaramond-SemiBold.woff2" CormorantGaramond-SemiBold.woff2
curl_pull "${CORMORANT_BASE}/CormorantGaramond-Bold.woff2"     CormorantGaramond-Bold.woff2

# Inter — rsms's official CDN-free release tarball (we pick what we need)
INTER_BASE="https://github.com/rsms/inter/raw/master/docs/font-files"
curl_pull "${INTER_BASE}/Inter-Regular.woff2"  Inter-Regular.woff2
curl_pull "${INTER_BASE}/Inter-Medium.woff2"   Inter-Medium.woff2
curl_pull "${INTER_BASE}/Inter-SemiBold.woff2" Inter-SemiBold.woff2
curl_pull "${INTER_BASE}/Inter-Bold.woff2"     Inter-Bold.woff2

# JetBrains Mono — direct GitHub raw URLs from upstream release tree
JBM_BASE="https://raw.githubusercontent.com/JetBrains/JetBrainsMono/master/fonts/webfonts"
curl_pull "${JBM_BASE}/JetBrainsMono-Regular.woff2"  JetBrainsMono-Regular.woff2
curl_pull "${JBM_BASE}/JetBrainsMono-Medium.woff2"   JetBrainsMono-Medium.woff2
curl_pull "${JBM_BASE}/JetBrainsMono-SemiBold.woff2" JetBrainsMono-SemiBold.woff2

echo "✓ Fonts fetched into ${TARGET}"
echo "  Commit them so CI + Tauri bundles stay deterministic."
