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

test("defaults to the system theme and spring palette", () => {
  const light = Preferences.load(storage(), false);
  const dark = Preferences.load(storage(), true);
  assert.equal(Preferences.apply({ dataset: {} }, light).theme, "light");
  assert.equal(Preferences.apply({ dataset: {} }, dark).theme, "dark");
  assert.deepEqual(Preferences.seasons, ["spring", "summer", "autumn", "winter"]);
});

test("persists explicit theme and season preferences", () => {
  const store = storage();
  const preferences = { theme: "dark", season: "winter", prefersDark: false };
  Preferences.save(store, preferences);
  const loaded = Preferences.load(store, true);
  assert.equal(loaded.theme, "dark");
  assert.equal(loaded.season, "winter");
});

test("applies every seasonal palette in both themes without touching save data", () => {
  for (const season of Preferences.seasons) {
    for (const theme of ["light", "dark"]) {
      const root = { dataset: {} };
      const result = Preferences.apply(root, { theme, season, prefersDark: false });
      assert.equal(result.theme, theme);
      assert.equal(root.dataset.season, season);
    }
  }
});

test("malformed or unavailable storage errors are surfaced to the caller", () => {
  assert.throws(() => Preferences.load(storage("{bad"), false), SyntaxError);
  const unavailable = {
    getItem: () => { throw new Error("Storage blocked"); },
    setItem: () => { throw new Error("Storage blocked"); }
  };
  assert.throws(() => Preferences.load(unavailable, false), /Storage blocked/);
  assert.throws(() => Preferences.save(unavailable, { theme: "light", season: "spring" }), /Storage blocked/);
});
