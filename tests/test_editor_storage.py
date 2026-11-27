import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from editor_storage import EditorStorage
from storage_primitives import list_backups

SAVE = b'{"FOV":{"__type":"float","value":60}}'


class EditorStorageTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        root = Path(self.directory.name)
        self.path = root / "SaveGame1.es3"
        self.path.write_bytes(SAVE)
        self.settings = root / "editor_settings.json"

    def test_external_policy_change_blocks_stale_editor(self):
        first = EditorStorage(self.settings)
        second = EditorStorage(self.settings)
        first.open(self.path)
        second.open(self.path)
        first.apply_backup_limit(0)
        with self.assertRaisesRegex(OSError, "policy changed"):
            second.save({"FOV": 70}, confirmed=True)
        self.assertEqual(self.path.read_bytes(), SAVE)

    def test_failed_settings_write_does_not_prune_or_change_policy(self):
        editor = EditorStorage(self.settings)
        source = editor.open(self.path)
        backup = source.load_backup
        with patch("preferences.save", side_effect=OSError("cannot write settings")):
            with self.assertRaisesRegex(OSError, "settings"):
                editor.apply_backup_limit(0)
        self.assertEqual(source.backup_limit, 3)
        self.assertTrue(backup.exists())
        self.assertEqual(len(list_backups(self.path)), 1)

    def test_pruning_refuses_externally_changed_source(self):
        editor = EditorStorage(self.settings)
        editor.open(self.path)
        self.path.write_bytes(SAVE.replace(b"60", b"61"))
        with self.assertRaisesRegex(OSError, "changed outside"):
            editor.prune_now()
        self.assertEqual(len(list_backups(self.path)), 1)


if __name__ == "__main__":
    unittest.main()
