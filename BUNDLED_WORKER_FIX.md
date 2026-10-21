# v3.1 Bundled worker fix

This release fixes the installed `.app` failure:

```text
Could not open media: No such file or directory (os error 2)
```

## What changed

`python/worker.py` and `python/requirements.txt` are now declared as Tauri bundle resources.

In development:

```text
src-tauri/../python/worker.py
```

is used.

In a packaged macOS application, Rust resolves the worker from the Tauri
resource directory instead of assuming the current working directory contains
`python/worker.py`.

Typical packaged location:

```text
Shadowing Player.app/
  Contents/
    Resources/
      python/
        worker.py
        requirements.txt
```

Tauri may internally preserve `../python` as `_up_/python` depending on resource
layout. The resolver checks both forms.

## Build

```bash
npm install
npm run build
npm run tauri build -- --bundles app,dmg
```

## Verify the worker is inside the app

```bash
find "src-tauri/target/release/bundle/macos/Shadowing Player.app" \
  -name "worker.py" -print
```

You should now get a path inside `Contents/Resources`.

## Important remaining dependency

This fix bundles `worker.py`, but it does **not** yet bundle a Python runtime,
Faster-Whisper, or FFmpeg.

So:

- the installed app can now locate `worker.py`;
- `SHADOWING_PYTHON` still works for local testing;
- if no environment variable is set, the app tries `python3` on macOS/Linux and
  `python` on Windows.

A fully self-contained installer still needs a frozen worker sidecar and bundled
FFmpeg/ffprobe.
