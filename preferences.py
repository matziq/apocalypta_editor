"""Validated native-editor preferences, independent of game save data."""

from __future__ import annotations

import json
import os
import sys
import uuid
from pathlib import Path

from bulk_actions import DEFAULT_TARGETS, checked_targets
from windows_file_safety import fingerprint, policy_lock, replace_file

THEMES = {"wasteland", "desert", "nuclear-winter", "apocalypse"}
THEME_MIGRATION = {"spring": "wasteland", "summer": "desert",
                   "winter": "nuclear-winter", "autumn": "apocalypse"}


def settings_path() -> Path:
    directory = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
    return directory / "editor_settings.json"


def defaults() -> dict:
    return {"version": 1, "backupLimit": 3, "targets": dict(DEFAULT_TARGETS),
            "fontSize": 100, "worldTheme": "wasteland", "dark": False, "autosave": False,
            "editableOnly": False}


def validate(value: object) -> dict:
    expected = {"version", "backupLimit", "targets", "fontSize", "worldTheme", "dark", "autosave", "editableOnly"}
    if (not isinstance(value, dict) or set(value) not in (expected, expected - {"editableOnly"})
            or type(value["version"]) is not int or value["version"] != 1):
        raise ValueError("Editor settings have an unsupported structure or version.")
    backup = value["backupLimit"]
    if type(backup) is not int or not 0 <= backup <= 9007199254740991:
        raise ValueError("Backup limit must be a whole number from 0 to 9007199254740991.")
    targets = value["targets"]
    if not isinstance(targets, dict) or set(targets) != set(DEFAULT_TARGETS):
        raise ValueError("Bulk targets require exactly ammo, consumables, nuts and liquids.")
    if any(type(value) is not int for value in targets.values()):
        raise ValueError("Bulk targets must be whole-number JSON integers.")
    checked_targets(targets)
    size = value["fontSize"]
    if type(size) is not int or not 80 <= size <= 140 or size % 10:
        raise ValueError("Text size must be 80 to 140 in steps of 10.")
    theme = value["worldTheme"]
    if not isinstance(theme, str):
        raise ValueError("World theme is invalid.")
    theme = THEME_MIGRATION.get(theme, theme)
    if theme not in THEMES:
        raise ValueError("World theme is invalid.")
    if type(value["dark"]) is not bool or type(value["autosave"]) is not bool:
        raise ValueError("Theme and autosave settings must be true or false.")
    editable_only = value.get("editableOnly", False)
    if type(editable_only) is not bool:
        raise ValueError("Editable-only filtering must be true or false.")
    return {**value, "worldTheme": theme, "targets": dict(targets), "editableOnly": editable_only}


def _read(path: Path) -> object:
    if fingerprint(path) is None:
        raise ValueError(f"Settings must be a regular single-link file: {path}")
    with path.open("rb") as stream:
        raw = stream.read(4097)
    if len(raw) > 4096:
        raise ValueError(f"Settings file is too large: {path}")

    def unique(pairs):
        result = {}
        for key, entry in pairs:
            if key in result:
                raise ValueError(f"Duplicate settings key: {key}")
            result[key] = entry
        return result

    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=unique)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"Malformed settings: {path}") from exc


def _exists(path: Path) -> bool:
    try:
        path.lstat()
    except FileNotFoundError:
        return False
    return True


def load(path: Path, legacy_dir: Path | None = None) -> dict:
    with policy_lock(path):
        return _load_locked(path, legacy_dir)


def _load_locked(path: Path, legacy_dir: Path | None = None) -> dict:
    if _exists(path):
        return validate(_read(path))
    result = defaults()
    if legacy_dir is not None:
        with policy_lock(legacy_dir / "settings.json"):
            _load_legacy(result, legacy_dir)
    return validate(result)


def _load_legacy(result: dict, legacy_dir: Path) -> None:
    for name, key, expected in (
        ("settings.json", "backupLimit", {"version", "backupLimit"}),
        ("font-size.json", "fontSize", {"fontSize"}),
        ("bulk-targets.json", "targets", set(DEFAULT_TARGETS)),
    ):
        legacy = legacy_dir / name
        if not _exists(legacy):
            continue
        value = _read(legacy)
        if not isinstance(value, dict) or set(value) != expected:
            raise ValueError(f"Legacy settings have an unsupported structure: {legacy}")
        if name == "settings.json":
            if type(value["version"]) is not int or value["version"] != 1:
                raise ValueError(f"Legacy settings have an unsupported version: {legacy}")
            result[key] = value[key]
        elif name == "bulk-targets.json":
            result[key] = value
        else:
            result[key] = value[key]


def save(path: Path, value: dict) -> None:
    checked = validate(value)
    with policy_lock(path):
        _save_locked(path, checked)


def _save_locked(path: Path, checked: dict) -> None:
    payload = json.dumps(checked, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.parent / f".apocalypter-preferences-{uuid.uuid4().hex}.tmp"
    created = False
    try:
        with temporary.open("xb") as stream:
            created = True
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        if _exists(path):
            if fingerprint(path) is None:
                raise ValueError("Editor settings cannot replace a link.")
            replace_file(temporary, path)
        else:
            temporary.rename(path)
    finally:
        if created and temporary.exists():
            temporary.unlink()
