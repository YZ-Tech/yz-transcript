"""Load + persist satellite settings to disk.

Mirrors music + people satellites: on import, read
<settings_root>/settings.json into the module-level `settings` dataclass.
PATCH /settings (server.py) mutates the dataclass in-place and calls
save().

`<settings_root>` is where the settings.json lives — separate from
`<data_root>` (where the JSONL files live) so changing `data_root` via
PATCH doesn't lose the settings.json itself. Defaults to
`~/.jarvyz/satellites/yz-transcript/` (derived from JARVYZ_HOME), override
via `JWT_TRANSCRIPT_SETTINGS_ROOT` (unusual — most overrides should use
`JWT_TRANSCRIPT_ROOT` to move the data dir instead)."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from .settings import Settings, settings as _live


def _settings_root() -> Path:
    env = os.environ.get("JWT_TRANSCRIPT_SETTINGS_ROOT")
    if env:
        return Path(env)
    home = Path(os.environ.get("JARVYZ_HOME") or Path.home() / ".jarvyz")
    return home / "satellites" / "yz-transcript"


def _settings_path() -> Path:
    return _settings_root() / "settings.json"


MUTABLE_KEYS = ("data_root", "retention_days_text")


def load() -> None:
    """Read settings.json into the live dataclass. No-op if file missing
    (defaults stand). Soft-fail on parse errors."""
    p = _settings_path()
    if not p.exists():
        return
    try:
        data = json.loads(p.read_text("utf-8"))
    except Exception as e:  # noqa: BLE001
        print(f"[transcript] settings.json parse failed: {e}", file=sys.stderr)
        return
    if "data_root" in data:
        _live.data_root = Path(str(data["data_root"]))
    if "retention_days_text" in data:
        try:
            _live.retention_days_text = max(0, int(data["retention_days_text"]))
        except (TypeError, ValueError):
            pass


def save() -> None:
    """Persist the live dataclass to settings.json. Atomic via tmp+rename."""
    p = _settings_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "data_root": str(_live.data_root),
        "retention_days_text": _live.retention_days_text,
    }
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    tmp.replace(p)


def apply_patch(patch: dict) -> Settings:
    """Validate + apply a PATCH /settings body. Returns the post-merge
    snapshot. Unknown keys are dropped silently."""
    if "data_root" in patch:
        _live.data_root = Path(str(patch["data_root"])).expanduser()
    if "retention_days_text" in patch:
        try:
            _live.retention_days_text = max(0, int(patch["retention_days_text"]))
        except (TypeError, ValueError):
            pass
    save()
    return _live


# Read on module import so any consumer that imports `settings`
# immediately sees persisted state.
load()
