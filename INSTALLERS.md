# Shadowing Player v2.9 — Installer builds

## macOS

Run on a Mac:

```bash
chmod +x scripts/build-macos-installer.sh
./scripts/build-macos-installer.sh
```

Expected artifacts:

```text
src-tauri/target/release/bundle/macos/Shadowing Player.app
src-tauri/target/release/bundle/dmg/*.dmg
```

## Windows

Run on Windows PowerShell:

```powershell
.\scripts\build-windows-installer.ps1
```

Expected artifacts:

```text
src-tauri\target\release\bundle\msi\*.msi
src-tauri\target\release\bundle\nsis\*.exe
```

## GitHub Actions

`.github/workflows/build-installers.yml` builds the app on native macOS and
Windows runners and uploads the resulting installers as Actions artifacts.

## Runtime dependency note

v2.9 still uses the local Python Faster-Whisper worker and FFmpeg.
The scripts above produce Tauri installers, but a truly self-contained installer
for another person's computer still requires freezing the Python worker into a
sidecar executable and bundling FFmpeg/FFprobe. That production sidecar step
requires native testing on each OS and is intentionally not represented here as
already complete.
