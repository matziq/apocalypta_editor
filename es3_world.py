"""Resolve saved local transforms only when the complete parent chain is known."""

from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass

from es3_parser import Node, at

KNOWN_SLOTS = {
    "6374689825314962276": "Bandage slot",
    "9124196666788711796": "First Aid Kit slot",
    "3656544721015511630": "Weapon slot 1",
    "1591285762866710851": "Weapon slot 2",
    "2901622336603839876": "Weapon slot 3",
    "6707555155505277952": "Flashlight slot (L)",
    "1007585140629016984": "Body armor slot",
    "5762072836280993281": "Backpack slot",
    "6960692475879471560": "Binoculars slot",
}


@dataclass(frozen=True)
class SavedObject:
    index: int
    name: str
    ref: str | None
    transform_id: str | None
    parent_ref: str | None
    parent_state: str
    transform: Node | None
    object: Node


def _value(node: Node | None):
    return node.value if node is not None else None


def _transform(object_node: Node | None) -> Node | None:
    components = at(object_node, "components")
    if components is None or components.kind != "array":
        return None
    return next((item for item in components.items
                 if _value(at(item, "__type")) == "Transform"), None)


def game_objects(tree: Node, key: str) -> list[SavedObject]:
    array = at(tree, key, "value", "array")
    if array is None or array.kind == "null":
        return []
    if array.kind != "array":
        raise ValueError(f"{key} has an unsupported structure.")
    result = []
    for index, obj in enumerate(array.items):
        transform = _transform(obj)
        parent = at(transform, "parent")
        parent_ref = _value(at(parent, "_ES3Ref"))
        name = _value(at(obj, "name"))
        ref = _value(at(obj, "_ES3Ref"))
        transform_id = _value(at(obj, "transformID"))
        parent_state = ("root" if parent is not None and parent.kind == "null"
                        else "linked" if isinstance(parent_ref, str) and parent_ref
                        else "unresolved")
        result.append(SavedObject(
            index, name if name is not None else f"Unnamed {key} object {index + 1}",
            ref, transform_id, parent_ref if isinstance(parent_ref, str) else None,
            parent_state, transform, obj,
        ))
    return result


