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
    _value: "",
    get value() { return this._value; },
    set value(value) { this._value = String(value); },
    hidden: false,
    disabled: false,
    children: [],
    dataset: {},
    classList: { toggle() {} },
    attributes: new Map(),
    events: {},
    append(...children) {
      for (const child of children) {
        if (child.parentNode) child.parentNode.children = child.parentNode.children.filter(node => node !== child);
        child.parentNode = this;
        this.children.push(child);
      }
    },
    replaceChildren(...children) {
      for (const child of this.children) child.parentNode = null;
      this.children = [];
      this.append(...children);
    },
    focus() { this.focused = true; },
    scrollIntoView() {},
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
  assert.equal(ui.elements.get("items-panel").inert, false);
  assert.equal(ui.elements.get("save").disabled, false);
});

function seedWorldItems(ui, mounted = false) {
  const pm = objs => ({ __type: "ES3PlayMaker.PMDataWrapper,Assembly-CSharp-firstpass", value: { objs } });
  const names = ["engine(Clone)1", "engine(Clone)2", "wheel(Clone)3"];
  const root = {
    Player: pm({ Health: { __type: "float", value: 100 } }),
    newGOArray_Items: { value: { array: names.map((name, index) => ({
      name, _ES3Ref: `${9000 + index}`, active: true,
      components: [{ __type: "Transform", parent: mounted && !index ? { _ES3Ref: "mount-1" } : null }]
    })) } },
    [names[0]]: pm({ owner: { _ES3Ref: "9000" }, Condition: { __type: "float", value: 25 }, Liquid: { __type: "float", value: 2 } }),
    [names[1]]: pm({ owner: { _ES3Ref: "9001" }, Condition: { __type: "float", value: 45 } })
  };
  if (mounted) {
    root.newGOArray_Cars = { value: { array: [{ name: "car(Clone)1", _ES3Ref: "car-1" }] } };
    root["car(Clone)1"] = pm({
      owner: { _ES3Ref: "car-1" }, hinge_engine: { transformID: "mount-1" },
      Liquid: { __type: "float", value: 2 }, LiquidCapacity: { __type: "float", value: 20 }
    });
  }
  ui.context.worldText = JSON.stringify(root);
  vm.runInContext('doc = ApocalypterSave.inspect(worldText); fileName = "SyntheticWorld.es3"; render();', ui.context);
}

test("world item selection keeps separate drafts, exposes loose condition and explains read-only objects", () => {
  const ui = app();
  seedWorldItems(ui);
  vm.runInContext('selectItem(doc.items[0].id); inputs.get(doc.items[0].fieldIds[0]).value = "100"; refresh(); selectItem(doc.items[1].id);', ui.context);
  assert.equal(vm.runInContext("changes.get(doc.items[0].fieldIds[0])", ui.context), 100);
  vm.runInContext('inputs.get(doc.items[1].fieldIds[0]).value = ""; refresh(); selectItem(doc.items[0].id);', ui.context);
  assert.equal(vm.runInContext("inputs.get(doc.items[0].fieldIds[0]).value", ui.context), "100");
  assert.equal(ui.elements.get("export").disabled, true);
  assert.equal(ui.elements.get("item-editor-title").textContent, "engine(Clone)1");
  assert.match(ui.elements.get("item-read-only").children[1].textContent, /capacity/);
  vm.runInContext("selectItem(doc.items[2].id);", ui.context);
  assert.equal(ui.elements.get("item-fields").children.length, 0);
  assert.match(ui.elements.get("item-edit-status").textContent, /no safely matched editable scalar/);
  ui.elements.get("reset").events.click();
  assert.equal(vm.runInContext("changes.size", ui.context), 0);
  assert.equal(vm.runInContext("inputs.get(doc.items[0].fieldIds[0]).value", ui.context), "25");
});

test("a mounted part reuses the same live control in item and vehicle sections", () => {
  const ui = app();
  seedWorldItems(ui, true);
  vm.runInContext("selectItem(doc.items[0].id);", ui.context);
  const row = vm.runInContext("fieldRows.get(doc.items[0].fieldIds[0])", ui.context);
  assert.equal(row.parentNode, ui.elements.get("item-fields"));
  vm.runInContext('inputs.get(doc.items[0].fieldIds[0]).value = "99"; refresh(); selectSection("vehicles");', ui.context);
  assert.equal(row.parentNode, vm.runInContext("fieldHomes.get(doc.items[0].fieldIds[0])", ui.context));
  vm.runInContext('selectSection("items");', ui.context);
  assert.equal(row.parentNode, ui.elements.get("item-fields"));
  assert.equal(vm.runInContext("inputs.get(doc.items[0].fieldIds[0]).value", ui.context), "99");
  assert.equal(vm.runInContext("changes.get(doc.items[0].fieldIds[0])", ui.context), 99);
});

