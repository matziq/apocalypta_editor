"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { inspect, serialize } = require("../save-format.js");
const pmType = "ES3PlayMaker.PMDataWrapper,Assembly-CSharp-firstpass";
const game = `\ufeff{\r\n "Player":{"__type":"${pmType}","value":{"objs":{"Health":{"__type":"float"1e2},"Player":{"__type":"GameObject","_ES3Ref":"9005913460443800891","unknown":1234567890123456789}},"arrays":{},"obj":null,"array":null}},\r\n "Ammo":{"__type":"${pmType}","value":{"objs":{"ammo_9mm":{"__type":"int"12},"armor":{"__type":"float"0}}}},\r\n "future":{"odd":[null,true,{"escaped":"brace } quote \\" and slash \\\\"}]}\r\n}`;
const settings = '{"peacefulMode":{"__type":"bool","value":false},"audio_volume":{"__type":"float","value":1},"saveTime1":{"__type":"string","value":"10\\\\11\\\\2026"},"unknown":{"value":9005913460443800891}}';

test("reads actual PlayMaker inline scalar syntax", () => {
  const doc = inspect(game);
  assert.equal(doc.kind, "Game save");
  assert.deepEqual(doc.fields.map(f => [f.id, f.value]), [["Player.Health", 100], ["Ammo.armor", 0], ["Ammo.ammo_9mm", 12]]);
});
test("no-op roundtrip preserves BOM, CRLF, precision and spelling", () => {
  assert.equal(serialize(game, {}), game);
  assert.equal(serialize(game, { "Player.Health": 100 }), game);
});
test("only exact numeric spans change", () => {
  assert.equal(serialize(game, { "Player.Health": 75, "Ammo.ammo_9mm": 30 }), game.replace('"float"1e2', '"float"75').replace('"int"12', '"int"30'));
});
test("standard ES3 settings retain unknown data", () => {
  assert.equal(inspect(settings).fields.length, 2);
  assert.equal(serialize(settings, { peacefulMode: true, audio_volume: 0.5 }), settings.replace('"value":false', '"value":true').replace('"value":1}', '"value":0.5}'));
});
test("rejects fractional, non-finite, out-of-range and wrongly typed edits", () => {
  for (const value of [-1, 2147483648, 1.5, NaN, Infinity, "3", null]) {
    assert.throws(() => serialize(game, { "Ammo.ammo_9mm": value }));
  }
  assert.throws(() => serialize(game, { "Player.Health": 101 }));
  assert.throws(() => serialize(settings, { peacefulMode: 1 }));
  assert.throws(() => serialize(settings, { audio_volume: 2 }));
});
test("rejects editing unverified or structural fields", () => {
  assert.throws(() => serialize(game, { "_ES3Ref": 0 }), /not supported/);
  assert.throws(() => serialize(settings, { saveTime1: "now" }), /not supported/);
});
test("rejects malformed, truncated, encrypted and unknown formats", () => {
  for (const text of ["", "binary", "{}", "[]", game.slice(0, -1), game + "garbage", '{"peacefulMode":{"__type":"bool","value":false,}}']) {
    assert.throws(() => inspect(text));
  }
});
test("duplicate keys are refused instead of editing an ambiguous field", () => {
  assert.throws(() => inspect(settings.replace('"value":false', '"value":false,"value":true')), /Duplicate/);
});
test("wrong type in a recognized field fails closed", () => {
  assert.throws(() => inspect(game.replace('"float"1e2', '"string"100')), /Unsupported structure/);
});
test("Map edits, boundary values and scientific notation are supported", () => {
  assert.equal(inspect(serialize(game, new Map([["Ammo.ammo_9mm", 2147483647]]))).fields.find(f => f.id === "Ammo.ammo_9mm").value, 2147483647);
  assert.equal(inspect(serialize(game, { "Player.Health": 0 })).fields[0].value, 0);
});
test("does not mistake escaped field-like text for real fields", () => {
  const text = settings.replace('"value":"10\\\\11\\\\2026"', '"value":"\\"Health\\":{\\"__type\\":\\"float\\"100}"');
  assert.equal(inspect(text).fields.length, 2);
  assert.equal(serialize(text, {}), text);
});
test("rejects huge and deeply nested inputs", () => {
  assert.throws(() => inspect(" ".repeat(20 * 1024 * 1024 + 1) + "{}"), /20 MiB/);
  assert.throws(() => inspect('{"x":' + "[".repeat(152) + "0" + "]".repeat(152) + "}"), /complex/);
});
test("rejects ambiguous inline plus named scalar values", () => {
  assert.throws(() => inspect(game.replace('"float"1e2', '"float"1e2,"value":90')), /Ambiguous/);
});

