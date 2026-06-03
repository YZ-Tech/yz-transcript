"""In-process event broadcaster for the transcript satellite.

Routes emit() events when state changes (entry added/deleted, capture
state flipped, prune ran). /events WS subscribers receive them via
per-connection asyncio queues. The JarvYZ-side proxy tails this WS and
re-broadcasts onto JarvYZ's own `transcript` channel so existing pubsub
consumers (the global /api/events WS, the Loom listener) keep working
unchanged.

Mirrors the people satellite's observer.py — simple, no observer thread."""
from __future__ import annotations

import asyncio
from typing import Any


_subscribers: set[asyncio.Queue] = set()


def subscribe() -> asyncio.Queue:
    """Register a new WS connection. Returns the queue it should
    `await q.get()` to receive events. Caller must `unsubscribe(q)` on
    disconnect."""
    q: asyncio.Queue = asyncio.Queue()
    _subscribers.add(q)
    return q


def unsubscribe(q: asyncio.Queue) -> None:
    _subscribers.discard(q)


def emit(kind: str, **payload: Any) -> None:
    """Fan out one event to every connected WS subscriber.

    Frame shape `{event: "transcript", kind, ...payload}` matches the
    pre-migration JarvYZ-bus convention so the proxy can re-broadcast
    `kind=...` payloads as-is. asyncio.Queue is unbounded — keep it that
    way unless we see actual memory pressure."""
    msg = {"event": "transcript", "kind": kind, **payload}
    for q in list(_subscribers):
        try:
            q.put_nowait(msg)
        except Exception:
            pass


def num_subscribers() -> int:
    return len(_subscribers)
