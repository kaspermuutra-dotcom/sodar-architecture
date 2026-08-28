#!/usr/bin/env bash
# Fetch model weights for the parallax view-interpolation pipeline
# (see docs/RECONSTRUCTION_INTEGRATION.md). Weights are large and are NOT
# committed — they land in third_party/weights/ which is gitignored.
#
# Needs network + one of: curl, wget; and `gdown` (pip install gdown) for the
# Google Drive sources. Run from the repo root.
set -euo pipefail

DEST="$(cd "$(dirname "$0")/.." && pwd)/third_party/weights"
mkdir -p "$DEST"
echo "weights -> $DEST"

# --- RAFT (optical flow) --------------------------------------------------------
# BSD-3. Upstream ships its own downloader (Dropbox zip of all checkpoints).
# We only need raft-things.pth for inference.
if [ ! -f "$DEST/raft-things.pth" ]; then
  echo "== RAFT =="
  ( cd "$(dirname "$0")/../third_party/RAFT" && ./download_models.sh )
  cp "$(dirname "$0")/../third_party/RAFT/models/raft-things.pth" "$DEST/" 2>/dev/null || \
    echo "  ! copy raft-things.pth manually from third_party/RAFT/models/"
fi

# --- Depth-Anything-V2 (monocular depth) --------------------------------------
# Use the SMALL checkpoint: it is Apache-2.0. Base/Large/Giant are CC-BY-NC-4.0.
if [ ! -f "$DEST/depth_anything_v2_vits.pth" ]; then
  echo "== Depth-Anything-V2 (Small, Apache-2.0) =="
  URL="https://huggingface.co/depth-anything/Depth-Anything-V2-Small/resolve/main/depth_anything_v2_vits.pth"
  if command -v curl >/dev/null; then curl -fL "$URL" -o "$DEST/depth_anything_v2_vits.pth"
  else wget -O "$DEST/depth_anything_v2_vits.pth" "$URL"; fi
fi

# --- LaMa (inpainting) -------------------------------------------------------
# Repo code Apache-2.0; big-lama weights carry their own terms — verify before
# any non-research use. HF mirror of the maintainers' Google Drive folder.
if [ ! -d "$DEST/big-lama" ]; then
  echo "== LaMa (big-lama) =="
  URL="https://huggingface.co/smartywu/big-lama/resolve/main/big-lama.zip"
  TMP="$DEST/big-lama.zip"
  if command -v curl >/dev/null; then curl -fL "$URL" -o "$TMP"; else wget -O "$TMP" "$URL"; fi
  ( cd "$DEST" && unzip -q big-lama.zip && rm big-lama.zip )
fi

echo "done. Contents:"
ls -la "$DEST"
