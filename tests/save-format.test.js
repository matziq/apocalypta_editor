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
