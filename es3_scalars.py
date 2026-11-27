"""Player and settings scalar support for the native save engine."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from typing import Any

from es3_parser import Node, at, parse

WRAPPER = "ES3PlayMaker.PMDataWrapper,Assembly-CSharp-firstpass"
AMMO_NAMES = (
    "ammo_22caliber", "ammo_22caliber_capacity", "ammo_9mm",
    "ammo_9mm_capacity", "ammo_20gauge", "ammo_20gauge_capacity",
    "ammo_arrow", "ammo_arrow_capacity", "ammo_battery_capacity",
    "ammo_grenade", "ammo_12gauge", "ammo_556", "ammo_762",
    "ammo_3006", "ammo_battery",
)
AMMO_TARGET_CAPACITIES = frozenset((
    "ammo_22caliber_capacity", "ammo_9mm_capacity",
    "ammo_20gauge_capacity", "ammo_arrow_capacity",
))
SWITCHES = (
    "peacefulMode", "disableThirstHunger", "disableFatigue", "mapCheat",
    "disableInsanity", "toggleHeadbob", "toggleFPS", "toggleFootstepSounds",
    "toggleADS", "automatic_gearbox", "autoclutch", "normalizeinput",
    "bloom", "sharpen",
)
VOLUMES = (
    "ambient_volume", "enginesoundvolume", "boss_music", "ambient_music",
    "audio_volume", "main_menu_music",
)


@dataclass(frozen=True)
class Scalar:
    id: str
    type: str
    value: bool | float
    start: int
    end: int
    minimum: int | float | None = None
    maximum: int | float | None = None
    top_off: bool = False


def _value(node: Node | None) -> Any:
    return node.value if node is not None else None


def inspect_scalars(text: str, tree: Node | None = None) -> tuple[list[Scalar], list[Scalar]]:
    """Return verified editable and out-of-range player/settings scalars."""
    if tree is None:
        tree = parse(text)
    editable: list[Scalar] = []
    readonly: list[Scalar] = []

    def add(identifier: str, node: Node | None, kind: str,
            minimum: int | None = None, maximum: int | None = None,
            top_off: bool = False) -> None:
        if node is None:
            return
        declared = at(node, "__type")
        named = at(node, "value")
        if node.implicit is not None and named is not None:
            raise ValueError(f"Ambiguous value for {identifier}.")
        scalar = node.implicit if node.implicit is not None else named
        expected = "boolean" if kind == "bool" else "number"
        if _value(declared) != kind or scalar is None or scalar.kind != expected:
            raise ValueError(f"Unsupported structure for {identifier}; this save version cannot be edited safely.")
        entry = Scalar(identifier, kind, scalar.value, scalar.start, scalar.end,
                       minimum, maximum, top_off)
        if kind != "bool" and (
            not math.isfinite(entry.value)
            or (kind == "int" and not entry.value.is_integer())
            or entry.value < minimum or entry.value > maximum
        ):
            readonly.append(entry)
        else:
            editable.append(entry)

    player = at(tree, "Player")
    if _value(at(player, "__type")) == WRAPPER:
        add("Player.Health", at(player, "value", "objs", "Health"), "float", 0, 100)
    ammo = at(tree, "Ammo")
    if _value(at(ammo, "__type")) == WRAPPER:
        ammo_data = at(ammo, "value", "objs")
        add("Ammo.armor", at(ammo_data, "armor"), "float", 0, 100)
        for name in AMMO_NAMES:
            target = not name.endswith("_capacity") or name in AMMO_TARGET_CAPACITIES
            add(f"Ammo.{name}", at(ammo_data, name), "int", 0, 2147483647, target)
    globals_node = at(tree, "global")
    if _value(at(globals_node, "__type")) == WRAPPER:
        data = at(globals_node, "value", "objs")
        for name in ("Hunger", "Thirst", "Fatigue", "Radiation"):
            add(f"global.{name}", at(data, name), "float", 0, 100)
        money = at(data, "Money")
        money_value = money.implicit if money is not None and money.implicit is not None else at(money, "value")
        if (_value(at(money, "__type")) == "int" and money_value is not None
                and money_value.kind == "number"
                and not (money.implicit is not None and at(money, "value") is not None)):
            add("global.Money", money, "int", 0, 1000000)
    for name in SWITCHES:
        add(name, at(tree, name), "bool")
    for name in VOLUMES:
        add(name, at(tree, name), "float", 0, 1)
    add("FOV", at(tree, "FOV"), "float", 30, 120)
    return editable, readonly


def _validate(field: Scalar, value: Any) -> None:
    if field.type == "bool":
        if not isinstance(value, bool):
            raise ValueError(f"{field.id} must be true or false.")
        return
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{field.id} must be a finite number.")
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError(f"{field.id} must be a finite number.")
    if value < field.minimum or value > field.maximum:
        raise ValueError(f"{field.id} must be between {field.minimum} and {field.maximum}.")
    if field.type == "int" and isinstance(value, float) and not value.is_integer():
        raise ValueError(f"{field.id} must be a whole number.")


def _js_number(value: int | float) -> str:
    number = float(value)
    if number == 0:
        return "0"
    raw = repr(number)
    if 1e-6 <= abs(number) < 1e21:
        from decimal import Decimal
        result = format(Decimal(raw), "f")
        return result.rstrip("0").rstrip(".") if "." in result else result
    mantissa, exponent = raw.lower().split("e")
    mantissa = mantissa.removesuffix(".0")
    exp = int(exponent)
    return f"{mantissa}e{'+' if exp >= 0 else ''}{exp}"


def serialize_fields(text: str, changes: dict[str, Any], fields: list[Scalar]) -> str:
    """Apply validated scalar edits to their original source spans."""
    by_id = {field.id: field for field in fields}
    edits = []
    for identifier, value in changes.items():
        field = by_id.get(identifier)
        if field is None:
            raise ValueError(f"Editing {identifier} is not supported.")
        _validate(field, value)
        unchanged = value == field.value and (
            field.type == "bool" or value != 0
            or math.copysign(1, value) == math.copysign(1, field.value)
        )
        replacement = (text[field.start:field.end] if unchanged
                       else json.dumps(value) if field.type == "bool"
                       else _js_number(value))
        edits.append((field.start, field.end, replacement))
    result = text
    for start, end, replacement in sorted(edits, reverse=True):
        result = result[:start] + replacement + result[end:]
    return result


def serialize_scalars(text: str, changes: dict[str, Any]) -> str:
    """Serialize only this module's supported scalar edits without reformatting."""
    fields, _ = inspect_scalars(text)
    result = serialize_fields(text, changes, fields)
    inspect_scalars(result)
    return result
