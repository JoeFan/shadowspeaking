#!/usr/bin/env bash
set -euo pipefail

echo "Tauri mobile project initialization only."
echo "The current Python/Faster-Whisper/FFmpeg CLI backend cannot run inside iOS/Android apps."
echo "Do not ship mobile until the Shadow backend is replaced by native/WASM transcription."

case "${1:-}" in
  ios)
    npm run tauri ios init
    ;;
  android)
    npm run tauri android init
    ;;
  *)
    echo "Usage: $0 ios|android"
    exit 1
    ;;
esac
