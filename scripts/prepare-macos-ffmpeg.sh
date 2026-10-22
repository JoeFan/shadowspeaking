#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

FFMPEG_PATH="$(command -v ffmpeg || true)"
FFPROBE_PATH="$(command -v ffprobe || true)"

if [ -z "$FFMPEG_PATH" ] || [ -z "$FFPROBE_PATH" ]; then
  echo "Install FFmpeg first: brew install ffmpeg"
  exit 1
fi

mkdir -p bin
cp "$FFMPEG_PATH" bin/ffmpeg
cp "$FFPROBE_PATH" bin/ffprobe
chmod +x bin/ffmpeg bin/ffprobe

python3 scripts/configure-ffmpeg-resources.py

echo "Bundled macOS FFmpeg:"
file bin/ffmpeg
file bin/ffprobe