const gameWrapper = "ES3PlayMaker.PMDataWrapper,Assembly-CSharp-firstpass";
function pm(objs, array = null) {
  return { __type: gameWrapper, value: { objs, arrays: null, obj: null, array } };
}
function gameObject(name, ref, transformId, parentRef = null) {
  return {
    __type: "GameObject",
    _ES3Ref: String(ref),
    transformID: String(transformId),
    tag: "Rigidbody",
    name,
    active: true,
    components: [{
      __type: "Transform",
      _ES3Ref: String(transformId),
      goID: String(ref),
      parent: parentRef === null ? null : { _ES3Ref: String(parentRef) },
      localPosition: { x: 0, y: 0, z: 0 }
    }]
  };
}
function itemRecord(name, ref, fields) {
  return pm({
    ...fields,
    owner: { __type: "GameObject", _ES3Ref: String(ref), name }
  });
}
function domainSave({ duplicateItemRef = false, worldItems = false, duplicateWorldRef = false, itemCapacity = false, crossArrayRef = false } = {}) {
  const shiv25 = gameObject("shiv(Clone)25", 101, 1001);
  const shiv55 = gameObject("shiv(Clone)55", 102, 1002);
  const akms = gameObject("akms(Clone)50", 103, 1003, 99001);
  const bandage = gameObject("bandage_1(Clone)16", 104, 1004, 99002);
  const duplicateBandage = gameObject("bandage_1(Clone)17", duplicateItemRef ? 104 : 107, 1007, 99003);
  const engineName = "594cc I2 23HP 39Nm Gasoline(Clone)3";
  const engine = gameObject(engineName, 105, 1005, 301);
  const radiatorName = "radiator_small(Clone)48";
  const radiator = gameObject(radiatorName, 106, 1006, 302);
  const carName = "Poloska(Clone)1";
  const car = gameObject(carName, 200, 2000);
  const root = {
    Player: pm({ Health: { __type: "float", value: 100 } }),
    Ammo: pm({ armor: { __type: "float", value: 0 } }),
    "shiv(Clone)25": { __type: "System.Object", value: { __type: "int", value: 0 } },
    "shiv(Clone)55": { __type: "System.Object", value: { __type: "int", value: 0 } },
    "akms(Clone)50": { __type: "System.Object", value: { __type: "int", value: 0 } },
    "bandage_1(Clone)16": itemRecord("bandage_1(Clone)16", 104, {
      Quantity: { __type: "int", value: 2 }
    }),
    [engineName]: itemRecord(engineName, 105, {
      Condition: { __type: "float", value: 74.25 }
    }),
    [radiatorName]: itemRecord(radiatorName, 106, {
      Condition: { __type: "float", value: 47.5 }
    }),
    [carName]: itemRecord(carName, 200, {
      Liquid: { __type: "float", value: 18.5 },
      LiquidCapacity: { __type: "float", value: 21 },
      hinge_engine: { __type: "GameObject", _ES3Ref: "3010", transformID: "301" },
      hinge_radiator: { __type: "GameObject", _ES3Ref: "3020", transformID: "302" },
      hinge_exhaust: { __type: "GameObject", _ES3Ref: "3030", transformID: "303" }
    }),
    weaponsAmmoInGun: pm({
      ammoakms: { __type: "int", value: 30 }
    }),
    newGOArray_Items: pm(null, [shiv25, shiv55, akms, bandage, duplicateBandage, engine, radiator]),
    newGOArray_Cars: pm(null, [car])
  };
  if (worldItems) {
    const looseName = "3L I5 Diesel(Clone)38";
    const storedName = "3L I5 Diesel(Clone)39";
    const ammoName = "ammo_box_762mm(Clone)40";
    const canName = "Gasoline_Can(Clone)41";
    root.newGOArray_Items.value.array.push(
      gameObject(looseName, 801, 8001),
      gameObject(storedName, duplicateWorldRef ? 801 : 802, 8002, 99009),
      gameObject(ammoName, 803, 8003),
      gameObject(canName, 804, 8004)
    );
    root[looseName] = itemRecord(looseName, 801, {
      Condition: { __type: "float", value: 21.25 },
      finalGearRatio: { __type: "float", value: 4 }
    });
    root[storedName] = itemRecord(storedName, duplicateWorldRef ? 801 : 802, {
      Condition: { __type: "float", value: 34.5 }
    });
    root[ammoName] = itemRecord(ammoName, 803, { ammo: { __type: "int", value: 10 } });
    root[canName] = itemRecord(canName, 804, {
      Liquid: { __type: "float", value: 6.25 },
      ...(itemCapacity ? { LiquidCapacity: { __type: "float", value: 20 } } : {})
    });
    if (crossArrayRef) {
      root.newGOArray_Cars.value.array.push(gameObject("ambiguous_car(Clone)9", 801, 8099));
      root["ambiguous_car(Clone)9"] = itemRecord("ambiguous_car(Clone)9", 801, {
        Liquid: { __type: "float", value: 5 }, LiquidCapacity: { __type: "float", value: 20 }
      });
    }
  }
  return JSON.stringify(root).replace(
    /"__type":"(float|int|bool)","value":(true|false|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    '"__type":"$1"$2'
  );
}

test("lists two shiv instances and an AKMS instance without inventing inventory ownership", () => {
  const doc = inspect(domainSave());
  const shivs = doc.items.filter(item => item.name.startsWith("shiv(Clone)"));
  const akms = doc.items.find(item => item.name === "akms(Clone)50");
  assert.equal(shivs.length, 2);
  assert.notEqual(shivs[0].ref, shivs[1].ref);
  assert.ok(shivs.every(item => item.location === "Unparented / world-root"));
  assert.equal(akms.location, "Unresolved parent / container");
  assert.equal(akms.loadedAmmo.scope, "weapon type");
  assert.equal(akms.loadedAmmo.value, 30);
  assert.equal(doc.fields.find(field => field.id === "weaponsAmmoInGun.ammoakms").value, 30);
});
test("duplicate object references are disambiguated and linked scalar edits are withheld", () => {
  const doc = inspect(domainSave({ duplicateItemRef: true }));
  const shivs = doc.items.filter(item => item.name.startsWith("shiv(Clone)"));
  assert.equal(shivs.length, 2);
  assert.ok(shivs.every(item => item.location === "Unparented / world-root"));
  const duplicateBandages = doc.items.filter(item => item.name.startsWith("bandage_1(Clone)"));
  assert.equal(duplicateBandages.length, 2);
  assert.ok(duplicateBandages.every(item => item.location === "Ambiguous duplicate object reference"));
  assert.equal(doc.fields.some(field => field.id.endsWith(":Quantity")), false);
});
test("joins vehicle fuel and mounted component condition through exact saved references", () => {
  const doc = inspect(domainSave());
  assert.equal(doc.vehicles.length, 1);
  const vehicle = doc.vehicles[0];
  assert.equal(vehicle.name, "Poloska(Clone)1");
  assert.deepEqual(vehicle.fuel, { value: 18.5, capacity: 21, unit: "L" });
  assert.deepEqual(vehicle.parts.map(part => [part.name, part.attachedTo, part.condition]), [
    ["594cc I2 23HP 39Nm Gasoline(Clone)3", "Poloska(Clone)1 · Engine", 74.25],
    ["radiator_small(Clone)48", "Poloska(Clone)1 · Radiator", 47.5]
  ]);
});
test("serializes only selected quantity, condition, fuel, and type-ammo tokens", () => {
  const text = domainSave();
  const doc = inspect(text);
  const fields = [
    doc.fields.find(field => field.id.endsWith(":Quantity")),
    doc.fields.find(field => field.id.endsWith(":Condition")),
    doc.fields.find(field => field.id.endsWith(":fuel")),
    doc.fields.find(field => field.id === "weaponsAmmoInGun.ammoakms")
  ];
  assert.ok(fields.every(Boolean));
  const values = new Map([[fields[0].id, 4], [fields[1].id, 99.5], [fields[2].id, 0], [fields[3].id, 45]]);
  let expected = text;
  for (const field of [...fields].sort((a, b) => b.start - a.start)) {
    expected = expected.slice(0, field.start) + JSON.stringify(values.get(field.id)) + expected.slice(field.end);
  }
  const edited = serialize(text, values);
  assert.equal(edited, expected);
  const reopened = inspect(edited);
  for (const [id, value] of values) assert.equal(reopened.fields.find(field => field.id === id).value, value);
  assert.equal(serialize(text, {}), text);
});
test("bounds existing stack quantity, component percent and fuel by saved tank capacity", () => {
  const text = domainSave();
  const doc = inspect(text);
  const quantity = doc.fields.find(field => field.id.endsWith(":Quantity"));
  const condition = doc.fields.find(field => field.id.endsWith(":Condition"));
  const fuel = doc.fields.find(field => field.id.endsWith(":fuel"));
  assert.throws(() => serialize(text, { [quantity.id]: 0 }), /between 1 and/);
  assert.throws(() => serialize(text, { [condition.id]: 100.01 }), /between 0 and 100/);
  assert.throws(() => serialize(text, { [fuel.id]: 21.01 }), /between 0 and 21/);
});

test("loose and unresolved-parent parts can be edited independently without ownership changes", () => {
  const text = domainSave({ worldItems: true });
  const doc = inspect(text);
  const parts = doc.items.filter(item => item.name.startsWith("3L I5 Diesel"));
  assert.equal(parts[0].location, "Unparented / world-root");
  assert.equal(parts[1].location, "Unresolved parent / container");
  const field = doc.fields.find(field => field.id === parts[0].fieldIds[0]);
  assert.equal(field.section, "items");
  assert.match(field.label, /Clone\)38/);
  assert.equal(serialize(text, { [field.id]: 100 }), text.slice(0, field.start) + "100" + text.slice(field.end));
  const reopened = inspect(serialize(text, { [field.id]: 100 }));
  assert.equal(reopened.items.find(item => item.id === parts[1].id).condition, 34.5);
  assert.deepEqual(reopened.items.map(item => [item.ref, item.parentRef]), doc.items.map(item => [item.ref, item.parentRef]));
  assert.ok(parts[0].readOnlyFields.some(field => field.name === "finalGearRatio"));
});

