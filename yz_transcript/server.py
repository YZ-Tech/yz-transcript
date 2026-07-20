"""FastAPI daemon for the transcript satellite.

The satellite is text-in / text-out. Callers (JarvYZ, future agents)
POST already-transcribed entries to `/entries`; the satellite stores
them as JSONL and indexes them for cosine-similarity search.

Endpoints:
  GET    /health                             — liveness probe
  GET    /settings                           — current settings snapshot
  PATCH  /settings                           — mutate satellite settings
  GET    /entries                            — list a day's entries
  POST   /entries                            — append one entry (used by JarvYZ)
  DELETE /entries                            — drop one (body: {day, ts})
  GET    /days                               — list days that have data
  GET    /state                              — capture/index state for the UI
  POST   /state/forget                       — drop entries from last N minutes
  POST   /state/prune                        — run retention policy now
  GET    /search                             — semantic search (UI use)
  POST   /tools/search_transcript            — LLM tool dispatch (manifest tools[])
  WS     /events                             — server-pushed transcript events
  /                                          — bundled SPA (StaticFiles)

The satellite owns transcript STATE (entries + index). It does NOT own
audio capture / VAD / STT / pause-until — those concerns stay caller-
side. `/state` therefore reports what the satellite KNOWS:
    {entries_count, today_count, last_entry_ts, index_ready, index_count}
The caller's "is capture running / paused" projection layers on top of
this in the JarvYZ-side proxy."""
from __future__ import annotations

import asyncio
import re
import sys
from pathlib import Path

from fastapi import Body, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles

from . import __version__, observer
from . import persistent_settings as _persist  # noqa: F401 — load() runs on import
from .core import index as transcript_index
from .core import store
from .settings import settings


app = FastAPI(title="transcript", version=__version__)


_DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _validate_day(day: str) -> None:
    if not _DAY_RE.match(day):
        raise HTTPException(400, "day must match YYYY-MM-DD")


# ─────────────────────────── lifecycle ────────────────────────────


@app.on_event("startup")
async def _startup() -> None:
    """Kick the search index's heavy backfill off the request path.

    `init()` creates the singleton synchronously (cheap); `initialize()`
    loads the model + backfills any new JSONL entries (~5–10 s cold +
    a few ms per new entry). We run it on a thread so health checks
    and the first /entries POSTs aren't blocked by model load."""
    transcript_index.init()
    import threading
    threading.Thread(
        target=transcript_index.get().initialize,
        name="transcript-index-init",
        daemon=True,
    ).start()


# ─────────────────────────── liveness ────────────────────────────


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "version": __version__,
        "python": sys.version.split()[0],
        "platform": sys.platform,
        "data_root": str(settings.data_root),
    }


# ─────────────────────────── settings ────────────────────────────


@app.get("/settings")
def get_settings() -> dict:
    return {
        "data_root": str(settings.data_root),
        "retention_days_text": settings.retention_days_text,
    }


@app.patch("/settings")
def patch_settings(patch: dict = Body(...)) -> dict:
    _persist.apply_patch(patch)
    observer.emit("settings_changed", **get_settings())
    return get_settings()


# ─────────────────────────── entries ────────────────────────────


@app.get("/entries")
def entries_list(day: str | None = None, limit: int = 100) -> dict:
    """Return entries for a day (default today), newest first. Same
    `{day, entries, total_day}` shape the pre-migration `/api/transcript`
    returned so the proxy + frontend keep working unchanged."""
    if day is not None:
        _validate_day(day)
    return store.list_entries(day=day, limit=limit)


@app.post("/entries")
def entries_create(entry: dict = Body(...)) -> dict:
    """Append one entry. Required: `ts`. Optional: `text`, `language`,
    `duration`, `audio_path`. Returns the persisted entry + the day it
    landed in. Also feeds the search index (no-op when the index is
    still warming up — the next initialize() picks it up off disk)."""
    if "ts" not in entry:
        raise HTTPException(400, "entry must include `ts` (unix float)")
    try:
        result = store.append_entry(entry)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    persisted = result["entry"]
    day = result["day"]
    idx = transcript_index.get()
    if idx is not None and idx.is_ready():
        idx.index_entry(
            day=day,
            ts=persisted["ts"],
            text=persisted["text"],
            language=persisted.get("language", ""),
            audio_path=persisted.get("audio_path"),
        )
    observer.emit("entry", day=day, **persisted)
    return {"ok": True, "day": day, "entry": persisted}


@app.delete("/entries")
def entries_delete(day: str, ts: float) -> dict:
    """Drop one entry by (day, ts). Returns the audio_path values the
    caller (JarvYZ) should unlink on its own filesystem — the satellite
    doesn't see audio. Query-param style (matches the pre-migration
    `/api/transcript/entry?day=&ts=` shape the frontend uses)."""
    _validate_day(day)
    result = store.drop_entry(day, ts)
    if result["dropped_entries"] == 0:
        raise HTTPException(404, "entry not found")
    observer.emit("delete", day=day, ts=ts, **result)
    return {"ok": True, **result}


@app.get("/days")
def days_list() -> dict:
    return {"days": store.list_days()}


# ─────────────────────────── state ─────────────────────────────


@app.get("/state")
def state() -> dict:
    """What the satellite knows about itself. Caller-side projections
    (is capture running? paused?) are added by the JarvYZ-side proxy."""
    idx = transcript_index.get()
    return {
        "today_count": store.today_count(),
        "last_entry_ts": store.last_entry_ts(),
        "index_ready": bool(idx and idx.is_ready()),
        "index_count": int(idx.count()) if idx else 0,
        "retention": {"text_days": settings.retention_days_text},
    }


