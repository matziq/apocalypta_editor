"""Presentation metadata for verified native-engine fields."""

from __future__ import annotations

from es3_document import Document

SWITCH_LABELS = {
    "peacefulMode": "Peaceful mode", "disableThirstHunger": "Disable thirst and hunger",
    "disableFatigue": "Disable fatigue", "mapCheat": "Map cheat", "disableInsanity": "Disable insanity",
    "toggleHeadbob": "Head bob", "toggleFPS": "Show FPS", "toggleFootstepSounds": "Footstep sounds",
    "toggleADS": "Toggle aim down sights", "automatic_gearbox": "Automatic gearbox",
    "autoclutch": "Automatic clutch", "normalizeinput": "Normalize driving input",
    "bloom": "Bloom", "sharpen": "Sharpen",
}
VOLUME_LABELS = {
    "ambient_volume": "Ambient volume", "enginesoundvolume": "Engine volume",
    "boss_music": "Boss music", "ambient_music": "Ambient music",
    "audio_volume": "Master volume", "main_menu_music": "Main menu music",
}
SUFFIXES = {
    "Quantity": "quantity", "Condition": "condition (%)", "ammo": "ammo count",
    "Liquid": "liquid amount", "batteries": "battery count",
}
SWITCH_HELP = {
    "peacefulMode": "Enables peaceful mode; exact affected enemy behaviors are not verified.",
    "disableThirstHunger": "Disables the game's thirst and hunger system.",
    "disableFatigue": "Disables the game's fatigue system.",
    "mapCheat": "Enables the saved map-cheat toggle; affected overlays are not verified.",
    "disableInsanity": "Disables insanity; negative saved Sanity behavior is not verified.",
    "toggleHeadbob": "Enables head-bob camera movement.",
    "toggleFPS": "Displays the FPS counter.",
    "toggleFootstepSounds": "Enables footstep sounds.",
    "toggleADS": "Selects toggle-style aiming rather than hold-style aiming.",
    "automatic_gearbox": "Enables automatic gearbox control.",
    "autoclutch": "Enables automatic clutch control.",
    "normalizeinput": "Enables normalized driving input; its mathematical scaling is not verified.",
    "bloom": "Enables the bloom graphics effect.",
    "sharpen": "Enables the sharpening graphics effect.",
}


def _help(identifier, scalar):
    effect = SWITCH_HELP.get(identifier)
    if identifier == "Player.Health":
        effect = "Player health; 100 is the editor's healthy endpoint. The separate global health copy is unchanged."
    elif identifier == "Ammo.armor":
        effect = "Saved armor amount. Bulk actions leave it unchanged and do not grant armor plates."
    elif identifier == "global.Money":
        effect = "Nuts currency. The 1,000,000 maximum is an editor safety limit, not a verified game maximum."
    elif identifier.startswith("Ammo.ammo_"):
        effect = ("Saved supply capacity, not the current amount." if identifier.endswith("_capacity")
                  else "Saved player ammunition supply, not per-weapon loaded rounds.")
    elif identifier.startswith("global."):
        effect = "Saved survival state; higher values are worse."
    elif identifier in VOLUME_LABELS:
        effect = "Saved audio volume: 0 is silent and 1 is full volume."
    elif identifier == "FOV":
        effect = "Camera field of view in degrees; higher values widen the view."
    elif identifier.endswith(":Condition"):
        effect = "Saved component condition in percent; higher values are healthier."
    elif identifier.endswith(":fuel"):
        effect = "This vehicle's fuel amount in liters, bounded by its saved capacity."
    elif identifier.endswith(":Quantity"):
        effect = "Units in this existing stack. Minimum 1 prevents deleting the object."
    elif identifier.endswith(":Liquid"):
        effect = "Existing item's liquid amount in saved units, bounded by its verified capacity."
    elif identifier.endswith(":ammo"):
        effect = "Rounds on this exact item, not the player supply or weapon-type counter."
    elif identifier.endswith(":batteries"):
        effect = "Count in this verified flashlight battery pack; no pack is created."
    elif identifier.startswith("weaponsAmmoInGun."):
        effect = "Loaded-round counter for this weapon type, not a specific weapon instance."
    range_text = ("Boolean: true or false." if scalar.type == "bool" else
                  f"{'Whole numbers' if scalar.type == 'int' else 'Numbers'} from {scalar.minimum} to {scalar.maximum}.")
    return f"{effect} {range_text}" if effect else range_text


def describe_fields(document: Document) -> list[dict]:
    items = {item.id: item for item in document.items}
    vehicles = {vehicle.id: vehicle for vehicle in document.vehicles}
    attached = {field.id: vehicle for vehicle in document.vehicles for field in vehicle.fields}
    result = []
    for scalar in document.fields:
        identifier = scalar.id
        if identifier.startswith("Player."):
            label, group, section = "Health", "Player", "player"
        elif identifier.startswith("Ammo."):
            name = identifier.removeprefix("Ammo.")
            label = "Armor" if name == "armor" else name.removeprefix("ammo_").replace("_", " ")
            group, section = "Supplies", "player"
        elif identifier.startswith("global."):
            name = identifier.removeprefix("global.")
            label, group, section = ("Nuts", "Currency", "player") if name == "Money" else (name, "Survival state", "player")
        elif identifier in SWITCH_LABELS:
            label, group, section = SWITCH_LABELS[identifier], "Gameplay settings", "settings"
        elif identifier in VOLUME_LABELS:
            label, group, section = VOLUME_LABELS[identifier], "Audio settings", "settings"
        elif identifier == "FOV":
            label, group, section = "Field of view", "Display settings", "settings"
        elif identifier.startswith("weaponsAmmoInGun."):
            label = identifier.removeprefix("weaponsAmmoInGun.") + " loaded rounds (weapon type)"
            group, section = "Ammunition by weapon type", "items"
        elif identifier.startswith("vehicle:"):
            vehicle = vehicles[identifier.rsplit(":", 1)[0]]
            label, group, section = f"{vehicle.name} fuel", "Fuel tank (L)", "vehicles"
        elif identifier.startswith("item:"):
            item_id, suffix = identifier.rsplit(":", 1)
            item = items[item_id]
            label = f"{item.object.name} {SUFFIXES.get(suffix, suffix)}"
            vehicle = attached.get(identifier)
            section = "vehicles" if vehicle else "items"
            group = f"{vehicle.name} components" if vehicle else {
                "Quantity": "Existing item quantities", "Condition": "Other saved item condition",
                "ammo": "Existing item ammunition", "Liquid": "Existing item liquids",
                "batteries": "Existing item batteries",
            }.get(suffix, "Saved item values")
        else:
            raise ValueError(f"No presentation mapping for verified field {identifier}.")
        result.append({"id": identifier, "label": label, "group": group, "section": section,
                       "value": scalar.value, "type": scalar.type, "min": scalar.minimum,
                       "max": scalar.maximum, "topOffConsumable": scalar.top_off, "help": _help(identifier, scalar)})
    return result