test("world ammo boxes expose their own count while unknown liquid capacity stays read-only", () => {
  const text = domainSave({ worldItems: true });
  const doc = inspect(text);
  const box = doc.items.find(item => item.name.startsWith("ammo_box_"));
  const can = doc.items.find(item => item.name.startsWith("Gasoline_Can"));
  assert.equal(box.ammo, 10);
  const [ammoId] = box.fieldIds;
  assert.equal(inspect(serialize(text, { [ammoId]: 0 })).items.find(item => item.id === box.id).ammo, 0);
  for (const value of [-1, 0.5, 2147483648]) assert.throws(() => serialize(text, { [ammoId]: value }));
  assert.equal(can.fieldIds.length, 0);
  assert.match(can.readOnlyFields.find(field => field.name === "Liquid").reason, /no capacity or units are guessed/);
  assert.throws(() => serialize(text, { [`${can.id}:Liquid`]: 20 }), /not supported/);
});

test("item liquids use only their own saved capacity and ambiguous world parts remain protected", () => {
  const text = domainSave({ worldItems: true, itemCapacity: true });
  const can = inspect(text).items.find(item => item.name.startsWith("Gasoline_Can"));
  assert.deepEqual(can.liquid, { value: 6.25, capacity: 20 });
  const [id] = can.fieldIds;
  assert.equal(inspect(serialize(text, { [id]: 20 })).items.find(item => item.id === can.id).liquid.value, 20);
  assert.throws(() => serialize(text, { [id]: 20.01 }), /between 0 and 20/);
  const ambiguous = inspect(domainSave({ worldItems: true, duplicateWorldRef: true })).items.filter(item => item.name.startsWith("3L I5 Diesel"));
  assert.ok(ambiguous.every(item => !item.fieldIds.length && !item.matchedRecord));
  const crossArray = inspect(domainSave({ worldItems: true, crossArrayRef: true }));
  assert.equal(crossArray.items.find(item => item.name === "3L I5 Diesel(Clone)38").fieldIds.length, 0);
  assert.equal(crossArray.vehicles.find(car => car.name === "ambiguous_car(Clone)9").fieldIds.length, 0);
});