@app.post("/state/forget")
def state_forget(body: dict = Body(...)) -> dict:
    """Drop entries from the last N minutes. Returns the audio_path
    values the caller should unlink on its own filesystem."""
    try:
        minutes = int(body.get("minutes", 5))
    except (TypeError, ValueError) as e:
        raise HTTPException(400, "minutes must be an integer") from e
    if minutes <= 0 or minutes > 60 * 24:
        raise HTTPException(400, "minutes must be in (0, 1440]")
    result = store.forget_recent(minutes)
    observer.emit("forget", **result)
    return {"ok": True, **result}


@app.post("/state/prune")
def state_prune() -> dict:
    """Run the retention pruner immediately. Normally a noop unless the
    user lowered `retention_days_text` from forever to a finite value."""
    result = store.prune_old()
    observer.emit("prune", **result)
    return {"ok": True, **result}


# ─────────────────────────── search ────────────────────────────


@app.get("/search")
def search(
    q: str,
    since_iso: str | None = None,
    until_iso: str | None = None,
    language: str | None = None,
    limit: int = 10,
) -> dict:
    """Semantic search over the indexed transcript. Returns
    `{ready, count, entries:[{ts, text, language, day, audio_path, score}, ...]}`.
    When the index is still warming up: `ready=False, entries=[]`."""
    from datetime import datetime as _dt

    idx = transcript_index.get()
    if idx is None:
        raise HTTPException(503, "transcript index not initialized")
    if not idx.is_ready():
        return {"ready": False, "count": 0, "entries": []}

    def _to_ts(iso: str | None) -> float | None:
        if not iso:
            return None
        try:
            return _dt.fromisoformat(iso).timestamp()
        except ValueError:
            return None

    results = idx.search(
        q,
        since=_to_ts(since_iso),
        until=_to_ts(until_iso),
        language=language.lower() if language else None,
        limit=max(1, min(50, int(limit))),
    )
    return {"ready": True, "count": idx.count(), "entries": results}


# ─────────────────────────── LLM tool ──────────────────────────


@app.post("/tools/search_transcript")
def tools_search_transcript(body: dict = Body(default_factory=dict)) -> dict:
    """LLM-callable wrapper around /search.

    Returns `{ok, text}` per the satellite-tools contract — `text` is
    TTS-friendly when `speakable=true` is declared in the manifest. This
    tool is `speakable=false` (multi-line, scored matches), so the LLM
    synthesizes the lines into a single spoken sentence."""
    from datetime import datetime as _dt

    query = str(body.get("query") or "").strip()
    if not query:
        return {"ok": False, "text": "search_transcript requires a `query`."}

    idx = transcript_index.get()
    if idx is None:
        return {"ok": False, "text": "Transcript search index is not available."}
    if not idx.is_ready():
        return {
            "ok": False,
            "text": "Transcript search index is still initializing — try again in a moment.",
        }

    def _to_ts(iso) -> float | None:
        if not iso:
            return None
        try:
            return _dt.fromisoformat(str(iso)).timestamp()
        except ValueError:
            return None

    try:
        limit_n = max(1, min(20, int(body.get("limit", 5))))
    except (TypeError, ValueError):
        limit_n = 5
    lang_raw = body.get("language")
    lang_filter = lang_raw.lower() if isinstance(lang_raw, str) and lang_raw else None

    results = idx.search(
        query,
        since=_to_ts(body.get("since_iso")),
        until=_to_ts(body.get("until_iso")),
        language=lang_filter,
        limit=limit_n,
    )
    if not results:
        return {"ok": True, "text": f"No transcript entries match '{query}'."}
    lines = [f"Found {len(results)} match(es) for '{query}':"]
    for r in results:
        when = _dt.fromtimestamp(r["ts"]).strftime("%Y-%m-%d %H:%M:%S")
        lang_tag = (r.get("language") or "").upper() or "?"
        lines.append(f"  [{when} {lang_tag} score={r['score']:.2f}] {r['text']}")
    return {"ok": True, "text": "\n".join(lines)}


# ─────────────────────────── events WS ────────────────────────────


@app.websocket("/events")
async def events_ws(ws: WebSocket) -> None:
    """Server → client push of transcript events. Initial frame is a
    `hello` so the client knows the channel is live without waiting for
    the first mutation."""
    await ws.accept()
    q = observer.subscribe()
    try:
        await ws.send_json({"event": "transcript", "kind": "hello"})
        while True:
            msg = await q.get()
            await ws.send_json(msg)
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        observer.unsubscribe(q)


# ─────────────────────────── SPA mount ────────────────────────────
#
# Mounted LAST so explicit JSON / WS routes win precedence over static
# files. Mkdir + mount unconditionally so a build:pages emit after the
# satellite has booted shows up on the next request (no restart needed).

_static_dir = Path(__file__).parent / "static"
_static_dir.mkdir(parents=True, exist_ok=True)
app.mount(
    "/",
    StaticFiles(directory=str(_static_dir), html=True),
    name="static",
)


# ─────────────────────────── entrypoint ───────────────────────────


def main() -> None:
    """`python -m yz_transcript` entry point."""
    import os
    import uvicorn

    host = os.environ.get("TRANSCRIPT_HOST", "127.0.0.1")
    # YZ_PORT (core-resolved, settings.ports) wins; TRANSCRIPT_PORT + default for standalone.
    port = int(os.environ.get("YZ_PORT") or os.environ.get("TRANSCRIPT_PORT") or "9004")
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
