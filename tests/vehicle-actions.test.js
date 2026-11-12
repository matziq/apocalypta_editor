"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Actions = require("../vehicle-actions.js");

function fixture() {
  const fields = [
    { id: "car-1:fuel", max: 21, value: 18.4 },
    { id: "car-1:Condition", max: 100, value: 74 },
    { id: "car-2:Condition", max: 100, value: 60 },
    { id: "Player.Health", max: 100, value: 50 }
  ];
  return {
    vehicle: { fieldIds: ["car-1:fuel", "car-1:Condition", "Player.Health"] },
    fields,
    drafts: new Map(fields.map(field => [field.id, { value: String(field.value), invalid: false }]))
  };
}
function apply(fixture, action) {
  const updates = [];
  const result = Actions.stage(
    fixture.vehicle,
    fixture.fields,
    action,
    field => fixture.drafts.get(field.id),
    (field, value) => {
      fixture.drafts.get(field.id).value = String(value);
      updates.push([field.id, value]);
    },
    (field, value) => assert.ok(value <= field.max)
  );
  return { ...result, updates };
}

test("repair stages only supported condition fields on the selected vehicle", () => {
  const state = fixture();
  assert.deepEqual(apply(state, "repair"), {
    staged: 1,
    skippedInvalid: 0,
    updates: [["car-1:Condition", 100]]
  });
  assert.equal(state.drafts.get("car-1:fuel").value, "18.4");
  assert.equal(state.drafts.get("Player.Health").value, "50");
});

test("top-off uses that vehicle's saved capacity and does not touch other vehicles", () => {
  const state = fixture();
  const result = apply(state, "topoff");
  assert.deepEqual(result, { staged: 1, skippedInvalid: 0, updates: [["car-1:fuel", 21]] });
});

test("missing eligible fields do nothing and unrelated invalid drafts are preserved", () => {
  const state = fixture();
  state.drafts.get("Player.Health").invalid = true;
  const result = apply(state, "repair");
  assert.equal(result.staged, 1);
  assert.equal(state.drafts.get("Player.Health").invalid, true);
  state.vehicle.fieldIds = ["unknown:fuel"];
  assert.deepEqual(apply(state, "topoff"), { staged: 0, skippedInvalid: 0, updates: [] });
});

test("invalid targeted edits are skipped instead of overwritten", () => {
  const state = fixture();
  state.drafts.get("car-1:Condition").invalid = true;
  assert.deepEqual(apply(state, "repair"), { staged: 0, skippedInvalid: 1, updates: [] });
});
test("all-vehicle batch skips missing mappings and invalid targets without touching unrelated drafts", () => {
  const state = fixture();
  state.drafts.get("car-1:Condition").invalid = true;
  state.drafts.get("Player.Health").value = "not valid";
  const updates = [];
  const result = Actions.all([state.vehicle, { fieldIds: ["car-2:Condition"] }, { fieldIds: [] }], state.fields,
    field => state.drafts.get(field.id), (field, value) => updates.push([field.id, value]), (field, value) => assert.ok(value <= field.max));
  assert.deepEqual(updates, [["car-1:fuel", 21], ["car-2:Condition", 100]]);
  assert.deepEqual(result, { staged: 2, skippedInvalid: 1, missingRepair: 1, missingFuel: 2 });
  assert.equal(state.drafts.get("Player.Health").value, "not valid");
});
test("item maximization skips unknown maxima and invalid drafts, never lowers or duplicates targets", () => {
  const fields = [
    { id: "part:Condition", max: 100 }, { id: "can:Liquid", max: 5 }, { id: "part:Quantity", max: 2147483647 },
    { id: "weaponsAmmoInGun.ammoakms", max: 2147483647 }, { id: "other:Condition", max: 100 }
  ];
  const items = [{ fieldIds: fields.slice(0, 3).map(field => field.id), readOnlyFields: [{}] }, { fieldIds: ["part:Condition", "other:Condition"], readOnlyFields: [] }];
  const drafts = new Map([
    ["part:Condition", { value: 95, invalid: true }], ["can:Liquid", { value: 6, invalid: false }],
    ["part:Quantity", { value: 2, invalid: false }], ["other:Condition", { value: 25, invalid: false }]
  ]);
  const updates = [];
  const result = Actions.maximizeItems(items, fields, field => drafts.get(field.id), (field, value) => updates.push([field.id, value]), () => {});
  assert.deepEqual(updates, [["other:Condition", 100]]);
  assert.deepEqual(result, { staged: 1, skippedUnverified: 2, skippedInvalid: 1, readOnly: 1 });
});
