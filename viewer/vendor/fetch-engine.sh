#!/usr/bin/env bash
# Fetch the pinned PlayCanvas engine for the panorama tour viewer.
# The .mjs is ~2.3 MB and is gitignored (see viewer/.gitignore); this script is
# the single source of the version pin. Run from anywhere.
set -euo pipefail

VERSION="2.21.4"   # https://github.com/playcanvas/engine/releases
DEST="$(cd "$(dirname "$0")" && pwd)"
OUT="$DEST/playcanvas-${VERSION}.min.mjs"
URL="https://cdn.jsdelivr.net/npm/playcanvas@${VERSION}/build/playcanvas.min.mjs"

if [ -f "$OUT" ]; then
  echo "already present: $OUT"
  exit 0
fi

echo "fetching PlayCanvas ${VERSION} -> $OUT"
if command -v curl >/dev/null; then curl -fL "$URL" -o "$OUT"
else wget -O "$OUT" "$URL"; fi

# index.html imports ./vendor/playcanvas-<VERSION>.min.mjs — keep them in sync.
echo "done. If you bumped VERSION, update the import in viewer/index.html too."
