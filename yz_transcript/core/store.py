"""Day-keyed JSONL storage for transcript entries.

Append-only file per UTC-local day. Entry shape (verbatim from
pre-migration JarvYZ-side):
    {ts: float, text: str, language: str, duration: float, audio_path?: str}

`audio_path` is a string the CALLER assigns (JarvYZ-side path relative
to its own audio dir). The satellite never resolves it — playback in
embedded mode routes through JarvYZ's `/api/transcript/audio/...`
endpoint, which reads from JarvYZ's filesystem directly. In standalone
mode the field is informational only.

All filesystem access is via `_settings.data_root` so PATCH /settings
updates take effect immediately (no module-import-time capture)."""
from __future__ import annotations

import json
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from ..settings import settings as _settings


_write_lock = threading.Lock()


# ─────────────────────────── path helpers ───────────────────────────


def _data_root() -> Path:
    return _settings.data_root


def _day_path(day: str) -> Path:
    return _data_root() / f"{day}.jsonl"


def _ensure_root() -> None:
    _data_root().mkdir(parents=True, exist_ok=True)


def day_for_ts(ts: float) -> str:
    """Same `YYYY-MM-DD` slug the JarvYZ-side TranscriptCapture used.
    Uses local-time interpretation so the JSONL day boundary matches the
    user's wall-clock midnight, NOT UTC midnight."""
    return datetime.fromtimestamp(ts).strftime("%Y-%m-%d")


# ─────────────────────────── public API ─────────────────────────────


def append_entry(entry: dict) -> dict:
    """Append one entry to its day's JSONL.

    `entry["ts"]` is required (unix float). Returns the persisted entry
    + its day. Missing fields are filled with sensible defaults so
    callers can POST a minimal payload."""
    if "ts" not in entry:
        raise ValueError("entry must include `ts`")
    persisted: dict[str, Any] = {
        "ts": float(entry["ts"]),
        "text": str(entry.get("text") or ""),
        "language": str(entry.get("language") or ""),
        "duration": float(entry.get("duration") or 0.0),
    }
    if entry.get("audio_path"):
        persisted["audio_path"] = str(entry["audio_path"])
    day = day_for_ts(persisted["ts"])
    _ensure_root()
    line = json.dumps(persisted, ensure_ascii=False)
    with _write_lock:
        with _day_path(day).open("a", encoding="utf-8") as f:
            f.write(line + "\n")
    return {"day": day, "entry": persisted}


def list_entries(day: str | None = None, limit: int = 100) -> dict:
    """Return entries for a day, newest first, capped at `limit`.

    Same shape the pre-migration `/api/transcript` endpoint returned so
    the proxy + frontend keep working unchanged."""
    if day is None:
        day = datetime.now().strftime("%Y-%m-%d")
    path = _day_path(day)
    if not path.exists():
        return {"day": day, "entries": [], "total_day": 0}
    entries: list[dict] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            entries.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    entries.reverse()
    capped = entries[: max(1, min(1000, int(limit)))]
    return {"day": day, "entries": capped, "total_day": len(entries)}


def list_days() -> list[dict]:
    """All days that have at least one JSONL row. Each entry carries
    `{day, size_bytes, mtime}` for the date-picker UI."""
    root = _data_root()
    if not root.exists():
        return []
    out: list[dict] = []
    for f in sorted(root.glob("*.jsonl")):
        try:
            st = f.stat()
        except OSError:
            continue
        out.append({"day": f.stem, "size_bytes": st.st_size, "mtime": st.st_mtime})
    return out


