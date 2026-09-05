#!/usr/bin/env bash
# Fetch the pinned Photo Sphere Viewer browser bundle (TD-003's ViewerBuilder).
#
# These are the *built* ESM/CSS artifacts jsDelivr serves from the npm packages
# published out of the vendored source at third_party/photo-sphere-viewer (pinned
# to tag 5.9.0 — keep VERSION here equal to that submodule's tag). Building the
# monorepo from source (tsup, a TypeScript/SCSS toolchain) is not required to run
# the viewer: the published dist *is* that same source's official build output.
# The .git submodule stays the source of truth for licence/provenance; this
# script is the version pin for the runtime bundle, same pattern as
# viewer/vendor/fetch-engine.sh for PlayCanvas.
#
# Total ~700 KB (three.js dominates); gitignored (see vendor/.gitignore).
set -euo pipefail

VERSION="5.9.0"      # https://github.com/mistic100/Photo-Sphere-Viewer/releases
THREE_VERSION="0.167.0"  # peerDependency pin from packages/core/package.json
DEST="$(cd "$(dirname "$0")" && pwd)"

# plain "npm-path|local-filename" pairs — portable to macOS's bash 3.2
# (no associative arrays: `declare -A` needs bash 4+)
FILES="
@photo-sphere-viewer/core@${VERSION}/index.module.js|psv-core.module.js
@photo-sphere-viewer/core@${VERSION}/index.min.css|psv-core.min.css
@photo-sphere-viewer/virtual-tour-plugin@${VERSION}/index.module.js|psv-virtual-tour.module.js
@photo-sphere-viewer/virtual-tour-plugin@${VERSION}/index.min.css|psv-virtual-tour.min.css
@photo-sphere-viewer/markers-plugin@${VERSION}/index.module.js|psv-markers.module.js
@photo-sphere-viewer/markers-plugin@${VERSION}/index.min.css|psv-markers.min.css
@photo-sphere-viewer/gyroscope-plugin@${VERSION}/index.module.js|psv-gyroscope.module.js
"

fetch_one() {
  local url="$1" out="$2"
  if [ -f "$DEST/$out" ]; then
    echo "already present: $out"
    return 0
  fi
  echo "fetching $out"
  if command -v curl >/dev/null; then curl -fL "$url" -o "$DEST/$out"
  else wget -O "$DEST/$out" "$url"; fi
}

echo "$FILES" | while IFS='|' read -r npm_path out; do
  [ -z "$npm_path" ] && continue
  fetch_one "https://cdn.jsdelivr.net/npm/${npm_path}" "$out"
done

fetch_one "https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/build/three.module.min.js" "three.module.min.js"

echo "done. If you bumped VERSION or THREE_VERSION, update the importmap in"
echo "../index.html and the pinned submodule tag at third_party/photo-sphere-viewer too."