class WorldTransforms:
    def __init__(self, tree: Node):
        self.items = game_objects(tree, "newGOArray_Items")
        self.cars = game_objects(tree, "newGOArray_Cars")
        player = at(tree, "Player", "value", "objs", "Player")
        player_transform = _transform(player)
        player_ref = _value(at(player, "_ES3Ref"))
        player_id = _value(at(player, "transformID"))
        records = [(obj.ref, obj.transform_id, obj.transform) for obj in self.items + self.cars]
        if player_transform is not None:
            records.append((player_ref, player_id, player_transform))
        owners = Counter(ref for ref, _, _ in records if isinstance(ref, str))
        ids = Counter(identifier for _, identifier, _ in records if isinstance(identifier, str))
        self.saved_transform_ids = set(ids) | {
            identifier for _, _, transform in records
            if isinstance(identifier := _value(at(transform, "_ES3Ref")), str)
        }
        self.transforms = {
            identifier: transform
            for ref, identifier, transform in records
            if isinstance(identifier, str)
            and _value(at(transform, "_ES3Ref")) == identifier
            and _value(at(transform, "goID")) == ref
            and owners.get(ref) == 1 and ids.get(identifier) == 1
        }
        self.player_transform = player_transform
        self.player_id = (player_id if player_transform is not None and isinstance(player_id, str)
                          and self.transforms.get(player_id) is player_transform else None)
        self.known_slots = (
            KNOWN_SLOTS if player_transform is not None and player_ref == "4908172907895950466"
            and player_id == "9005913460443800891"
            and self.transforms.get(player_id) is player_transform else {}
        )
        self.ref_counts = Counter(obj.ref for obj in self.items + self.cars if obj.ref is not None)
        self.parent_counts = Counter(obj.parent_ref for obj in self.items if obj.parent_ref)
        player_refs = at(player, "es3Prefab", "refs")
        self.player_parent_refs = {self.player_id} if self.player_id else set()
        if self.player_id and player_refs is not None and player_refs.kind == "object":
            ref_owners = Counter()
            for record in [player] + [obj.object for obj in self.items + self.cars]:
                refs = at(record, "es3Prefab", "refs")
                if refs is not None and refs.kind == "object":
                    ref_owners.update(node.value for node in refs.props.values()
                                      if node.kind == "string" and node.value)
            self.player_parent_refs.update(
                node.value for node in player_refs.props.values()
                if node.kind == "string" and node.value and ref_owners[node.value] == 1
                and node.value not in self.saved_transform_ids
                and node.value not in self.ref_counts
            )
        self.containers = {}
        for car in self.cars:
            prefab = _value(at(car.object, "es3Prefab", "prefabId"))
            refs = at(car.object, "es3Prefab", "refs")
            for prefab_id, key, ref, label in (
                ("3545007504786799582", "8038138322462240083", "1052945493227557322", "User-identified trailer container"),
                ("8734799950597450027", "2086200191613234582", "7489528302310536125", "User-identified box in vehicle trunk"),
            ):
                matching_cars = 0
                for candidate in self.cars:
                    candidate_refs = at(candidate.object, "es3Prefab", "refs")
                    if candidate_refs is not None and candidate_refs.kind == "object" and any(
                        node.kind == "string" and node.value == ref for node in candidate_refs.props.values()
                    ):
                        matching_cars += 1
                if (car.ref and self.ref_counts[car.ref] == 1 and prefab == prefab_id
                        and matching_cars == 1 and _value(at(refs, key)) == ref):
                    self.containers[ref] = label

    @staticmethod
    def _vector(node: Node | None, keys: tuple[str, ...]) -> dict[str, float] | None:
        result = {}
        for key in keys:
            value = at(node, key)
            if value is None or value.kind != "number" or not math.isfinite(value.value):
                return None
            result[key] = value.value
        return result

    def position(self, transform: Node | None) -> dict[str, float] | None:
        own_id = _value(at(transform, "_ES3Ref"))
        if not isinstance(own_id, str) or self.transforms.get(own_id) is not transform:
            return None
        point = self._vector(at(transform, "localPosition"), ("x", "y", "z"))
        if point is None:
            return None
        visited = {own_id}
        while True:
            parent = at(transform, "parent")
            if parent is not None and parent.kind == "null":
                return point
            parent_id = _value(at(parent, "_ES3Ref"))
            if not isinstance(parent_id, str) or parent_id in visited or parent_id not in self.transforms:
                return None
            visited.add(parent_id)
            transform = self.transforms[parent_id]
            position = self._vector(at(transform, "localPosition"), ("x", "y", "z"))
            scale = self._vector(at(transform, "localScale"), ("x", "y", "z"))
            q = self._vector(at(transform, "localRotation"), ("x", "y", "z", "w"))
            if position is None or scale is None or q is None:
                return None
            if abs(math.hypot(q["x"], q["y"], q["z"], q["w"]) - 1) > 0.001:
                return None
            x, y, z = (point[axis] * scale[axis] for axis in ("x", "y", "z"))
            tx = 2 * (q["y"] * z - q["z"] * y)
            ty = 2 * (q["z"] * x - q["x"] * z)
            tz = 2 * (q["x"] * y - q["y"] * x)
            point = {
                "x": position["x"] + x + q["w"] * tx + q["y"] * tz - q["z"] * ty,
                "y": position["y"] + y + q["w"] * ty + q["z"] * tx - q["x"] * tz,
                "z": position["z"] + z + q["w"] * tz + q["x"] * ty - q["y"] * tx,
            }
            if not all(math.isfinite(value) for value in point.values()):
                return None

    def identified_location(self, obj: SavedObject) -> str | None:
        if obj.ref is None or self.ref_counts[obj.ref] != 1:
            return None

        slot = self.known_slots.get(obj.parent_ref)
        if slot:
            requires_zero = obj.parent_ref in ("6374689825314962276", "9124196666788711796")
            position = self._vector(at(obj.transform, "localPosition"), ("x", "y", "z"))
            if not requires_zero or position is not None and all(position[axis] == 0 for axis in ("x", "y", "z")):
                extra = "" if self.parent_counts[obj.parent_ref] == 1 else " (multiple children)"
                return f"User-identified {slot}{extra}"
        parent = obj.parent_ref
        visited = set()
        while parent and parent not in visited:
            if parent in self.containers:
                return f"{self.containers[parent]} (saved parent link)"
            visited.add(parent)
            parent = _value(at(self.transforms.get(parent), "parent", "_ES3Ref"))
        return None

    def belongs_to_player(self, obj: SavedObject) -> bool:
        """Require an unambiguous saved parent chain, never proximity or name."""
        visited = set()
        while obj.transform_id not in visited:
            if (not isinstance(obj.ref, str) or self.ref_counts[obj.ref] != 1
                    or not isinstance(obj.transform_id, str)
                    or self.transforms.get(obj.transform_id) is not obj.transform
                    or obj.parent_state != "linked"):
                return False
            visited.add(obj.transform_id)
            if obj.parent_ref in self.transforms and obj.parent_ref != self.player_id:
                parent = next((item for item in self.items
                               if item.transform_id == obj.parent_ref
                               and self.transforms.get(item.transform_id) is item.transform), None)
                if parent is None:
                    return False
                obj = parent
                continue
            if obj.parent_ref in self.saved_transform_ids and obj.parent_ref != self.player_id:
                return False
            if obj.parent_ref in self.known_slots:
                return bool(self.identified_location(obj))
            if obj.parent_ref in self.player_parent_refs:
                return True
            return False
        return False
