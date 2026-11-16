import json
import os
import tempfile
import unittest
from pathlib import Path

from preferences import defaults, load, save


class PreferenceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.path = self.root / "editor_settings.json"

    def test_roundtrip_and_legacy_migration(self):
        legacy = self.root / "legacy"
        legacy.mkdir()
        (legacy / "settings.json").write_text('{"version":1,"backupLimit":5}', encoding="utf-8")
        (legacy / "font-size.json").write_text('{"fontSize":80}', encoding="utf-8")
        (legacy / "bulk-targets.json").write_text(
            '{"ammo":888,"consumables":777,"nuts":42,"liquids":50}', encoding="utf-8")
        value = load(self.path, legacy)
        self.assertEqual(value["backupLimit"], 5)
        self.assertEqual(value["fontSize"], 80)
        self.assertEqual(value["targets"]["ammo"], 888)
        value["worldTheme"] = "winter"
        save(self.path, value)
        self.assertEqual(load(self.path)["worldTheme"], "nuclear-winter")
        self.assertEqual(load(self.path)["targets"], value["targets"])

    def test_invalid_or_duplicate_settings_are_explicit_errors(self):
        save(self.path, defaults())
        before = self.path.read_bytes()
        value = defaults()
        value["targets"]["ammo"] = -1
        with self.assertRaises(ValueError):
            save(self.path, value)
        self.assertEqual(self.path.read_bytes(), before)
        self.path.write_text('{"version":1,"version":1}', encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            load(self.path)

    def test_existing_settings_migrate_editable_filter_and_validate_it(self):
        old = defaults()
        del old["editableOnly"]
        self.path.write_text(json.dumps(old), encoding="utf-8")
        self.assertFalse(load(self.path)["editableOnly"])
        old["editableOnly"] = "yes"
        self.path.write_text(json.dumps(old), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "Editable-only"):
            load(self.path)

    def test_linked_settings_are_not_read_or_replaced(self):
        target = self.root / "target.json"
        target.write_text(json.dumps(defaults()), encoding="utf-8")
        os.link(target, self.path)
        with self.assertRaises(ValueError):
            load(self.path)
        with self.assertRaises(ValueError):
            save(self.path, defaults())
        self.assertTrue(target.exists())


if __name__ == "__main__":
    unittest.main()
