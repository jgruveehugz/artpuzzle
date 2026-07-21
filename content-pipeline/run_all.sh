#!/usr/bin/env bash
# run_all.sh — Run the full ArtPuzzle content pipeline in sequence.
# Usage: bash content-pipeline/run_all.sh
set -euo pipefail

# Resolve paths relative to this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VENV_PY="$PROJECT_ROOT/.venv/bin/python"

if [ ! -x "$VENV_PY" ]; then
  echo "✗ venv not found at $VENV_PY"
  echo "  Create it with: /opt/homebrew/bin/python3.12 -m venv $PROJECT_ROOT/.venv"
  echo "  Then: env -u PYTHONPATH $VENV_PY -m pip install Pillow requests python-slugify"
  exit 1
fi

# Clear PYTHONPATH so the Hermes venv's site-packages doesn't leak in and shadow
# our project venv's native modules (e.g. PIL/_imaging).
unset PYTHONPATH

echo "▶ Fetching candidates from museum APIs..."
"$VENV_PY" "$SCRIPT_DIR/fetch.py"

echo ""
echo "▶ Downloading high-res images..."
"$VENV_PY" "$SCRIPT_DIR/download.py"

echo ""
echo "▶ Processing images (resize/optimize/strip EXIF)..."
"$VENV_PY" "$SCRIPT_DIR/process.py"

echo ""
echo "▶ Generating puzzles.json + curation-report.json..."
"$VENV_PY" "$SCRIPT_DIR/manifest.py"

echo ""
echo "✓ Pipeline complete."
echo "  Puzzles manifest: $PROJECT_ROOT/data/puzzles.json"
echo "  Curation report:  $PROJECT_ROOT/data/curation-report.json"
echo "  Images:           $PROJECT_ROOT/src/assets/images/"
