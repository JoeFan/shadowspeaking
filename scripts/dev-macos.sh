#!/usr/bin/env bash
set -euo pipefail

python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -U pip
python -m pip install -r python/requirements.txt

export SHADOWING_PYTHON="$PWD/.venv/bin/python"
source "$HOME/.cargo/env" 2>/dev/null || true

npm install
npm run tauri dev
