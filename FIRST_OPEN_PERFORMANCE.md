# v3.4 First-open performance

Changes:

1. Local media is handed to `<video>` immediately.
2. Python `open_media` registration does not start until the video fires `canplay`.
3. Transient `opening:` lessons never call `save_position`.
4. Initial Recent/SQLite loading is delayed 1.8 seconds after app startup.
5. Legacy full-file SHA recovery is delayed until well after playback begins.
6. Local video uses `preload="auto"`.

This specifically reduces first-open CPU/disk contention between WKWebView playback,
Python startup, SQLite, and compatibility recovery.

MKV remains slower because it must be converted before WKWebView playback.
