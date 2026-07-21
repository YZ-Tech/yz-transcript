"""Multilingual semantic search over the transcript JSONL.

Moved verbatim from `pipeline/transcript_search.py` (JarvYZ-side,
pre-migration). Identical model + dim + cache format so the existing
`.index.npz` cache loads without re-encoding — users keep their warm
search index across migration.

sentence-transformers MiniLM (384 dim, multilingual, ~120 MB) +
in-memory cosine similarity + persistent .npz cache. Source of truth
stays in the JSONL files; this is a parallel index.

Lifecycle:
  - `init()` constructs the singleton.
  - `initialize()` (background-threaded) loads the model, reads the
    cache, backfills any new JSONL entries via `core.store.iter_all_entries`,
    marks the index ready.
  - `index_entry(...)` is called by server.py after every successful
    POST /entries — appends one embedding in memory and schedules a
    debounced cache flush (a per-entry `np.savez` of the WHOLE matrix
    was O(N^2) lifetime disk writes). The JSONL stays the source of
    truth: entries missed by a crash before a flush are backfilled by
    the next `initialize()`.
  - `search(...)` runs cosine sim over the in-memory matrix with
    optional since/until/language filters.

The cache path is computed every call from `settings.data_root` so PATCH
/settings changes take effect on the next save. Cache lives at
`<data_root>/.index.npz`."""
from __future__ import annotations

import sys
import threading
from pathlib import Path
from typing import Any

import numpy as np

from ..settings import settings as _settings
from . import store

_MODEL_NAME = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
_DIM = 384
# Seconds of quiet before pending index entries are written to disk.
_FLUSH_DEBOUNCE_S = 30.0


def _cache_path() -> Path:
    return _settings.data_root / ".index.npz"


def _log(msg: str) -> None:
    """Lightweight stderr log — no pipeline.log import because we live
    inside the satellite, not JarvYZ."""
    print(f"[transcript_index] {msg}", file=sys.stderr)


