"""`python -m yz_transcript` entry point. Defers to yz_transcript.server."""
from __future__ import annotations

from . import server  # noqa: F401

if __name__ == "__main__":
    server.main()
