"""Bounded reading and verified backup creation for the native migration."""

from __future__ import annotations

import hashlib
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from es3_parser import MAX_BYTES
from windows_file_safety import fingerprint


def read_bounded(path: Path) -> bytes:
    with path.open("rb") as stream:
        result = stream.read(MAX_BYTES + 1)
    if len(result) > MAX_BYTES:
        raise ValueError("Save exceeds the 20 MiB limit.")
    return result


def digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def create_verified_backup(path: Path, content: bytes) -> Path:
    if len(content) > MAX_BYTES:
        raise ValueError("Save exceeds the 20 MiB limit.")
    now = datetime.now(timezone.utc)
    stamp = now.strftime("%Y%m%dT%H%M%S") + f"{now.microsecond // 1000:03d}Z"
    backup = path.with_name(f"{path.name}.{stamp}.{uuid.uuid4().hex}.original.bak")
    try:
        with backup.open("xb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
    except OSError as exc:
        raise OSError(f"Backup creation failed; the original was not replaced. Incomplete backup, if present: {backup}") from exc
    if fingerprint(backup) is None or digest(read_bounded(backup)) != digest(content):
        raise OSError(f"Backup could not be verified; the original was not replaced: {backup}")
    return backup


def list_backups(path: Path) -> list[tuple[Path, datetime, tuple]]:
    pattern = re.compile(re.escape(path.name) + r"\.(\d{8}T\d{9}Z)\.([a-f0-9]{32})\.original\.bak\Z")
    backups = []
    for candidate in path.parent.iterdir():
        match = pattern.fullmatch(candidate.name)
        if match is None:
            continue
        try:
            stamp = datetime.strptime(match.group(1), "%Y%m%dT%H%M%S%fZ")
        except ValueError:
            continue
        identity = fingerprint(candidate)
        if identity is not None:
            backups.append((candidate, stamp, identity))
    backups.sort(key=lambda entry: str(entry[0]))
    backups.sort(key=lambda entry: entry[1], reverse=True)
    return backups
