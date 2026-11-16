import json
import math
import unittest

from es3_parser import parse
from es3_world import KNOWN_SLOTS, WorldTransforms
from oracle_support import javascript_result

WRAPPER = "ES3PlayMaker.PMDataWrapper,Assembly-CSharp-firstpass"


def game_object(name, ref, transform_id, parent=None):
    return {
        "__type": "GameObject", "_ES3Ref": ref, "transformID": transform_id,
        "name": name, "active": True, "tag": "Rigidbody",
        "components": [{
            "__type": "Transform", "_ES3Ref": transform_id, "goID": ref,
            "parent": None if parent is None else {"_ES3Ref": parent},
            "localPosition": {"x": 0, "y": 0, "z": 0},
        }],
    }


def synthetic_save():
    player = game_object("Player", "player", "pt")
    player["components"][0]["localPosition"] = {"x": 10, "y": 2, "z": 20}
    root = game_object("root(Clone)1", "r", "rt")
    root["components"][0].update({
        "localPosition": {"x": 100, "y": 0, "z": 200},
        "localRotation": {"x": 0, "y": math.sqrt(.5), "z": 0, "w": math.sqrt(.5)},
        "localScale": {"x": 2, "y": 1, "z": 1},
    })
    child = game_object("child(Clone)2", "c", "ct", "rt")
    child["components"][0].update({
        "localPosition": {"x": 1, "y": 0, "z": 0},
        "localRotation": {"x": 0, "y": 0, "z": 0, "w": 1},
        "localScale": {"x": 1, "y": 1, "z": 1},
    })
    zero = game_object("zero(Clone)3", "z", "zt", "ct")
    missing = game_object("missing(Clone)4", "m", "mt")
    del missing["components"][0]["parent"]
    malformed = game_object("malformed(Clone)5", "f", "ft")
    malformed["components"][0]["parent"] = {"_ES3Ref": 123}
    absent = game_object("absent(Clone)6", "a", "at")
    absent["components"] = []
    cycle1 = game_object("cycle(Clone)7", "c1", "c1t", "c2t")
    cycle2 = game_object("cycle(Clone)8", "c2", "c2t", "c1t")
    for obj in (cycle1, cycle2):
        obj["components"][0].update({
            "localRotation": {"x": 0, "y": 0, "z": 0, "w": 1},
            "localScale": {"x": 1, "y": 1, "z": 1},
        })
    dup1 = game_object("dup(Clone)9", "d1", "dt")
    dup2 = game_object("dup(Clone)10", "d2", "dt")
    owner1 = game_object("owner(Clone)11", "duplicate-owner", "o1")
    owner2 = game_object("owner(Clone)12", "duplicate-owner", "o2")
    items = [root, child, zero, missing, malformed, absent, cycle1, cycle2, dup1, dup2, owner1, owner2]
    return json.dumps({
        "Player": {"__type": WRAPPER, "value": {"objs": {
            "Health": {"__type": "float", "value": 100}, "Player": player}}},
        "newGOArray_Items": {"__type": WRAPPER, "value": {"array": items}},
    })


class WorldTests(unittest.TestCase):
    def test_world_positions_match_js_and_unresolved_are_not_plotted(self):
        text = synthetic_save()
        world = WorldTransforms(parse(text))
        actual = [world.position(item.transform) for item in world.items]
        self.assertEqual(world.position(world.player_transform), {"x": 10, "y": 2, "z": 20})
        self.assertEqual(actual[0], {"x": 100, "y": 0, "z": 200})
        for item in actual[1:3]:
            self.assertAlmostEqual(item["x"], 100)
            self.assertAlmostEqual(item["z"], 198)
        self.assertTrue(all(item is None for item in actual[3:]))
        self.assertEqual([item.parent_state for item in world.items[3:6]], ["unresolved"] * 3)

        expected = javascript_result(self._testMethodName)
        self.assertEqual(world.position(world.player_transform), expected["player"])
        for left, right in zip(actual, expected["items"], strict=True):
            if left is None:
                self.assertIsNone(right)
            else:
                for axis in ("x", "y", "z"):
                    self.assertAlmostEqual(left[axis], right[axis])

    def test_confirmed_slots_and_nested_container_locations_match_js(self):
        player = game_object("Player", "4908172907895950466", "9005913460443800891")
        items = []
        for index, slot in enumerate(KNOWN_SLOTS):
            obj = game_object(f"slot-item(Clone){index}", f"item{index}", f"tr{index}", slot)
            if index >= 2:
                obj["components"][0]["localPosition"]["x"] = 1
            items.append(obj)
        trailer = game_object("Trailer", "trailer", "trailer-transform")
        trailer["es3Prefab"] = {"prefabId": "3545007504786799582",
                                "refs": {"8038138322462240083": "1052945493227557322"}}
        car = game_object("Vulture", "car", "car-transform")
        car["es3Prefab"] = {"prefabId": "8734799950597450027",
                            "refs": {"2086200191613234582": "7489528302310536125"}}
        crate = game_object("crate(Clone)1", "crate", "crate-transform", "1052945493227557322")
        nested = game_object("nested(Clone)1", "nested", "nested-transform", "crate-transform")
        boxed = game_object("boxed(Clone)1", "boxed", "boxed-transform", "7489528302310536125")
        items.extend((crate, nested, boxed))
        wrapper = lambda payload: {"__type": WRAPPER, "value": payload}
        text = json.dumps({
            "Player": wrapper({"objs": {"Health": {"__type": "float", "value": 100}, "Player": player}}),
            "newGOArray_Items": wrapper({"array": items}),
            "newGOArray_Cars": wrapper({"array": [trailer, car]}),
        })
        world = WorldTransforms(parse(text))
        actual = [world.identified_location(item) for item in world.items]
        self.assertEqual(len(world.known_slots), 9)
        for index, label in enumerate(KNOWN_SLOTS.values()):
            self.assertEqual(actual[index], f"User-identified {label}")
        self.assertEqual(actual[-3], "User-identified trailer container (saved parent link)")
        self.assertEqual(actual[-2], "User-identified trailer container (saved parent link)")
        self.assertEqual(actual[-1], "User-identified box in vehicle trunk (saved parent link)")

        self.assertEqual(actual, javascript_result(self._testMethodName))

    def test_slot_labels_require_verified_player_transform(self):
        player = game_object("Player", "4908172907895950466", "9005913460443800891")
        player["components"] = []
        slot = game_object("slot(Clone)1", "item", "it", "3656544721015511630")
        text = json.dumps({
            "Player": {"__type": WRAPPER, "value": {"objs": {"Player": player}}},
            "newGOArray_Items": {"__type": WRAPPER, "value": {"array": [slot]}},
        })
        world = WorldTransforms(parse(text))
        self.assertEqual(world.known_slots, {})
        self.assertIsNone(world.identified_location(world.items[0]))


if __name__ == "__main__":
    unittest.main()
