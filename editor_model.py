"""Staged, validated edits and bulk operations for the native interface."""

from __future__ import annotations

import math
from collections.abc import Mapping

from bulk_actions import all_vehicles, maximize_items, maximize_player, stage_vehicle, top_off_consumables
from es3_document import inspect_document
from es3_scalars import _validate
from field_views import describe_fields


class EditorModel:
    def __init__(self, content: bytes):
        self.content = content
        self.document = inspect_document(content.decode("utf-8"))
        self.fields = describe_fields(self.document)
        self.by_id = {field["id"]: field for field in self.fields}
        self.scalars = {field.id: field for field in self.document.fields}
        self.drafts: dict[str, str | bool] = {}

    def stage(self, identifier: str, value: str | bool) -> None:
        if identifier not in self.by_id:
            raise ValueError(f"Editing {identifier} is not supported.")
        if not isinstance(value, (str, bool)):
            raise ValueError("A draft must be text or a boolean.")
        self.drafts[identifier] = value

    def read(self, field: Mapping) -> dict:
        identifier = field["id"]
        if identifier not in self.drafts:
            return {"invalid": False, "value": field["value"]}
        value = self.drafts[identifier]
        try:
            if field["type"] == "bool":
                if type(value) is not bool:
                    raise ValueError("Choose true or false.")
            else:
                if not isinstance(value, str) or not value.strip():
                    raise ValueError("Enter a number.")
                value = float(value)
                if not math.isfinite(value):
                    raise ValueError("Enter a finite number.")
                if field["type"] == "int" and value.is_integer():
                    value = int(value)
            _validate(self.scalars[identifier], value)
            return {"invalid": False, "value": value}
        except ValueError as exc:
            return {"invalid": True, "error": str(exc)}

    def changes(self) -> dict:
        result = {}
        for identifier in self.drafts:
            field = self.by_id[identifier]
            state = self.read(field)
            if state["invalid"]:
                raise ValueError(f'{field["label"]}: {state["error"]}')
            if state["value"] != field["value"]:
                result[identifier] = state["value"]
        return result

    def _write(self, field: Mapping, value: int | float) -> None:
        self.stage(field["id"], str(value))

    def _validate_target(self, field: Mapping, value: int | float) -> None:
        _validate(self.scalars[field["id"]], value)

    def maximize_player(self, targets: Mapping[str, int]) -> dict:
        return maximize_player(self.fields, self.read, self._write, self._validate_target, targets)

    def maximize_items(self, targets: Mapping[str, int]) -> dict:
        items = [{"fieldIds": [field.id for field in item.fields], "readOnlyFields": item.readonly}
                 for item in self.document.items]
        return maximize_items(items, self.fields, self.read, self._write, self._validate_target, targets)

    def vehicle_action(self, vehicle_id: str | None, action: str, targets: Mapping[str, int]) -> dict:
        vehicles = [{"id": vehicle.id, "name": vehicle.name,
                     "fieldIds": [field.id for field in vehicle.fields]}
                    for vehicle in self.document.vehicles]
        if vehicle_id is None:
            if action != "both":
                raise ValueError("Select a vehicle.")
            result = all_vehicles(vehicles, self.fields, self.read, self._write, self._validate_target, targets)
            consumables = top_off_consumables(self.fields, self.read, self._write, self._validate_target, targets)
            result["staged"] += consumables["staged"]
            result["skippedInvalid"] += consumables["skippedInvalid"]
            return result
        vehicle = next((entry for entry in vehicles if entry["id"] == vehicle_id), None)
        if vehicle is None:
            raise ValueError("Select a valid vehicle.")
        return stage_vehicle(vehicle, self.fields, action, self.read, self._write, self._validate_target, targets)
