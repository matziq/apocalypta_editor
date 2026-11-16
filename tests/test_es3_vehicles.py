import json
import unittest

from es3_items import inspect_items
from es3_parser import parse
from es3_vehicles import inspect_vehicles
from es3_world import WorldTransforms
from oracle_support import javascript_result

WRAPPER = "ES3PlayMaker.PMDataWrapper,Assembly-CSharp-firstpass"


def wrapped(data):
    return {"__type": WRAPPER, "value": {"objs": data}}


def object_data(name, ref, transform, parent=None, prefab=None):
    obj = {"name": name, "_ES3Ref": ref, "transformID": transform, "__type": "GameObject",
           "components": [{"__type": "Transform", "_ES3Ref": transform, "goID": ref,
                           "parent": None if parent is None else {"_ES3Ref": parent},
                           "localPosition": {"x": 0, "y": 0, "z": 0}}]}
    if prefab:
        obj["es3Prefab"] = {"prefabId": prefab}
    return obj


def synthetic_vehicle_save():
    car = object_data("Car(Clone)1", "car", "ct")
    trailer = object_data("Trailer(Clone)2", "trailer", "tt")
    radiator = object_data("radiator_small(Clone)3", "part", "pt", "radiator-mount", "5669857674379848146")
    invalid = object_data("other(Clone)4", "other", "ot", "unknown")
    root = {
        "Player": wrapped({"Health": {"__type": "float", "value": 100}}),
        "newGOArray_Cars": {"value": {"array": [car, trailer]}},
        "newGOArray_Items": {"value": {"array": [radiator, invalid]}},
        car["name"]: wrapped({"owner": car, "hinge_radiator": {"transformID": "radiator-mount"},
                              "Liquid": {"__type": "float", "value": 2},
                              "LiquidCapacity": {"__type": "float", "value": 20}}),
        trailer["name"]: wrapped({"owner": trailer, "Liquid": {"__type": "float", "value": 2},
                                  "LiquidCapacity": {"__type": "float", "value": 20}}),
        radiator["name"]: wrapped({"owner": radiator, "Liquid": {"__type": "float", "value": 2},
                                   "Condition": {"__type": "float", "value": 40}}),
    }
    return json.dumps(root)


class VehicleTests(unittest.TestCase):
    def test_matched_mounts_and_trailer_fuel_match_js(self):
        text = synthetic_vehicle_save()
        tree = parse(text)
        world = WorldTransforms(tree)
        vehicles = inspect_vehicles(tree, world, inspect_items(tree, world))
        actual = {v.id: sorted(entry.id for entry in v.fields) for v in vehicles}
        self.assertEqual(actual, javascript_result(self._testMethodName))
        self.assertEqual(len(vehicles[0].fields), 3)
        self.assertEqual(len(vehicles[1].fields), 0)


if __name__ == "__main__":
    unittest.main()
