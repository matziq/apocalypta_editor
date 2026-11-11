"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Preferences = require("../ui-preferences.js");
const Save = require("../save-format.js");

function app({ stored = null, pickerResult, pickerError, native = true, confirm = () => true, fetchResponse } = {}) {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const element = () => ({
    textContent: "",
    value: "",
    hidden: false,
    disabled: false,
    children: [],
    dataset: {},
    classList: { toggle() {} },
    attributes: new Map(),
    events: {},
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    querySelectorAll: () => [],
    setAttribute(name, value) { this.attributes.set(name, value); },
    removeAttribute(name) { this.attributes.delete(name); },
    getAttribute(name) { return this.attributes.get(name) || null; },
    addEventListener(name, callback) { this.events[name] = callback; }
  });
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => [id, element()]));
  const fetches = [];
  const storage = {
    getItem: () => stored,
    setItem: (key, value) => { stored = value; }
  };
  const context = vm.createContext({
    document: {
      body: { dataset: {} },
      createElement: element,
      getElementById(id) {
        assert.ok(elements.has(id), `Missing HTML control: ${id}`);
        return elements.get(id);
      },
      querySelector: () => native ? { content: "test-token" } : null
    },
    window: {
      matchMedia: () => ({ matches: false, addEventListener() {} }),
      addEventListener() {},
      confirm
    },
    location: { protocol: native ? "http:" : "file:", hostname: native ? "127.0.0.1" : "" },
    localStorage: storage,
    ApocalypterUi: Preferences,
    ApocalypterSave: Save,
    TextDecoder,
    TextEncoder,
    atob,
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: async (url, init) => {
      fetches.push({ url, init });
      if (fetchResponse) return fetchResponse(url, init);
      if (url === "/api/status") return { ok: true, json: async () => ({ protocolVersion: 2, folderExists: true, saveFolder: "C:\\Synthetic\\Apocalypter" }) };
      if (pickerError) throw pickerError;
      return { ok: !pickerResult?.error, status: pickerResult?.error ? 404 : 200, json: async () => pickerResult };
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8"), context);
  return { elements, context, fetches, stored: () => stored };
}

test("malformed preferences cannot prevent file-picker event binding", () => {
  const ui = app({ stored: "{broken" });
  assert.match(ui.elements.get("appearance-status").textContent, /could not be loaded/);
  assert.equal(typeof ui.elements.get("file").events.change, "function");
  assert.equal(typeof ui.elements.get("native-picker").events.click, "function");
  assert.equal(ui.elements.get("browser-picker-controls").hidden, true);
});

test("native picker cancellation preserves the document and staged edits", async () => {
  const ui = app({ pickerResult: { canceled: true } });
  vm.runInContext("doc = { text: 'original' }; changes.set('Player.Health', 50);", ui.context);
  await ui.elements.get("native-picker").events.click();
  assert.equal(vm.runInContext("doc.text", ui.context), "original");
  assert.equal(vm.runInContext("changes.get('Player.Health')", ui.context), 50);
  assert.match(ui.elements.get("picker-hint").textContent, /canceled/);
  assert.equal(ui.elements.get("native-picker").disabled, false);
  assert.equal(ui.elements.get("browser-picker-controls").hidden, true);
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
  assert.match(ui.elements.get("browser-picker-hint").textContent, /browser-only version/);
});

test("an outdated bridge produces relaunch instructions instead of an indefinite native request", async () => {
  const ui = app({ fetchResponse: async () => ({ ok: false, status: 404 }) });
  await ui.elements.get("native-picker").events.click();
  assert.deepEqual(ui.fetches.map(request => request.url), ["/api/status"]);
  assert.match(ui.elements.get("message").textContent, /outdated.*Relaunch run\.bat/);
  assert.equal(ui.elements.get("native-picker").disabled, false);
});

test("an unresponsive bridge leaves retry and browser fallback available with an explicit timeout", async () => {
  const ui = app({ fetchResponse: async () => { const error = new Error("aborted"); error.name = "AbortError"; throw error; } });
  await ui.elements.get("native-picker").events.click();
  assert.match(ui.elements.get("message").textContent, /did not respond within 5 seconds/);
  assert.equal(ui.elements.get("native-picker").disabled, false);
  assert.equal(ui.elements.get("browser-picker-controls").hidden, false);
});

function seedNativeEdit(ui) {
  vm.runInContext(`
    doc = ApocalypterSave.inspect('{"peacefulMode":{"__type":"bool","value":false}}');
    fileName = "SaveSettings.es3";
    nativeSource = { handle: "opaque-handle", path: "C:\\\\Synthetic\\\\SaveSettings.es3", canSave: true };
    render();
    inputs.get("peacefulMode").checked = true;
  `, ui.context);
}

test("canceling overwrite confirmation sends no save request and retains drafts", async () => {
  let prompt;
  const ui = app({ confirm: text => { prompt = text; return false; } });
  seedNativeEdit(ui);
  await ui.elements.get("save").events.click();
  assert.match(prompt, /C:\\Synthetic\\SaveSettings\.es3/);
  assert.equal(ui.fetches.length, 0);
  assert.equal(vm.runInContext("changes.get('peacefulMode')", ui.context), true);
});

test("each confirmed save sends an opaque handle and adopts the new baseline", async () => {
  let confirmations = 0;
  const ui = app({
    confirm: () => { confirmations++; return true; },
    fetchResponse: async (url, init) => {
      assert.equal(url, "/api/save");
      const request = JSON.parse(init.body);
      assert.deepEqual(Object.keys(request).sort(), ["changes", "confirmed", "handle"]);
      assert.equal(request.handle, "opaque-handle");
      return {
        ok: true,
        json: async () => ({
          backupPath: `C:\\Synthetic\\backup-${confirmations}.bak`,
          contentBase64: Buffer.from(`{"peacefulMode":{"__type":"bool","value":${request.changes.peacefulMode}}}`).toString("base64")
        })
      };
    }
  });
  seedNativeEdit(ui);
  await ui.elements.get("save").events.click();
  assert.equal(vm.runInContext("doc.fields[0].value", ui.context), true);
  assert.equal(vm.runInContext("changes.size", ui.context), 0);
  assert.match(ui.elements.get("message").textContent, /backup-1\.bak/);
  vm.runInContext('inputs.get("peacefulMode").checked = false;', ui.context);
  await ui.elements.get("save").events.click();
  assert.equal(confirmations, 2);
  assert.equal(vm.runInContext("doc.fields[0].value", ui.context), false);
  assert.equal(vm.runInContext("changes.size", ui.context), 0);
});

test("save refusal preserves the original baseline and edits and unlocks controls", async () => {
  const ui = app({
    fetchResponse: async () => ({ ok: false, status: 409, json: async () => ({ error: "The original changed outside the editor." }) })
  });
  seedNativeEdit(ui);
  await ui.elements.get("save").events.click();
  assert.equal(vm.runInContext("doc.fields[0].value", ui.context), false);
  assert.equal(vm.runInContext("changes.get('peacefulMode')", ui.context), true);
  assert.match(ui.elements.get("message").textContent, /original changed.*Pending edits remain/);
  assert.equal(ui.elements.get("vehicle-select").disabled, false);
  assert.equal(ui.elements.get("save").disabled, false);
});
