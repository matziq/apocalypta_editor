"""Pure bulk target calculations for the native editor migration."""

from __future__ import annotations

import math
from collections.abc import Callable, Mapping, Sequence
from typing import Any

DEFAULT_TARGETS = {"ammo": 999, "consumables": 999, "nuts": 900000, "liquids": 100}
_LIMITS = {"ammo": (0, 2147483647), "consumables": (1, 2147483647),
           "nuts": (0, 1000000), "liquids": (0, 100)}


def checked_targets(targets: Mapping[str, int | float]) -> Mapping[str, int | float]:
    for key, (minimum, maximum) in _LIMITS.items():
        value = targets.get(key)
        if (isinstance(value, bool) or not isinstance(value, (int, float))
                or isinstance(value, float) and (not math.isfinite(value) or not value.is_integer())
                or not minimum <= value <= maximum):
            raise ValueError(f"{key} target must be a whole number from {minimum} to {maximum}.")
    return targets


def count_target(field: Mapping[str, Any], targets: Mapping[str, int | float]) -> int | float:
    identifier = field["id"]
    ammo = (identifier.startswith(("Ammo.", "weaponsAmmoInGun."))
            or identifier.endswith((":ammo", ":batteries")))
    return targets["ammo" if ammo else "consumables"]


def liquid_target(field: Mapping[str, Any], targets: Mapping[str, int]) -> float:
    if targets["liquids"] == 100:
        return field["max"]
    return float(format(field["max"] * targets["liquids"] / 100, ".12g"))


def maximize_player(fields: Sequence[Mapping[str, Any]], read: Callable, write: Callable,
                    validate: Callable, targets: Mapping[str, int]) -> dict[str, Any]:
    checked_targets(targets)
    result = {"staged": 0, "skipped": []}
    for field in fields:
        identifier = field["id"]
        if field["section"] != "player" or identifier == "Ammo.armor":
            continue
        if identifier.endswith("_capacity") and not field.get("topOffConsumable"):
            continue
        target = (targets["nuts"] if identifier == "global.Money"
                  else targets["ammo"] if field.get("topOffConsumable")
                  else 0 if identifier in ("global.Hunger", "global.Thirst",
                                             "global.Fatigue", "global.Radiation")
                  else 100)
        current = read(field)
        if current["invalid"]:
            result["skipped"].append(field["label"])
            continue
        try:
            validate(field, target)
        except ValueError:
            result["skipped"].append(field["label"])
            continue
        if float(current["value"]) != target:
            write(field, target)
            result["staged"] += 1
    return result


def top_off_consumables(fields: Sequence[Mapping[str, Any]], read: Callable, write: Callable,
                        validate: Callable, targets: Mapping[str, int]) -> dict[str, int]:
    checked_targets(targets)
    result = {"staged": 0, "skippedInvalid": 0}
    for field in fields:
        if not field.get("topOffConsumable") and field["id"] != "global.Money":
            continue
        target = targets["nuts"] if field["id"] == "global.Money" else count_target(field, targets)
        current = read(field)
        if current["invalid"]:
            result["skippedInvalid"] += 1
            continue
        if float(current["value"]) != target:
            validate(field, target)
            write(field, target)
            result["staged"] += 1
    return result


def stage_vehicle(vehicle: Mapping[str, Any], fields: Sequence[Mapping[str, Any]], action: str,
                  read: Callable, write: Callable, validate: Callable,
                  targets: Mapping[str, int]) -> dict[str, int]:
    checked_targets(targets)
    suffixes = (":Condition",) if action == "repair" else (":fuel", ":Liquid") if action == "topoff" else None
    if suffixes is None:
        raise ValueError(f"Unknown vehicle action: {action}")
    fields_by_id = {field["id"]: field for field in fields}
    result = {"staged": 0, "skippedInvalid": 0}
    for identifier in dict.fromkeys(vehicle.get("fieldIds", [])):
        if not identifier.endswith(suffixes):
            continue
        if action == "topoff" and identifier.endswith(":fuel") and "trailer" in vehicle.get("name", "").lower():
            continue
        field = fields_by_id.get(identifier)
        if field is None:
            continue
        current = read(field)
        if current["invalid"]:
            result["skippedInvalid"] += 1
            continue
        target = field["max"] if action == "repair" else liquid_target(field, targets)
        if float(current["value"]) != target:
            validate(field, target)
            write(field, target)
            result["staged"] += 1
    return result


def all_vehicles(vehicles: Sequence[Mapping[str, Any]], fields: Sequence[Mapping[str, Any]],
                 read: Callable, write: Callable, validate: Callable,
                 targets: Mapping[str, int]) -> dict[str, int]:
    checked_targets(targets)
    result = {"staged": 0, "skippedInvalid": 0, "missingRepair": 0, "missingFuel": 0}
    for vehicle in vehicles:
        for action, suffix, missing in (("repair", ":Condition", "missingRepair"),
                                        ("topoff", ":fuel", "missingFuel")):
            if not (action == "topoff" and "trailer" in vehicle.get("name", "").lower()):
                if not any(identifier.endswith(suffix) for identifier in vehicle["fieldIds"]):
                    result[missing] += 1
            staged = stage_vehicle(vehicle, fields, action, read, write, validate, targets)
            result["staged"] += staged["staged"]
            result["skippedInvalid"] += staged["skippedInvalid"]
    return result


def maximize_items(items: Sequence[Mapping[str, Any]], fields: Sequence[Mapping[str, Any]],
                   read: Callable, write: Callable, validate: Callable,
                   targets: Mapping[str, int]) -> dict[str, int]:
    checked_targets(targets)
    ids = {identifier for item in items for identifier in item["fieldIds"]}
    result = {"staged": 0, "skippedUnverified": 0, "skippedInvalid": 0,
              "readOnly": sum(len(item["readOnlyFields"]) for item in items)}
    for field in fields:
        identifier = field["id"]
        if identifier not in ids and not identifier.startswith("weaponsAmmoInGun."):
            continue
        target = (field["max"] if identifier.endswith(":Condition")
                  else liquid_target(field, targets) if identifier.endswith(":Liquid")
                  else count_target(field, targets) if field.get("topOffConsumable")
                  else None)
        if target is None:
            result["skippedUnverified"] += 1
            continue
        current = read(field)
        if current["invalid"]:
            result["skippedInvalid"] += 1
            continue
        if float(current["value"]) != target:
            validate(field, target)
            write(field, target)
            result["staged"] += 1
    return result
