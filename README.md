<!-- ─────────────────────────── JARVYZ SATELLITE ─────────────────────────── -->

# transcript

[![JarvYZ](https://img.shields.io/badge/JARVYZ-Satellite-blue.svg?logoColor=white)](../../README.md)
[![Version](https://img.shields.io/badge/VERSION-0.1.0-blue.svg?logo=git&logoColor=white)](pyproject.toml)
[![Python](https://img.shields.io/badge/PYTHON-3.10–3.12-blue.svg?logo=python&logoColor=white)](pyproject.toml)
[![License](https://img.shields.io/badge/LICENSE-MIT-blue.svg?logo=opensourceinitiative&logoColor=white)](pyproject.toml)
[![Kind](https://img.shields.io/badge/KIND-service-blue.svg?logoColor=white)](#)
[![Port](https://img.shields.io/badge/PORT-9004-blue.svg?logoColor=white)](#)
[![Creator](https://img.shields.io/badge/CREATOR-Yeon-blue.svg?logo=github&logoColor=white)](https://github.com/YeonV)
[![Blade](https://img.shields.io/badge/A.K.A-Blade-darkred.svg?logo=github&logoColor=white)](https://github.com/YeonV)

<p align="left">
  <img src="ui/public/logo.svg" alt="JarvYZ" width="200">
</p>

> `yz-transcript` — Day-keyed JSONL store + multilingual semantic search over ambient voice transcripts. Text-in / text-out.

### Techs

[![FastAPI](https://img.shields.io/badge/x-FastAPI-blue.svg?logo=fastapi&logoColor=white&label=)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/x-React-blue.svg?logo=react&logoColor=white&label=)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/x-TypeScript-blue.svg?logo=typescript&logoColor=white&label=)](https://www.typescriptlang.org/)
[![Transformers](https://img.shields.io/badge/x-Transformers-blue.svg?logo=huggingface&logoColor=white&label=)](https://huggingface.co/sentence-transformers)

**Run** `python -m yz_transcript` &nbsp;·&nbsp; **API** `/api/transcript/*`

<!-- ───────────────────────────────────────────────────────────────────────── -->

<details>
<summary><b>Documentation</b></summary>

Day-keyed JSONL store + multilingual semantic search over ambient voice
transcripts. Text-in / text-out: callers send already-transcribed lines,
the satellite stores + indexes + serves them. Audio capture / VAD / STT
stay caller-side.

The substrate for "what did I say about X yesterday?" and any future
agent that wants to read the user's own spoken history.

## Standalone install

```bash
# WSL / Linux
uv pip install --python <venv>/bin/python -e satellites/yz-transcript
python -m yz_transcript     # http://127.0.0.1:9004
```

Storage defaults to `~/.jarvyz/satellites/transcript/`. Override via
`JWT_TRANSCRIPT_ROOT` env. Settings persist to
`~/.jarvyz/satellites/transcript/settings.json`.

## Routes

| Method | Path | Body / params | Purpose |
|---|---|---|---|
| `GET` | `/health` | — | liveness + version info |
| `GET` | `/settings` | — | snapshot |
| `PATCH` | `/settings` | partial | apply + persist + emit `settings_changed` |
| `GET` | `/entries` | `?day=YYYY-MM-DD&limit=...` | list newest-first |
| `POST` | `/entries` | `{ts, text?, language?, duration?, audio_path?}` | append + index + emit `entry` |
| `DELETE` | `/entries` | `?day=YYYY-MM-DD&ts=...` | drop one; returns `audio_paths` for caller cleanup |
| `GET` | `/days` | — | days with data (date-picker) |
| `GET` | `/state` | — | `{today_count, last_entry_ts, index_ready, index_count, retention}` |
| `POST` | `/state/forget` | `{minutes}` | drop last-N-minutes entries |
| `POST` | `/state/prune` | — | run retention policy now |
| `GET` | `/search` | `?q=...&since_iso=...&until_iso=...&language=...&limit=...` | semantic search |
| `POST` | `/tools/search_transcript` | LLM args | manifest tool dispatch — returns `{ok, text}` |
| `WS` | `/events` | — | `{event:"transcript", kind, ...}` push |
| `/` | — | — | bundled SPA |

### What's NOT here

This satellite is text-only. Audio capture, VAD, STT, pause/resume state
all live in the caller (JarvYZ-side `pipeline/transcript.py` /
`TranscriptCapture`). The caller POSTs already-transcribed entries here.

`audio_path` on an entry is an opaque string the caller assigns. The
satellite never resolves it. In JarvYZ-embedded mode, audio playback
routes through JarvYZ's own `/api/transcript/audio/{day}/{name}` which
reads from JarvYZ's filesystem directly.

## Search index

Multilingual MiniLM (`paraphrase-multilingual-MiniLM-L12-v2`, 384 dim,
CPU). Cache lives at `<data_root>/.index.npz`. Backfilled at startup on
a thread, populated incrementally on every successful `POST /entries`.
Same model + dim as the pre-migration `pipeline/transcript_search.py` so
existing index caches keep working post-migration.

## Embedded use (JarvYZ-side)

JarvYZ ships `web/api/transcript_satellite.py` which proxies
`/api/transcript/*` to this satellite. The audio download endpoint
(`/api/transcript/audio/{day}/{name}`) stays JarvYZ-side because the
clip lives on JarvYZ's filesystem.

The LLM `search_transcript` tool is contributed via this satellite's
manifest `tools[]` — built-in `search_transcript` got removed from
`pipeline/tools.py` as part of the migration. Disable the satellite in
`/satellites` → the LLM tool vanishes from the catalog instantly.

## See also

- [SATELLITE_DYNAMIC_MODULES.md](../../SATELLITE_DYNAMIC_MODULES.md) — manifest + IIFE contract
- [satellites/people](../people/) — closest shape (JSON store + per-mount UI)
- [satellites/yz-music](../music/) — manifest `tools[]` + `service` reference

</details>
