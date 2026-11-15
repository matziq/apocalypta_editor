(function (root) {
  "use strict";

  const defaultTargets = Object.freeze({ ammo: 999, consumables: 999, nuts: 900000, liquids: 100 });
  function checkedTargets(targets = defaultTargets) {
    for (const [key, min, max] of [["ammo", 0, 2147483647], ["consumables", 1, 2147483647], ["nuts", 0, 1000000], ["liquids", 0, 100]]) {
      if (!Number.isInteger(targets[key]) || targets[key] < min || targets[key] > max) throw new Error(`${key} target must be a whole number from ${min} to ${max}.`);
    }
    return targets;
  }
  function countTarget(field, targets) {
    return field.id.startsWith("Ammo.") || field.id.startsWith("weaponsAmmoInGun.") ||
      field.id.endsWith(":ammo") || field.id.endsWith(":batteries") ? targets.ammo : targets.consumables;
  }
  function liquidTarget(field, targets) {
    return targets.liquids === 100 ? field.max : Number((field.max * targets.liquids / 100).toPrecision(12));
  }
  function stage(vehicle, fields, action, readValue, writeValue, validate, targets = defaultTargets) {
    checkedTargets(targets);
    const fieldById = new Map(fields.map(field => [field.id, field]));
    const suffixes = action === "repair" ? [":Condition"] : action === "topoff" ? [":fuel", ":Liquid"] : null;
    if (!suffixes) throw new Error(`Unknown vehicle action: ${action}`);
    let staged = 0;
    let skippedInvalid = 0;
    for (const id of new Set(vehicle?.fieldIds || [])) {
      if (!suffixes.some(suffix => id.endsWith(suffix))) continue;
      if (action === "topoff" && id.endsWith(":fuel") && /trailer/i.test(vehicle?.name || "")) continue;
      const field = fieldById.get(id);
      if (!field) continue;
      const current = readValue(field);
      if (current.invalid) {
        skippedInvalid++;
        continue;
      }
      const target = action === "repair" ? field.max : liquidTarget(field, targets);
      if (Number(current.value) === target) continue;
      validate(field, target);
      writeValue(field, target);
      staged++;
    }
    return { staged, skippedInvalid };
  }

  function all(vehicles, fields, readValue, writeValue, validate, targets = defaultTargets) {
    checkedTargets(targets);
    const result = { staged: 0, skippedInvalid: 0, missingRepair: 0, missingFuel: 0 };
    for (const vehicle of vehicles) {
      for (const [action, suffix, missing] of [["repair", ":Condition", "missingRepair"], ["topoff", ":fuel", "missingFuel"]]) {
        if (!(action === "topoff" && /trailer/i.test(vehicle.name || "")) &&
            !vehicle.fieldIds.some(id => id.endsWith(suffix))) result[missing]++;
        const next = stage(vehicle, fields, action, readValue, writeValue, validate, targets);
        result.staged += next.staged;
        result.skippedInvalid += next.skippedInvalid;
      }
    }
    return result;
  }

  function maximize(fields, readValue, writeValue, validate, targets = defaultTargets) {
    checkedTargets(targets);
    const result = { staged: 0, skipped: [] };
    for (const field of fields.filter(field => field.section === "player" && field.id !== "Ammo.armor" && (!field.id.endsWith("_capacity") || field.topOffConsumable))) {
      const target = field.id === "global.Money" ? targets.nuts : field.topOffConsumable ? targets.ammo :
        /^global\.(Hunger|Thirst|Fatigue|Radiation)$/.test(field.id) ? 0 : 100;
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

  function topOffConsumables(fields, readValue, writeValue, validate, targets = defaultTargets) {
    checkedTargets(targets);
    const result = { staged: 0, skippedInvalid: 0 };
    for (const field of fields.filter(field => field.topOffConsumable || field.id === "global.Money")) {
      const target = field.id === "global.Money" ? targets.nuts : countTarget(field, targets);
      const current = readValue(field);
      if (current.invalid) { result.skippedInvalid++; continue; }
      if (Number(current.value) === target) continue;
      validate(field, target);
      writeValue(field, target);
      result.staged++;
    }
    return result;
  }

  function maximizeItems(items, fields, readValue, writeValue, validate, targets = defaultTargets) {
    checkedTargets(targets);
    const ids = new Set(items.flatMap(item => item.fieldIds));
    const result = { staged: 0, skippedUnverified: 0, skippedInvalid: 0, readOnly: items.reduce((sum, item) => sum + item.readOnlyFields.length, 0) };
    for (const field of fields.filter(field => ids.has(field.id) || field.id.startsWith("weaponsAmmoInGun."))) {
      const target = field.id.endsWith(":Condition") ? field.max : field.id.endsWith(":Liquid") ? liquidTarget(field, targets) :
        field.topOffConsumable ? countTarget(field, targets) : undefined;
      if (target === undefined) {
        result.skippedUnverified++;
        continue;
      }
      const current = readValue(field);
      if (current.invalid) { result.skippedInvalid++; continue; }
      if (Number(current.value) === target) continue;
      validate(field, target);
      writeValue(field, target);
      result.staged++;
    }
    return result;
  }

  const api = { stage, all, maximize, maximizeItems, topOffConsumables, checkedTargets, defaultTargets };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ApocalypterVehicleActions = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
