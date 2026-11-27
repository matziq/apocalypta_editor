import tempfile
import unittest
from pathlib import Path

from es3_parser import MAX_BYTES
from storage_primitives import create_verified_backup, digest, list_backups, read_bounded


class StoragePrimitiveTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def test_backup_is_verified_exact_and_unique(self):
        source = self.root / "SaveGame1.es3"
        source.write_bytes(b"\xef\xbb\xbf{\r\n}")
        data = read_bounded(source)
        first = create_verified_backup(source, data)
        second = create_verified_backup(source, data)
        self.assertNotEqual(first, second)
        self.assertRegex(first.name, r"^SaveGame1\.es3\.\d{8}T\d{9}Z\.[a-f0-9]{32}\.original\.bak$")
        self.assertEqual(read_bounded(first), data)
        self.assertEqual(read_bounded(second), data)
        self.assertEqual(digest(data), digest(source.read_bytes()))

    def test_oversize_file_and_backup_are_refused(self):
        source = self.root / "SaveGame1.es3"
        with source.open("wb") as stream:
            stream.truncate(MAX_BYTES + 1)
        with self.assertRaisesRegex(ValueError, "20 MiB"):
            read_bounded(source)
        with self.assertRaisesRegex(ValueError, "20 MiB"):
            create_verified_backup(source, b"x" * (MAX_BYTES + 1))
        self.assertEqual(list(self.root.iterdir()), [source])

    def test_backup_discovery_excludes_unrelated_names_and_invalid_dates(self):
        source = self.root / "SaveGame1.es3"
        source.write_bytes(b"{}")
        created = create_verified_backup(source, b"{}")
        (self.root / "SaveGame1.es3.20261301T000000000Z.0123456789abcdef0123456789abcdef.original.bak").write_bytes(b"{}")
        (self.root / "SaveGame2.es3.20260101T000000000Z.0123456789abcdef0123456789abcdef.original.bak").write_bytes(b"{}")
        (self.root / "SaveGame1.es3.original.bak").write_bytes(b"{}")
        self.assertEqual([entry[0] for entry in list_backups(source)], [created])


if __name__ == "__main__":
    unittest.main()
