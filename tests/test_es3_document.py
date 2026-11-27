import json
import unittest

from es3_document import inspect_document, serialize_document
from oracle_support import javascript_result
from test_es3_items import fixture


class DocumentTests(unittest.TestCase):
    def test_only_readonly_global_is_supported_without_editing(self):
        text = '{"global":{"__type":"ES3PlayMaker.PMDataWrapper,Assembly-CSharp-firstpass","value":{"objs":{"Sanity":{"__type":"float","value":-5}}}}}'
        document = inspect_document(text)
        self.assertEqual([field.id for field in document.readonly], ["global.Sanity"])
        self.assertEqual(serialize_document(text, {}), text)
        with self.assertRaises(ValueError):
            serialize_document(text, {"global.Sanity": 0})

    def test_synthetic_item_and_weapon_edits_match_javascript_bytes(self):
        root = json.loads(fixture())
        root["weaponsAmmoInGun"] = {
            "__type": "ES3PlayMaker.PMDataWrapper,Assembly-CSharp-firstpass",
            "value": {"objs": {"ammoslamberg500": {"__type": "int", "value": 2}}},
        }
        text = json.dumps(root, indent=1) + "\r\n"
        document = inspect_document(text)
        by_id = {field.id: field for field in document.fields}
        changes = {
            next(identifier for identifier in by_id if identifier.endswith(":Quantity")): 999,
            next(identifier for identifier in by_id if identifier.endswith(":Liquid")): 3,
            next(identifier for identifier in by_id if identifier.endswith(":Condition")): 100,
            "weaponsAmmoInGun.ammoslamberg500": 999,
        }
        self.assertTrue(by_id["weaponsAmmoInGun.ammoslamberg500"].top_off)
        self.assertEqual(serialize_document(text, changes).encode("utf-8"),
                         javascript_result(self._testMethodName).encode("utf-8"))
        with self.assertRaises(ValueError):
            serialize_document(text, {"unknown": 1})


if __name__ == "__main__":
    unittest.main()
