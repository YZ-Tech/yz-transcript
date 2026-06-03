"""Storage + index — the read/write substrate underneath server.py.

  - `store` owns the JSONL files (append, list, delete, prune).
  - `index` owns the semantic-search vector index over the same content.

Routes in server.py orchestrate them; this layer is HTTP-free."""
