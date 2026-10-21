# Website login mode

## Goal

Allow a user to open a website that requires authentication and use the site's
own player after signing in.

## Architecture

The main Shadowing Player UI creates a dedicated Tauri WebView window:

```text
Main application
    |
    +-- Open Website
          |
          +-- remote HTTPS page
                |
                +-- website login
                +-- website cookies/session
                +-- website player
```

The app never receives the typed password.

## Why this is separate from Open Video URL

`Open Video URL` expects the URL itself to be a directly playable media resource.

`Open Website` expects a normal web page and allows the user to authenticate
through that site's own UI.

## Shadow analysis

No attempt is made to intercept or decrypt the website's media stream.
If a future site provides a documented, non-DRM, authenticated media API, a
separate integration can pass authorized audio to the transcription pipeline
without storing the user's password.
