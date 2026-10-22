#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Building native Shadow worker sidecar for macOS"

PYTHON_BIN="${PYTHON_BIN:-python3.12}"

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "ERROR: $PYTHON_BIN was not found."
  echo "Install Python 3.12 first, e.g. brew install python@3.12"
  exit 1
fi

rm -rf .sidecar-venv python/build python/dist

"$PYTHON_BIN" -m venv .sidecar-venv
source .sidecar-venv/bin/activate

python -m pip install --upgrade pip wheel setuptools
python -m pip install -r python/requirements.txt

cd python
pyinstaller --clean --noconfirm shadow-worker.spec
cd ..

mkdir -p src-tauri/sidecars
cp python/dist/shadow-worker src-tauri/sidecars/shadow-worker
chmod +x src-tauri/sidecars/shadow-worker

echo "==> Sidecar architecture"
file src-tauri/sidecars/shadow-worker

echo "==> Smoke test"
src-tauri/sidecars/shadow-worker --help >/dev/null

python3 scripts/configure-native-sidecar.py

echo
echo "Native macOS sidecar ready:"
ls -lh src-tauri/sidecars/shadow-worker
