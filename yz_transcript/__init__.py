"""transcript — day-keyed JSONL store + multilingual semantic search.

The satellite is text-in / text-out: callers POST `/entries` with already-
transcribed lines, the satellite stores them in
`<data_root>/<YYYY-MM-DD>.jsonl` and indexes them for cosine-similarity
search. Audio capture / VAD / STT stay on the caller's side (JarvYZ).

`<data_root>` defaults to `~/.jarvyz/satellites/yz-transcript/`, overridable
via `JWT_TRANSCRIPT_ROOT` env. The satellite owns this directory; JarvYZ
proxies `/api/transcript/*` to it."""
from __future__ import annotations

__version__ = "0.1.0"
__all__ = ["__version__"]
