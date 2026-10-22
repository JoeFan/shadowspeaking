import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

type Segment = {
  id: number;
  text: string;
  start: number;
  end: number;
  originalText?: string;
  edited?: boolean;
};

type Lesson = {
  id: string;
  originalFilename: string;
  sourcePath: string;
  playbackPath: string;
  duration: number;
  lastPosition: number;
  shadowReady: boolean;
  language?: string | null;
  segmentCount: number;
  segments?: Segment[];
  likedSegmentIds?: number[];
};

type ShadowState = "idle" | "preparing" | "ready" | "active";
type SubtitleFilter = "all" | "liked";

type LanguageOption = {
  code: string;
  label: string;
};

const LANGUAGE_OPTIONS: LanguageOption[] = [
  { code: "auto", label: "Auto" },
  { code: "en", label: "English" },
  { code: "zh", label: "中文" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" },
  { code: "de", label: "Deutsch" },
  { code: "it", label: "Italiano" },
  { code: "pt", label: "Português" },
  { code: "ru", label: "Русский" },
  { code: "ar", label: "العربية" },
  { code: "hi", label: "हिन्दी" }
];

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

export default function App() {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [status, setStatus] = useState("Ready");
  const [opening, setOpening] = useState(false);

  const [shadowState, setShadowState] = useState<ShadowState>("idle");
  const [activeSegment, setActiveSegment] = useState<Segment | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [subtitleFilter, setSubtitleFilter] = useState<SubtitleFilter>("all");
  const [playingLiked, setPlayingLiked] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");
  const [showWebsiteInput, setShowWebsiteInput] = useState(false);
  const [websiteUrl, setWebsiteUrl] = useState(() =>
    localStorage.getItem("shadowing.lastWebsiteUrl") ?? ""
  );
  const [playbackRate, setPlaybackRate] = useState<number>(() => {
    const saved = Number(localStorage.getItem("shadowing.playbackRate"));
    return [0.5, 0.75, 1, 1.25, 1.5, 2].includes(saved) ? saved : 1;
  });

  const [shadowLanguage, setShadowLanguage] = useState<string>(() =>
    localStorage.getItem("shadowing.language") ?? "auto"
  );

  const [editingSegmentId, setEditingSegmentId] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");

  const videoRef = useRef<HTMLVideoElement>(null);
  const segmentTargetRef = useRef<Segment | null>(null);
  const requestRef = useRef(0);
  const subtitleRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const likedQueueRef = useRef<number[]>([]);
  const pendingRegistrationRef = useRef<string | null>(null);

  const segments = useMemo(() => lesson?.segments ?? [], [lesson]);
  const likedIds = useMemo(
    () => new Set(lesson?.likedSegmentIds ?? []),
    [lesson?.likedSegmentIds]
  );

  const visibleSegments = useMemo(() => {
    if (subtitleFilter === "liked") {
      return segments.filter((segment) => likedIds.has(segment.id));
    }
    return segments;
  }, [segments, subtitleFilter, likedIds]);

  const shadowVisible = shadowState === "active";

  useEffect(() => {
    // Do not start Python/SQLite immediately at app launch.
    // Give the WebView time to paint and become responsive first.
    const timer = window.setTimeout(() => {
      void refreshLessons();
    }, 1800);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    localStorage.setItem("shadowing.language", shadowLanguage);
  }, [shadowLanguage]);

  useEffect(() => {
    localStorage.setItem("shadowing.playbackRate", String(playbackRate));
    if (videoRef.current) videoRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  // Playback is driven only by the selected media path. Background worker
  // registration must never be on the critical path for local playback.
  useEffect(() => {
    if (!lesson || !videoRef.current) return;

    const video = videoRef.current;
    video.playbackRate = playbackRate;

    // For a user-initiated local open, try to start immediately. Browsers /
    // WebViews may still require the user to press Play, so failure is ignored.
    if (lesson.id.startsWith("opening:")) {
      void video.play().catch(() => {});
    }
  }, [lesson?.playbackPath]);

  useEffect(() => {
    if (!activeSegment || !shadowVisible) return;

    subtitleRefs.current.get(activeSegment.id)?.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
  }, [activeSegment?.id, shadowVisible]);

  async function refreshLessons() {
    try {
      setLessons(await invoke<Lesson[]>("list_lessons"));
    } catch (error) {
      setStatus(`History error: ${String(error)}`);
    }
  }



function isRemoteUrl(value: string) {
  return /^https?:\/\//i.test(value);
}


function openWebsite() {
  const value = websiteUrl.trim();

  if (!value) {
    setStatus("Enter a website URL first.");
    return;
  }

  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    setStatus("That does not look like a valid website URL.");
    return;
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    setStatus("Only http:// and https:// websites are supported.");
    return;
  }

  localStorage.setItem("shadowing.lastWebsiteUrl", parsed.toString());

  // Use a unique label so opening a second authenticated website window
  // never collides with an existing WebView window.
  const label = `website-${Date.now()}`;

  const websiteWindow = new WebviewWindow(label, {
    url: parsed.toString(),
    title: `Website · ${parsed.hostname}`,
    width: 1280,
    height: 860,
    minWidth: 760,
    minHeight: 560,
    resizable: true,
    center: true,
    focus: true
  });

  websiteWindow.once("tauri://created", () => {
    setShowWebsiteInput(false);
    setStatus(
      "Website opened in an app window. Log in there using the website's own sign-in page."
    );
  });

  websiteWindow.once("tauri://error", (event) => {
    setStatus(`Could not open website: ${String(event.payload)}`);
  });
}

function openVideoUrl() {
  const url = videoUrl.trim();

  if (!url) {
    setStatus("Enter a video URL first.");
    return;
  }

  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    setStatus("That does not look like a valid URL.");
    return;
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    setStatus("Only http:// and https:// video URLs are supported.");
    return;
  }

  stopSegmentPlayback();
  pendingRegistrationRef.current = null;
  setActiveSegment(null);
  setSelectedId(null);
  setSubtitleFilter("all");

  const lastPart =
    decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() ?? "");

  const remoteLesson: Lesson = {
    id: `remote:${url}`,
    originalFilename: lastPart || parsed.hostname,
    sourcePath: url,
    playbackPath: url,
    duration: 0,
    lastPosition: 0,
    shadowReady: false,
    language: null,
    segmentCount: 0,
    segments: [],
    likedSegmentIds: []
  };

  setLesson(remoteLesson);
  setShadowState("idle");
  setShowUrlInput(false);
  setStatus("Opening video URL…");

  window.setTimeout(() => {
    videoRef.current?.play().catch(() => {
      // Manual play may still be required by the WebView.
    });
  }, 0);
}

async function chooseFile() {
  const selected = await open({
    multiple: false,
    directory: false,
    title: "Open media",
    filters: [{
      name: "Video / Audio",
      extensions: ["mp4", "mov", "m4v", "mkv", "webm", "mp3", "wav", "m4a"]
    }]
  });

  if (!selected || Array.isArray(selected)) return;

  stopSegmentPlayback();
  setActiveSegment(null);
  setSelectedId(null);
  setSubtitleFilter("all");

  const fileName = selected.split(/[\\/]/).pop() ?? selected;
  const extension = fileName.includes(".")
    ? `.${fileName.split(".").pop()!.toLowerCase()}`
    : "";

  const requiresConversion = extension === ".mkv";

  if (!requiresConversion) {
    // Instant UI: hand the original path directly to <video>.
    // Registration/cache lookup continues asynchronously.
    const transient: Lesson = {
      id: `opening:${selected}`,
      originalFilename: fileName,
      sourcePath: selected,
      playbackPath: selected,
      duration: 0,
      lastPosition: 0,
      shadowReady: false,
      language: null,
      segmentCount: 0,
      segments: [],
      likedSegmentIds: []
    };

    setLesson(transient);
    setShadowState("idle");
    setOpening(false);
    setStatus("Playing original file · registering in background…");

    // Do NOT start Python yet. Let the WebView reach canplay first.
    // This avoids CPU / disk contention during the first local media open.
    pendingRegistrationRef.current = selected;


    return;
  }

  // MKV currently needs a compatible MP4 before WKWebView can play it.
  try {
    setOpening(true);
    setStatus("Preparing MKV for playback…");

    const result = await invoke<Lesson>("open_media", { path: selected });

    setLesson(result);
    setShadowState(result.shadowReady ? "ready" : "idle");
    setStatus("Ready to play.");
    await refreshLessons();
  } catch (error) {
    setStatus(`Could not open media: ${String(error)}`);
  } finally {
    setOpening(false);
  }
}

  function registerOpenedMediaAfterPlaybackStarted(path: string) {
    if (pendingRegistrationRef.current !== path) return;

    // Clear first so repeated canplay events cannot launch duplicate workers.
    pendingRegistrationRef.current = null;

    void invoke<Lesson>("open_media", { path })
      .then((result) => {
        setLesson((current) => {
          if (!current || current.sourcePath !== path) return current;
          return { ...result, playbackPath: path, sourcePath: path };
        });

        setShadowState(result.shadowReady ? "ready" : "idle");
        setStatus(
          result.shadowReady
            ? "Ready to play · Shadow Speaking already prepared."
            : "Ready to play."
        );

        // Refresh Recent only after registration is complete.
        window.setTimeout(() => {
          void refreshLessons();
        }, 300);

        if (!result.shadowReady) {
          // Legacy SHA recovery is intentionally delayed further.
          window.setTimeout(() => {
            void invoke<Lesson & { found?: boolean }>(
              "recover_legacy_shadow",
              { id: result.id, path }
            )
              .then((legacy) => {
                if (!legacy.found) return;

                setLesson((current) => {
                  if (!current || current.sourcePath !== path) return current;
                  return {
                    ...current,
                    ...legacy,
                    playbackPath: path,
                    sourcePath: path
                  };
                });

                setShadowState("ready");
                setStatus(
                  "Ready to play · Previous Shadow Speaking result recovered."
                );

                void refreshLessons();
              })
              .catch(() => {
                // Optional compatibility work must never disturb playback.
              });
          }, 1200);
        }
      })
      .catch((error) => {
        setStatus(
          `Video is playing, but Recent registration failed: ${String(error)}`
        );
      });
  }


  async function openRecent(id: string) {
    try {
      stopSegmentPlayback();
      setOpening(true);

      const result = await invoke<Lesson>("get_lesson", { id });

      setLesson(result);
      setActiveSegment(null);
      setSelectedId(null);
      setSubtitleFilter("all");
      setShadowState(result.shadowReady ? "ready" : "idle");
      setStatus("Loaded.");
    } catch (error) {
      setStatus(`Could not load: ${String(error)}`);
    } finally {
      setOpening(false);
    }
  }

  async function prepareShadowSpeaking() {
    if (!lesson || shadowState === "preparing") return;

    if (isRemoteUrl(lesson.sourcePath)) {
      setStatus(
        "Remote URL playback is available, but Shadow Speaking analysis is not enabled for remote streams yet."
      );
      return;
    }

    setShadowState("preparing");
    setStatus("Preparing Shadow Speaking in the background… Keep watching.");

    try {
      const result = await invoke<Lesson>("prepare_shadow", {
        id: lesson.id,
        language: shadowLanguage
      });

      setLesson((current) => {
        if (!current || current.id !== result.id) return current;
        return { ...current, ...result };
      });

      setShadowState("ready");
      setStatus("Shadow Speaking is ready.");
      await refreshLessons();
    } catch (error) {
      setShadowState("idle");
      setStatus(`Shadow preparation failed: ${String(error)}`);
    }
  }

  function enterShadowSpeaking() {
    if (!lesson?.shadowReady && shadowState !== "ready") return;
    setShadowState("active");
    setStatus("Shadow Speaking active.");
  }

  function leaveShadowSpeaking() {
    stopSegmentPlayback();
    setShadowState(lesson?.shadowReady ? "ready" : "idle");
    setStatus("Normal playback mode.");
  }

  async function toggleLike(segmentId: number) {
    if (!lesson) return;

    const liked = !likedIds.has(segmentId);

    // Optimistic update so the heart responds immediately.
    setLesson((current) => {
      if (!current) return current;

      const ids = new Set(current.likedSegmentIds ?? []);

      if (liked) ids.add(segmentId);
      else ids.delete(segmentId);

      return {
        ...current,
        likedSegmentIds: Array.from(ids).sort((a, b) => a - b)
      };
    });

    try {
      const updated = await invoke<Lesson>("set_segment_like", {
        id: lesson.id,
        segmentId,
        liked
      });

      setLesson((current) => {
        if (!current || current.id !== updated.id) return current;
        return { ...current, ...updated };
      });
    } catch (error) {
      // Roll back by reloading the lesson.
      try {
        const reloaded = await invoke<Lesson>("get_lesson", { id: lesson.id });
        setLesson(reloaded);
      } catch {}

      setStatus(`Could not update Like: ${String(error)}`);
    }
  }

  function beginEditSegment(segment: Segment) {
    setEditingSegmentId(segment.id);
    setEditingText(segment.text);
  }

  function cancelEditSegment() {
    setEditingSegmentId(null);
    setEditingText("");
  }

  async function saveEditedSegment(segmentId: number) {
    if (!lesson) return;

    const text = editingText.trim();

    if (!text) {
      setStatus("Subtitle text cannot be empty.");
      return;
    }

    try {
      const updated = await invoke<Lesson>("update_segment_text", {
        id: lesson.id,
        segmentId,
        text
      });

      setLesson(updated);
      setEditingSegmentId(null);
      setEditingText("");
      setStatus("Subtitle saved.");
      await refreshLessons();
    } catch (error) {
      setStatus(`Could not save subtitle: ${String(error)}`);
    }
  }

  async function resetEditedSegment(segmentId: number) {
    if (!lesson) return;

    try {
      const updated = await invoke<Lesson>("reset_segment_text", {
        id: lesson.id,
        segmentId
      });

      setLesson(updated);
      setEditingSegmentId(null);
      setEditingText("");
      setStatus("Subtitle restored to the original Whisper text.");
    } catch (error) {
      setStatus(`Could not reset subtitle: ${String(error)}`);
    }
  }

  function playLiked() {
    if (!lesson) return;

    const queue = segments
      .filter((segment) => likedIds.has(segment.id))
      .map((segment) => segment.id);

    if (queue.length === 0) {
      setStatus("No liked sentences yet.");
      return;
    }

    setPlayingLiked(true);
    likedQueueRef.current = queue.slice(1);

    const first = segments.find((segment) => segment.id === queue[0]);
    if (first) playSegment(first, true);
  }

  function stopLikedPlayback() {
    likedQueueRef.current = [];
    setPlayingLiked(false);
    stopSegmentPlayback();
    videoRef.current?.pause();
  }

  function playNextLiked() {
    const nextId = likedQueueRef.current.shift();

    if (nextId === undefined) {
      setPlayingLiked(false);
      setStatus("Finished playing liked sentences.");
      return;
    }

    const next = segments.find((segment) => segment.id === nextId);

    if (!next) {
      playNextLiked();
      return;
    }

    playSegment(next, true);
  }

  async function importShadowLesson() {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: "Import Shadow Lesson",
        filters: [{
          name: "Shadow Lesson",
          extensions: ["shadowlesson"]
        }]
      });

      if (!selected || Array.isArray(selected)) return;

      stopSegmentPlayback();
      setOpening(true);
      setStatus("Importing Shadow Lesson…");

      const result = await invoke<Lesson>("import_shadow_package", {
        path: selected
      });

      setLesson(result);
      setActiveSegment(null);
      setSelectedId(null);
      setSubtitleFilter("all");
      setShadowState("ready");
      setStatus("Shadow Lesson imported. Ready to play or enter Shadow Speaking.");

      await refreshLessons();
    } catch (error) {
      setStatus(`Could not import Shadow Lesson: ${String(error)}`);
    } finally {
      setOpening(false);
    }
  }

  async function exportShadowLesson() {
    if (!lesson || !lesson.shadowReady) {
      setStatus("Prepare Shadow Speaking first, then export the lesson.");
      return;
    }

    try {
      const baseName = lesson.originalFilename
        .replace(/\.[^/.]+$/, "")
        .replace(/[\\/:*?"<>|]+/g, "_");

      const destination = await save({
        title: "Export Shadow Lesson",
        defaultPath: `${baseName}.shadowlesson`,
        filters: [{
          name: "Shadow Lesson",
          extensions: ["shadowlesson"]
        }]
      });

      if (!destination) return;

      setStatus("Exporting Shadow Lesson…");

      const result = await invoke<{ ok: boolean; path: string }>(
        "export_shadow_package",
        {
          id: lesson.id,
          path: destination
        }
      );

      setStatus(`Exported Shadow Lesson: ${result.path}`);
    } catch (error) {
      setStatus(`Could not export Shadow Lesson: ${String(error)}`);
    }
  }

  async function deleteLesson(id: string, name: string) {
    if (!window.confirm(
      `Delete "${name}" from Recent and remove its local cache?`
    )) {
      return;
    }

    try {
      if (lesson?.id === id) {
        videoRef.current?.pause();
        setLesson(null);
        setShadowState("idle");
        setActiveSegment(null);
        setSelectedId(null);
      }

      await invoke("delete_lesson", { id });

      setLessons((current) =>
        current.filter((item) => item.id !== id)
      );

      setStatus(`Deleted: ${name}`);
    } catch (error) {
      setStatus(`Delete failed: ${String(error)}`);
    }
  }

  function stopSegmentPlayback() {
    requestRef.current += 1;
    segmentTargetRef.current = null;
    setActiveSegment(null);
    setSelectedId(null);
  }

  function playSegment(segment: Segment, fromLikedQueue = false) {
    const video = videoRef.current;
    if (!video) return;

    const requestId = ++requestRef.current;

    video.pause();

    segmentTargetRef.current = segment;
    setSelectedId(segment.id);
    setActiveSegment(segment);

    const startPlaying = async () => {
      if (requestId !== requestRef.current) return;
      if (segmentTargetRef.current?.id !== segment.id) return;

      try {
        await video.play();
      } catch (error) {
        if (
          error instanceof DOMException &&
          error.name === "AbortError"
        ) {
          return;
        }

        if (fromLikedQueue) {
          setPlayingLiked(false);
          likedQueueRef.current = [];
        }

        setStatus(`Playback failed: ${String(error)}`);
      }
    };

    if (Math.abs(video.currentTime - segment.start) < 0.08) {
      void startPlaying();
    } else {
      video.addEventListener(
        "seeked",
        () => void startPlaying(),
        { once: true }
      );

      video.currentTime = segment.start;
    }
  }

  function handleTimeUpdate() {
    const video = videoRef.current;
    if (!video || video.seeking) return;

    if (shadowVisible) {
      const current =
        segments.find(
          (segment) =>
            video.currentTime >= segment.start &&
            video.currentTime < segment.end
        ) ?? null;

      if (current?.id !== activeSegment?.id) {
        setActiveSegment(current);
      }
    }

    const target = segmentTargetRef.current;

    if (
      target &&
      video.currentTime >= target.end - 0.04
    ) {
      segmentTargetRef.current = null;
      video.pause();

      // Keep the sentence selected/highlighted after it finishes.
      setActiveSegment(target);
      setSelectedId(target.id);

      if (playingLiked) {
        window.setTimeout(() => {
          playNextLiked();
        }, 250);
      }
    }
  }

  async function savePosition() {
    if (!lesson || !videoRef.current) return;
    if (isRemoteUrl(lesson.sourcePath)) return;

    // A transient lesson has not been registered in SQLite yet.
    // More importantly, spawning Python while switching media can make
    // the first open feel frozen.
    if (lesson.id.startsWith("opening:")) return;

    try {
      await invoke("save_position", {
        id: lesson.id,
        position: videoRef.current.currentTime
      });
    } catch {}
  }

  const mediaSrc = lesson
    ? isRemoteUrl(lesson.playbackPath)
      ? lesson.playbackPath
      : convertFileSrc(lesson.playbackPath)
    : undefined;

  const remotePlayback = Boolean(
    lesson && isRemoteUrl(lesson.sourcePath)
  );

  return (
    <main className="app">
      <aside className="sidebar">
        <div className="brand-block">
          <h1>Shadowing Player</h1>
          <p>Play first · Shadow on demand</p>
        </div>

        <button
          className="primary"
          onClick={() => void chooseFile()}
          disabled={opening}
        >
          {opening ? "Opening…" : "📂 Open Local File"}
        </button>

        <button
          className="secondary-action"
          onClick={() => setShowUrlInput((current) => !current)}
        >
          🔗 Open Video URL
        </button>

        {showUrlInput && (
          <div className="url-open-panel">
            <input
              className="url-input"
              type="url"
              placeholder="https://example.com/video.mp4"
              value={videoUrl}
              onChange={(event) => setVideoUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  openVideoUrl();
                }
              }}
              autoFocus
            />

            <button
              className="url-open-button"
              onClick={openVideoUrl}
            >
              Open
            </button>

            <p>
              Direct MP4/WebM URLs work best. Compatible HLS streams may also
              play. A normal webpage URL is usually not the media stream.
            </p>
          </div>
        )}

        <button
          className="secondary-action"
          onClick={() => setShowWebsiteInput((current) => !current)}
        >
          🌐 Open Website
        </button>

        {showWebsiteInput && (
          <div className="url-open-panel website-open-panel">
            <input
              className="url-input"
              type="url"
              placeholder="https://example.com/login-or-video-page"
              value={websiteUrl}
              onChange={(event) => setWebsiteUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  openWebsite();
                }
              }}
              autoFocus
            />

            <button
              className="url-open-button"
              onClick={openWebsite}
            >
              Open Website
            </button>

            <p>
              Sign in inside the website window. Shadowing Player does not ask
              for or store your username/password. The website handles its own
              login and session.
            </p>

            <p className="website-security-note">
              Website playback only. Protected streams and DRM are not bypassed.
            </p>
          </div>
        )}

        <button
          className="secondary-action"
          onClick={() => void importShadowLesson()}
          disabled={opening}
        >
          📦 Import Shadow Lesson
        </button>

        <div className="recent-title">Recent</div>

        {lessons.map((item) => (
          <div
            className={`recent-row ${
              item.id === lesson?.id ? "selected" : ""
            }`}
            key={item.id}
          >
            <button
              className="recent-open"
              onClick={() => void openRecent(item.id)}
            >
              <span>{item.originalFilename}</span>

              <small>
                {formatTime(item.duration)}
                {item.shadowReady ? " · Shadow ready" : ""}
              </small>
            </button>

            <button
              className="recent-delete"
              title="Delete"
              onClick={() =>
                void deleteLesson(
                  item.id,
                  item.originalFilename
                )
              }
            >
              ×
            </button>
          </div>
        ))}
      </aside>

      <section className="main">
        <div className="topbar">
          <span>{status}</span>

          {lesson && (
            <div className="topbar-meta">
              <strong>{lesson.originalFilename}</strong>

              {lesson.shadowReady && (
                <span className="status-chip">
                  Shadow ready
                </span>
              )}
            </div>
          )}
        </div>

        {!lesson ? (
          <div className="empty">
            <h2>Open a video or audio file</h2>

            <p>
              Play normally first. Prepare Shadow Speaking only when you need it.
            </p>
          </div>
        ) : (
          <div
            className={`workspace ${
              shadowVisible ? "with-subtitles" : ""
            }`}
          >
            <div className="player-side">
              <div className="player-card">
                <video
                  key={mediaSrc}
                  ref={videoRef}
                  src={mediaSrc}
                  controls
                  playsInline
                  preload="auto"
                  onTimeUpdate={handleTimeUpdate}
                  onPause={() => void savePosition()}
                  onError={() => {
                    if (remotePlayback) {
                      setStatus(
                        "Could not play this URL directly. It may be a webpage, require login/headers, use unsupported streaming, or be DRM-protected."
                      );
                    }
                  }}
                  onCanPlay={() => {
                    if (
                      lesson &&
                      !isRemoteUrl(lesson.sourcePath) &&
                      lesson.id.startsWith("opening:")
                    ) {
                      registerOpenedMediaAfterPlaybackStarted(lesson.sourcePath);
                    }
                  }}
                  onLoadedMetadata={() => {
                    const video = videoRef.current;
                    if (!video) return;

                    video.playbackRate = playbackRate;

                    if (
                      lesson.lastPosition > 0 &&
                      lesson.lastPosition < video.duration
                    ) {
                      video.currentTime = lesson.lastPosition;
                    }
                  }}
                />

                <div className="player-toolbar">
                  <div className="shadow-status-group">
                    {shadowState === "idle" && (
                      <button
                        className="shadow-button"
                        disabled={remotePlayback}
                        title={
                          remotePlayback
                            ? "URL playback is supported; remote Shadow analysis is not enabled yet."
                            : undefined
                        }
                        onClick={() =>
                          void prepareShadowSpeaking()
                        }
                      >
                        {remotePlayback
                          ? "🗣 Shadow unavailable for URL"
                          : "🗣 Prepare Shadow Speaking"}
                      </button>
                    )}

                    {shadowState === "preparing" && (
                      <button
                        className="shadow-button preparing"
                        disabled
                        aria-disabled="true"
                        aria-busy="true"
                      >
                        <span className="shadow-spinner" aria-hidden="true" />
                        Preparing…
                      </button>
                    )}

                    {shadowState === "ready" && (
                      <button
                        className="shadow-button ready"
                        onClick={enterShadowSpeaking}
                      >
                        ✓ Enter Shadow Speaking
                      </button>
                    )}

                    {shadowState === "active" && (
                      <>
                        <span className="mode-chip">
                          ● Shadow Mode
                        </span>

                        <button
                          className="toolbar-button"
                          onClick={leaveShadowSpeaking}
                        >
                          Exit
                        </button>
                      </>
                    )}
                  </div>

                  <div className="toolbar-right">
                    <label className="language-control">
                      <span>Language</span>
                      <select
                        value={shadowLanguage}
                        onChange={(event) =>
                          setShadowLanguage(event.target.value)
                        }
                        aria-label="Shadow language"
                        disabled={shadowState === "preparing"}
                      >
                        {LANGUAGE_OPTIONS.map((option) => (
                          <option key={option.code} value={option.code}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="speed-control">
                      <span>Speed</span>
                      <select
                        value={playbackRate}
                        onChange={(event) => {
                          const rate = Number(event.target.value);
                          setPlaybackRate(rate);
                          if (videoRef.current) {
                            videoRef.current.playbackRate = rate;
                          }
                        }}
                        aria-label="Playback speed"
                      >
                        <option value={0.5}>0.5×</option>
                        <option value={0.75}>0.75×</option>
                        <option value={1}>1×</option>
                        <option value={1.25}>1.25×</option>
                        <option value={1.5}>1.5×</option>
                        <option value={2}>2×</option>
                      </select>
                    </label>

                    <button
                      className="toolbar-button"
                      disabled={!lesson.shadowReady}
                      onClick={() =>
                        void exportShadowLesson()
                      }
                    >
                      Export
                    </button>
                  </div>
                </div>

                {shadowState === "preparing" && (
                  <div className="background-note">
                    Shadow transcription is running in the background.
                    The video can keep playing.
                  </div>
                )}
              </div>

              {shadowVisible && (
                <div className="current-caption-bar">
                  <span className="caption-label">Current</span>

                  <span className="caption-text">
                    {activeSegment?.text ??
                      "Double-click a subtitle on the right to practise."}
                  </span>
                </div>
              )}
            </div>

            {shadowVisible && (
              <aside className="subtitles">
                <div className="subtitle-head">
                  <div className="subtitle-title-row">
                    <div>
                      <h2>Shadow Speaking</h2>

                      <p>
                        {lesson.language ?? ""} ·{" "}
                        {lesson.segmentCount} chunks
                      </p>
                    </div>

                    <div className="subtitle-tabs">
                      <button
                        className={subtitleFilter === "all" ? "active" : ""}
                        onClick={() => setSubtitleFilter("all")}
                      >
                        All
                      </button>

                      <button
                        className={subtitleFilter === "liked" ? "active" : ""}
                        onClick={() => setSubtitleFilter("liked")}
                      >
                        ♥ Liked {lesson.likedSegmentIds?.length ?? 0}
                      </button>
                    </div>
                  </div>

                  <div className="liked-actions">
                    {playingLiked ? (
                      <button
                        className="mini-action"
                        onClick={stopLikedPlayback}
                      >
                        ■ Stop Liked
                      </button>
                    ) : (
                      <button
                        className="mini-action"
                        disabled={(lesson.likedSegmentIds?.length ?? 0) === 0}
                        onClick={playLiked}
                      >
                        ▶ Play Liked
                      </button>
                    )}

                    <span>
                      Double-click a sentence to play that segment
                    </span>
                  </div>
                </div>

                <div className="subtitle-list">
                  {visibleSegments.length === 0 ? (
                    <div className="empty-liked">
                      {subtitleFilter === "liked"
                        ? "No liked sentences yet. Tap ♡ on a sentence to save it."
                        : "No subtitles available."}
                    </div>
                  ) : (
                    visibleSegments.map((segment) => (
                      <div
                        key={segment.id}
                        ref={(element) => {
                          if (element) {
                            subtitleRefs.current.set(
                              segment.id,
                              element
                            );
                          } else {
                            subtitleRefs.current.delete(
                              segment.id
                            );
                          }
                        }}
                        className={[
                          "subtitle-row",
                          activeSegment?.id === segment.id
                            ? "active"
                            : "",
                          selectedId === segment.id
                            ? "selected"
                            : ""
                        ].join(" ")}
                        onClick={() =>
                          setSelectedId(segment.id)
                        }
                        onDoubleClick={() =>
                          playSegment(segment)
                        }
                      >
                        <button
                          className={`like-button ${
                            likedIds.has(segment.id)
                              ? "liked"
                              : ""
                          }`}
                          title={
                            likedIds.has(segment.id)
                              ? "Unlike sentence"
                              : "Like sentence"
                          }
                          onClick={(event) => {
                            event.stopPropagation();
                            void toggleLike(segment.id);
                          }}
                          onDoubleClick={(event) => {
                            event.stopPropagation();
                          }}
                        >
                          {likedIds.has(segment.id) ? "♥" : "♡"}
                        </button>

                        <div className="subtitle-content">
                          <div className="subtitle-meta-row">
                            <span className="time">
                              {formatTime(segment.start)} –{" "}
                              {formatTime(segment.end)}
                            </span>

                            <div className="subtitle-edit-actions">
                              {segment.edited && (
                                <span className="edited-badge">Edited</span>
                              )}

                              {editingSegmentId !== segment.id && (
                                <button
                                  className="subtitle-edit-button"
                                  title="Edit subtitle text"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    beginEditSegment(segment);
                                  }}
                                  onDoubleClick={(event) =>
                                    event.stopPropagation()
                                  }
                                >
                                  ✎
                                </button>
                              )}
                            </div>
                          </div>

                          {editingSegmentId === segment.id ? (
                            <div
                              className="subtitle-editor"
                              onClick={(event) => event.stopPropagation()}
                              onDoubleClick={(event) => event.stopPropagation()}
                            >
                              <textarea
                                value={editingText}
                                onChange={(event) =>
                                  setEditingText(event.target.value)
                                }
                                onKeyDown={(event) => {
                                  if (event.key === "Escape") {
                                    event.preventDefault();
                                    cancelEditSegment();
                                  } else if (
                                    event.key === "Enter" &&
                                    !event.shiftKey
                                  ) {
                                    event.preventDefault();
                                    void saveEditedSegment(segment.id);
                                  }
                                }}
                                autoFocus
                              />

                              <div className="subtitle-editor-actions">
                                <button
                                  className="mini-action"
                                  onClick={() =>
                                    void saveEditedSegment(segment.id)
                                  }
                                >
                                  Save
                                </button>

                                <button
                                  className="mini-action"
                                  onClick={cancelEditSegment}
                                >
                                  Cancel
                                </button>

                                {segment.edited && (
                                  <button
                                    className="mini-action reset-action"
                                    onClick={() =>
                                      void resetEditedSegment(segment.id)
                                    }
                                  >
                                    Reset
                                  </button>
                                )}
                              </div>
                            </div>
                          ) : (
                            <span className="subtitle-text">
                              {segment.text}
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </aside>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
