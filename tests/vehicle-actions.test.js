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
test("trailer fuel fields are ignored even if supplied to a vehicle action", () => {
  const trailer = { name: "Trailer_Big(Clone)407", fieldIds: ["trailer:fuel"] };
  const fields = [{ id: "trailer:fuel", max: 20 }];
  const updates = [];
  const read = () => ({ value: 5, invalid: false });
  const write = (field, value) => updates.push([field.id, value]);
  assert.deepEqual(Actions.stage(trailer, fields, "topoff", read, write, () => {}), { staged: 0, skippedInvalid: 0 });
  assert.deepEqual(Actions.all([trailer], fields, read, write, () => {}),
    { staged: 0, skippedInvalid: 0, missingRepair: 1, missingFuel: 0 });
  assert.deepEqual(updates, []);
});
test("item maximization applies requested counts, skips invalid drafts and deduplicates targets", () => {
  const fields = [
    { id: "part:Condition", max: 100 }, { id: "can:Liquid", max: 5 }, { id: "part:Quantity", max: 2147483647 },
    { id: "weaponsAmmoInGun.ammoakms", max: 2147483647, bulkTarget: 100 }, { id: "other:Condition", max: 100 }
  ];
  const items = [{ fieldIds: fields.slice(0, 3).map(field => field.id), readOnlyFields: [{}] }, { fieldIds: ["part:Condition", "other:Condition"], readOnlyFields: [] }];
  const drafts = new Map([
    ["part:Condition", { value: 95, invalid: true }], ["can:Liquid", { value: 6, invalid: false }],
    ["part:Quantity", { value: 2, invalid: false }], ["other:Condition", { value: 25, invalid: false }],
    ["weaponsAmmoInGun.ammoakms", { value: 200, invalid: false }]
  ]);
  const updates = [];
  const result = Actions.maximizeItems(items, fields, field => drafts.get(field.id), (field, value) => updates.push([field.id, value]), () => {});
  assert.deepEqual(updates, [["can:Liquid", 5], ["weaponsAmmoInGun.ammoakms", 100], ["other:Condition", 100]]);
  assert.deepEqual(result, { staged: 3, skippedUnverified: 1, skippedInvalid: 1, readOnly: 1 });
});

test("consumable top-off skips invalid drafts and unrelated armor or capacity fields", () => {
  const fields = [
    { id: "Ammo.armor" }, { id: "Ammo.armorPlates" }, { id: "Ammo.ammo_9mm_capacity" },
    { id: "Ammo.ammo_9mm", topOffConsumable: true },
    { id: "item:aid:Quantity", topOffConsumable: true },
    { id: "item:unknown:Quantity" }, { id: "global.Money" }
  ];
  const drafts = new Map(fields.map(field => [field.id, { value: 2, invalid: false }]));
  drafts.get("item:aid:Quantity").invalid = true;
  const updates = [];
  const result = Actions.topOffConsumables(fields, field => drafts.get(field.id),
    (field, value) => updates.push([field.id, value]), () => {});
  assert.deepEqual(updates, [["Ammo.ammo_9mm", 999], ["global.Money", 900000]]);
  assert.deepEqual(result, { staged: 2, skippedInvalid: 1 });
});
