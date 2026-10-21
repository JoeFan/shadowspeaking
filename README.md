# Shadowing Desktop Player v2

Core workflow:

1. Open Local File
2. Media is prepared for playback only
3. Play normally
4. Click Shadow Speaking only when you want practice mode
5. Faster-Whisper runs locally
6. Right subtitle panel appears
7. Current subtitle auto-highlights and auto-scrolls
8. Double-click any subtitle to play only that segment
9. Delete Recent removes DB + cached media

## Setup

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -U pip
python -m pip install -r python/requirements.txt

export SHADOWING_PYTHON="$PWD/.venv/bin/python"

npm install
npm run tauri dev
```

Requires:
- Python 3.12
- ffmpeg + ffprobe
- Rust/cargo
- Node 20+


## v2.1 Sentence-first segmentation

Shadow Speaking segmentation now prioritizes complete sentences.

Rules:

1. `.`, `!`, `?` define normal sentence boundaries.
2. Normal complete sentences are kept intact, even when they are longer than the old 10-second / 24-word limits.
3. Very long sentences are split first at `,`, `;`, or `:`.
4. Natural speech pauses are used only as a secondary fallback.
5. Hard duration / word-count splitting is only a last resort.
6. Very short utterances such as "Yeah." may be merged with an adjacent sentence when appropriate.

To regenerate subtitles for a video already processed in v2, delete that lesson from Recent and open it again, then click Shadow Speaking.


## v2.2 — `.shadowlesson` portable lesson packages

A processed Shadow Speaking lesson can now be saved as a reusable file:

```text
MyLesson.shadowlesson
```

The file is a portable ZIP-based lesson container with a custom extension. It contains:

```text
manifest.json
media/
  playback.mp4
transcript/
  segments.json
```

### Export

1. Open a normal media file.
2. Click **Shadow Speaking** and wait until transcription is ready.
3. Click **Export Shadow Lesson**.
4. Save the `.shadowlesson` file wherever you want.

### Import

1. Click **Import Shadow Lesson**.
2. Select a `.shadowlesson`.
3. It opens directly in Shadow Speaking mode.

Import does **not** run Whisper and does **not** segment the lesson again.

This means the exact sentence-first segmentation that was exported is preserved.

### Notes

- `.shadowlesson` includes the processed playback media, so it can be moved to another computer.
- Imported lessons are added to Recent.
- Deleting an imported Recent item removes only the local imported cache; the original `.shadowlesson` file is not deleted.


## v2.3 — Background Shadow preparation

The player now separates normal playback, shadow preparation, and shadow practice.

### State flow

```text
Open Local File
    ↓
Normal playback
    ↓
Prepare Shadow Speaking
    ↓
Video keeps playing while Whisper runs in the background
    ↓
Shadow Speaking Ready
    ↓
Click Ready
    ↓
