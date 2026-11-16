"""Backed-up native save lifecycle. Callers must hold the shared policy mutex."""

from __future__ import annotations

import os
import uuid
from contextlib import nullcontext
from dataclasses import dataclass
from pathlib import Path

from es3_document import inspect_document, serialize_document
from storage_primitives import create_verified_backup, digest, list_backups, read_bounded
from windows_file_safety import delete_unchanged, fingerprint, hold_unchanged, replace_file


def _limit(value: int) -> int:
    if type(value) is not int or not 0 <= value <= 9007199254740991:
        raise ValueError("Backup limit must be a whole number from 0 to 9007199254740991.")
    return value


@dataclass
class Source:
    path: Path
    content: bytes
    hash: str
    backup_limit: int
    load_backup: Path | None = None
    load_hash: str | None = None
    load_length: int = 0
    retention_warning: str = ""


def _verified(path: Path | None, length: int, expected_hash: str | None) -> bool:
    if path is None or expected_hash is None:
        return False
    try:
        if fingerprint(path) is None:
            return False
        data = read_bounded(path)
        return len(data) == length and digest(data) == expected_hash
    except (OSError, ValueError):
        return False


def _recovery_point(path: Path, content: bytes) -> Path:
    expected_hash = digest(content)
    for candidate, _, _ in list_backups(path):
        if _verified(candidate, len(content), expected_hash):
            return candidate
    return create_verified_backup(path, content)


def _retain(source: Source) -> str:
    failures = []
    try:
        if source.backup_limit > 0:
            if source.load_backup is None:
                raise OSError("The recovery point is missing; no backups were pruned.")
            identity = fingerprint(source.load_backup)
            protection = hold_unchanged(source.load_backup, identity)
        else:
            protection = nullcontext()
        with protection:
            if source.backup_limit > 0 and not _verified(source.load_backup, source.load_length, source.load_hash):
                raise OSError("The recovery point changed; no backups were pruned.")
            backups = list_backups(source.path)
            if source.backup_limit > 0 and not any(entry[0] == source.load_backup for entry in backups):
                raise OSError("The verified recovery point is no longer an eligible editor backup.")
            remaining = source.backup_limit
            for path, _, identity in backups:
                if source.backup_limit > 0 and path == source.load_backup:
                    continue
                if remaining > (1 if source.backup_limit > 0 else 0):
                    remaining -= 1
                    continue
                try:
                    delete_unchanged(path, identity)
                except OSError as exc:
                    failures.append(f"{path}: {exc}")
    except OSError as exc:
        failures.append(str(exc))
    return " ".join(failures)


def open_source(path: Path, backup_limit: int) -> Source:
    limit = _limit(backup_limit)
    path = path.absolute()
    if path.suffix.lower() != ".es3" or not path.is_file():
        raise ValueError("Choose an .es3 save file.")
    content = read_bounded(path)
    inspect_document(content.decode("utf-8"))
    current_hash = digest(content)
    backup = _recovery_point(path, content) if limit else None
    if digest(read_bounded(path)) != current_hash:
        raise OSError("The save changed during opening. Reopen it; no edits were enabled.")
    source = Source(path, content, current_hash, limit, backup,
                    current_hash if backup else None, len(content) if backup else 0)
    source.retention_warning = _retain(source)
    return source


def prepare_backup_limit(source: Source, backup_limit: int) -> tuple[int, Path | None, str | None, int]:
    limit = _limit(backup_limit)
    content = read_bounded(source.path)
    if digest(content) != source.hash:
        raise OSError("The original changed outside the editor. Backup retention was not applied.")
    backup = _recovery_point(source.path, content) if limit else None
    if digest(read_bounded(source.path)) != source.hash:
        raise OSError("The original changed while preparing retention. No backups were pruned.")
    return limit, backup, source.hash if backup else None, len(content) if backup else 0


def apply_prepared_limit(source: Source, prepared: tuple[int, Path | None, str | None, int]) -> None:
    source.backup_limit, source.load_backup, source.load_hash, source.load_length = prepared
    source.retention_warning = _retain(source)


def set_backup_limit(source: Source, backup_limit: int) -> None:
    apply_prepared_limit(source, prepare_backup_limit(source, backup_limit))


def save_source(source: Source, changes: dict, *, confirmed: bool, autosave: bool,
                backup_limit: int) -> dict:
    if not confirmed:
        return {"canceled": True}
    limit = _limit(backup_limit)
    if limit != source.backup_limit:
        raise OSError("The backup policy changed. Apply the current limit before saving.")
    if autosave and source.retention_warning:
        raise OSError("Autosave paused: backup cleanup is incomplete.")
    original = read_bounded(source.path)
    if digest(original) != source.hash:
        raise OSError("The original changed outside the editor. Nothing was written.")
    edited = serialize_document(original.decode("utf-8"), changes).encode("utf-8")
    if len(edited) > 20 * 1024 * 1024:
        raise ValueError("Edited save exceeds the 20 MiB limit.")
    valid = _verified(source.load_backup, source.load_length, source.load_hash)
    if autosave and limit and not valid:
        raise OSError("Autosave stopped: the verified recovery point is missing or changed.")
    backup = (None if limit == 0 else source.load_backup
              if valid and (autosave or source.hash == source.load_hash)
              else _recovery_point(source.path, original))
    if backup is not None and backup != source.load_backup:
        source.load_backup, source.load_hash, source.load_length = backup, source.hash, len(original)
    temporary = source.path.parent / f".apocalypter-{uuid.uuid4().hex}.tmp"
    created = False
    try:
        protection = hold_unchanged(backup, fingerprint(backup)) if backup is not None else nullcontext()
        with protection:
            if backup is not None and not _verified(backup, source.load_length, source.load_hash):
                raise OSError("The verified recovery point changed. Replacement was canceled.")
            with temporary.open("xb") as stream:
                created = True
                stream.write(edited)
                stream.flush()
                os.fsync(stream.fileno())
            if digest(read_bounded(source.path)) != source.hash:
                raise OSError("The original changed while preparing the save. Replacement was canceled.")
            replace_file(temporary, source.path)
            source.hash = digest(edited)
            source.content = edited
    except OSError as exc:
        recovery = f"Backup retained at {backup}." if backup else "Backups are disabled; no recovery copy was created."
        raise OSError(f"Could not replace the save. {recovery}") from exc
    finally:
        if created and temporary.exists():
            temporary.unlink()
    source.retention_warning = _retain(source)
    return {"canceled": False, "saved": True, "backupPath": backup,
            "backupLimit": limit, "retentionWarning": source.retention_warning}
