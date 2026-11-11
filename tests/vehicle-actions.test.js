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
