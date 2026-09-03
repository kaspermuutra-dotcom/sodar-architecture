#!/usr/bin/env bash
# Serve the viewer over HTTP (ESM + textures need http://, not file://).
set -euo pipefail
cd "$(dirname "$0")"
[ -f vendor/playcanvas-2.21.4.min.mjs ] || ./vendor/fetch-engine.sh
ls panoramas/*.jpg >/dev/null 2>&1 || python3 panoramas/make_demo_panoramas.py
PORT="${1:-8777}"
echo "viewer: http://localhost:$PORT/  (same URL on a phone on your LAN)"
exec python3 -m http.server "$PORT"
