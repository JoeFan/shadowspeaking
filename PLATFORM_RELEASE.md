# Platform release status — v2.6

## What v2.6 changes

Normal open for MP4/MOV/M4V/WebM/audio is now zero-copy and instant-first:

1. The selected original file is handed directly to the player.
2. No whole-file SHA is computed before playback.
3. No media copy is performed before playback.
4. Faster-Whisper is not imported before playback.
5. Recent registration happens asynchronously.
6. The first `Prepare Shadow Speaking` creates the durable local analysis copy and runs Whisper.
7. Old v2.5 SHA-based Shadow results are looked up in the background, so recovery does not block playback.

MKV is the exception: the macOS WebView cannot reliably play MKV, so it still needs a compatible MP4 before playback.

## macOS

Source is ready for local development on macOS.

Developer build:

```bash
./scripts/dev-macos.sh
```

Local Tauri bundle:

```bash
./scripts/build-macos-local.sh
```

A public distributable `.dmg` should additionally:
- bundle the Python Shadow worker/runtime as a Tauri sidecar, or replace it with a native backend;
- bundle FFmpeg or replace FFmpeg CLI use with a native media layer;
- be Apple code-signed and notarized.

Those signing credentials are account-specific and cannot be generated inside this environment.

## Windows

The desktop code is compatible in principle, but build it on Windows:

```powershell
.\scripts\build-windows-local.ps1
```

A standalone public MSI/EXE has the same Python-worker/FFmpeg bundling requirement as macOS.

## iPhone / iPad

Tauri 2 can create an iOS shell, but the current Shadow backend cannot be shipped unchanged:
- iOS apps cannot launch a normal external Python interpreter;
- the current Faster-Whisper Python worker is therefore unavailable;
- FFmpeg CLI invocation is also not an appropriate iOS runtime architecture.

Initialize the shell only:

```bash
./scripts/init-mobile.sh ios
```

A real iOS Shadow build requires replacing the Python backend with one of:
- whisper.cpp/native Swift bridge;
- a Rust-native Whisper backend compiled for iOS;
- an on-device WASM transcription backend if performance is acceptable.

A signed `.ipa` additionally requires Xcode and the user's Apple Developer signing identity/provisioning profile.

## Android

Same architectural issue as iOS: the current Python worker cannot be treated as a normal child process inside an Android app.

Initialize the shell only:

```bash
./scripts/init-mobile.sh android
```

A real APK/AAB requires a native/WASM Shadow backend and an Android media implementation.

## Recommended next cross-platform step

Keep the React/Tauri UI and `.shadowlesson` format, but replace this layer:

```text
Python + Faster-Whisper + FFmpeg CLI
```

with:

```text
Rust/native Whisper backend
+ platform media APIs
```

Then the same lesson database, sentence-first segmentation, Likes, playback speed, import/export, and Shadow UI can be shared across macOS, Windows, iOS, and Android.
