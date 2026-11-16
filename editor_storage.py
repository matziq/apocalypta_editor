"""Coordinated native save and backup-policy operations."""

from __future__ import annotations

from pathlib import Path

import preferences
from native_storage import (
    Source, _retain, apply_prepared_limit, open_source, prepare_backup_limit, save_source,
)
from storage_primitives import digest, read_bounded
from windows_file_safety import policy_lock


class EditorStorage:
    def __init__(self, settings_path: Path, legacy_dir: Path | None = None):
        self.settings_path = settings_path
        self.legacy_dir = legacy_dir
        self.source: Source | None = None

    def settings(self) -> dict:
        return preferences.load(self.settings_path, self.legacy_dir)

    def update_settings(self, updates: dict) -> dict:
        if "backupLimit" in updates:
            raise ValueError("Use the backup-policy operation to change retention.")
        with policy_lock(self.settings_path):
            settings = preferences.validate({**self.settings(), **updates})
            preferences.save(self.settings_path, settings)
            return settings

    def open(self, path: Path) -> Source:
        with policy_lock(self.settings_path):
            settings = self.settings()
            opened = open_source(path, settings["backupLimit"])
            self.source = opened
            return opened

    def apply_backup_limit(self, limit: int) -> str:
        with policy_lock(self.settings_path):
            settings = self.settings()
            candidate = {**settings, "backupLimit": limit}
            checked = preferences.validate(candidate)
            prepared = prepare_backup_limit(self.source, limit) if self.source is not None else None
            preferences.save(self.settings_path, checked)
            if self.source is not None:
                apply_prepared_limit(self.source, prepared)
                return self.source.retention_warning
            return ""

    def prune_now(self) -> str:
        if self.source is None:
            raise ValueError("Open a save before pruning backups.")
        with policy_lock(self.settings_path):
            current = self.settings()["backupLimit"]
            if current != self.source.backup_limit:
                raise OSError("Backup policy changed in another editor. Apply the current limit first.")
            if digest(read_bounded(self.source.path)) != self.source.hash:
                raise OSError("The original changed outside the editor. Backups were not pruned.")
            self.source.retention_warning = _retain(self.source)
            return self.source.retention_warning

    def save(self, changes: dict, *, confirmed: bool, autosave: bool = False) -> dict:
        if not confirmed:
            return {"canceled": True}
        if self.source is None:
            raise ValueError("Open a save before saving.")
        with policy_lock(self.settings_path):
            current = self.settings()["backupLimit"]
            return save_source(self.source, changes, confirmed=True, autosave=autosave, backup_limit=current)
