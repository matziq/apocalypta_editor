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

  const api = { stage };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ApocalypterVehicleActions = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
