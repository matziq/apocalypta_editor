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
test("every supported setting and parser field carries meaningful floating help, including read-only reasons", () => {
  const bools = ["peacefulMode", "disableThirstHunger", "disableFatigue", "mapCheat", "disableInsanity", "toggleHeadbob", "toggleFPS", "toggleFootstepSounds", "toggleADS", "automatic_gearbox", "autoclutch", "normalizeinput", "bloom", "sharpen"];
  const volumes = ["ambient_volume", "enginesoundvolume", "boss_music", "ambient_music", "audio_volume", "main_menu_music"];
  const root = Object.fromEntries([...bools.map(id => [id, { __type: "bool", value: false }]), ...volumes.map(id => [id, { __type: "float", value: 0.5 }]), ["FOV", { __type: "float", value: 90 }]]);
  const doc = inspect(JSON.stringify(root));
  assert.equal(doc.fields.length, 21);
  for (const field of doc.fields) {
    assert.ok(field.help?.length > 40, field.id);
    if (field.type === "bool") assert.match(field.help, /True|Enables|Selects/, field.id);
    else assert.match(field.help, /from \d+ to/, field.id);
  }
  for (const field of inspect(game).fields) assert.ok(field.help?.length > 40, field.id);
  const readOnly = inspect(game.replace('"float"1e2', '"float"101')).readOnlyFields[0];
  assert.match(readOnly.help, /Read-only:.*preserved unchanged/);
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
test("out-of-editor-range saved values stay read-only without blocking unrelated edits", () => {
  const text = game.replace('"float"1e2', '"float"1.01e2').replace('"float"0', '"float"-1');
  const doc = inspect(text);
  assert.deepEqual(doc.readOnlyFields.map(field => [field.id, field.value]), [["Player.Health", 101], ["Ammo.armor", -1]]);
  assert.match(doc.readOnlyFields[0].reason, /preserved unchanged/);
  assert.equal(serialize(text, {}), text);
  assert.equal(serialize(text, { "Ammo.ammo_9mm": 30 }), text.replace('"int"12', '"int"30'));
  assert.throws(() => serialize(text, { "Player.Health": 100 }), /not supported/);
  const onlyReadOnly = '{"FOV":{"__type":"float","value":121}}';
  assert.equal(inspect(onlyReadOnly).fields.length, 0);
  assert.deepEqual(inspect(onlyReadOnly).sections.map(section => section.id), ["settings"]);
  assert.equal(serialize(onlyReadOnly, {}), onlyReadOnly);
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
test("world coordinates compose uniquely resolved transforms and reject missing, ambiguous and cyclic parents", () => {
  const player = gameObject("Player", "4908172907895950466", "9005913460443800891");
  player.components[0].localPosition = { x: 10, y: 2, z: 20 };
  const rootItem = gameObject("root(Clone)1", "r", "rt");
  rootItem.components[0].localPosition = { x: 100, y: 0, z: 200 };
  rootItem.components[0].localRotation = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };
  rootItem.components[0].localScale = { x: 2, y: 1, z: 1 };
  const child = gameObject("child(Clone)2", "c", "ct", "rt");
  child.components[0].localPosition = { x: 1, y: 0, z: 0 };
  const zero = gameObject("zero(Clone)3", "z", "zt", "ct");
  child.components[0].localRotation = { x: 0, y: 0, z: 0, w: 1 };
  child.components[0].localScale = { x: 1, y: 1, z: 1 };
  const missing = gameObject("missing(Clone)4", "m", "mt");
  delete missing.components[0].parent;
  const malformed = gameObject("malformed(Clone)5", "f", "ft");
  malformed.components[0].parent = { _ES3Ref: 123 };
  const absent = gameObject("absent(Clone)6", "a", "at");
  absent.components = [];
  const cycle1 = gameObject("cycle(Clone)7", "c1", "c1t", "c2t");
  const cycle2 = gameObject("cycle(Clone)8", "c2", "c2t", "c1t");
  for (const o of [cycle1, cycle2]) {
    o.components[0].localRotation = { x: 0, y: 0, z: 0, w: 1 };
    o.components[0].localScale = { x: 1, y: 1, z: 1 };
  }
  const dup1 = gameObject("dup(Clone)9", "d1", "dt");
  const dup2 = gameObject("dup(Clone)10", "d2", "dt");
  const owner1 = gameObject("owner(Clone)11", "duplicate-owner", "o1");
  const owner2 = gameObject("owner(Clone)12", "duplicate-owner", "o2");
  const text = JSON.stringify({ Player: pm({ Health: { __type: "float", value: 100 }, Player: player }),
    newGOArray_Items: pm(null, [rootItem, child, zero, missing, malformed, absent, cycle1, cycle2, dup1, dup2, owner1, owner2]) });
  const doc = inspect(text);
  assert.deepEqual(doc.playerPosition, { x: 10, y: 2, z: 20 });
  assert.deepEqual(doc.items[0].worldPosition, { x: 100, y: 0, z: 200 });
  for (const item of doc.items.slice(1, 3)) {
    assert.ok(Math.abs(item.worldPosition.x - 100) < 1e-8);
    assert.ok(Math.abs(item.worldPosition.z - 198) < 1e-8);
  }
  for (const item of doc.items.slice(3)) assert.equal(item.worldPosition, null, item.name);
  assert.equal(doc.items[3].parentState, "unresolved");
  assert.equal(doc.items[4].parentState, "unresolved");
  assert.equal(doc.items[5].parentState, "unresolved");
  assert.equal(serialize(text, {}), text);
});
test("user slot labels require the confirmed player anchor and exact parent with zero offset", () => {
  const player = gameObject("Player", "4908172907895950466", "9005913460443800891");
  const slot = gameObject("bandage(Clone)1", "a", "at", "6374689825314962276");
  const distant = gameObject("bandage(Clone)2", "b", "bt", "6374689825314962276");
  distant.components[0].localPosition.x = 5;
  const root = { Player: pm({ Health: { __type: "float", value: 100 }, Player: player }), newGOArray_Items: pm(null, [slot, distant]) };
  let doc = inspect(JSON.stringify(root));
  assert.match(doc.items[0].location, /Bandage slot/);
  assert.doesNotMatch(doc.items[1].location, /Bandage slot/);
  assert.deepEqual(doc.identifiedSlots.find(s => s.label === "Bandage slot").items.map(i => i.name), ["bandage(Clone)1"]);
  player._ES3Ref = "other";
  doc = inspect(JSON.stringify(root));
  assert.equal(doc.identifiedSlots.length, 0);
  assert.doesNotMatch(doc.items[0].location, /Bandage slot/);
});
test("user-confirmed slots and vehicle containers follow exact parent links, including nested contents", () => {
  const player = gameObject("Player", "4908172907895950466", "9005913460443800891");
  const slots = [
    ["6374689825314962276", "Bandage slot"], ["9124196666788711796", "First Aid Kit slot"],
    ["3656544721015511630", "Weapon slot 1"], ["1591285762866710851", "Weapon slot 2"],
    ["2901622336603839876", "Weapon slot 3"], ["6707555155505277952", "Flashlight slot (L)"],
    ["1007585140629016984", "Body armor slot"], ["5762072836280993281", "Backpack slot"],
    ["6960692475879471560", "Binoculars slot"]
  ];
  const equipped = slots.map(([ref], i) => {
    const item = gameObject(`equipped(Clone)${i}`, `e${i}`, `et${i}`, ref);
    if (i > 1) item.components[0].localPosition.x = 2;
    return item;
  });
  const trailer = gameObject("Trailer_Big(Clone)407", "trailer", "trailert");
  trailer.es3Prefab = { prefabId: "3545007504786799582", refs: { "8038138322462240083": "1052945493227557322" } };
  const car = gameObject("Vulture(Clone)76", "car", "cart");
  car.es3Prefab = { prefabId: "8734799950597450027", refs: { "2086200191613234582": "7489528302310536125" } };
  const crate = gameObject("crate(Clone)1", "crate", "cratet", "1052945493227557322");
  const nested = gameObject("cargo(Clone)2", "cargo", "cargot", "cratet");
  const boxItem = gameObject("akms(Clone)3", "akms", "akmst", "7489528302310536125");
  const root = { Player: pm({ Health: { __type: "float", value: 100 }, Player: player }),
    newGOArray_Items: pm(null, [...equipped, crate, nested, boxItem]), newGOArray_Cars: pm(null, [trailer, car]) };
  let doc = inspect(JSON.stringify(root));
  for (const [i, [, label]] of slots.entries()) {
    assert.match(doc.items[i].location, new RegExp(label.replace(/[()]/g, "\\$&")));
    assert.equal(doc.identifiedSlots[i].items[0].name, equipped[i].name);
  }
  assert.match(doc.items[9].location, /trailer container/);
  assert.match(doc.items[10].location, /trailer container/);
  assert.match(doc.items[11].location, /box in vehicle trunk/);
  trailer.es3Prefab.prefabId = "wrong";
  doc = inspect(JSON.stringify(root));
  assert.doesNotMatch(doc.items[9].location, /trailer container/);
  assert.doesNotMatch(doc.items[10].location, /trailer container/);
  assert.match(doc.items[11].location, /box in vehicle trunk/);
});
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

test("trailer vehicle liquid is never classified as fuel, regardless of name casing", () => {
  for (const name of ["Trailer_Big(Clone)407", "small_trailer(Clone)1"]) {
    const root = {
      Player: pm({ Health: { __type: "float", value: 100 } }),
      newGOArray_Cars: pm(null, [gameObject(name, 200, 2000)]),
      [name]: itemRecord(name, 200, { Liquid: { __type: "float", value: 5 }, LiquidCapacity: { __type: "float", value: 20 } })
    };
    const text = JSON.stringify(root), doc = inspect(text), trailer = doc.vehicles[0];
    assert.equal(trailer.fuel, null);
    assert.equal(trailer.fieldIds.some(id => id.endsWith(":fuel")), false);
    assert.match(trailer.warnings.join(" "), /Trailer liquid fields are not identified as fuel/);
    const updates = {};
    require("../vehicle-actions.js").stage(trailer, doc.fields, "topoff",
      field => ({ value: field.value, invalid: false }), (field, value) => { updates[field.id] = value; }, require("../save-format.js").validate);
    assert.equal(Object.keys(updates).some(id => id.endsWith(":fuel")), false);
    assert.equal(serialize(text, {}), text);
  }
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

test("First Aid and Weed expose only their existing stack quantities", () => {
  const aidName = "first_aid_1(Clone)359", weedName = "weed_bag(Clone)333";
  const aid = gameObject(aidName, 901, 9001, "7489528302310536125");
  aid.es3Prefab = { prefabId: "3955095449936337101" };
  const weed = gameObject(weedName, 902, 9002, "1668109356054687553");
  weed.es3Prefab = { prefabId: "2856772050428381491" };
  const carName = "Vulture(Clone)76", car = gameObject(carName, 903, 9003);
  car.es3Prefab = { prefabId: "8734799950597450027", refs: { "2086200191613234582": "7489528302310536125" } };
  const root = {
    Player: pm({ Health: { __type: "float", value: 100 } }),
    Ammo: pm({ armor: { __type: "float", value: 0 } }),
    newGOArray_Items: pm(null, [aid, weed]),
    newGOArray_Cars: pm(null, [car]),
    [aidName]: itemRecord(aidName, 901, { Quantity: { __type: "int", value: 3 } }),
    [weedName]: itemRecord(weedName, 902, { Quantity: { __type: "int", value: 4 } }),
    [carName]: itemRecord(carName, 903, {})
  };
  root[aidName].value.objs.owner.es3Prefab = { prefabId: "3955095449936337101" };
  root[weedName].value.objs.owner.es3Prefab = { prefabId: "2856772050428381491" };
  root[carName].value.objs.owner.es3Prefab = { prefabId: "8734799950597450027", refs: { "2086200191613234582": "7489528302310536125" } };
  const text = JSON.stringify(root), doc = inspect(text);
  const aidItem = doc.items.find(item => item.name === aidName);
  const weedItem = doc.items.find(item => item.name === weedName);
  assert.equal(aidItem.quantity, 3);
  assert.equal(aidItem.location, "User-identified box in vehicle trunk (saved parent link)");
  assert.equal(weedItem.quantity, 4);
  assert.equal(weedItem.location, "Unresolved parent / container");
  for (const [item, value] of [[aidItem, 5], [weedItem, 7]]) {
    const field = doc.fields.find(candidate => candidate.id === item.fieldIds[0]);
    assert.match(field.id, /:Quantity$/);
    assert.equal(field.bulkTarget, undefined);
    const changed = inspect(serialize(text, { [field.id]: value }));
    assert.equal(changed.items.find(candidate => candidate.id === item.id).quantity, value);
  }
  assert.equal(serialize(text, {}), text);
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

test("verified survival globals use gameplay clamp bounds while uncertain state stays read-only", () => {
  const text = JSON.stringify({ global: pm({
    Hunger: { __type: "float", value: 10 },
    Thirst: { __type: "float", value: 15 },
    Fatigue: { __type: "float", value: 16.5 },
    Radiation: { __type: "float", value: 0 },
    Money: { __type: "int", value: 39 },
    Sanity: { __type: "float", value: -27.3359985 },
    PlayerHealth: { __type: "float", value: 100 }
  }) });
  const doc = inspect(text);
  assert.equal(doc.kind, "Game save");
  assert.deepEqual(doc.fields.map(field => field.id), ["global.Hunger", "global.Thirst", "global.Fatigue", "global.Radiation", "global.Money"]);
  assert.deepEqual(doc.readOnlyFields.map(field => field.id), ["global.Sanity", "global.PlayerHealth"]);
  const edits = Object.fromEntries(doc.fields.map(field => [field.id, field.id === "global.Radiation" ? 100 : 0]));
  const reopened = inspect(serialize(text, edits));
  assert.deepEqual(reopened.readOnlyFields.map(field => field.value), [-27.3359985, 100]);
  for (const field of doc.fields.filter(field => field.id !== "global.Money")) {
    for (const value of [-0.01, 100.01]) assert.throws(() => serialize(text, { [field.id]: value }), /between 0 and 100/);
  }
  assert.throws(() => serialize(text, { "global.Sanity": 0 }), /not supported/);
});

test("Nuts edit only the saved global integer within the explicit editor limit", () => {
  const text = JSON.stringify({ global: pm({ Money: { __type: "int", value: 42 }, Sanity: { __type: "float", value: -7 } }) });
  const doc = inspect(text), money = doc.fields.find(field => field.id === "global.Money");
  assert.equal(money.label, "Nuts");
  assert.match(money.help, /editor safety limit, not a verified game maximum/);
  assert.equal(serialize(text, {}), text);
  assert.equal(serialize(text, { "global.Money": 999 }), text.slice(0, money.start) + "999" + text.slice(money.end));
  for (const value of [-1, 1000001, 1.5, NaN]) assert.throws(() => serialize(text, { "global.Money": value }));
  for (const value of [0, 1000000]) assert.equal(inspect(serialize(text, { "global.Money": value })).fields[0].value, value);
  for (const value of [-1, 1000001, 1.5]) {
    const invalid = text.replace('"value":42', `"value":${value}`);
    assert.equal(inspect(invalid).fields.some(field => field.id === "global.Money"), false);
    assert.equal(serialize(invalid, {}), invalid);
  }
  const wrongType = text.replace('"__type":"int","value":42', '"__type":"float","value":42');
  assert.equal(inspect(wrongType).readOnlyFields.find(field => field.id === "global.Money").value, 42);
  assert.throws(() => serialize(wrongType, { "global.Money": 100 }), /not supported/);
});

test("additional verified boolean settings edit only the requested scope", () => {
  for (const name of ["automatic_gearbox", "autoclutch", "normalizeinput", "bloom", "sharpen"]) {
    const text = JSON.stringify({
      [name]: { __type: "bool", value: false },
      global: pm({ [name]: { __type: "bool", value: false } })
    });
    const edited = serialize(text, { [name]: true });
    assert.equal(edited, text.replace('"value":false', '"value":true'));
    assert.equal(inspect(edited).fields.find(field => field.id === name).value, true);
    assert.throws(() => serialize(text, { [`global.${name}`]: true }), /not supported/);
  }
});

function prefabLiquidSave(name = "MotorOil_Can_Small", prefabId = "5864412579365047585", extra = {}) {
  const savedName = `${name}(Clone)1`;
  const object = gameObject(savedName, 801, 8001);
  object.es3Prefab = { prefabId, refs: {} };
  const record = itemRecord(savedName, 801, { Liquid: { __type: "float", value: 4.5 }, ...extra });
  record.value.objs.owner.es3Prefab = { prefabId, refs: {} };
  return {
    Player: pm({ Health: { __type: "float", value: 100 } }),
    newGOArray_Items: pm(null, [object]),
    [savedName]: record
  };
}

test("exact verified prefab identities provide item bounds without adding a saved capacity", () => {
  for (const [name, prefabId, capacity] of [
    ["MotorOil_Can_Small", "5864412579365047585", 5],
    ["Gasoline_Can", "6858519991654959144", 20],
    ["Water_Can_Plastic", "4230013134874058846", 13],
    ["Diesel_Barrel", "608293236901033563", 150],
    ["MotorOil_Can_Big", "5623108999256334996", 30],
    ["radiator_medium_race", "2169926468007209799", 14]
  ]) {
    const text = JSON.stringify(prefabLiquidSave(name, prefabId));
    const doc = inspect(text);
    const item = doc.items[0];
    assert.equal(item.liquid.capacity, capacity);
    assert.match(item.liquid.capacitySource, new RegExp(prefabId));
    const id = item.fieldIds[0], field = doc.fields.find(field => field.id === id);
    const edited = serialize(text, { [id]: capacity });
    assert.equal(edited, text.slice(0, field.start) + capacity + text.slice(field.end));
    assert.equal(edited.includes('"LiquidCapacity"'), false);
    assert.throws(() => serialize(text, { [id]: capacity + 0.01 }), /between/);
    assert.equal(serialize(text, {}), text);
  }
});

function wheelSave(name = "small_wheel_3", prefabId = "2321790605670812229") {
  const savedName = `${name}(Clone)1`;
  const object = gameObject(savedName, 801, 8001);
  object.es3Prefab = { prefabId, refs: {} };
  return {
    Player: pm({ Health: { __type: "float", value: 100 } }),
    newGOArray_Items: pm(null, [object]),
    [savedName]: { __type: "System.Object", value: { __type: "float", value: 24.5 } }
  };
}

test("verified wheels edit the exact name-keyed condition without changing other bytes", () => {
  for (const [name, id, label] of [
    ["small_wheel_3", "2321790605670812229", "Small wheel T1"],
    ["small_wheel_2", "2184613845620177162", "Small wheel T2"],
    ["wheel_2_armored", "2663761577720072192", "Armored Street Wheel"]
  ]) {
    const text = JSON.stringify(wheelSave(name, id));
    const doc = inspect(text), item = doc.items[0];
    assert.match(item.displayName, new RegExp(label));
    assert.equal(item.condition, 24.5);
    const field = doc.fields.find(field => field.id === item.fieldIds[0]);
    assert.equal(field.id.endsWith(":Condition"), true);
    assert.equal(serialize(text, {}), text);
    assert.equal(serialize(text, { [field.id]: 100 }), text.slice(0, field.start) + "100" + text.slice(field.end));
    assert.throws(() => serialize(text, { [field.id]: 101 }), /between/);
  }
});

test("name-keyed wheel condition refuses ambiguous, mismatched and malformed records", () => {
  const scenarios = [
    root => root.newGOArray_Items.value.array.push(gameObject("small_wheel_3(Clone)1", 802, 8002)),
    root => root.newGOArray_Items.value.array.push(gameObject("other(Clone)2", 801, 8002)),
    root => { root.newGOArray_Items.value.array[0].es3Prefab.prefabId = "2184613845620177162"; },
    root => { root["small_wheel_3(Clone)1"].__type = "Other"; },
    root => { root["small_wheel_3(Clone)1"].value.__type = "int"; },
    root => { root["small_wheel_3(Clone)1"].value.value = 101; },
    root => { delete root["small_wheel_3(Clone)1"]; }
  ];
  for (const change of scenarios) {
    const root = wheelSave();
    change(root);
    const text = JSON.stringify(root);
    assert.equal(inspect(text).items[0].condition, null);
    assert.equal(serialize(text, {}), text);
  }
  const ambiguous = JSON.stringify(wheelSave()).replace('"__type":"float","value":24.5', '"__type":"float"24.5,"value":10');
  assert.equal(inspect(ambiguous).items[0].condition, null);
});

test("item maximization includes name-keyed wheels and verified liquids without treating cargo as mounted", () => {
  const Actions = require("../vehicle-actions.js");
  const root = wheelSave();
  const liquid = prefabLiquidSave("Diesel_Barrel", "608293236901033563");
  liquid.newGOArray_Items.value.array[0]._ES3Ref = "802";
  liquid["Diesel_Barrel(Clone)1"].value.objs.owner._ES3Ref = "802";
  root.newGOArray_Items.value.array.push(liquid.newGOArray_Items.value.array[0]);
  root["Diesel_Barrel(Clone)1"] = liquid["Diesel_Barrel(Clone)1"];
  const car = gameObject("car(Clone)2", 900, 9000);
  car.es3Prefab = { refs: { child: "cargo-parent" } };
  root.newGOArray_Items.value.array.forEach(item => { item.components[0].parent = { _ES3Ref: "cargo-parent" }; });
  root.newGOArray_Cars = pm(null, [car]);
  root[car.name] = itemRecord(car.name, 900, {});
  const text = JSON.stringify(root), doc = inspect(text), changes = {};
  const result = Actions.maximizeItems(doc.items, doc.fields, field => ({ value: field.value, invalid: false }),
    (field, value) => { changes[field.id] = value; }, require("../save-format.js").validate);
  assert.equal(result.staged, 2);
  assert.deepEqual(Object.values(changes), [100, 150]);
  assert.equal(doc.vehicles[0].parts.length, 0);
  const edited = inspect(serialize(text, changes));
  assert.equal(edited.items[0].condition, 100);
  assert.equal(edited.items[1].liquid.value, 150);
});

test("bulk counts require exact item prefab and owner identity for bandages, repair kits and ammo", () => {
  const Actions = require("../vehicle-actions.js");
  for (const [name, prefabId, key, target] of [
    ["bandage_1", "688495819279421776", "Quantity", 999],
    ["Repairbox_Small", "9121322384858893382", "Quantity", 999],
    ["Repairbox_Medium", "7600464120049698740", "Quantity", 999],
    ["Repairbox_Large", "4165647324065915868", "Quantity", 999],
    ["ammo_box_762mm", "3377769854383720206", "ammo", 999],
    ["ammo_box_big_arrow", "1625578815151821771", "ammo", 999]
  ]) {
    const root = prefabLiquidSave(name, prefabId);
    const record = root[`${name}(Clone)1`].value.objs;
    delete record.Liquid;
    record[key] = { __type: "int", value: 5 };
    const text = JSON.stringify(root), doc = inspect(text), changes = {};
    const result = Actions.maximizeItems(doc.items, doc.fields, f => ({ value: f.value, invalid: false }),
      (f, value) => { changes[f.id] = value; }, require("../save-format.js").validate);
    assert.equal(result.staged, 1, name);
    assert.equal(Object.values(changes)[0], target);
    assert.equal(inspect(serialize(text, changes)).fields.find(f => f.topOffConsumable).value, target);
    record.owner.es3Prefab.prefabId = "wrong";
    assert.equal(inspect(JSON.stringify(root)).fields.some(f => f.bulkTarget !== undefined), false);
    record.owner.es3Prefab.prefabId = prefabId;
    root.newGOArray_Items.value.array[0].name = "unrelated(Clone)1";
    assert.equal(inspect(JSON.stringify(root)).fields.some(f => f.bulkTarget !== undefined), false);
  }
});

test("Repair & Top Off covers all verified item consumables with exact identity and existing counters", () => {
  const cases = [
    ["bandage_1", "688495819279421776", "Quantity"],
    ["Repairbox_Small", "9121322384858893382", "Quantity"],
    ["Repairbox_Medium", "7600464120049698740", "Quantity"],
    ["Repairbox_Large", "4165647324065915868", "Quantity"],
    ["first_aid_1", "3955095449936337101", "Quantity"],
    ["weed_bag", "2856772050428381491", "Quantity"],
    ["cigarette_bactrian", "7947724335221001397", "Quantity"],
    ["cigar", "6706846953073870613", "Quantity"],
    ["sanity_pills", "4398581480533230246", "Quantity"],
    ["flashlight_batteries", "6027655925999442117", "batteries"],
    ["ammo_arrow", "3766863323530176910", "ammo"],
    ["ammo_box_20gauge", "5513939087385948062", "ammo"],
    ["ammo_box_22", "3910063457913955151", "ammo"],
    ["ammo_box_big_22", "5744510244793180658", "ammo"],
    ["ammo_box_big_12gauge", "2411824388914619091", "ammo"],
    ["ammo_box_big_762mm", "3133067563820807118", "ammo"],
    ["ammo_box_762mm", "3377769854383720206", "ammo"],
    ["ammo_box_556mm", "8401587218543670294", "ammo"],
    ["ammo_box_12gauge", "8519476287603981168", "ammo"],
    ["ammo_box_3006", "2704672928494571242", "ammo"],
    ["ammo_box_big_3006", "7095138909402377063", "ammo"],
    ["ammo_box_big_9mm", "2992344171066298429", "ammo"],
    ["ammo_box_big_20gauge", "6949040989765713240", "ammo"],
    ["ammo_box_big_arrow", "1625578815151821771", "ammo"],
    ["ammo_box_9mm", "3733066396143753576", "ammo"],
    ["ammo_box_big_556mm", "6082136355384846395", "ammo"]
  ];
  const Actions = require("../vehicle-actions.js");
  for (const [name, id, key] of cases) {
    const root = prefabLiquidSave(name, id);
    const record = root[`${name}(Clone)1`].value.objs;
    delete record.Liquid;
    record[key] = { __type: "int", value: 1200 };
    record.ForBuyInt = { __type: "int", value: 3 };
    const text = JSON.stringify(root), doc = inspect(text), field = doc.fields.find(f => f.topOffConsumable);
    assert.ok(field, name);
    const changes = {};
    Actions.topOffConsumables(doc.fields, f => ({ value: f.value, invalid: false }),
      (f, value) => { changes[f.id] = value; }, require("../save-format.js").validate);
    assert.deepEqual(changes, { [field.id]: 999 }, name);
    assert.equal(serialize(text, changes), text.slice(0, field.start) + "999" + text.slice(field.end), name);
    assert.equal(serialize(text, {}), text);
    record.owner.es3Prefab.prefabId = "wrong";
    assert.equal(inspect(JSON.stringify(root)).fields.some(f => f.topOffConsumable), false, name);
    record.owner.es3Prefab.prefabId = id;
    delete record[key];
    assert.equal(inspect(JSON.stringify(root)).fields.some(f => f.topOffConsumable), false, name);
  }
});

test("battery pack editing refuses ambiguous identity and invalid counters without affecting unrelated fields", () => {
  for (const alter of [
    root => { root["flashlight_batteries(Clone)1"].value.objs.batteries = { __type: "int", value: -1 }; },
    root => { root["flashlight_batteries(Clone)1"].value.objs.batteries = { __type: "int", value: 1.5 }; },
    root => { root["flashlight_batteries(Clone)1"].value.objs.batteries = { __type: "int", value: 2147483648 }; },
    root => { root["flashlight_batteries(Clone)1"].value.objs.batteries = { __type: "float", value: 3 }; },
    root => { root["flashlight_batteries(Clone)1"].value.objs.batteries = { __type: "int", value: "3" }; },
    root => { root["flashlight_batteries(Clone)1"].value.objs.owner._ES3Ref = "different"; },
    root => { root.newGOArray_Items.value.array.push(root.newGOArray_Items.value.array[0]); },
    root => { root.newGOArray_Items.value.array[0].es3Prefab.prefabId = "unknown"; }
  ]) {
    const root = prefabLiquidSave("flashlight_batteries", "6027655925999442117");
    root["flashlight_batteries(Clone)1"].value.objs.batteries = { __type: "int", value: 5 };
    alter(root);
    const text = JSON.stringify(root), doc = inspect(text);
    assert.equal(doc.fields.some(f => f.topOffConsumable), false);
    assert.equal(serialize(text, {}), text);
  }
  const root = prefabLiquidSave("flashlight_batteries", "6027655925999442117");
  root["flashlight_batteries(Clone)1"].value.objs.batteries = { __type: "int", value: 5 };
  const text = JSON.stringify(root).replace('"batteries":{"__type":"int","value":5}', '"batteries":{"__type":"int"5,"value":9}');
  const doc = inspect(text);
  assert.equal(doc.fields.some(f => f.topOffConsumable), false);
  assert.ok(doc.items[0].readOnlyFields.some(f => f.name === "batteries"));
  assert.match(doc.items[0].warnings.join(" "), /shown read-only/);
  assert.equal(serialize(text, {}), text);
});

test("battery pack counts support zero, existing positive values and signed-int bounds in Saved Items Maximize", () => {
  for (const count of [0, 2, 2147483647]) {
    const root = prefabLiquidSave("flashlight_batteries", "6027655925999442117");
    delete root["flashlight_batteries(Clone)1"].value.objs.Liquid;
    root["flashlight_batteries(Clone)1"].value.objs.batteries = { __type: "int", value: count };
    const text = JSON.stringify(root), doc = inspect(text), field = doc.fields.find(f => f.topOffConsumable);
    assert.equal(field.value, count);
    assert.equal(doc.items[0].readOnlyFields.some(f => f.name === "batteries"), false);
    const changes = {};
    require("../vehicle-actions.js").maximizeItems(doc.items, doc.fields, f => ({ value: f.value, invalid: false }),
      (f, value) => { changes[f.id] = value; }, require("../save-format.js").validate);
    assert.deepEqual(changes, { [field.id]: 999 });
    assert.equal(serialize(text, { [field.id]: 999 }), text.slice(0, field.start) + "999" + text.slice(field.end));
    assert.throws(() => serialize(text, { [field.id]: -1 }), /must be between/);
    assert.throws(() => serialize(text, { [field.id]: 2147483648 }), /must be between/);
  }
});

test("Repair & Top Off sets carried ammo and requested capacities but leaves other capacities, armor and plates unchanged", () => {
  const counts = ["22caliber", "9mm", "20gauge", "arrow", "grenade", "12gauge", "556", "762", "3006", "battery"];
  const capacities = ["22caliber", "9mm", "20gauge", "arrow", "battery"];
  const ints = Object.fromEntries([...counts.map(name => [`ammo_${name}`, { __type: "int", value: 2 }]),
    ...capacities.map(name => [`ammo_${name}_capacity`, { __type: "int", value: 40 }])]);
  const text = JSON.stringify({ Ammo: pm({ ...ints, armor: { __type: "float", value: 0 },
    armorPlates: { __type: "int", value: 0 }, unknownCounter: { __type: "int", value: 5 } }) });
  const doc = inspect(text), changes = {};
  require("../vehicle-actions.js").topOffConsumables(doc.fields, f => ({ value: f.value, invalid: false }),
    (f, value) => { changes[f.id] = value; }, require("../save-format.js").validate);
  assert.deepEqual(changes, Object.fromEntries([...counts.map(name => [`Ammo.ammo_${name}`, 999]),
    ...["22caliber", "9mm", "20gauge", "arrow"].map(name => [`Ammo.ammo_${name}_capacity`, 999])]));
  const edited = JSON.parse(serialize(text, changes)).Ammo.value.objs;
  assert.equal(edited.armor.value, 0);
  assert.equal(edited.armorPlates.value, 0);
  assert.equal(edited.unknownCounter.value, 5);
  for (const name of capacities) assert.equal(edited[`ammo_${name}_capacity`].value, ["22caliber", "9mm", "20gauge", "arrow"].includes(name) ? 999 : 40);
});

test("vehicle top-off includes only uniquely mounted verified radiator liquid", () => {
  const Actions = require("../vehicle-actions.js");
  const root = prefabLiquidSave("radiator_medium_race", "2169926468007209799");
  const item = root.newGOArray_Items.value.array[0];
  item.components[0].parent = { _ES3Ref: "rad-mount" };
  const car = gameObject("car(Clone)2", 900, 9000);
  root.newGOArray_Cars = pm(null, [car]);
  root[car.name] = itemRecord(car.name, 900, {
    hinge_radiator: { transformID: "rad-mount" },
    Liquid: { __type: "float", value: 2 },
    LiquidCapacity: { __type: "float", value: 20 }
  });
  let doc = inspect(JSON.stringify(root)), updates = {};
  Actions.stage(doc.vehicles[0], doc.fields, "topoff", f => ({ value: f.value, invalid: false }),
    (f, v) => { updates[f.id] = v; }, require("../save-format.js").validate);
  assert.deepEqual(Object.values(updates), [20, 14]);
  assert.equal(doc.fields.find(f => f.id.endsWith(":Liquid")).section, "vehicles");
  root.newGOArray_Items.value.array.push(gameObject("other(Clone)3", 803, 8003, "rad-mount"));
  doc = inspect(JSON.stringify(root));
  assert.equal(doc.vehicles[0].fieldIds.some(id => id.endsWith(":Liquid")), false);
  root.newGOArray_Items.value.array.pop();
  item.components[0].parent._ES3Ref = "cargo";
  doc = inspect(JSON.stringify(root));
  assert.equal(doc.vehicles[0].fieldIds.some(id => id.endsWith(":Liquid")), false);
});

test("verified engine and radiator liquid capacities are enforced without inventing fields", () => {
  for (const [name, id, capacity] of [
    ["Diesel_Can", "9030660213298172268", 20],
    ["594cc I2 23HP 39Nm Gasoline", "3634296406011431456", 2],
    ["3L I5 87HP 172Nm Diesel", "6089072345908897270", 5.1],
    ["3.7L I6 145HP 292Nm Gasoline", "624016700395080820", 5.30000019],
    ["3.8L V6 165HP 285Nm Gasoline", "5945172545298182391", 6],
    ["radiator_small", "5669857674379848146", 6],
    ["radiator_motorcycle", "2705209445545947911", 3],
    ["radiator_truck_ultra", "3587043590766116916", 28]
  ]) {
    const root = prefabLiquidSave(name, id);
    root[`${name}(Clone)1`].value.objs.Liquid.value = 1;
    const text = JSON.stringify(root), doc = inspect(text), item = doc.items[0];
    assert.equal(item.liquid.capacity, capacity);
    assert.equal(inspect(serialize(text, { [item.fieldIds[0]]: capacity })).items[0].liquid.value, capacity);
    assert.throws(() => serialize(text, { [item.fieldIds[0]]: capacity + 0.1 }), /between/);
    assert.equal(serialize(text, {}), text);
    root[`${name}(Clone)1`].value.objs.owner.es3Prefab.prefabId = "wrong";
    assert.equal(inspect(JSON.stringify(root)).items[0].liquid, null);
    root[`${name}(Clone)1`].value.objs.owner.es3Prefab.prefabId = id;
    root[`${name}(Clone)1`].value.objs.LiquidCapacity = { __type: "float", value: -1 };
    assert.equal(inspect(JSON.stringify(root)).items[0].liquid, null);
  }
});

test("fractional prefab capacities accept Unity float spellings and reject the next float", () => {
  const Actions = require("../vehicle-actions.js");
  for (const [name, id, nominal, serialized, nextFloat] of [
    ["3L I5 87HP 172Nm Diesel", "6089072345908897270", 5.1, 5.0999999, 5.100000381469727],
    ["3.7L I6 145HP 292Nm Gasoline", "624016700395080820", 5.3, 5.30000019, 5.3000006675720215]
  ]) {
    const root = prefabLiquidSave(name, id);
    root[`${name}(Clone)1`].value.objs.Liquid.value = serialized;
    const text = JSON.stringify(root), doc = inspect(text), field = doc.fields.find(f => f.id.endsWith(":Liquid"));
    assert.ok(field);
    assert.equal(serialize(text, {}), text);
    assert.doesNotThrow(() => require("../save-format.js").validate(field, nominal));
    assert.doesNotThrow(() => require("../save-format.js").validate(field, serialized));
    assert.throws(() => require("../save-format.js").validate(field, nextFloat), /between/);
    const updates = {};
    Actions.maximizeItems(doc.items, doc.fields, f => ({ value: f.value, invalid: false }),
      (f, value) => { updates[f.id] = value; }, require("../save-format.js").validate);
    if (serialized !== field.max) assert.equal(updates[field.id], field.max);
  }
});

test("engine top-off requires a unique matching engine mount, not a radiator or cargo parent", () => {
  const Actions = require("../vehicle-actions.js");
  const root = prefabLiquidSave("3.8L V6 165HP 285Nm Gasoline", "5945172545298182391");
  const item = root.newGOArray_Items.value.array[0], car = gameObject("car(Clone)2", 900, 9000);
  root.newGOArray_Cars = pm(null, [car]);
  root[car.name] = itemRecord(car.name, 900, {
    hinge_engine: { transformID: "engine-mount" }, hinge_radiator: { transformID: "radiator-mount" }
  });
  item.components[0].parent = { _ES3Ref: "engine-mount" };
  let doc = inspect(JSON.stringify(root)), updates = {};
  Actions.stage(doc.vehicles[0], doc.fields, "topoff", f => ({ value: f.value, invalid: false }),
    (f, value) => { updates[f.id] = value; }, require("../save-format.js").validate);
  assert.deepEqual(Object.values(updates), [6]);
  for (const parent of ["radiator-mount", "cargo"]) {
    item.components[0].parent._ES3Ref = parent;
    doc = inspect(JSON.stringify(root));
    assert.equal(doc.vehicles[0].fieldIds.some(id => id.endsWith(":Liquid")), false);
  }
  item.components[0].parent._ES3Ref = "engine-mount";
  root.newGOArray_Items.value.array.push(gameObject("other(Clone)3", 803, 8003, "engine-mount"));
  doc = inspect(JSON.stringify(root));
  assert.equal(doc.vehicles[0].fieldIds.some(id => id.endsWith(":Liquid")), false);
});

test("Vulture wheel hinges repair only uniquely matched wheels, not physics-lock cargo", () => {
  const Actions = require("../vehicle-actions.js");
  const root = wheelSave(), car = gameObject("Vulture(Clone)2", 900, 9000);
  car.es3Prefab = { prefabId: "8734799950597450027", refs: { "5305950010086703831": "front-left", "2086200191613234582": "physics-lock" } };
  root.newGOArray_Cars = pm(null, [car]);
  root[car.name] = itemRecord(car.name, 900, {});
  root[car.name].value.objs.owner.es3Prefab = { prefabId: "8734799950597450027" };
  root.newGOArray_Items.value.array[0].components[0].parent = { _ES3Ref: "front-left" };
  let doc = inspect(JSON.stringify(root));
  assert.match(doc.items[0].attachedTo, /Front left wheel/);
  assert.deepEqual(doc.vehicles[0].fieldIds, doc.items[0].fieldIds);
  const changes = {};
  const result = Actions.stage(doc.vehicles[0], doc.fields, "repair", field => ({ value: field.value, invalid: false }),
    (field, value) => { changes[field.id] = value; }, require("../save-format.js").validate);
  assert.equal(result.staged, 1);
  assert.equal(Object.values(changes)[0], 100);
  root.newGOArray_Items.value.array[0].components[0].parent._ES3Ref = "physics-lock";
  doc = inspect(JSON.stringify(root));
  assert.equal(doc.items[0].attachedTo, null);
  assert.equal(doc.vehicles[0].fieldIds.length, 0);
  root.newGOArray_Items.value.array[0].components[0].parent._ES3Ref = "front-left";
  root.newGOArray_Items.value.array.push(gameObject("other(Clone)3", 803, 8003, "front-left"));
  doc = inspect(JSON.stringify(root));
  assert.equal(doc.items[0].attachedTo, null);
  assert.equal(doc.vehicles[0].fieldIds.length, 0);
  root.newGOArray_Items.value.array.pop();
  root[car.name].value.objs.owner.es3Prefab.prefabId = "wrong";
  doc = inspect(JSON.stringify(root));
  assert.equal(doc.items[0].attachedTo, null);
});

test("prefab liquid fallback refuses missing, conflicting, misnamed and ambiguous identities", () => {
  const scenarios = [
    root => { delete root.newGOArray_Items.value.array[0].es3Prefab; },
    root => { root["MotorOil_Can_Small(Clone)1"].value.objs.owner.es3Prefab.prefabId = "unknown"; },
    root => { root.newGOArray_Items.value.array[0].es3Prefab.prefabId = "unknown"; },
    root => { root.newGOArray_Items.value.array.push(gameObject("copy(Clone)2", 801, 8002)); },
    root => { root["MotorOil_Can_Small(Clone)1"].value.objs.Liquid.value = 5.1; }
  ];
  for (const change of scenarios) {
    const root = prefabLiquidSave();
    change(root);
    assert.equal(inspect(JSON.stringify(root)).items[0].liquid, null);
  }
  assert.equal(inspect(JSON.stringify(prefabLiquidSave("UnknownCan"))).items[0].liquid, null);
  for (const value of [0, -1]) {
    const root = prefabLiquidSave(undefined, undefined, { LiquidCapacity: { __type: "float", value } });
    assert.equal(inspect(JSON.stringify(root)).items[0].liquid, null);
  }
  const savedCapacity = inspect(JSON.stringify(prefabLiquidSave(undefined, undefined, { LiquidCapacity: { __type: "float", value: 7 } }))).items[0];
  assert.deepEqual(savedCapacity.liquid, { value: 4.5, capacity: 7 });
});

test("unique vehicle prefab membership supplies location evidence but never repair targets", () => {
  const root = prefabLiquidSave();
  const itemName = "MotorOil_Can_Small(Clone)1";
  root.newGOArray_Items.value.array[0].components[0].parent = { _ES3Ref: "vehicle-child" };
  root[itemName].value.objs.Condition = { __type: "float", value: 50 };
  const car = gameObject("car(Clone)2", 900, 9000);
  car.es3Prefab = { refs: { "prefab-child-id": "vehicle-child" } };
  root.newGOArray_Cars = pm(null, [car]);
  root[car.name] = itemRecord(car.name, 900, { Liquid: { __type: "float", value: 10 }, LiquidCapacity: { __type: "float", value: 20 } });
  let doc = inspect(JSON.stringify(root));
  assert.equal(doc.items[0].associatedVehicle, car.name);
  assert.match(doc.items[0].location, /mounting\/storage unknown/);
  assert.equal(doc.items[0].attachedTo, null);
  assert.deepEqual(doc.vehicles[0].parts, []);
  assert.equal(doc.vehicles[0].fieldIds.some(id => doc.items[0].fieldIds.includes(id)), false);
  assert.equal(doc.fields.find(field => field.id.endsWith(":Condition")).section, "items");
  const other = gameObject("car(Clone)3", 901, 9001);
  other.es3Prefab = car.es3Prefab;
  root.newGOArray_Cars.value.array.push(other);
  root[other.name] = itemRecord(other.name, 901, {});
  doc = inspect(JSON.stringify(root));
  assert.equal(doc.items[0].associatedVehicle, null);
  assert.equal(doc.items[0].location, "Unresolved parent / container");
  assert.match(doc.items[0].warnings.join(" "), /more than one vehicle/);
});
