# v3.2 bundled FFmpeg

This release fixes:

`Could not open media: [Errno 2] No such file or directory: 'ffmpeg'`

## macOS build

```bash
brew install ffmpeg
./scripts/prepare-macos-ffmpeg.sh
npm install
npm run build
npm run tauri build -- --bundles app,dmg
```

Verify:

```bash
find "src-tauri/target/release/bundle/macos/Shadowing Player.app" \
  \( -name "ffmpeg" -o -name "ffprobe" \) -print
```

## Windows build

```powershell
choco install ffmpeg -y
.\scripts\prepare-windows-ffmpeg.ps1
npm install
npm run build
npm run tauri build -- --bundles msi,nsis
```

## Note

This bundles worker.py + ffmpeg + ffprobe. The Python/Faster-Whisper runtime is
still external unless you freeze it into a sidecar executable.
