#!/usr/bin/env bash
# Capture assets/screenshot.png from the static README fixture (no macOS/Electron required).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HTML="file://${ROOT}/docs/readme-screenshot.html"
OUT="${ROOT}/assets/screenshot.png"
mkdir -p "${ROOT}/assets"

if command -v firefox >/dev/null 2>&1; then
  firefox --headless --screenshot "$OUT" --window-size=1280,780 "$HTML"
elif command -v google-chrome >/dev/null 2>&1; then
  google-chrome --headless --disable-gpu --window-size=1280,780 --screenshot="$OUT" "$HTML"
elif command -v chromium >/dev/null 2>&1; then
  chromium --headless --disable-gpu --window-size=1280,780 --screenshot="$OUT" "$HTML"
else
  echo "Need firefox, google-chrome, or chromium for headless screenshot." >&2
  exit 1
fi

python3 - <<'PY' "$OUT"
from pathlib import Path
import sys
from PIL import Image
p = Path(sys.argv[1])
img = Image.open(p)
if img.mode in ("RGBA", "P"):
    img = img.convert("RGB")
w, h = img.size
if w > 1280:
    h = int(h * 1280 / w)
    img = img.resize((1280, h), Image.LANCZOS)
img.save(p, format="PNG", optimize=True)
print("Wrote", p, img.size)
PY

echo "Done: $OUT"
