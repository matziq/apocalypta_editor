"""Compose the native save engine's scalar, item, vehicle, and world views."""

from __future__ import annotations

from dataclasses import dataclass

from es3_items import Item, _number, _value, inspect_items
from es3_parser import at, parse
from es3_scalars import Scalar, WRAPPER, inspect_scalars, serialize_fields
from es3_vehicles import Vehicle, inspect_vehicles
from es3_world import WorldTransforms

WEAPON_AMMO = frozenset((
    "ammoakms", "ammoakmdrum", "ammoakmtrash", "ammo22pipepistol",
    "ammo22piperevolver", "ammoborzsmg", "ammocrossbow", "ammofolk17",
    "ammom16a1", "ammorochesterm24", "ammorochesterm24chopped",
    "ammoslamberg500", "ammoslamberg500chopped", "ammoslamfireshotgun",
    "ammoredmarkm11", "ammoredmarkm11scoped", "ammo22pipesmg",
))


@dataclass
class Document:
    fields: list[Scalar]
    readonly: list[Scalar | ReadOnly]
    items: list[Item]
    vehicles: list[Vehicle]
    world: WorldTransforms


@dataclass(frozen=True)
class ReadOnly:
    id: str
    value: bool | float
    reason: str
    section: str = "player"


def inspect_document(text: str) -> Document:
    tree = parse(text)
    fields, scalar_readonly = inspect_scalars(text, tree)
    readonly: list[Scalar | ReadOnly] = list(scalar_readonly)
    globals_node = at(tree, "global")
    if _value(at(globals_node, "__type")) == WRAPPER:
        data = at(globals_node, "value", "objs")
        money = at(data, "Money")
        money_value = money.implicit if money is not None and money.implicit is not None else at(money, "value")
        supported_money = (_value(at(money, "__type")) == "int" and money_value is not None
                           and money_value.kind == "number"
                           and not (money.implicit is not None and at(money, "value") is not None))
        reasons = []
        if not supported_money:
            reasons.append(("Money", "This Money record is not a uniquely represented integer; preserved unchanged."))
        reasons.extend((
            ("Sanity", "The active gameplay FSM clamps 0 to 100, but inspected saves also contain negative values; behavior with insanity disabled has not been verified."),
            ("PlayerHealth", "A separate saved health copy; its load precedence relative to Player.Health has not been verified."),
            *((name, "Game-slot copy only. Edit the verified per-key setting in SaveSettings.es3; duplicate scopes are not synchronized.")
              for name in ("automatic_gearbox", "autoclutch", "normalizeinput")),
        ))
        for name, reason in reasons:
            node = at(data, name)
            saved = node.implicit if node is not None and node.implicit is not None else at(node, "value")
            if saved is not None and saved.kind in ("number", "boolean"):
                readonly.append(ReadOnly(f"global.{name}", saved.value, reason))
    world = WorldTransforms(tree)
    items = inspect_items(tree, world)
    vehicles = inspect_vehicles(tree, world, items)
    fields.extend(entry for vehicle in vehicles for entry in vehicle.fields if entry.id.endswith(":fuel"))
    fields.extend(entry for item in items for entry in item.fields)
    weapons = at(tree, "weaponsAmmoInGun")
    if _value(at(weapons, "__type")) == WRAPPER:
        data = at(weapons, "value", "objs")
        if data is not None and data.kind == "object":
            for name, node in data.props.items():
                number = _number(node, "int")
                if number is None or not number.value.is_integer() or not 0 <= number.value <= 2147483647:
                    continue
                if node.implicit is not None and at(node, "value") is not None:
                    raise ValueError(f"Ambiguous value for weaponsAmmoInGun.{name}.")
                fields.append(Scalar(f"weaponsAmmoInGun.{name}", "int", number.value,
                                     number.start, number.end, 0, 2147483647, name in WEAPON_AMMO))
    if not fields and not readonly:
        raise ValueError("No supported Apocalypter fields found. Open SaveGameN.es3 or SaveSettings.es3.")
    return Document(fields, readonly, items, vehicles, world)


def serialize_document(text: str, changes: dict) -> str:
    document = inspect_document(text)
    result = serialize_fields(text, changes, document.fields)
    inspect_document(result)
    return result
