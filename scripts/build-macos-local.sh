#!/usr/bin/env bash
set -euo pipefail

echo "This creates the Tauri macOS bundle on a Mac."
echo "Current v2.6 still requires a Python worker runtime."
echo "For a redistributable standalone .dmg, bundle the worker as a sidecar first."

source .venv/bin/activate
export SHADOWING_PYTHON="$PWD/.venv/bin/python"
npm install
npm run tauri build
