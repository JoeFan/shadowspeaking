#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> 1/6 Build native Python/Faster-Whisper sidecar"
./scripts/build-macos-sidecar.sh

echo "==> 2/6 Prepare bundled FFmpeg"
./scripts/prepare-macos-ffmpeg.sh

echo "==> 3/6 Generate icons"
npm run tauri icon src-tauri/icons/icon.png

echo "==> 4/6 Clean old bundle"
rm -rf dist src-tauri/target/release/bundle

echo "==> 5/6 Build frontend"
npm run build

echo "==> 6/6 Build macOS app + DMG"
npm run tauri build -- --bundles app,dmg

APP="src-tauri/target/release/bundle/macos/Shadowing Player.app"

echo
echo "==> Verify packaged worker + FFmpeg"
find "$APP/Contents" \
  \( -name "shadow-worker" -o -name "ffmpeg" -o -name "ffprobe" \) \
  -print

echo
echo "Build complete."
