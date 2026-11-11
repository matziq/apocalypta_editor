"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Preferences = require("../ui-preferences.js");

function app({ stored = null, pickerResult, pickerError, native = true } = {}) {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => [id, {
    textContent: "",
    value: "",
    hidden: false,
    disabled: false,
    attributes: new Map(),
    events: {},
    setAttribute(name, value) { this.attributes.set(name, value); },
    getAttribute(name) { return this.attributes.get(name) || null; },
    addEventListener(name, callback) { this.events[name] = callback; }
  }]));
  const storage = {
    getItem: () => stored,
    setItem: (key, value) => { stored = value; }
  };
  const context = vm.createContext({
    document: {
      body: { dataset: {} },
      getElementById(id) {
        assert.ok(elements.has(id), `Missing HTML control: ${id}`);
        return elements.get(id);
      },
      querySelector: () => native ? { content: "test-token" } : null
    },
    window: {
      matchMedia: () => ({ matches: false, addEventListener() {} }),
      addEventListener() {}
    },
    location: { protocol: native ? "http:" : "file:", hostname: native ? "127.0.0.1" : "" },
    localStorage: storage,
    ApocalypterUi: Preferences,
    fetch: async () => {
      if (pickerError) throw pickerError;
      return { ok: !pickerResult?.error, status: pickerResult?.error ? 404 : 200, json: async () => pickerResult };
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8"), context);
  return { elements, context, stored: () => stored };
}

test("malformed preferences cannot prevent file-picker event binding", () => {
  const ui = app({ stored: "{broken" });
  assert.match(ui.elements.get("appearance-status").textContent, /could not be loaded/);
  assert.equal(typeof ui.elements.get("file").events.change, "function");
  assert.equal(typeof ui.elements.get("native-picker").events.click, "function");
});

test("native picker cancellation preserves the document and staged edits", async () => {
  const ui = app({ pickerResult: { canceled: true } });
  vm.runInContext("doc = { text: 'original' }; changes.set('Player.Health', 50);", ui.context);
  await ui.elements.get("native-picker").events.click();
  assert.equal(vm.runInContext("doc.text", ui.context), "original");
  assert.equal(vm.runInContext("changes.get('Player.Health')", ui.context), 50);
  assert.match(ui.elements.get("picker-hint").textContent, /canceled/);
  assert.equal(ui.elements.get("native-picker").disabled, false);
});

test("native picker failures are visible and keep the browser fallback available", async () => {
  for (const options of [
    { pickerError: new Error("Bridge stopped") },
    { pickerResult: { error: "Save folder does not exist" } }
  ]) {
    const ui = app(options);
    vm.runInContext("doc = { text: 'original' }; changes.set('Player.Health', 50);", ui.context);
    await ui.elements.get("native-picker").events.click();
    assert.match(ui.elements.get("message").textContent, /Save picker failed:/);
    assert.match(ui.elements.get("picker-hint").textContent, /browser chooser/);
    assert.equal(ui.elements.get("browser-picker-controls").hidden, false);
    assert.equal(ui.elements.get("native-picker").disabled, false);
    assert.equal(vm.runInContext("changes.get('Player.Health')", ui.context), 50);
  }
});

test("standalone HTML retains a browser picker instead of displaying an inert native button", () => {
  const ui = app({ native: false });
  assert.equal(ui.elements.get("native-picker-controls").hidden, true);
  assert.equal(ui.elements.get("browser-picker-controls").hidden, false);
});