test("filtering world items by saved identity preserves the selected item's edits", () => {
  const ui = app();
  seedWorldItems(ui);
  vm.runInContext('selectItem(doc.items[0].id); inputs.get(doc.items[0].fieldIds[0]).value = "100"; refresh();', ui.context);
  ui.elements.get("item-filter").value = "9001";
  ui.elements.get("item-filter").events.input();
  assert.match(ui.elements.get("item-filter-status").textContent, /1 of 3/);
  assert.equal(vm.runInContext("itemRows.get(doc.items[0].id).row.hidden", ui.context), true);
  ui.elements.get("item-filter").value = "not-a-saved-item";
  ui.elements.get("item-filter").events.input();
  assert.match(ui.elements.get("item-filter-status").textContent, /No items match/);
  assert.equal(vm.runInContext("changes.get(doc.items[0].fieldIds[0])", ui.context), 100);
});

test("out-of-range values are explained without inputs and do not block unrelated edits", () => {
  const ui = app();
  vm.runInContext(`
    doc = ApocalypterSave.inspect('{"FOV":{"__type":"float","value":121},"peacefulMode":{"__type":"bool","value":false}}');
    render();
    inputs.get("peacefulMode").checked = true;
    refresh();
  `, ui.context);
  assert.equal(vm.runInContext("inputs.has('FOV')", ui.context), false);
  assert.equal(vm.runInContext("changes.get('peacefulMode')", ui.context), true);
  assert.equal(ui.elements.get("export").disabled, false);
  assert.equal(ui.elements.get("fields").hidden, false);
  const rows = ui.elements.get("fields").children.flatMap(group => group.children);
  const readOnlyRow = rows.find(row => row.children?.[0]?.textContent === "Field of view (read-only)");
  assert.ok(readOnlyRow);
  assert.equal(readOnlyRow.children[1].textContent, "121");
  assert.match(readOnlyRow.children[0].children[0].textContent, /preserved unchanged/);
  ui.elements.get("reset").events.click();
  assert.equal(vm.runInContext("doc.readOnlyFields[0].value", ui.context), 121);
  assert.equal(vm.runInContext("changes.size", ui.context), 0);
  vm.runInContext('doc = ApocalypterSave.inspect(\'{"FOV":{"__type":"float","value":121}}\'); render();', ui.context);
  assert.equal(ui.elements.get("fields").hidden, false);
  assert.equal(vm.runInContext("inputs.size", ui.context), 0);
});

test("item inspector shows verified prefab capacity evidence without claiming mounting", () => {
  const ui = app();
  seedWorldItems(ui);
  vm.runInContext(`
    const root = JSON.parse(worldText);
    const name = "MotorOil_Can_Small(Clone)1";
    root.newGOArray_Items.value.array[0].name = name;
    root.newGOArray_Items.value.array[0].es3Prefab = { prefabId: "5864412579365047585" };
    root.newGOArray_Items.value.array[0].components[0].parent = { _ES3Ref: "storage-child" };
    root[name] = root["engine(Clone)1"];
    delete root["engine(Clone)1"];
    root[name].value.objs.owner.es3Prefab = { prefabId: "5864412579365047585" };
    root.newGOArray_Cars = { value: { array: [{ name: "car(Clone)1", _ES3Ref: "car-1", es3Prefab: { refs: { child: "storage-child" } } }] } };
    root["car(Clone)1"] = { __type: "ES3PlayMaker.PMDataWrapper,Assembly-CSharp-firstpass", value: { objs: { owner: { _ES3Ref: "car-1" } } } };
    doc = ApocalypterSave.inspect(JSON.stringify(root)); render(); selectItem(doc.items[0].id);
  `, ui.context);
  assert.match(ui.elements.get("item-editor-note").textContent, /prefab 5864412579365047585/);
  assert.match(ui.elements.get("item-editor-note").textContent, /mounting\/storage unknown/);
  assert.match(ui.elements.get("items-note").textContent, /1 vehicle-associated/);
  assert.equal(vm.runInContext("doc.vehicles[0].parts.length", ui.context), 0);
  ui.elements.get("item-filter").value = "car(Clone)1";
  ui.elements.get("item-filter").events.input();
  assert.match(ui.elements.get("item-filter-status").textContent, /1 of 3/);
});