Right-side subtitles appear
```

Opening a normal MP4/MOV/M4V/WebM/audio file does not run Whisper and does not segment subtitles.

For directly playable formats, the app also avoids an unnecessary video transcode on open. MKV still requires conversion because macOS WebKit does not reliably play MKV.

When `Prepare Shadow Speaking` is clicked:

- the current video is NOT paused
- current playback time is NOT changed
- Faster-Whisper runs via the Python worker
- sentence-first segmentation runs after transcription
- the button shows `Preparing Shadow Speaking…`
- when complete, the button changes to `Shadow Speaking Ready`
- subtitles remain hidden until the user explicitly enters Shadow Speaking mode

Imported `.shadowlesson` files start in the `Ready` state because they are already processed.


## v2.4 — Liked sentences + refined UI

### Liked sentences

Every Shadow Speaking subtitle now has a heart button:

```text
♡  not liked
♥  liked
```

Likes are persisted in SQLite.

The subtitle panel has two views:

- `All`
- `Liked`

In `Liked`, only saved sentences are displayed. They can still be double-clicked to play the exact corresponding media segment.

`Play Liked` plays all liked sentences sequentially.

Liked sentence IDs are also included in exported `.shadowlesson` packages and restored on import.

### UI refinement

- narrower Recent sidebar
- Recent delete button only appears on hover
- player remains the visual focus
- Shadow Mode uses a compact status chip
- Current subtitle is a slim caption bar rather than a large duplicate card
- right subtitle panel is wider and denser
- current playback and selected subtitle states are visually distinct
- liked filter and playback controls are integrated into the subtitle header


## v2.5 — Playback speed

Available speeds: 0.5×, 0.75×, 1×, 1.25×, 1.5×, 2×. The selected speed is remembered locally and applies to normal playback, subtitle segment playback, and Play Liked.


## v2.6 — Instant zero-copy open

For directly playable media, opening no longer waits for a whole-file hash or media copy.

```text
Open Local File
→ original path goes straight to player
→ playback can start immediately
→ Recent/cache lookup continues in background
```

Only the first `Prepare Shadow Speaking` creates a durable local analysis copy and loads Faster-Whisper.

Legacy v2.5 Shadow data can be recovered in the background without blocking playback.

See `PLATFORM_RELEASE.md` for macOS, Windows, iOS and Android packaging status.


## v2.7 — Open Video URL

The sidebar now includes `Open Video URL`.

First-stage URL playback supports:
- direct MP4 URLs
- direct WebM URLs
- HLS `.m3u8` streams when the platform WebView supports them

The URL is sent directly to the HTML video element; it is not copied locally.

Limitations:
- A normal webpage URL is usually not the real video stream.
- Login/session/header restricted media may fail.
- DRM-protected streams are not bypassed.
- Shadow Speaking analysis is intentionally disabled for remote streams in v2.7.
- Local Shadow Speaking, Likes, speed control, zero-copy local open, and `.shadowlesson` behavior are unchanged.


## v2.8 — Open Website with website-managed login

The sidebar now has three media entry paths:

```text
Open Local File
Open Video URL
Open Website
```

`Open Website` launches the supplied `http://` or `https://` page in a separate
Tauri WebView window inside the application.

Typical flow:

```text
Open Website
→ enter the website/login/video-page URL
→ website window opens
→ sign in on the website itself
→ browse to the video
→ play with the website's own player
```

Security behavior:

- Shadowing Player does not request or persist the website username/password.
- Credentials are entered into the website's own login page.
- The website/WebView manages its authentication session/cookies.
- Remote content is not given Shadowing Player commands or local filesystem access.
- This feature does not bypass DRM, paywalls, access controls, or protected streams.

Current limitation:

Website playback is intentionally separate from Shadow Speaking analysis.
A website can play successfully after login while the media stream still cannot
be legally/technically exposed to the local Whisper pipeline.

For Shadow Speaking, use a local media file, `.shadowlesson`, or a future
explicitly supported non-DRM remote-media integration.


## v2.9 — Multilingual Shadow Speaking

Language selector:
Auto, English, 中文, 日本語, 한국어, Français, Español, Deutsch,
Italiano, Português, Русский, العربية, हिन्दी.

- Auto lets Faster-Whisper detect the spoken language.
- Manual selection passes the selected language code to Whisper.
- Chinese/Japanese sentence segmentation recognizes `。！？…`.
- CJK clause splitting recognizes `，、；：`.
- Chinese/Japanese subtitle words are joined without artificial spaces.

See `INSTALLERS.md` for macOS and Windows build instructions.


## v3.0 — Editable Shadow subtitles

Each generated subtitle now has an edit control.

- Click `✎` to edit the text in place.
- `Enter` saves; `Shift+Enter` inserts a line break; `Esc` cancels.
- Timestamps are never changed by text editing.
- The first manual edit stores the original Whisper text in `originalText`.
- Edited subtitles show an `Edited` badge.
- `Reset` restores the original Whisper text.
- Changes persist in SQLite because they are written back to `segments_json`.
- Liked sentences use the same edited segment data.
- `.shadowlesson` export/import automatically preserves edited text and its original text metadata.
- Double-clicking the subtitle row still plays the media segment.