def drop_entry(day: str, ts: float) -> dict:
    """Delete one entry by (day, ts). Returns the dropped-counts so the
    caller (JarvYZ-side) can decide whether to also unlink the backing
    audio clip on its own filesystem."""
    path = _day_path(day)
    if not path.exists():
        return {"dropped_entries": 0, "audio_paths": []}
    dropped = 0
    audio_paths: list[str] = []
    with _write_lock:
        kept: list[str] = []
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                e = json.loads(line)
            except json.JSONDecodeError:
                kept.append(line)
                continue
            if abs(float(e.get("ts", 0)) - float(ts)) > 0.001:
                kept.append(line)
                continue
            dropped += 1
            ap = e.get("audio_path")
            if ap:
                audio_paths.append(str(ap))
        path.write_text("\n".join(kept) + ("\n" if kept else ""), encoding="utf-8")
    return {"dropped_entries": dropped, "audio_paths": audio_paths}


def forget_recent(minutes: int) -> dict:
    """Drop entries with `ts >= now - minutes*60`. Affects today +
    yesterday's JSONL. Returns the list of `audio_path` values so the
    caller (JarvYZ-side, which owns audio) can unlink them."""
    cutoff = time.time() - max(1, minutes) * 60
    dropped = 0
    audio_paths: list[str] = []
    with _write_lock:
        for day_offset in (0, 1):
            day = datetime.fromtimestamp(
                time.time() - day_offset * 86400
            ).strftime("%Y-%m-%d")
            path = _day_path(day)
            if not path.exists():
                continue
            kept: list[str] = []
            for line in path.read_text(encoding="utf-8").splitlines():
                if not line.strip():
                    continue
                try:
                    e = json.loads(line)
                except json.JSONDecodeError:
                    kept.append(line)
                    continue
                if float(e.get("ts", 0)) < cutoff:
                    kept.append(line)
                    continue
                dropped += 1
                ap = e.get("audio_path")
                if ap:
                    audio_paths.append(str(ap))
            path.write_text("\n".join(kept) + ("\n" if kept else ""), encoding="utf-8")
    return {"dropped_entries": dropped, "audio_paths": audio_paths}


def prune_old() -> dict:
    """Delete JSONL files older than `retention_days_text` (mtime-based).
    No-op when retention is 0 (forever). Returns count deleted."""
    days = _settings.retention_days_text
    if days <= 0:
        return {"jsonl_files_deleted": 0}
    cutoff = time.time() - days * 86400
    deleted = 0
    root = _data_root()
    if not root.exists():
        return {"jsonl_files_deleted": 0}
    with _write_lock:
        for jsonl in root.glob("*.jsonl"):
            try:
                if jsonl.stat().st_mtime < cutoff:
                    jsonl.unlink()
                    deleted += 1
            except OSError:
                continue
    return {"jsonl_files_deleted": deleted}


def iter_all_entries():
    """Generator over every persisted entry, in (day, ts) order.

    Used by the index for backfill on first boot. Yields `(day, entry)`
    pairs."""
    root = _data_root()
    if not root.exists():
        return
    for jsonl in sorted(root.glob("*.jsonl")):
        day = jsonl.stem
        try:
            text = jsonl.read_text(encoding="utf-8")
        except OSError:
            continue
        for line in text.splitlines():
            if not line.strip():
                continue
            try:
                e = json.loads(line)
            except json.JSONDecodeError:
                continue
            yield day, e


def today_count() -> int:
    """How many entries the current day's JSONL has — surfaced in
    `/state` for the UI's "N entries today" affordance."""
    day = datetime.now().strftime("%Y-%m-%d")
    path = _day_path(day)
    if not path.exists():
        return 0
    try:
        return sum(1 for line in path.read_text(encoding="utf-8").splitlines() if line.strip())
    except OSError:
        return 0


def last_entry_ts() -> float | None:
    """Timestamp of the most recently written entry across all days, or
    None when the store is empty. Used for the UI's "last activity" hint."""
    days = list_days()
    if not days:
        return None
    days.sort(key=lambda d: d["mtime"], reverse=True)
    for day_info in days:
        path = _day_path(day_info["day"])
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except OSError:
            continue
        for line in reversed(lines):
            if not line.strip():
                continue
            try:
                e = json.loads(line)
                return float(e.get("ts", 0)) or None
            except json.JSONDecodeError:
                continue
    return None
