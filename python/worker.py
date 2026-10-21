from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path



DIRECT_PLAY = {
    ".mp4",
    ".mov",
    ".m4v",
    ".webm",
    ".mp3",
    ".wav",
    ".m4a",
}

NEEDS_CONVERSION = {
    ".mkv",
}

SUPPORTED = DIRECT_PLAY | NEEDS_CONVERSION

_model = None


def now():
    return datetime.now(timezone.utc).isoformat()


def model():
    """
    Lazy-load Faster-Whisper only when Shadow Speaking is requested.
    Normal media opening does not import Whisper at all.
    """
    global _model

    if _model is None:
        from faster_whisper import WhisperModel

        _model = WhisperModel(
            "small",
            device="auto",
            compute_type="int8",
        )

    return _model


def clean(text):
    return re.sub(r"\s+", " ", text).strip()


def sha(path):
    digest = hashlib.sha256()

    with Path(path).open("rb") as file:
        while chunk := file.read(1024 * 1024):
            digest.update(chunk)

    return digest.hexdigest()


def fast_file_id(path):
    """
    Cheap stable key for the same file at the same path while unchanged.
    Does NOT read the whole media file.
    """
    path = Path(path).expanduser().resolve()
    stat = path.stat()

    signature = (
        f"{path}|{stat.st_size}|{stat.st_mtime_ns}"
    ).encode("utf-8", errors="surrogatepass")

    return hashlib.sha256(signature).hexdigest()


