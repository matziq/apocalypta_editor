"""Verified item scalar discovery for the native save engine."""

from __future__ import annotations

import math
import re
import struct
from collections import Counter
from dataclasses import dataclass, field

from es3_parser import Node, at
from es3_scalars import Scalar, WRAPPER
from es3_world import SavedObject, WorldTransforms

# These identities are copied from the verified prefab/FSM mappings in save-format.js.
CONSUMABLES = {
    "688495819279421776": ("bandage_1", "Quantity"),
    "9121322384858893382": ("Repairbox_Small", "Quantity"),
    "7600464120049698740": ("Repairbox_Medium", "Quantity"),
    "4165647324065915868": ("Repairbox_Large", "Quantity"),
    "5513939087385948062": ("ammo_box_20gauge", "ammo"),
    "3910063457913955151": ("ammo_box_22", "ammo"),
    "5744510244793180658": ("ammo_box_big_22", "ammo"),
    "2411824388914619091": ("ammo_box_big_12gauge", "ammo"),
    "3133067563820807118": ("ammo_box_big_762mm", "ammo"),
    "3377769854383720206": ("ammo_box_762mm", "ammo"),
    "8401587218543670294": ("ammo_box_556mm", "ammo"),
    "8519476287603981168": ("ammo_box_12gauge", "ammo"),
    "2704672928494571242": ("ammo_box_3006", "ammo"),
    "7095138909402377063": ("ammo_box_big_3006", "ammo"),
    "2992344171066298429": ("ammo_box_big_9mm", "ammo"),
    "6949040989765713240": ("ammo_box_big_20gauge", "ammo"),
    "1625578815151821771": ("ammo_box_big_arrow", "ammo"),
    "3733066396143753576": ("ammo_box_9mm", "ammo"),
    "6082136355384846395": ("ammo_box_big_556mm", "ammo"),
    "3766863323530176910": ("ammo_arrow", "ammo"),
    "3955095449936337101": ("first_aid_1", "Quantity"),
    "2856772050428381491": ("weed_bag", "Quantity"),
    "7947724335221001397": ("cigarette_bactrian", "Quantity"),
    "6706846953073870613": ("cigar", "Quantity"),
    "4398581480533230246": ("sanity_pills", "Quantity"),
    "6027655925999442117": ("flashlight_batteries", "batteries"),
}
LIQUIDS = {
    "5864412579365047585": ("MotorOil_Can_Small", 5),
    "6858519991654959144": ("Gasoline_Can", 20),
    "4230013134874058846": ("Water_Can_Plastic", 13),
    "608293236901033563": ("Diesel_Barrel", 150),
    "5623108999256334996": ("MotorOil_Can_Big", 30),
    "9030660213298172268": ("Diesel_Can", 20),
    "2169926468007209799": ("radiator_medium_race", 14),
    "8205777586039224731": ("radiator_medium", 9),
    "2705209445545947911": ("radiator_motorcycle", 3),
    "5669857674379848146": ("radiator_small", 6),
    "5421126813566889844": ("radiator_truck", 18),
    "2031828300969920981": ("radiator_truck_big", 24),
    "3587043590766116916": ("radiator_truck_ultra", 28),
    "3634296406011431456": ("594cc I2 23HP 39Nm Gasoline", 2),
    "6089072345908897270": ("3L I5 87HP 172Nm Diesel", 5.1),
    "5945172545298182391": ("3.8L V6 165HP 285Nm Gasoline", 6),
    "624016700395080820": ("3.7L I6 145HP 292Nm Gasoline", 5.3),
    "7861181815379186": ("5.8L I6 120HP 356Nm Diesel", 7),
    "4167795411855106502": ("18L V8 335HP 1700Nm Diesel", 16),
    "7876660059110608148": ("2.8L V6 115HP 183Nm Gasoline", 5),
    "9035087652290305727": ("5.2L V8 230HP 340Nm Gasoline", 7),
    "5126044545507921876": ("7L V8 355HP 569Nm Gasoline", 9),
    "884780215855984285": ("1.3L v2 55HP 94Nm Gasoline", 3.3),
    "6758790462075466819": ("1.2L I4 59HP 87Nm Gasoline", 3.3),
    "374403439354623823": ("2.3L I4 89HP 165Nm Gasoline", 3.9),
    "1298474360822390476": ("7L I6 165HP 542Nm Diesel", 7.5),
    "4674809622967151223": ("8.2L V8 400HP 746Nm Gasoline", 10),
    "873555013045931076": ("11.5L V12 274HP 854Nm Gasoline", 13),
}
WHEELS = {
    "2321790605670812229": "small_wheel_3",
    "2184613845620177162": "small_wheel_2",
    "2663761577720072192": "wheel_2_armored",
}


@dataclass
class Item:
    id: str
    object: SavedObject
    matched: bool
    location: str = "Unresolved parent / container"
    attached_to: str | None = None
    associated_vehicle: str | None = None
    fields: list[Scalar] = field(default_factory=list)
    readonly: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    liquid_source: str | None = None


def _value(node: Node | None):
    return node.value if node is not None else None


def _number(node: Node | None, kind: str) -> Node | None:
    if node is None or _value(at(node, "__type")) != kind:
        return None
    scalar = node.implicit if node.implicit is not None else at(node, "value")
    if scalar is None or scalar.kind != "number" or not math.isfinite(scalar.value):
        return None
    return scalar


