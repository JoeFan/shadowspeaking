# v3.6 — Native Python / Faster-Whisper sidecar

v3.6 removes the end-user dependency on a separately installed Python runtime
and `faster-whisper`.

## What changes

Production:

```text
Shadowing Player.app
  Contents/Resources/
    sidecars/shadow-worker
    ... bundled ffmpeg / ffprobe
```

Rust launches `shadow-worker` directly.

Development fallback:

```text
.venv/bin/python python/worker.py
```

This keeps development convenient even before a sidecar has been built.

## macOS

From the project root:

```bash
brew install python@3.12 ffmpeg
./scripts/build-macos-self-contained.sh
```

Or build the worker only:

```bash
./scripts/build-macos-sidecar.sh
```

The worker is created with PyInstaller and copied to:

```text
src-tauri/sidecars/shadow-worker
```

The script also updates `tauri.conf.json` so Tauri bundles it as a resource.

## Windows

Use a native Windows machine:

```powershell
choco install ffmpeg -y
.\scripts\build-windows-self-contained.ps1
```

## Model files

This removes the Python/Faster-Whisper runtime dependency, but it does **not**
embed a Whisper model by default. Faster-Whisper will use/download its model
into the app-data model cache on first use.

Bundling a model is possible, but models are large and would make the installer
much bigger.

## Important platform rule

Build the sidecar on the target OS/architecture:

- Apple Silicon macOS -> arm64 sidecar
- Intel macOS -> x86_64 sidecar
- Windows x64 -> Windows x64 sidecar

Do not build a Linux sidecar and copy it into a macOS or Windows installer.

## Verification

After macOS build:

```bash
APP="src-tauri/target/release/bundle/macos/Shadowing Player.app"

find "$APP/Contents" \
  \( -name "shadow-worker" -o -name "ffmpeg" -o -name "ffprobe" \) \
  -print
```

The installed app should be able to start Shadow preparation without:
- `No module named 'faster_whisper'`
- missing Python
- missing ffmpeg
