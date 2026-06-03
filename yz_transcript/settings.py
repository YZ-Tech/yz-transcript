"""Satellite-owned settings.

Two knobs today:
    data_root        — where the JSONL files + .index.npz live.
    retention_days   — pruning policy; 0 = forever.

Defaults match the in-tree implementation's defaults (text retention
forever) so existing data is preserved verbatim after migration."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _default_data_root() -> Path:
    """Where the satellite stores its JSONL + index. Override via
    `JWT_TRANSCRIPT_ROOT` env (mirrors `JWT_PEOPLE_ROOT` /
    `JWT_MUSIC_ROOT` conventions)."""
    env = os.environ.get("JWT_TRANSCRIPT_ROOT")
    if env:
        return Path(env)
    home = Path(os.environ.get("JARVYZ_HOME") or Path.home() / ".jarvyz")
    return home / "satellites" / "yz-transcript"


@dataclass
class Settings:
    """Snapshot of mutable satellite settings."""

    data_root: Path = field(default_factory=_default_data_root)
    # Days to keep JSONL entries. 0 = forever (matches pre-migration default).
    retention_days_text: int = 0


# Module singleton. persistent_settings.load() may replace fields from
# the on-disk JSON sidecar at boot.
settings = Settings()
