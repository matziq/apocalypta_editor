import json
import unittest

from es3_items import inspect_items
from es3_parser import parse
from es3_world import WorldTransforms
from oracle_support import javascript_result

WRAPPER = "ES3PlayMaker.PMDataWrapper,Assembly-CSharp-firstpass"


def wrapper(value):
    return {"__type": WRAPPER, "value": value}


def fixture():
    definitions = [
        ("bandage_1(Clone)1", "r1", "688495819279421776",
         {"Quantity": {"__type": "int", "value": 7}}),
        ("ammo_box_12gauge(Clone)2", "r2", "8519476287603981168",
         {"ammo": {"__type": "int", "value": 14}}),
        ("flashlight_batteries(Clone)3", "r3", "6027655925999442117",
         {"batteries": {"__type": "string", "value": "bad"}}),
        ("radiator_small(Clone)4", "r4", "5669857674379848146",
         {"Liquid": {"__type": "float", "value": 2}, "Condition": {"__type": "float", "value": 50}}),
        ("mystery(Clone)5", "r5", "688495819279421776",
         {"Quantity": {"__type": "int", "value": 5}}),
    ]
    objects = []
    root = {"Player": wrapper({"objs": {"Health": {"__type": "float", "value": 100}}})}
    for index, (name, ref, prefab, values) in enumerate(definitions):
        transform = f"t{index}"
        owner = {"__type": "GameObject", "_ES3Ref": ref, "transformID": transform,
                 "name": name, "es3Prefab": {"prefabId": prefab},
                 "components": [{"__type": "Transform", "_ES3Ref": transform, "goID": ref,
                                 "parent": None, "localPosition": {"x": 0, "y": 0, "z": 0}}]}
        objects.append(owner)
        root[name] = wrapper({"objs": {"owner": owner, **values}})
    wheel = {"__type": "GameObject", "_ES3Ref": "wheel-ref", "transformID": "wheel-transform",
             "name": "small_wheel_3(Clone)6", "es3Prefab": {"prefabId": "2321790605670812229"},
             "components": [{"__type": "Transform", "_ES3Ref": "wheel-transform", "goID": "wheel-ref",
                             "parent": None, "localPosition": {"x": 0, "y": 0, "z": 0}}]}
    objects.append(wheel)
    root[wheel["name"]] = {"__type": "System.Object", "value": {"__type": "float", "value": 55}}
    root["newGOArray_Items"] = wrapper({"array": objects})
    return json.dumps(root)


class ItemTests(unittest.TestCase):
    def test_partial_item_shapes_match_javascript_safely(self):
        source_root = json.loads(fixture())
        cases = []
        for key, field, value in (
            ("bandage_1(Clone)1", "Quantity", 0),
            ("bandage_1(Clone)1", "Quantity", 1.5),
            ("ammo_box_12gauge(Clone)2", "ammo", -1),
            ("radiator_small(Clone)4", "Condition", 101),
            ("radiator_small(Clone)4", "Liquid", 7),
        ):
            root = json.loads(json.dumps(source_root))
            root[key]["value"]["objs"][field]["value"] = value
            cases.append(json.dumps(root))
        unmatched = json.loads(json.dumps(source_root))
        unmatched["bandage_1(Clone)1"]["value"]["objs"]["owner"]["_ES3Ref"] = "different"
        cases.append(json.dumps(unmatched))
        duplicate = json.loads(json.dumps(source_root))
        duplicate["newGOArray_Items"]["value"]["array"][1]["_ES3Ref"] = "r1"
        cases.append(json.dumps(duplicate))

        for text, expected in zip(cases, javascript_result(self._testMethodName), strict=True):
            with self.subTest(case=cases.index(text)):
                tree = parse(text)
                items = inspect_items(tree, WorldTransforms(tree))
                fields = {entry.id: [entry.value, entry.minimum, entry.maximum, entry.top_off]
                          for item in items for entry in item.fields}
                self.assertEqual(fields, expected["fields"])
                self.assertEqual({item.id: item.readonly for item in items}, expected["readonly"])

    def test_verified_fields_match_js_and_bad_battery_is_readonly(self):
        text = fixture()
        tree = parse(text)
        items = inspect_items(tree, WorldTransforms(tree))
        actual = {
            entry.id: [entry.value, entry.minimum, entry.maximum, entry.top_off]
            for item in items for entry in item.fields
        }
        self.assertEqual(actual, javascript_result(self._testMethodName))
        self.assertEqual(len(items[2].fields), 0)
        self.assertTrue(items[2].warnings)
        self.assertFalse(items[4].fields[0].top_off)

    def test_out_of_range_ambiguous_values_remain_readonly(self):
        root = json.loads(fixture())
        text = json.dumps(root).replace(
            '"Quantity": {"__type": "int", "value": 7}',
            '"Quantity": {"__type": "int"0, "value": 7}',
        )
        tree = parse(text)
        item = inspect_items(tree, WorldTransforms(tree))[0]
        self.assertFalse(item.fields)
        self.assertEqual(item.readonly[0]["name"], "Quantity")
        self.assertEqual(javascript_result(self._testMethodName), [])

    def test_liquid_capacity_evidence_distinguishes_saved_and_prefab_limits(self):
        root = json.loads(fixture())
        tree = parse(json.dumps(root))
        item = inspect_items(tree, WorldTransforms(tree))[3]
        self.assertEqual(item.liquid_source, "verified prefab")
        root["radiator_small(Clone)4"]["value"]["objs"]["LiquidCapacity"] = {
            "__type": "float", "value": 4,
        }
        tree = parse(json.dumps(root))
        item = inspect_items(tree, WorldTransforms(tree))[3]
        self.assertEqual(item.liquid_source, "saved LiquidCapacity")
        self.assertEqual(next(field.maximum for field in item.fields if field.id.endswith(":Liquid")), 4)


if __name__ == "__main__":
    unittest.main()
