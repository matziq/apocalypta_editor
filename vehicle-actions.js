(function (root) {
  "use strict";

  function stage(vehicle, fields, action, readValue, writeValue, validate) {
    const fieldById = new Map(fields.map(field => [field.id, field]));
    const suffix = action === "repair" ? ":Condition" : action === "topoff" ? ":fuel" : null;
    if (!suffix) throw new Error(`Unknown vehicle action: ${action}`);
    let staged = 0;
    let skippedInvalid = 0;
    for (const id of vehicle?.fieldIds || []) {
      if (!id.endsWith(suffix)) continue;
      const field = fieldById.get(id);
      if (!field) continue;
      const current = readValue(field);
      if (current.invalid) {
        skippedInvalid++;
        continue;
      }
      if (Number(current.value) === field.max) continue;
      validate(field, field.max);
      writeValue(field, field.max);
      staged++;
    }
    return { staged, skippedInvalid };
  }

  function all(vehicles, fields, readValue, writeValue, validate) {
    const result = { staged: 0, skippedInvalid: 0, missingRepair: 0, missingFuel: 0 };
    for (const vehicle of vehicles) {
      for (const [action, suffix, missing] of [["repair", ":Condition", "missingRepair"], ["topoff", ":fuel", "missingFuel"]]) {
        if (!vehicle.fieldIds.some(id => id.endsWith(suffix))) result[missing]++;
        const next = stage(vehicle, fields, action, readValue, writeValue, validate);
        result.staged += next.staged;
        result.skippedInvalid += next.skippedInvalid;
      }
    }
    return result;
  }

  function maximize(fields, readValue, writeValue, validate) {
    const result = { staged: 0, skipped: [] };
    for (const field of fields.filter(field => field.section === "player")) {
      const target = /^global\.(Hunger|Thirst|Fatigue|Radiation)$/.test(field.id) ? 0 : 100;
      if (readValue(field).invalid) { result.skipped.push(field.label); continue; }
      try { validate(field, target); }
      catch { result.skipped.push(field.label); continue; }
      if (Number(readValue(field).value) !== target) {
        writeValue(field, target);
        result.staged++;
      }
    }
    return result;
  }

  function maximizeItems(items, fields, readValue, writeValue, validate) {
    const ids = new Set(items.flatMap(item => item.fieldIds));
    const result = { staged: 0, skippedUnverified: 0, skippedInvalid: 0, readOnly: items.reduce((sum, item) => sum + item.readOnlyFields.length, 0) };
    for (const field of fields.filter(field => ids.has(field.id) || field.id.startsWith("weaponsAmmoInGun."))) {
      if (!field.id.endsWith(":Condition") && !field.id.endsWith(":Liquid")) {
        result.skippedUnverified++;
        continue;
      }
      const current = readValue(field);
      if (current.invalid) { result.skippedInvalid++; continue; }
      if (Number(current.value) >= field.max) continue;
      validate(field, field.max);
      writeValue(field, field.max);
      result.staged++;
    }
    return result;
  }

  const api = { stage, all, maximize, maximizeItems };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ApocalypterVehicleActions = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
