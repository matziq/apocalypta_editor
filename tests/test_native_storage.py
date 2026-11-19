import os
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from native_storage import _retain, open_source, save_source, set_backup_limit, update_slot_timestamp
from storage_primitives import list_backups

SAVE = b'{"FOV":{"__type":"float","value":60},"peacefulMode":{"__type":"bool","value":false}}'
SLOT_SETTINGS = (
    b'\xef\xbb\xbf{\r\n "saveTime1" : {"__type":"string","value":"01\\/02\\/2025 03:04"},\r\n'
    b' "saveTime10":{"__type":"string","value":"05\\/06\\/2025 07:08"},\r\n'
    b' "unknown":"caf\xc3\xa9", "FOV":{"__type":"float","value":60}\r\n}\r\n'
)


class NativeStorageTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "SaveGame1.es3"
        self.path.write_bytes(SAVE)

    def historical_backup(self, index):
        path = self.path.with_name(
            f"{self.path.name}.20200101T0000{index:02}000Z.{uuid4().hex}.original.bak"
        )
        path.write_bytes(SAVE + b" " * (index + 1))
        return path

    def test_open_manual_save_autosave_and_limit_one_rotation(self):
        source = open_source(self.path, 1)
        recovery = source.load_backup
        self.assertEqual(recovery.read_bytes(), SAVE)
        self.assertEqual(open_source(self.path, 1).load_backup, recovery)
        save_source(source, {"FOV": 70}, confirmed=True, autosave=False, backup_limit=1)
        first = self.path.read_bytes()
        self.assertEqual(recovery.read_bytes(), SAVE)
        save_source(source, {"FOV": 80}, confirmed=True, autosave=True, backup_limit=1)
        second = self.path.read_bytes()
        self.assertEqual(recovery.read_bytes(), SAVE)
        self.assertNotEqual(first, second)
        save_source(source, {"FOV": 90}, confirmed=True, autosave=False, backup_limit=1)
        self.assertEqual(source.load_backup.read_bytes(), second)
        self.assertEqual(len(list_backups(self.path)), 1)
        self.assertFalse(recovery.exists())

    def test_slot_date_uses_local_file_time_and_only_replaces_the_matching_value(self):
        settings = self.path.with_name("SaveSettings.es3")
        for name, old in (("SaveGame1.es3", b"01\\/02\\/2025 03:04"),
                          ("SaveGame10.es3", b"05\\/06\\/2025 07:08")):
            with self.subTest(name=name):
                slot = self.path.with_name(name)
                slot.write_bytes(SAVE)
                settings.write_bytes(SLOT_SETTINGS)
                stamp = datetime(2026, 11, 19, 5, 50, 40).timestamp()
                os.utime(slot, (stamp, stamp))
                self.assertEqual(update_slot_timestamp(slot, 3), "")
                self.assertEqual(settings.read_bytes(), SLOT_SETTINGS.replace(old, b"19\\/11\\/2026 05:50"))
                self.assertTrue(any(backup.read_bytes() == SLOT_SETTINGS for backup, _, _ in list_backups(settings)))
                self.assertEqual(slot.read_bytes(), SAVE)

    def test_slot_save_and_autosave_update_settings_without_editing_other_keys(self):
        settings = self.path.with_name("SaveSettings.es3")
        previous = datetime(2025, 2, 1, 3, 4).timestamp()
        os.utime(self.path, (previous, previous))
        source = open_source(self.path, 3)
        for automatic, fov in ((False, 70), (True, 80)):
            with self.subTest(automatic=automatic):
                settings.write_bytes(SLOT_SETTINGS)
                result = save_source(source, {"FOV": fov}, confirmed=True, autosave=automatic, backup_limit=3)
                self.assertTrue(result["saved"])
                self.assertEqual(result["slotDateWarning"], "")
                local = datetime.fromtimestamp(self.path.stat().st_mtime_ns // 1_000_000_000)
                self.assertGreater(local, datetime.fromtimestamp(previous))
                expected = local.strftime("%d/%m/%Y %H:%M").replace("/", r"\/").encode()
                self.assertEqual(settings.read_bytes(), SLOT_SETTINGS.replace(b"01\\/02\\/2025 03:04", expected))

    def test_slot_date_failure_is_nonfatal_and_does_not_create_or_edit_settings(self):
        settings = self.path.with_name("SaveSettings.es3")
        source = open_source(self.path, 3)
        for index, content in enumerate((None, SAVE, b"{broken",
                                        b'{"saveTime1":{"__type":"string""old","value":"other"}}')):
            with self.subTest(content=content):
                if content is not None:
                    settings.write_bytes(content)
                result = save_source(source, {"FOV": 70 + index}, confirmed=True,
                                     autosave=False, backup_limit=3)
                self.assertTrue(result["saved"])
                self.assertIn("Load-menu date not updated:", result["slotDateWarning"])
                if content is None:
                    self.assertFalse(settings.exists())
                else:
                    self.assertEqual(settings.read_bytes(), content)
                self.assertEqual(list_backups(settings), [])

    def test_saving_settings_does_not_change_slot_dates(self):
        settings = self.path.with_name("SaveSettings.es3")
        settings.write_bytes(SLOT_SETTINGS)
        source = open_source(settings, 3)
        result = save_source(source, {"FOV": 70}, confirmed=True, autosave=False, backup_limit=3)
        self.assertEqual(result["slotDateWarning"], "")
        self.assertEqual(settings.read_bytes(), SLOT_SETTINGS.replace(b'"value":60', b'"value":70'))

    def test_zero_disables_backups_and_cancel_does_not_save(self):
        source = open_source(self.path, 3)
        set_backup_limit(source, 0)
        self.assertEqual(list_backups(self.path), [])
        self.assertEqual(save_source(source, {"FOV": 70}, confirmed=False, autosave=False, backup_limit=0),
                         {"canceled": True})
        self.assertEqual(self.path.read_bytes(), SAVE)
        save_source(source, {"FOV": 70}, confirmed=True, autosave=False, backup_limit=0)
        self.assertNotEqual(self.path.read_bytes(), SAVE)
        self.assertEqual(list_backups(self.path), [])

    def test_external_change_invalid_edit_and_stale_policy_never_replace(self):
        source = open_source(self.path, 3)
        for changes, limit in (({"FOV": 121}, 3), ({"FOV": 70}, 2)):
            with self.subTest(changes=changes, limit=limit), self.assertRaises((ValueError, OSError)):
                save_source(source, changes, confirmed=True, autosave=False, backup_limit=limit)
            self.assertEqual(self.path.read_bytes(), SAVE)
        external = SAVE.replace(b"60", b"61")
        self.path.write_bytes(external)
        with self.assertRaisesRegex(OSError, "changed outside"):
            save_source(source, {"FOV": 70}, confirmed=True, autosave=False, backup_limit=3)
        self.assertEqual(self.path.read_bytes(), external)

    def test_missing_autosave_recovery_point_blocks_write(self):
        source = open_source(self.path, 3)
        source.load_backup.unlink()
        with self.assertRaisesRegex(OSError, "recovery point"):
            save_source(source, {"FOV": 70}, confirmed=True, autosave=True, backup_limit=3)
        self.assertEqual(self.path.read_bytes(), SAVE)

    def test_failed_replace_retains_backup_and_cleans_temporary(self):
        source = open_source(self.path, 3)
        with patch("native_storage.replace_file", side_effect=OSError("synthetic failure")):
            with self.assertRaisesRegex(OSError, "Backup retained"):
                save_source(source, {"FOV": 70}, confirmed=True, autosave=False, backup_limit=3)
        self.assertEqual(self.path.read_bytes(), SAVE)
        self.assertEqual(source.load_backup.read_bytes(), SAVE)
        self.assertEqual(list(self.path.parent.glob(".apocalypter-*.tmp")), [])

    def test_backup_creation_failure_blocks_open_and_manual_overwrite(self):
        with patch("native_storage.create_verified_backup", side_effect=OSError("synthetic backup failure")):
            with self.assertRaisesRegex(OSError, "backup failure"):
                open_source(self.path, 3)
        self.assertEqual(self.path.read_bytes(), SAVE)
        source = open_source(self.path, 3)
        save_source(source, {"FOV": 70}, confirmed=True, autosave=False, backup_limit=3)
        prior = self.path.read_bytes()
        with patch("native_storage.create_verified_backup", side_effect=OSError("synthetic backup failure")):
            with self.assertRaisesRegex(OSError, "backup failure"):
                save_source(source, {"FOV": 80}, confirmed=True, autosave=False, backup_limit=3)
        self.assertEqual(self.path.read_bytes(), prior)
        self.assertEqual(source.content, prior)
        self.assertEqual(source.load_backup.read_bytes(), SAVE)

    def test_cleanup_warning_after_commit_does_not_report_save_failure(self):
        source = open_source(self.path, 3)
        with patch("native_storage._retain", return_value="synthetic cleanup warning"):
            result = save_source(source, {"FOV": 70}, confirmed=True, autosave=False, backup_limit=3)
        self.assertTrue(result["saved"])
        self.assertEqual(result["retentionWarning"], "synthetic cleanup warning")
        self.assertEqual(source.content, self.path.read_bytes())
        with self.assertRaisesRegex(OSError, "cleanup"):
            save_source(source, {"FOV": 80}, confirmed=True, autosave=True, backup_limit=3)

    def test_retention_limits_keep_recovery_and_newest_eligible(self):
        for limit in (0, 1, 2, 5):
            with self.subTest(limit=limit):
                path = self.path.with_name(f"slot-{limit}.es3")
                path.write_bytes(SAVE)
                self.path = path
                old = [self.historical_backup(i) for i in range(8)]
                source = open_source(path, limit)
                self.assertEqual(len(list_backups(path)), limit)
                self.assertEqual(path.read_bytes(), SAVE)
                if limit:
                    self.assertTrue(source.load_backup.exists())
                    self.assertTrue(all(entry.exists() for entry in old[9 - limit:]))

    def test_invalid_file_does_not_prune_existing_backups(self):
        backup = self.historical_backup(0)
        self.path.write_bytes(b"not an ES3 save")
        for limit in (0, 1, 3):
            with self.subTest(limit=limit), self.assertRaises(ValueError):
                open_source(self.path, limit)
            self.assertTrue(backup.exists())

    def test_partial_cleanup_reports_failure_and_can_retry(self):
        source = open_source(self.path, 1)
        backups = [self.historical_backup(i) for i in range(4)]
        from windows_file_safety import delete_unchanged

        def selective_delete(path, identity):
            if path == backups[1]:
                raise OSError("one locked backup")
            return delete_unchanged(path, identity)

        with patch("native_storage.delete_unchanged", side_effect=selective_delete):
            warning = _retain(source)
        self.assertIn("one locked backup", warning)
        self.assertEqual(len(list_backups(self.path)), 2)
        self.assertTrue(source.load_backup.exists())
        self.assertTrue(backups[1].exists())
        self.assertEqual(_retain(source), "")
        self.assertEqual(len(list_backups(self.path)), 1)

    def test_unrelated_names_and_hardlinks_are_never_pruned(self):
        unrelated = self.path.with_name(self.path.name + ".original.bak")
        unrelated.write_bytes(b"unrelated")
        other = self.path.with_name("other.es3")
        other.write_bytes(b"other")
        link = self.path.with_name(
            f"{self.path.name}.20200101T000000000Z.{uuid4().hex}.original.bak"
        )
        link.hardlink_to(other)
        self.historical_backup(1)
        open_source(self.path, 0)
        self.assertTrue(unrelated.exists())
        self.assertEqual(other.read_bytes(), b"other")
        self.assertEqual(link.read_bytes(), b"other")
        self.assertEqual(list_backups(self.path), [])


if __name__ == "__main__":
    unittest.main()
