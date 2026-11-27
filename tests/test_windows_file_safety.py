import os
import tempfile
import threading
import unittest
from pathlib import Path

from windows_file_safety import delete_unchanged, fingerprint, hold_unchanged, policy_lock, replace_file


class WindowsFileSafetyTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def test_only_unchanged_single_link_entry_is_deleted(self):
        backup = self.root / "backup"
        backup.write_bytes(b"old")
        identity = fingerprint(backup)
        self.assertIsNotNone(identity)
        backup.write_bytes(b"changed")
        with self.assertRaises(OSError):
            delete_unchanged(backup, identity)
        self.assertEqual(backup.read_bytes(), b"changed")
        delete_unchanged(backup, fingerprint(backup))
        self.assertFalse(backup.exists())

    def test_hardlinked_backup_is_not_eligible(self):
        original = self.root / "original"
        link = self.root / "link"
        original.write_bytes(b"content")
        os.link(original, link)
        self.assertIsNone(fingerprint(link))
        with self.assertRaises(OSError):
            delete_unchanged(link, None)
        self.assertEqual(original.read_bytes(), b"content")
        self.assertTrue(link.exists())

    def test_protected_backup_cannot_be_modified_or_removed(self):
        backup = self.root / "backup"
        backup.write_bytes(b"recovery")
        with hold_unchanged(backup, fingerprint(backup)):
            self.assertEqual(backup.read_bytes(), b"recovery")
            with self.assertRaises(OSError):
                backup.write_bytes(b"changed")
            with self.assertRaises(OSError):
                backup.unlink()
        self.assertEqual(backup.read_bytes(), b"recovery")

    def test_atomic_replacement_requires_existing_destination(self):
        destination = self.root / "destination"
        temporary = self.root / "temporary"
        destination.write_bytes(b"before")
        temporary.write_bytes(b"after")
        replace_file(temporary, destination)
        self.assertEqual(destination.read_bytes(), b"after")
        self.assertFalse(temporary.exists())
        temporary.write_bytes(b"other")
        with self.assertRaises(OSError):
            replace_file(temporary, self.root / "absent")
        self.assertEqual(temporary.read_bytes(), b"other")

    def test_policy_mutex_serializes_concurrent_editor_sessions(self):
        settings = self.root / "settings.json"
        ready = threading.Event()
        release = threading.Event()
        errors = []

        def holder():
            try:
                with policy_lock(settings):
                    ready.set()
                    if not release.wait(5):
                        raise TimeoutError("Test did not release its mutex holder.")
            except Exception as exc:
                errors.append(exc)
                ready.set()

        thread = threading.Thread(target=holder)
        thread.start()
        try:
            self.assertTrue(ready.wait(5))
            self.assertFalse(errors)
            with self.assertRaises(TimeoutError):
                with policy_lock(settings, timeout_ms=50):
                    self.fail("Concurrent lock should have timed out.")
        finally:
            release.set()
            thread.join(5)
        self.assertFalse(thread.is_alive())
        self.assertEqual(errors, [])
        with policy_lock(settings):
            pass


if __name__ == "__main__":
    unittest.main()
