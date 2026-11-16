import unittest

from bulk_actions import all_vehicles, checked_targets, maximize_items, maximize_player, stage_vehicle, top_off_consumables
from oracle_support import javascript_result


class BulkTests(unittest.TestCase):
    def test_targets_validate_before_any_staging(self):
        target = {"ammo": 1.0, "consumables": 1, "nuts": 0, "liquids": 50}
        self.assertEqual(checked_targets(target)["ammo"], 1)
        writes = []
        for bad in (-1, 1.5, True, float("inf")):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                maximize_player([], lambda f: {}, lambda f, value: writes.append(value),
                                lambda f, value: None, {**target, "ammo": bad})
        self.assertEqual(writes, [])

    def test_selected_vehicle_skips_invalid_drafts_and_trailer_fuel(self):
        fields = [
            {"id": "car:fuel", "max": 21},
            {"id": "car:Condition", "max": 100},
            {"id": "trailer:fuel", "max": 20},
        ]
        drafts = {"car:fuel": {"value": 4, "invalid": False},
                  "car:Condition": {"value": "bad", "invalid": True},
                  "trailer:fuel": {"value": 5, "invalid": False}}
        writes = []
        targets = {"ammo": 999, "consumables": 999, "nuts": 900000, "liquids": 50}
        read = lambda field: drafts[field["id"]]
        write = lambda field, value: writes.append((field["id"], value))
        validate = lambda field, value: self.assertLessEqual(value, field["max"])
        car = {"name": "Car", "fieldIds": ["car:fuel", "car:Condition"]}
        self.assertEqual(stage_vehicle(car, fields, "repair", read, write, validate, targets),
                         {"staged": 0, "skippedInvalid": 1})
        self.assertEqual(stage_vehicle(car, fields, "topoff", read, write, validate, targets),
                         {"staged": 1, "skippedInvalid": 0})
        trailer = {"name": "TRAILER", "fieldIds": ["trailer:fuel"]}
        self.assertEqual(stage_vehicle(trailer, fields, "topoff", read, write, validate, targets),
                         {"staged": 0, "skippedInvalid": 0})
        self.assertEqual(writes, [("car:fuel", 10.5)])

    def test_item_maximization_deduplicates_and_preserves_invalid_drafts(self):
        fields = [
            {"id": "part:Condition", "max": 100},
            {"id": "can:Liquid", "max": 5},
            {"id": "part:Quantity", "max": 2147483647},
            {"id": "weaponsAmmoInGun.ammoakms", "max": 2147483647, "topOffConsumable": True},
            {"id": "other:Condition", "max": 100},
        ]
        items = [{"fieldIds": ["part:Condition", "can:Liquid", "part:Quantity"], "readOnlyFields": [{}]},
                 {"fieldIds": ["part:Condition", "other:Condition"], "readOnlyFields": []}]
        drafts = {"part:Condition": {"value": 95, "invalid": True},
                  "can:Liquid": {"value": 2, "invalid": False},
                  "part:Quantity": {"value": 2, "invalid": False},
                  "weaponsAmmoInGun.ammoakms": {"value": 200, "invalid": False},
                  "other:Condition": {"value": 25, "invalid": False}}
        writes = []
        result = maximize_items(items, fields, lambda field: drafts[field["id"]],
                                lambda field, value: writes.append((field["id"], value)),
                                lambda field, value: None,
                                {"ammo": 999, "consumables": 999, "nuts": 900000, "liquids": 100})
        self.assertEqual(result, {"staged": 3, "skippedUnverified": 1, "skippedInvalid": 1, "readOnly": 1})
        self.assertEqual(writes, [("can:Liquid", 5), ("weaponsAmmoInGun.ammoakms", 999), ("other:Condition", 100)])

    def test_all_vehicles_skips_invalid_missing_and_trailer_targets(self):
        fields = [
            {"id": "car-1:fuel", "max": 21},
            {"id": "car-1:Condition", "max": 100},
            {"id": "car-2:Condition", "max": 100},
            {"id": "trailer:fuel", "max": 20},
            {"id": "Player.Health", "max": 100},
        ]
        drafts = {
            "car-1:fuel": {"value": 18.4, "invalid": False},
            "car-1:Condition": {"value": "invalid", "invalid": True},
            "car-2:Condition": {"value": 60, "invalid": False},
            "trailer:fuel": {"value": 5, "invalid": False},
            "Player.Health": {"value": "unrelated", "invalid": True},
        }
        vehicles = [
            {"name": "Car", "fieldIds": ["car-1:fuel", "car-1:Condition", "Player.Health"]},
            {"name": "Car", "fieldIds": ["car-2:Condition"]},
            {"name": "Other", "fieldIds": []},
            {"name": "Trailer", "fieldIds": ["trailer:fuel"]},
        ]
        writes = []
        targets = {"ammo": 999, "consumables": 999, "nuts": 900000, "liquids": 100}
        result = all_vehicles(vehicles, fields, lambda field: drafts[field["id"]],
                              lambda field, value: writes.append((field["id"], value)),
                              lambda field, value: self.assertLessEqual(value, field["max"]), targets)
        self.assertEqual(writes, [("car-1:fuel", 21), ("car-2:Condition", 100)])
        self.assertEqual(result, {"staged": 2, "skippedInvalid": 1, "missingRepair": 2, "missingFuel": 2})
        self.assertTrue(drafts["Player.Health"]["invalid"])

    def test_bulk_actions_match_javascript_on_synthetic_records(self):
        fields = [
            {"id": "Player.Health", "section": "player", "label": "Health", "value": 20, "max": 100},
            {"id": "Ammo.armor", "section": "player", "label": "Armor", "value": 13, "max": 100},
            {"id": "Ammo.ammo_22caliber_capacity", "section": "player", "label": "22 capacity", "value": 22, "max": 2147483647, "topOffConsumable": True},
            {"id": "Ammo.ammo_battery_capacity", "section": "player", "label": "Battery capacity", "value": 10, "max": 2147483647},
            {"id": "global.Money", "section": "player", "label": "Nuts", "value": 100, "max": 1000000},
            {"id": "global.Hunger", "section": "player", "label": "Hunger", "value": 25, "max": 100},
            {"id": "item:1:Quantity", "section": "items", "label": "Bandage", "value": 3, "max": 2147483647, "topOffConsumable": True},
            {"id": "item:2:ammo", "section": "items", "label": "Ammo", "value": 10, "max": 2147483647, "topOffConsumable": True},
            {"id": "item:3:Liquid", "section": "items", "label": "Liquid", "value": 2, "max": 13},
            {"id": "item:4:Condition", "section": "items", "label": "Condition", "value": 30, "max": 100},
            {"id": "vehicle:1:fuel", "section": "vehicles", "label": "Fuel", "value": 2, "max": 20},
            {"id": "vehicle:1:Condition", "section": "vehicles", "label": "Engine", "value": 50, "max": 100},
            {"id": "vehicle:2:fuel", "section": "vehicles", "label": "Trailer", "value": 2, "max": 20},
        ]
        vehicles = [
            {"name": "Car", "fieldIds": ["vehicle:1:fuel", "vehicle:1:Condition"]},
            {"name": "Trailer", "fieldIds": ["vehicle:2:fuel"]},
        ]
        items = [{"fieldIds": ["item:1:Quantity", "item:2:ammo", "item:3:Liquid", "item:4:Condition"],
                  "readOnlyFields": [{"name": "unknown"}]}]
        targets = {"ammo": 777, "consumables": 555, "nuts": 12345, "liquids": 50}
        expected = javascript_result(self._testMethodName)

        def run(action):
            writes = {}
            def read(field):
                return {"invalid": False, "value": field["value"]}
            def write(field, value):
                writes[field["id"]] = value
            def validate(field, value):
                if value < 0 or value > field["max"]:
                    raise ValueError("range")
            return {"result": action(read, write, validate), "writes": writes}

        actual = {
            "player": run(lambda r, w, v: maximize_player(fields, r, w, v, targets)),
            "consumables": run(lambda r, w, v: top_off_consumables(fields, r, w, v, targets)),
            "vehicles": run(lambda r, w, v: all_vehicles(vehicles, fields, r, w, v, targets)),
            "items": run(lambda r, w, v: maximize_items(items, fields, r, w, v, targets)),
        }
        self.assertEqual(actual, expected)
        self.assertNotIn("Ammo.armor", actual["player"]["writes"])
        self.assertNotIn("Ammo.ammo_battery_capacity", actual["player"]["writes"])
        self.assertNotIn("vehicle:2:fuel", actual["vehicles"]["writes"])


if __name__ == "__main__":
    unittest.main()