def inspect_items(tree: Node, world: WorldTransforms) -> list[Item]:
    result = []
    counts = Counter(obj.ref for obj in world.items + world.cars if obj.ref is not None)
    names = Counter(obj.name for obj in world.items + world.cars)
    for obj in world.items:
        identifier = f"item:{obj.ref if obj.ref is not None else obj.name}:{obj.index}"
        record = at(tree, obj.name) if obj.ref is not None and counts[obj.ref] == 1 else None
        data = at(record, "value", "objs") if _value(at(record, "__type")) == WRAPPER else None
        owner = at(data, "owner")
        matched = bool(data and owner and _value(at(owner, "_ES3Ref")) == obj.ref)
        location = ("Ambiguous duplicate object reference" if obj.ref is not None and counts[obj.ref] != 1
                    else "Unparented / world-root" if obj.parent_state == "root"
                    else "Unresolved parent / container")
        item = Item(identifier, obj, matched, location)
        result.append(item)
        prefab = _value(at(obj.object, "es3Prefab", "prefabId"))
        wheel = WHEELS.get(prefab)
        wheel_record = at(tree, obj.name)
        if (obj.ref is not None and counts[obj.ref] == 1 and names[obj.name] == 1 and wheel
                and re.fullmatch(re.escape(wheel) + r"\(Clone\)\d+", obj.name)
                and _value(at(wheel_record, "__type")) == "System.Object"):
            wheel_node = at(wheel_record, "value")
            wheel_value = _number(wheel_node, "float")
            if (wheel_value is not None
                    and bool(wheel_node.implicit) != bool(at(wheel_node, "value"))
                    and 0 <= wheel_value.value <= 100):
                item.fields.append(Scalar(f"{identifier}:Condition", "float", wheel_value.value,
                                          wheel_value.start, wheel_value.end, 0, 100))
            else:
                item.warnings.append("Wheel condition is ambiguous or invalid; shown read-only.")
        if not matched:
            continue
        owner_prefab = _value(at(owner, "es3Prefab", "prefabId"))
        name = re.sub(r"\(Clone\)\d*$", "", obj.name)
        verified = CONSUMABLES.get(prefab) if owner_prefab == prefab else None
        if verified is not None and verified[0] != name:
            verified = None

        def add(key: str, kind: str, minimum: float, maximum: float,
                top_off=False, precheck_integer=False) -> None:
            node = at(data, key)
            scalar = _number(node, kind)
            if scalar is None:
                if node is not None:
                    item.warnings.append(f"Unsupported {kind} field: {key}; shown read-only.")
                return
            value = scalar.value
            if value < minimum or value > maximum or (precheck_integer and not value.is_integer()):
                item.warnings.append(f"Unsupported range for {key}; shown read-only.")
                return
            if node.implicit is not None and at(node, "value") is not None:
                raise ValueError(f"Ambiguous value for {identifier}:{key}.")
            if kind == "int" and not value.is_integer():
                item.warnings.append(f"Unsupported range for {key}; shown read-only.")
                return
            item.fields.append(Scalar(f"{identifier}:{key}", kind, value, scalar.start,
                                      scalar.end, minimum, maximum, top_off))

        add("Quantity", "int", 1, 2147483647, verified is not None and verified[1] == "Quantity")
        add("Condition", "float", 0, 100)
        add("ammo", "int", 0, 2147483647, verified is not None and verified[1] == "ammo",
            precheck_integer=True)
        if verified is not None and verified[1] == "batteries":
            # Unlike mandatory scalar records, malformed optional battery counters stay read-only.
            battery = at(data, "batteries")
            if battery is not None and battery.implicit is not None and at(battery, "value") is not None:
                item.warnings.append("Ambiguous batteries field; shown read-only.")
            else:
                add("batteries", "int", 0, 2147483647, True)

        liquid = _number(at(data, "Liquid"), "float")
        capacity_node = at(data, "LiquidCapacity")
        capacity = _number(capacity_node, "float")
        verified_liquid = LIQUIDS.get(prefab) if owner_prefab == prefab else None
        if verified_liquid is not None and verified_liquid[0] != name:
            verified_liquid = None
        limit = capacity.value if capacity is not None else None
        if capacity_node is None and verified_liquid is not None:
            raw = verified_liquid[1]
            float32 = struct.unpack("f", struct.pack("f", raw))[0]
            limit = max(raw, float(format(float32, ".9g")))
        if liquid is not None and limit is not None and limit > 0 and 0 <= liquid.value <= limit:
            add("Liquid", "float", 0, limit)
            if any(entry.id == f"{identifier}:Liquid" for entry in item.fields):
                item.liquid_source = "saved LiquidCapacity" if capacity_node is not None else "verified prefab"
        editable = {entry.id.rsplit(":", 1)[-1] for entry in item.fields}
        for key, node in data.props.items():
            saved = node.implicit if node.implicit is not None else at(node, "value")
            if saved is None or saved.kind not in ("number", "boolean") or key in editable:
                continue
            reason = (
                "No valid saved capacity or exact verified prefab capacity supports this amount; no capacity or units are guessed."
                if key == "Liquid" else
                "Saved capacity is a limit, not an editable amount."
                if key == "LiquidCapacity" else
                "This saved value does not meet the supported type or range; it is preserved unchanged."
                if key in ("Quantity", "Condition", "ammo", "batteries") else
                "This field's gameplay meaning or safe range has not been verified; it is preserved unchanged."
            )
            item.readonly.append({"name": key, "value": saved.value, "reason": reason})
    return result
