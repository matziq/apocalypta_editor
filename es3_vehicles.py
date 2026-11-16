"""Verified vehicle scalar and mount discovery for the native migration."""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field

from es3_items import Item, LIQUIDS, WHEELS, _number, _value
from es3_parser import Node, at
from es3_scalars import Scalar, WRAPPER
from es3_world import WorldTransforms

WHEEL_MOUNTS = {
    "3278462540176318831": "Front right wheel",
    "1533047110744586257": "Rear left wheel",
    "5305950010086703831": "Front left wheel",
    "1324165727380696362": "Rear right wheel",
}


@dataclass
class Vehicle:
    id: str
    name: str
    ref: str | None
    fields: list[Scalar] = field(default_factory=list)
    parts: list[Item] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def inspect_vehicles(tree: Node, world: WorldTransforms, items: list[Item]) -> list[Vehicle]:
    all_objects = world.items + world.cars
    refs = Counter(obj.ref for obj in all_objects if obj.ref is not None)
    names = Counter(obj.name for obj in all_objects)
    mounts = defaultdict(list)
    prefab_vehicles = defaultdict(dict)
    vehicles = []
    for car in world.cars:
        vehicle = Vehicle(f"vehicle:{car.ref if car.ref is not None else car.name}:{car.index}",
                          car.name, car.ref)
        vehicles.append(vehicle)
        record = at(tree, car.name)
        data = at(record, "value", "objs") if _value(at(record, "__type")) == WRAPPER else None
        owner = at(data, "owner")
        matched = bool(data and owner and car.ref and refs[car.ref] == 1
                       and _value(at(owner, "_ES3Ref")) == car.ref)
        if not matched:
            vehicle.warnings.append("Vehicle object and scalar record cannot be uniquely matched.")
            continue
        prefab_refs = at(car.object, "es3Prefab", "refs")
        if prefab_refs is not None and prefab_refs.kind == "object":
            for entry in prefab_refs.props.values():
                if entry.kind == "string":
                    prefab_vehicles[entry.value][vehicle.id] = vehicle
        for key in ("hinge_engine", "hinge_radiator", "hinge_exhaust"):
            transform_id = _value(at(data, key, "transformID"))
            if isinstance(transform_id, str):
                mounts[transform_id].append((vehicle, key, False))
        if (_value(at(car.object, "es3Prefab", "prefabId")) == "8734799950597450027"
                and _value(at(owner, "es3Prefab", "prefabId")) == "8734799950597450027"):
            for key in WHEEL_MOUNTS:
                transform_id = _value(at(car.object, "es3Prefab", "refs", key))
                if isinstance(transform_id, str):
                    mounts[transform_id].append((vehicle, key, True))
        liquid_node = at(data, "Liquid")
        liquid = _number(liquid_node, "float")
        capacity = _number(at(data, "LiquidCapacity"), "float")
        if "trailer" in car.name.lower():
            vehicle.warnings.append("Trailer liquid fields are not identified as fuel.")
        elif liquid is not None and capacity is not None and capacity.value > 0 and 0 <= liquid.value <= capacity.value:
            if liquid_node.implicit is not None and at(liquid_node, "value") is not None:
                raise ValueError(f"Ambiguous value for {vehicle.id}:fuel.")
            vehicle.fields.append(Scalar(f"{vehicle.id}:fuel", "float", liquid.value,
                                         liquid.start, liquid.end, 0, capacity.value))
        else:
            vehicle.warnings.append("Fuel or saved tank capacity is invalid or unsupported.")

    parent_counts = Counter(obj.parent_ref for obj in world.items if obj.parent_ref)
    for item in items:
        obj = item.object
        prefab = _value(at(obj.object, "es3Prefab", "prefabId"))
        wheel = WHEELS.get(prefab)
        wheel_record = at(tree, obj.name)
        wheel_match = bool(obj.ref is not None and refs[obj.ref] == 1 and names[obj.name] == 1
                           and wheel and re.fullmatch(re.escape(wheel) + r"\(Clone\)\d+", obj.name)
                           and _value(at(wheel_record, "__type")) == "System.Object")
        part_links = mounts.get(obj.parent_ref, [])
        links = [link for link in part_links
                 if not link[2] or wheel_match and parent_counts[obj.parent_ref] == 1]
        if len(links) == 1:
            vehicle, mount_key, wheel_only = links[0]
            mount_label = (WHEEL_MOUNTS[mount_key] if wheel_only else
                           {"hinge_engine": "Engine", "hinge_radiator": "Radiator",
                            "hinge_exhaust": "Exhaust"}[mount_key])
            item.attached_to = f"{vehicle.name} · {mount_label}"
            item.location = f"Attached to {vehicle.name} ({mount_label})"
            vehicle.parts.append(item)
            for scalar in item.fields:
                if scalar.id.endswith(":Condition"):
                    vehicle.fields.append(scalar)
                elif scalar.id.endswith(":Liquid"):
                    record = at(tree, obj.name)
                    owner = at(record, "value", "objs", "owner")
                    verified = LIQUIDS.get(prefab)
                    clean_name = re.sub(r"\(Clone\)\d*$", "", obj.name)
                    expected_mount = ("hinge_radiator" if clean_name.startswith("radiator_")
                                      else "hinge_engine" if verified and "HP " in clean_name else None)
                    if (verified and verified[0] == clean_name
                            and _value(at(owner, "es3Prefab", "prefabId")) == prefab
                            and expected_mount == mount_key and parent_counts[obj.parent_ref] == 1):
                        vehicle.fields.append(scalar)
        elif len(part_links) > 1 or len(links) > 1:
            item.location = "Ambiguous vehicle mount"
        elif obj.ref is not None and refs[obj.ref] == 1 and obj.parent_ref:
            candidates = prefab_vehicles.get(obj.parent_ref, {})
            if len(candidates) == 1:
                item.associated_vehicle = next(iter(candidates.values())).name
                item.location = f"Vehicle-associated: {item.associated_vehicle} (prefab reference; mounting/storage unknown)"
        identified = world.identified_location(obj)
        if identified is not None:
            item.location = identified
    return vehicles
