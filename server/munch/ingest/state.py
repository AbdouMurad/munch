"""Resume file: the cells still to search, so a capped or crashed crawl never re-pays."""

import json
from dataclasses import asdict
from pathlib import Path

from munch.ingest.grid import Cell


def load_pending(path: Path, bbox: str) -> list[Cell] | None:
    """Pending cells from a previous run over the same bbox, else None."""
    if not path.exists():
        return None
    data = json.loads(path.read_text())
    if data.get("bbox") != bbox:
        return None
    return [Cell(**c) for c in data["pending"]]


def save_pending(path: Path, bbox: str, pending: list[Cell]) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps({"bbox": bbox, "pending": [asdict(c) for c in pending]}))
    tmp.replace(path)  # atomic, so a Ctrl-C mid-write can't corrupt it
