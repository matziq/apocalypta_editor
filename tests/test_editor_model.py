import json
import unittest

from editor_model import EditorModel
from test_es3_items import fixture
from test_es3_scalars import GAME


class EditorModelTests(unittest.TestCase):
    def test_invalid_draft_is_preserved_and_prevents_all_changes(self):
        model = EditorModel(GAME.encode("utf-8"))
        model.stage("Player.Health", "broken")
        model.stage("Ammo.ammo_9mm", "100")
        result = model.maximize_player({"ammo": 999, "consumables": 999, "nuts": 900000, "liquids": 100})
        self.assertIn("Health", result["skipped"])
        self.assertEqual(model.drafts["Player.Health"], "broken")
        self.assertEqual(model.drafts["Ammo.ammo_9mm"], "999")
        with self.assertRaisesRegex(ValueError, "Health"):
            model.changes()
        model.stage("Player.Health", "80")
        self.assertEqual(model.changes()["Ammo.ammo_9mm"], 999)

    def test_items_maximize_skips_unverified_and_does_not_change_source(self):
        text = fixture()
        model = EditorModel(text.encode("utf-8"))
        result = model.maximize_items({"ammo": 321, "consumables": 555, "nuts": 12345, "liquids": 50})
        self.assertGreater(result["staged"], 0)
        changes = model.changes()
        self.assertEqual(changes["item:r1:0:Quantity"], 555)
        self.assertEqual(changes["item:r2:1:ammo"], 321)
        self.assertEqual(changes["item:r4:3:Liquid"], 3)
        self.assertEqual(model.content, text.encode("utf-8"))

    def test_boolean_and_numeric_validation(self):
        model = EditorModel(json.dumps({
            "peacefulMode": {"__type": "bool", "value": False},
            "FOV": {"__type": "float", "value": 60},
        }).encode())
        model.stage("peacefulMode", True)
        model.stage("FOV", "120.1")
        with self.assertRaisesRegex(ValueError, "Field of view"):
            model.changes()
        model.stage("FOV", "90.5")
        self.assertEqual(model.changes(), {"peacefulMode": True, "FOV": 90.5})


if __name__ == "__main__":
    unittest.main()