class TranscriptIndex:
    """Cosine-sim store over multilingual-MiniLM embeddings."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._model: Any = None
        # Parallel arrays: embeddings is (N, D) float32; entries is a
        # list of dicts {day, ts, text, language, audio_path}.
        self._embeddings: np.ndarray = np.zeros((0, _DIM), dtype=np.float32)
        self._entries: list[dict] = []
        self._loaded = False
        # Debounced cache flush (see index_entry).
        self._dirty = False
        self._flush_timer: threading.Timer | None = None

    # ── public ────────────────────────────────────────────────────

    def is_ready(self) -> bool:
        return self._loaded

    def count(self) -> int:
        with self._lock:
            return len(self._entries)

    def initialize(self) -> None:
        """Backfill missing JSONL entries into the index. Idempotent.
        Heavy: loads the model (~10 s cold) and may encode hundreds of
        entries. Call from a background thread at startup."""
        with self._lock:
            if self._loaded:
                return
            _settings.data_root.mkdir(parents=True, exist_ok=True)
            self._load_cache_locked()
            indexed_keys = {(e["day"], e["ts"]) for e in self._entries}
            new_entries: list[dict] = []
            for day, e in store.iter_all_entries():
                key = (day, float(e.get("ts", 0.0)))
                if key in indexed_keys:
                    continue
                new_entries.append({
                    "day": day,
                    "ts": float(e.get("ts", 0.0)),
                    "text": str(e.get("text", "")),
                    "language": str(e.get("language", "")),
                    "audio_path": e.get("audio_path"),
                })
            if new_entries:
                _log(f"backfilling {len(new_entries)} entries")
                texts = [e["text"] for e in new_entries]
                new_emb = self._encode_locked(texts)
                self._embeddings = (
                    np.vstack([self._embeddings, new_emb])
                    if len(self._embeddings)
                    else new_emb
                )
                self._entries.extend(new_entries)
                self._save_cache_locked()
            self._loaded = True
            _log(f"ready — {len(self._entries)} entries indexed")

    def index_entry(
        self,
        day: str,
        ts: float,
        text: str,
        language: str,
        audio_path: str | None = None,
    ) -> None:
        """Append one entry's embedding. No-op if index not loaded yet —
        the next `initialize()` call will pick the entry up off disk.

        Disk flush is debounced: `np.savez` rewrites the ENTIRE matrix
        (npz has no append), so saving per entry was O(N) writes per
        utterance -> O(N^2) lifetime SSD wear. Losing an unflushed tail
        on a crash is safe — the JSONL is the source of truth and
        `initialize()` backfills."""
        if not text.strip():
            return
        with self._lock:
            if not self._loaded:
                return
            try:
                emb = self._encode_locked([text])
                self._embeddings = np.vstack([self._embeddings, emb])
                self._entries.append({
                    "day": day,
                    "ts": ts,
                    "text": text,
                    "language": language,
                    "audio_path": audio_path,
                })
                self._dirty = True
                if self._flush_timer is None:
                    t = threading.Timer(_FLUSH_DEBOUNCE_S, self._flush_debounced)
                    t.daemon = True
                    self._flush_timer = t
                    t.start()
            except Exception as e:  # noqa: BLE001
                _log(f"index_entry error: {e}")

    def _flush_debounced(self) -> None:
        with self._lock:
            self._flush_timer = None
            if self._dirty:
                self._dirty = False
                self._save_cache_locked()

    def flush(self) -> None:
        """Force-write any pending entries. Called at server shutdown so
        a clean exit never relies on the backfill path."""
        with self._lock:
            if self._flush_timer is not None:
                self._flush_timer.cancel()
                self._flush_timer = None
            if self._dirty:
                self._dirty = False
                self._save_cache_locked()

    def search(
        self,
        query: str,
        *,
        since: float | None = None,
        until: float | None = None,
        language: str | None = None,
        limit: int = 10,
    ) -> list[dict]:
        """Cosine-sim search with optional filters. Returns entries
        ordered by descending score; each entry includes a `score` float
        in [-1, 1]. Empty list if index isn't ready or has no entries."""
        with self._lock:
            if not self._loaded or len(self._entries) == 0:
                return []
            q_emb = self._encode_locked([query])[0]
            scores = self._embeddings @ q_emb  # cosine — embeddings normalized
            order = np.argsort(-scores)
            results: list[dict] = []
            for i in order:
                if len(results) >= limit:
                    break
                e = self._entries[i]
                if since is not None and e["ts"] < since:
                    continue
                if until is not None and e["ts"] > until:
                    continue
                if language is not None and e["language"] != language:
                    continue
                results.append({**e, "score": float(scores[i])})
            return results

    # ── internals (must be called with lock held) ─────────────────

    def _ensure_model_locked(self) -> None:
        if self._model is not None:
            return
        _log(f"loading {_MODEL_NAME}")
        from sentence_transformers import SentenceTransformer
        # CPU keeps it out of GPU's way; multilingual-MiniLM is small
        # enough that CPU inference is fast (~5 ms per 100-char input).
        self._model = SentenceTransformer(_MODEL_NAME, device="cpu")
        _log("model ready")

    def _encode_locked(self, texts: list[str]) -> np.ndarray:
        self._ensure_model_locked()
        emb = self._model.encode(
            texts, normalize_embeddings=True, show_progress_bar=False
        )
        return np.asarray(emb, dtype=np.float32)

    def _load_cache_locked(self) -> None:
        p = _cache_path()
        if not p.exists():
            return
        try:
            data = np.load(p, allow_pickle=True)
            self._embeddings = np.asarray(data["embeddings"], dtype=np.float32)
            self._entries = list(data["entries"])
            _log(f"cache loaded — {len(self._entries)} entries")
        except Exception as e:  # noqa: BLE001
            _log(f"cache load failed (rebuilding): {e}")
            self._embeddings = np.zeros((0, _DIM), dtype=np.float32)
            self._entries = []

    def _save_cache_locked(self) -> None:
        p = _cache_path()
        try:
            p.parent.mkdir(parents=True, exist_ok=True)
            np.savez(
                p,
                embeddings=self._embeddings,
                entries=np.array(self._entries, dtype=object),
            )
        except Exception as e:  # noqa: BLE001
            _log(f"cache save failed: {e}")


# ── module-level singleton ────────────────────────────────────────

_INDEX: TranscriptIndex | None = None


def init() -> TranscriptIndex:
    global _INDEX
    if _INDEX is None:
        _INDEX = TranscriptIndex()
    return _INDEX


def get() -> TranscriptIndex | None:
    return _INDEX
