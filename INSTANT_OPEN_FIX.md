# v3.3 Instant Open / UI freeze fix

Changes:

- Direct MP4/MOV/M4V/WebM/MP3/WAV/M4A playback is attached to `<video>` immediately.
- `open_media` registration remains background-only for direct-play files.
- Direct-play `open_media` no longer runs `ffprobe` before inserting/updating Recent.
- All Rust commands that launch the Python worker now use `spawn_blocking`, so Python/SQLite/FFmpeg work cannot block the Tauri UI thread.
- Faster-Whisper remains lazy-loaded only when `Prepare Shadow Speaking` is requested.
- MKV is intentionally still slower on first open because it must be converted to MP4 for WKWebView compatibility.

## Expected behavior

For MP4/MOV/M4V/WebM and supported audio:

1. Select file.
2. Player appears immediately using the original local path.
3. Recent/SQLite registration runs in the background.
4. Shadow analysis does not start until the Shadow button is clicked.

For MKV:

- First open still shows `Preparing MKV for playback…` while conversion runs.
