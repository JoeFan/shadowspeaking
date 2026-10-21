#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "Shadowing Player v2.9 — macOS installer build"

command -v node >/dev/null || { echo "Node.js is required"; exit 1; }
command -v cargo >/dev/null || { echo "Rust/Cargo is required"; exit 1; }
command -v ffmpeg >/dev/null || { echo "FFmpeg is required: brew install ffmpeg"; exit 1; }
command -v python3.12 >/dev/null || { echo "Python 3.12 is required"; exit 1; }

if [ ! -d ".venv" ]; then
  python3.12 -m venv .venv
fi

source .venv/bin/activate
python -m pip install -U pip
python -m pip install -r python/requirements.txt
npm install

npm run tauri icon src-tauri/icons/icon.png

export SHADOWING_PYTHON="$PWD/.venv/bin/python"
npm run tauri build -- --bundles app,dmg

echo
echo "Created:"
find src-tauri/target/release/bundle \
  \( -name "*.app" -o -name "*.dmg" \) -print
