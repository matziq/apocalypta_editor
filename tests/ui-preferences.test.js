"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Preferences = require("../ui-preferences.js");

function storage(initial = null) {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (key, next) => { assert.equal(key, Preferences.storageKey); value = next; },
    get saved() { return value; }
  };
}

test("defaults to the system theme and Wasteland palette", () => {
  const light = Preferences.load(storage(), false);
  const dark = Preferences.load(storage(), true);
  assert.equal(Preferences.apply({ dataset: {} }, light).theme, "light");
  assert.equal(Preferences.apply({ dataset: {} }, dark).theme, "dark");
  assert.deepEqual(Preferences.palettes, ["wasteland", "desert", "nuclear-winter", "apocalypse"]);
});

test("persists explicit theme and palette preferences", () => {
  const store = storage();
  const preferences = { theme: "dark", palette: "nuclear-winter", prefersDark: false };
  Preferences.save(store, preferences);
  const loaded = Preferences.load(store, true);
  assert.equal(loaded.theme, "dark");
  assert.equal(loaded.palette, "nuclear-winter");
});

test("applies every game-world palette in both themes without touching save data", () => {
  for (const palette of Preferences.palettes) {
    for (const theme of ["light", "dark"]) {
      const root = { dataset: {} };
      const result = Preferences.apply(root, { theme, palette, prefersDark: false });
      assert.equal(result.theme, theme);
      assert.equal(root.dataset.palette, palette);
    }
  }
});

test("migrates each saved season to its corresponding world palette", () => {
  for (const [season, palette] of Object.entries({ spring: "wasteland", summer: "desert", autumn: "apocalypse", winter: "nuclear-winter" })) {
    const store = storage(JSON.stringify({ theme: "dark", season, autosave: true }));
    const loaded = Preferences.load(store, false);
    assert.equal(loaded.palette, palette);
    Preferences.save(store, loaded);
    assert.equal(Preferences.load(store, false).palette, palette);
    assert.equal(JSON.parse(store.saved).season, undefined);
  }
});

test("malformed or unavailable storage errors are surfaced to the caller", () => {
  assert.throws(() => Preferences.load(storage("{bad"), false), SyntaxError);
  const unavailable = {
    getItem: () => { throw new Error("Storage blocked"); },
    setItem: () => { throw new Error("Storage blocked"); }
  };
  assert.throws(() => Preferences.load(unavailable, false), /Storage blocked/);
  assert.throws(() => Preferences.save(unavailable, { theme: "light", palette: "wasteland" }), /Storage blocked/);
});