def db(data):
    connection = sqlite3.connect(data / "shadowing.db")
    connection.row_factory = sqlite3.Row

    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS lessons(
          id TEXT PRIMARY KEY,
          original_filename TEXT NOT NULL,
          source_path TEXT NOT NULL,
          playback_path TEXT NOT NULL,
          duration REAL NOT NULL DEFAULT 0,
          last_position REAL NOT NULL DEFAULT 0,
          language TEXT,
          segments_json TEXT NOT NULL DEFAULT '[]',
          shadow_ready INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
        """
    )

    columns = {
        row["name"]
        for row in connection.execute("PRAGMA table_info(lessons)").fetchall()
    }

    if "liked_segments_json" not in columns:
        connection.execute(
            "ALTER TABLE lessons ADD COLUMN liked_segments_json TEXT NOT NULL DEFAULT '[]'"
        )

    if "analysis_path" not in columns:
        connection.execute(
            "ALTER TABLE lessons ADD COLUMN analysis_path TEXT"
        )

    connection.commit()
    return connection



def resolve_binary(name):
    resource_dir = os.environ.get("SHADOWING_RESOURCE_DIR")
    exe = f"{name}.exe" if os.name == "nt" else name

    candidates = []
    if resource_dir:
        root = Path(resource_dir)
        candidates += [
            root / "bin" / exe,
            root / "_up_" / "bin" / exe,
            root / exe,
        ]

    for candidate in candidates:
        if candidate.exists():
            return str(candidate)

    system = shutil.which(exe) or shutil.which(name)
    if system:
        return system

    if os.name != "nt":
        for prefix in ("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"):
            candidate = Path(prefix) / name
            if candidate.exists():
                return str(candidate)

    raise RuntimeError(
        f"{name} not found. Rebuild the installer with bundled {exe}."
    )


FFMPEG = resolve_binary("ffmpeg")
FFPROBE = resolve_binary("ffprobe")


def ffprobe_duration(path):
    process = subprocess.run(
        [
            FFPROBE,
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )

    try:
        return float(process.stdout.strip())
    except Exception:
        return 0.0


def convert_for_playback(source, destination):
    subprocess.run(
        [
            FFMPEG,
            "-y",
            "-fflags",
            "+genpts",
            "-i",
            str(source),

            "-map",
            "0:v:0?",
            "-map",
            "0:a:0?",

            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",

            "-c:a",
            "aac",
            "-profile:a",
            "aac_low",
            "-b:a",
            "192k",
            "-ac",
            "2",
            "-ar",
            "48000",

            "-movflags",
            "+faststart",
            "-avoid_negative_ts",
            "make_zero",

            str(destination),
        ],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def sentence_first_chunks(raw, language="en"):
    words = []

    for segment in raw:
        for word in getattr(segment, "words", None) or []:
            token = clean(word.word or "")

            if (
                not token
                or word.start is None
                or word.end is None
            ):
                continue

            words.append(
                {
                    "text": token,
                    "start": float(word.start),
                    "end": float(word.end),
                }
            )

    if not words:
        return []

    if language in {"zh", "ja"}:
        strong_pattern = r'[。！？!?…]["\')\]]*$'
        soft_pattern = r'[,，、;；:：]["\')\]]*$'
        joiner = ""
    elif language == "ko":
        strong_pattern = r'[.!?。！？…]["\')\]]*$'
        soft_pattern = r'[,;:]["\')\]]*$'
        joiner = " "
    else:
        strong_pattern = r'[.!?…]["\')\]]*$'
        soft_pattern = r'[,;:]["\')\]]*$'
        joiner = " "

    # 1. Build complete sentences first.
    sentences = []
    current = []

    for index, word in enumerate(words):
        current.append(word)

        strong_end = bool(
            re.search(
                strong_pattern,
                word["text"],
            )
        )

        next_pause = 0.0

        if index + 1 < len(words):
            next_pause = max(
                0.0,
                words[index + 1]["start"] - word["end"],
            )

        if strong_end:
            sentences.append(current)
            current = []

        elif (
            next_pause >= 0.95
            and len(current) >= 4
            and (
                current[-1]["end"] - current[0]["start"]
            ) >= 2.0
        ):
            # Fallback when Whisper punctuation is missing.
            sentences.append(current)
            current = []

    if current:
        sentences.append(current)

    # 2. Preserve normal sentences; split only long ones.
    units = []

    for sentence in sentences:
        duration = sentence[-1]["end"] - sentence[0]["start"]

        if duration <= 15.0 and len(sentence) <= 34:
            units.append(sentence)
            continue

        part = []

        for index, word in enumerate(sentence):
            part.append(word)

            part_duration = part[-1]["end"] - part[0]["start"]

            soft_end = bool(
                re.search(
                    soft_pattern,
                    word["text"],
                )
            )

            next_pause = 0.0

            if index + 1 < len(sentence):
                next_pause = max(
                    0.0,
                    sentence[index + 1]["start"] - word["end"],
                )

            if (
                soft_end
                and part_duration >= 6.0
                and len(part) >= 8
            ):
                units.append(part)
                part = []

            elif (
                next_pause >= 0.65
                and part_duration >= 7.0
                and len(part) >= 9
            ):
                units.append(part)
                part = []

            elif (
                part_duration >= 18.0
                or len(part) >= 42
            ):
                units.append(part)
                part = []

        if part:
            units.append(part)

    # 3. Merge tiny utterances with a neighboring unit.
    merged = []

    for unit in units:
        duration = unit[-1]["end"] - unit[0]["start"]
        tiny = duration < 2.0 or len(unit) <= 3

        if (
            tiny
            and merged
            and unit[-1]["end"] - merged[-1][-1]["end"] <= 0.7
            and unit[-1]["end"] - merged[-1][0]["start"] <= 13.5
        ):
            merged[-1].extend(unit)
        else:
            merged.append(unit)

    if (
        len(merged) >= 2
        and (
            len(merged[0]) <= 3
            or merged[0][-1]["end"] - merged[0][0]["start"] < 1.8
        )
        and merged[1][-1]["end"] - merged[0][0]["start"] <= 13.5
    ):
        merged[1] = merged[0] + merged[1]
        merged = merged[1:]

    result = []

    for index, unit in enumerate(merged, start=1):
        result.append(
            {
                "id": index,
                "text": clean(
                    joiner.join(
                        word["text"]
                        for word in unit
                    )
                ),
                "start": round(unit[0]["start"], 2),
                "end": round(unit[-1]["end"], 2),
            }
        )

    return result

def lesson(row, include=True):
    segments = json.loads(row["segments_json"])

    try:
        liked_ids = json.loads(row["liked_segments_json"] or "[]")
    except Exception:
        liked_ids = []

    result = {
        "id": row["id"],
        "originalFilename": row["original_filename"],
        "sourcePath": row["source_path"],
        "playbackPath": row["playback_path"],
        "duration": row["duration"],
        "lastPosition": row["last_position"],
        "shadowReady": bool(row["shadow_ready"]),
        "language": row["language"],
        "segmentCount": len(segments),
        "likedSegmentIds": liked_ids,
    }

    if include:
        result["segments"] = segments

    return result


def update_segment_text(data, ident, segment_id, text):
    connection = db(data)
    row = connection.execute(
        "SELECT * FROM lessons WHERE id=?",
        (ident,),
    ).fetchone()

    if not row:
        raise RuntimeError("Lesson not found")

    new_text = clean(text)
    if not new_text:
        raise RuntimeError("Subtitle text cannot be empty")

    segments = json.loads(row["segments_json"])
    found = False

    for segment in segments:
        if int(segment.get("id", -1)) != int(segment_id):
            continue

        found = True
        if "originalText" not in segment:
            segment["originalText"] = segment.get("text", "")

        segment["text"] = new_text
        segment["edited"] = new_text != segment.get("originalText", "")

        if not segment["edited"]:
            segment.pop("edited", None)
        break

    if not found:
        raise RuntimeError("Subtitle segment not found")

    connection.execute(
        "UPDATE lessons SET segments_json=?, updated_at=? WHERE id=?",
        (json.dumps(segments, ensure_ascii=False), now(), ident),
    )
    connection.commit()

    updated = connection.execute(
        "SELECT * FROM lessons WHERE id=?",
        (ident,),
    ).fetchone()
    return lesson(updated, True)


def reset_segment_text(data, ident, segment_id):
    connection = db(data)
    row = connection.execute(
        "SELECT * FROM lessons WHERE id=?",
        (ident,),
    ).fetchone()

    if not row:
        raise RuntimeError("Lesson not found")

    segments = json.loads(row["segments_json"])
    found = False

    for segment in segments:
        if int(segment.get("id", -1)) != int(segment_id):
            continue

        found = True
        original = segment.get("originalText")
        if original is not None:
            segment["text"] = original
        segment.pop("edited", None)
        break

    if not found:
        raise RuntimeError("Subtitle segment not found")

    connection.execute(
        "UPDATE lessons SET segments_json=?, updated_at=? WHERE id=?",
        (json.dumps(segments, ensure_ascii=False), now(), ident),
    )
    connection.commit()

    updated = connection.execute(
        "SELECT * FROM lessons WHERE id=?",
        (ident,),
    ).fetchone()
    return lesson(updated, True)


def set_segment_like(data, ident, segment_id, liked):
    connection = db(data)

    row = connection.execute(
        "SELECT * FROM lessons WHERE id=?",
        (ident,),
    ).fetchone()

    if not row:
        raise RuntimeError("Lesson not found")

    segments = json.loads(row["segments_json"])

    if not any(int(segment.get("id", -1)) == int(segment_id) for segment in segments):
        raise RuntimeError("Subtitle segment not found")

    try:
        ids = set(json.loads(row["liked_segments_json"] or "[]"))
    except Exception:
        ids = set()

    if liked:
        ids.add(int(segment_id))
    else:
        ids.discard(int(segment_id))

    liked_ids = sorted(int(value) for value in ids)

    connection.execute(
        """
        UPDATE lessons
        SET liked_segments_json=?, updated_at=?
        WHERE id=?
        """,
        (
            json.dumps(liked_ids),
            now(),
            ident,
        ),
    )

    connection.commit()

    updated = connection.execute(
        "SELECT * FROM lessons WHERE id=?",
        (ident,),
    ).fetchone()

    return lesson(updated, True)



def open_media(data, original_path):
    """
    Zero-copy normal open.

    Directly playable formats:
      - no whole-file SHA-256
      - no copy
      - no Whisper
      - no segmentation
      - original file is the playback source

    MKV still needs a playable MP4 because WKWebView does not reliably
    play MKV. Whisper still does not run during open.
    """
    original = Path(original_path).expanduser().resolve()

    if not original.exists():
        raise RuntimeError("Media file does not exist")

    suffix = original.suffix.lower()

    if suffix not in SUPPORTED:
        raise RuntimeError(f"Unsupported media type: {suffix}")

    ident = fast_file_id(original)
    connection = db(data)

    row = connection.execute(
        "SELECT * FROM lessons WHERE id=?",
        (ident,),
    ).fetchone()

    if row:
        playback = Path(row["playback_path"])
        if playback.exists():
            return lesson(row, True)

    timestamp = now()

    if suffix in NEEDS_CONVERSION:
        # MKV cannot be instant-zero-copy in the current WebView player.
        folder = data / "lessons" / ident
        folder.mkdir(parents=True, exist_ok=True)

        playback = folder / "playback.mp4"

        if not playback.exists():
            convert_for_playback(original, playback)
    else:
        playback = original

    duration = ffprobe_duration(playback)

    connection.execute(
        """
        INSERT INTO lessons
        (
          id,
          original_filename,
          source_path,
          playback_path,
          duration,
          last_position,
          language,
          segments_json,
          shadow_ready,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          original_filename=excluded.original_filename,
          source_path=excluded.source_path,
          playback_path=excluded.playback_path,
          duration=excluded.duration,
          updated_at=excluded.updated_at
        """,
        (
            ident,
            original.name,
            str(original),
            str(playback),
            duration,
            0.0,
            None,
            "[]",
            0,
            timestamp,
            timestamp,
        ),
    )

    connection.commit()

    row = connection.execute(
        "SELECT * FROM lessons WHERE id=?",
        (ident,),
    ).fetchone()

    return lesson(row, True)


def recover_legacy_shadow(data, ident, original_path):
    """
    Background compatibility lookup for v2.5 and older databases.

    Old versions used a whole-file SHA-256 as the lesson id. This command
    is deliberately separate from open_media so hashing never blocks
    immediate playback.

    If a legacy Shadow lesson exists, copy only its transcript metadata
    into the new zero-copy lesson row. Media playback stays on the
    currently selected original file.
    """
    original = Path(original_path).expanduser().resolve()

    if not original.exists():
        return {"found": False}

    legacy_id = sha(original)

    if legacy_id == ident:
        return {"found": False}

    connection = db(data)

    legacy = connection.execute(
        "SELECT * FROM lessons WHERE id=?",
        (legacy_id,),
    ).fetchone()

    current = connection.execute(
        "SELECT * FROM lessons WHERE id=?",
        (ident,),
    ).fetchone()

    if (
        not legacy
        or not current
        or not bool(legacy["shadow_ready"])
    ):
        return {"found": False}

    connection.execute(
        """
        UPDATE lessons
        SET
          language=?,
          segments_json=?,
          shadow_ready=1,
          liked_segments_json=?,
          updated_at=?
        WHERE id=?
        """,
        (
            legacy["language"],
            legacy["segments_json"],
            legacy["liked_segments_json"] or "[]",
            now(),
            ident,
        ),
    )

    connection.commit()

    row = connection.execute(
        "SELECT * FROM lessons WHERE id=?",
        (ident,),
    ).fetchone()

    result = lesson(row, True)
    result["found"] = True
    return result


def prepare_shadow(data, ident, language='auto'):
    """
    First Shadow preparation is the point where a durable local cache is
    created. The frontend may keep playing the original file while this
    worker copies and analyzes in the background.
    """
    connection = db(data)

    row = connection.execute(
        "SELECT * FROM lessons WHERE id=?",
        (ident,),
    ).fetchone()

    if not row:
        raise RuntimeError("Lesson not found")

    if row["shadow_ready"]:
        return lesson(row, True)

    original = Path(row["source_path"])

    if not original.exists():
        raise RuntimeError(
            "Original media is missing. Re-open or relocate the file."
        )

    folder = data / "lessons" / ident
    folder.mkdir(parents=True, exist_ok=True)

    suffix = original.suffix.lower()

    # Create the durable analysis copy only now.
    if suffix in NEEDS_CONVERSION:
        playback = Path(row["playback_path"])
        if not playback.exists():
            playback = folder / "playback.mp4"
            convert_for_playback(original, playback)
        analysis_path = playback
    else:
        analysis_path = folder / f"source{suffix}"

        if not analysis_path.exists():
            shutil.copy2(original, analysis_path)

    whisper_language = None if language == "auto" else language

    segments_iter, info = model().transcribe(
        str(analysis_path),
        beam_size=5,
        vad_filter=True,
        word_timestamps=True,
        language=whisper_language,
    )

    detected_language = info.language or (
        "en" if language == "auto" else language
    )

    parts = sentence_first_chunks(
        list(segments_iter),
        detected_language,
    )

    connection.execute(
        """
        UPDATE lessons
        SET
          language=?,
          segments_json=?,
          shadow_ready=1,
          analysis_path=?,
          updated_at=?
        WHERE id=?
        """,
        (
            info.language,
            json.dumps(parts, ensure_ascii=False),
            str(analysis_path),
            now(),
            ident,
        ),
    )

    connection.commit()

    row = connection.execute(
        "SELECT * FROM lessons WHERE id=?",
        (ident,),
    ).fetchone()

    return lesson(row, True)


def list_lessons(data):
    connection = db(data)

    rows = connection.execute(
        "SELECT * FROM lessons ORDER BY updated_at DESC"
    ).fetchall()

    return [
        lesson(row, False)
        for row in rows
        if Path(row["playback_path"]).exists()
    ]


def get_lesson(data, ident):
    row = db(data).execute(
        "SELECT * FROM lessons WHERE id=?",
        (ident,),
    ).fetchone()

    if not row:
        raise RuntimeError("Lesson not found")

    return lesson(row, True)


def save_position(data, ident, position):
    connection = db(data)

    connection.execute(
        """
        UPDATE lessons
        SET last_position=?, updated_at=?
        WHERE id=?
        """,
        (
            max(0.0, position),
            now(),
            ident,
        ),
    )

    connection.commit()

    return {"ok": True}


def delete_lesson(data, ident):
    connection = db(data)

    connection.execute(
        "DELETE FROM lessons WHERE id=?",
        (ident,),
    )

    connection.commit()

    folder = data / "lessons" / ident

    if folder.exists():
        shutil.rmtree(folder)

    return {"ok": True}


def export_shadow_package(data, ident, destination):
    connection = db(data)

    row = connection.execute(
        "SELECT * FROM lessons WHERE id=?",
        (ident,),
    ).fetchone()

    if not row:
        raise RuntimeError("Lesson not found")

    if not bool(row["shadow_ready"]):
        raise RuntimeError("Prepare Shadow Speaking before exporting")

    analysis_value = row["analysis_path"] if "analysis_path" in row.keys() else None
    media_path = Path(analysis_value) if analysis_value else Path(row["playback_path"])

    if not media_path.exists():
        raise RuntimeError("Playback media is missing")

    segments = json.loads(row["segments_json"])
    destination = Path(destination)

    if destination.suffix.lower() != ".shadowlesson":
        destination = destination.with_suffix(".shadowlesson")

    destination.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    media_name = (
        f"playback{media_path.suffix.lower() or '.mp4'}"
    )

    manifest = {
        "format": "shadowlesson",
        "formatVersion": 1,
        "lessonId": row["id"],
        "title": row["original_filename"],
        "language": row["language"],
        "duration": row["duration"],
        "media": f"media/{media_name}",
        "segments": "transcript/segments.json",
        "segmentCount": len(segments),
        "likedSegmentIds": json.loads(row["liked_segments_json"] or "[]"),
        "createdAt": row["created_at"],
        "exportedAt": now(),
    }

    with zipfile.ZipFile(
        destination,
        "w",
        compression=zipfile.ZIP_DEFLATED,
    ) as archive:
        archive.writestr(
            "manifest.json",
            json.dumps(
                manifest,
                ensure_ascii=False,
                indent=2,
            ),
        )

        archive.writestr(
            "transcript/segments.json",
            json.dumps(
                segments,
                ensure_ascii=False,
                indent=2,
            ),
        )

        archive.write(
            media_path,
            f"media/{media_name}",
        )

    return {
        "ok": True,
        "path": str(destination),
    }


def import_shadow_package(data, package_path):
    package_path = Path(package_path)

    if not package_path.exists():
        raise RuntimeError("Shadow Lesson file does not exist")

    if package_path.suffix.lower() != ".shadowlesson":
        raise RuntimeError("Expected a .shadowlesson file")

    package_hash = sha(package_path)
    imported_id = f"import-{package_hash}"

    folder = data / "lessons" / imported_id
    folder.mkdir(
        parents=True,
        exist_ok=True,
    )

    try:
        with zipfile.ZipFile(
            package_path,
            "r",
        ) as archive:
            names = set(archive.namelist())

            if "manifest.json" not in names:
                raise RuntimeError(
                    "Invalid Shadow Lesson: manifest.json is missing"
                )

            manifest = json.loads(
                archive.read(
                    "manifest.json"
                ).decode("utf-8")
            )

            if manifest.get("format") != "shadowlesson":
                raise RuntimeError(
                    "Invalid Shadow Lesson format"
                )

            if int(manifest.get("formatVersion", 0)) != 1:
                raise RuntimeError(
                    "Unsupported Shadow Lesson version"
                )

            segments_entry = manifest.get("segments")
            media_entry = manifest.get("media")

            if (
                not segments_entry
                or segments_entry not in names
                or not media_entry
                or media_entry not in names
            ):
                raise RuntimeError(
                    "Shadow Lesson package is incomplete"
                )

            for entry in (
                segments_entry,
                media_entry,
            ):
                path = Path(entry)

                if (
                    path.is_absolute()
                    or ".." in path.parts
                ):
                    raise RuntimeError(
                        "Unsafe path inside Shadow Lesson package"
                    )

            segments = json.loads(
                archive.read(
                    segments_entry
                ).decode("utf-8")
            )

            media_suffix = (
                Path(media_entry).suffix.lower()
                or ".mp4"
            )

            playback = (
                folder
                / f"playback{media_suffix}"
            )

            with (
                archive.open(media_entry) as source,
                playback.open("wb") as target,
            ):
                shutil.copyfileobj(
                    source,
                    target,
                )

    except zipfile.BadZipFile as error:
        raise RuntimeError(
            "Invalid or damaged Shadow Lesson file"
        ) from error

    connection = db(data)

    existing = connection.execute(
        "SELECT * FROM lessons WHERE id=?",
        (imported_id,),
    ).fetchone()

    created_at = (
        existing["created_at"]
        if existing
        else now()
    )

    last_position = (
        existing["last_position"]
        if existing
        else 0.0
    )

    connection.execute(
        """
        INSERT OR REPLACE INTO lessons
        (
          id,
          original_filename,
          source_path,
          playback_path,
          duration,
          last_position,
          language,
          segments_json,
          shadow_ready,
          liked_segments_json,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            imported_id,
            manifest.get("title")
            or package_path.stem,
            str(playback),
            str(playback),
            float(
                manifest.get("duration")
                or 0.0
            ),
            last_position,
            manifest.get("language"),
            json.dumps(
                segments,
                ensure_ascii=False,
            ),
            1,
            json.dumps(
                manifest.get("likedSegmentIds") or [],
                ensure_ascii=False,
            ),
            created_at,
            now(),
        ),
    )

    connection.commit()

    row = connection.execute(
        "SELECT * FROM lessons WHERE id=?",
        (imported_id,),
    ).fetchone()

    return lesson(row, True)


def main():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--data-dir",
        required=True,
    )

    sub = parser.add_subparsers(
        dest="cmd",
        required=True,
    )

    command = sub.add_parser("open")
    command.add_argument("--path", required=True)

    command = sub.add_parser("shadow")
    command.add_argument("--id", required=True)
    command.add_argument("--language", default="auto")

    command = sub.add_parser("legacy")
    command.add_argument("--id", required=True)
    command.add_argument("--path", required=True)

    sub.add_parser("list")

    command = sub.add_parser("get")
    command.add_argument("--id", required=True)

    command = sub.add_parser("position")
    command.add_argument("--id", required=True)
    command.add_argument(
        "--position",
        type=float,
        required=True,
    )

    command = sub.add_parser("delete")
    command.add_argument("--id", required=True)

    command = sub.add_parser("export")
    command.add_argument("--id", required=True)
    command.add_argument("--path", required=True)

    command = sub.add_parser("import")
    command.add_argument("--path", required=True)

    command = sub.add_parser("edit-text")
    command.add_argument("--id", required=True)
    command.add_argument("--segment-id", type=int, required=True)
    command.add_argument("--text", required=True)

    command = sub.add_parser("reset-text")
    command.add_argument("--id", required=True)
    command.add_argument("--segment-id", type=int, required=True)

    command = sub.add_parser("like")
    command.add_argument("--id", required=True)
    command.add_argument("--segment-id", type=int, required=True)
    command.add_argument("--liked", choices=["true", "false"], required=True)

    args = parser.parse_args()

    data = Path(args.data_dir)
    data.mkdir(
        parents=True,
        exist_ok=True,
    )

    try:
        if args.cmd == "open":
            result = open_media(
                data,
                args.path,
            )

        elif args.cmd == "shadow":
            result = prepare_shadow(
                data,
                args.id,
                args.language,
            )

        elif args.cmd == "legacy":
            result = recover_legacy_shadow(
                data,
                args.id,
                args.path,
            )

        elif args.cmd == "list":
            result = list_lessons(data)

        elif args.cmd == "get":
            result = get_lesson(
                data,
                args.id,
            )

        elif args.cmd == "position":
            result = save_position(
                data,
                args.id,
                args.position,
            )

        elif args.cmd == "delete":
            result = delete_lesson(
                data,
                args.id,
            )

        elif args.cmd == "export":
            result = export_shadow_package(
                data,
                args.id,
                args.path,
            )

        elif args.cmd == "import":
            result = import_shadow_package(
                data,
                args.path,
            )

        elif args.cmd == "edit-text":
            result = update_segment_text(
                data,
                args.id,
                args.segment_id,
                args.text,
            )

        elif args.cmd == "reset-text":
            result = reset_segment_text(
                data,
                args.id,
                args.segment_id,
            )

        else:
            result = set_segment_like(
                data,
                args.id,
                args.segment_id,
                args.liked == "true",
            )

        print(
            json.dumps(
                result,
                ensure_ascii=False,
            )
        )

    except Exception as error:
        print(
            str(error),
            file=sys.stderr,
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
