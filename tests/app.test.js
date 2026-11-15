"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Preferences = require("../ui-preferences.js");
const Save = require("../save-format.js");
const VehicleActions = require("../vehicle-actions.js");

function app({ stored = null, pickerResult, pickerError, native = true, confirm = () => true, fetchResponse, timers = false } = {}) {
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
    getBoundingClientRect() { return { top: 100 }; },
    insertAdjacentElement(position, node) { this.parentNode.append(node); },
    querySelectorAll: () => [],
    setAttribute(name, value) { this.attributes.set(name, value); },
    removeAttribute(name) { this.attributes.delete(name); },
    getAttribute(name) { return this.attributes.get(name) || null; },
    addEventListener(name, callback) {
      const previous = this.events[name];
      this.events[name] = previous ? async (...args) => { await previous(...args); return callback(...args); } : callback;
    }
  });
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => [id, element()]));
  for (const node of elements.values()) node.parentNode = element();
  const fetches = [];
  const windowEvents = {};
  const scheduled = new Map();
  let timerId = 0;
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
      addEventListener(name, callback) { windowEvents[name] = callback; },
      confirm
    },
    location: { protocol: native ? "http:" : "file:", hostname: native ? "127.0.0.1" : "" },
    localStorage: storage,
    ApocalypterUi: Preferences,
    ApocalypterSave: Save,
    ApocalypterVehicleActions: VehicleActions,
    File,
    TextDecoder,
    TextEncoder,
    atob,
    AbortController,
    setTimeout: timers ? callback => { scheduled.set(++timerId, callback); return timerId; } : setTimeout,
    clearTimeout: timers ? id => scheduled.delete(id) : clearTimeout,
    fetch: async (url, init) => {
      fetches.push({ url, init });
      if (fetchResponse) return fetchResponse(url, init);
      if (url === "/api/status") return { ok: true, json: async () => ({ protocolVersion: 4, backupLimit: 3, folderExists: true, saveFolder: "C:\\Synthetic\\Apocalypter" }) };
      if (pickerError) throw pickerError;
      return { ok: !pickerResult?.error, status: pickerResult?.error ? 404 : 200, json: async () => pickerResult };
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8"), context);
  return { elements, context, fetches, windowEvents, stored: () => stored, async flushTimers() {
    const callbacks = [...scheduled.values()];
    scheduled.clear();
    for (const callback of callbacks) await callback();
    await new Promise(resolve => setImmediate(resolve));
  } };
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
    nativeSource = { handle: "opaque-handle", path: "C:\\\\Synthetic\\\\SaveSettings.es3", canSave: true, backupLimit: 3 };
    render();
    inputs.get("peacefulMode").checked = true;
  `, ui.context);
}

const pm = objs => ({ __type: "ES3PlayMaker.PMDataWrapper,Assembly-CSharp-firstpass", value: { objs } });
const scalar = value => ({ __type: "float", value });
const healthText = value => JSON.stringify({ Player: pm({ Health: scalar(value) }) });
function nativeFixture(ui, text = healthText(100)) {
  vm.runInContext(`doc = ApocalypterSave.inspect(${JSON.stringify(text)}); originalBytes = new TextEncoder().encode(doc.text); fileName = "SaveGame1.es3";
    nativeSource = { handle: "opaque", path: "C:\\\\Synthetic\\\\SaveGame1.es3", canSave: true, backupLimit: 3, backupPath: "C:\\\\Synthetic\\\\load.original.bak", modifiedUtc: "2026-01-01T00:00:00Z" }; render();`, ui.context);
}
function draft(ui, id) { return vm.runInContext(`inputs.get(${JSON.stringify(id)})`, ui.context); }
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function saveReply(text) {
  return { ok: true, json: async () => ({ contentBase64: Buffer.from(text).toString("base64"), backupLimit: 3, backupPath: "C:\\Synthetic\\load.original.bak" }) };
}
async function commitInput(ui, id, value) {
  const input = draft(ui, id);
  input.value = value;
  await input.events.input();
  await input.events.change();
}

test("native startup autoload adopts backed-up source; standalone startup never requests a file", async () => {
  const text = healthText(50);
  const ui = app({ pickerResult: { name: "SaveGame2.es3", contentBase64: Buffer.from(text).toString("base64"), source: {
    handle: "opened", path: "C:\\Synthetic\\SaveGame2.es3", canSave: true, backupLimit: 3, backupPath: "C:\\Synthetic\\original.bak", modifiedUtc: "2026-01-01T00:00:00Z"
  } } });
  ui.windowEvents.DOMContentLoaded();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(ui.fetches.map(request => request.url), ["/api/status", "/api/latest"]);
  assert.equal(vm.runInContext("nativeSource.handle", ui.context), "opened");
  assert.match(ui.elements.get("source-status").textContent, /SaveGame2.*original\.bak/);
  assert.equal(ui.elements.get("autosave").checked, false);
  const standalone = app({ native: false });
  standalone.windowEvents.DOMContentLoaded();
  assert.equal(standalone.fetches.length, 0);
});

test("latest-load failure or missing verified backup leaves editing unavailable and chooser visible", async () => {
  for (const result of [{ error: "Newest slot invalid; no older slot selected." }, { name: "SaveGame1.es3", source: {} }]) {
    const ui = app({ pickerResult: result });
    await vm.runInContext("openNative(true)", ui.context);
    assert.equal(vm.runInContext("doc", ui.context), null);
    assert.match(ui.elements.get("message").textContent, /failed:/);
    assert.equal(ui.elements.get("native-picker").disabled, false);
  }
});

test("native discard refusal sends no open/backup/pruning requests and keeps drafts", async () => {
  const ui = app({ confirm: () => false });
  nativeFixture(ui, healthText(50));
  const input = draft(ui, "Player.Health");
  await commitInput(ui, "Player.Health", 70);
  await ui.elements.get("native-picker").events.click();
  assert.equal(ui.fetches.length, 0);
  assert.equal(draft(ui, "Player.Health"), input);
  assert.equal(input.value, "70");
  assert.equal(vm.runInContext("changes.get('Player.Health')", ui.context), 70);
});

test("startup reads native zero policy before autoload and honestly enables backup-free saves", async () => {
  const ui = app({ fetchResponse: async url => ({ ok: true, json: async () => url === "/api/status"
    ? { protocolVersion: 4, backupLimit: 0, folderExists: true, saveFolder: "C:\\Synthetic" }
    : { name: "SaveGame1.es3", contentBase64: Buffer.from(healthText(50)).toString("base64"),
      source: { handle: "zero", path: "C:\\Synthetic\\SaveGame1.es3", canSave: true, backupLimit: 0, backupPath: null } } }) });
  await vm.runInContext("openNative(true)", ui.context);
  assert.deepEqual(ui.fetches.map(request => request.url), ["/api/status", "/api/latest"]);
  assert.equal(ui.elements.get("backup-limit").value, "0");
  assert.match(ui.elements.get("source-status").textContent, /Backups disabled: no recovery/);
  assert.equal(ui.elements.get("autosave").disabled, false);
  assert.doesNotMatch(ui.elements.get("picker-hint").textContent, /backup verified/);
});

test("unreadable native preference blocks autoload without substituting a default", async () => {
  const ui = app({ fetchResponse: async () => ({ ok: false, status: 409, json: async () => ({ error: "Stored backup setting is invalid; no default was substituted." }) }) });
  await vm.runInContext("openNative(true)", ui.context);
  assert.deepEqual(ui.fetches.map(request => request.url), ["/api/status"]);
  assert.equal(vm.runInContext("nativeBackupLimit", ui.context), null);
  assert.match(ui.elements.get("backup-status").textContent, /invalid; no default/);
  assert.equal(vm.runInContext("doc", ui.context), null);
});

test("retention changes preserve live drafts, and zero mode still permits opt-in autosave", async () => {
  const warnings = [];
  const ui = app({ timers: true, confirm: text => { warnings.push(text); return true; }, fetchResponse: async (url, init) => {
    if (url === "/api/retention") return { ok: true, json: async () => ({ backupLimit: JSON.parse(init.body).backupLimit, backupPath: null }) };
    return { ok: true, json: async () => ({ contentBase64: Buffer.from(healthText(75)).toString("base64"), backupLimit: 0, backupPath: null }) };
  } });
  nativeFixture(ui);
  ui.elements.get("autosave").checked = true; ui.elements.get("autosave").events.change();
  const input = draft(ui, "Player.Health");
  input.value = "75"; await input.events.input();
  ui.elements.get("backup-limit").value = "0";
  await ui.elements.get("apply-backup-limit").events.click();
  await ui.flushTimers();
  assert.equal(ui.fetches.length, 1, "Applying a policy must not commit an uncommitted draft");
  assert.match(warnings[0], /ALL eligible editor backups.*\n[\s\S]*no automatic recovery copy/i);
  assert.deepEqual(JSON.parse(ui.fetches[0].init.body), { backupLimit: 0, handle: "opaque" });
  assert.equal(draft(ui, "Player.Health"), input);
  assert.equal(input.value, "75");
  assert.equal(ui.elements.get("autosave").disabled, false);
  assert.match(ui.elements.get("save-hint").textContent, /WITHOUT a recovery/);
  await input.events.change();
  await ui.flushTimers();
  assert.equal(ui.fetches.length, 2);
  assert.equal(vm.runInContext("doc.fields[0].value", ui.context), 75);
  assert.match(ui.elements.get("source-status").textContent, /Backups disabled: no recovery/);
});

test("delayed retention cannot autosave newer uncommitted or invalid drafts", async () => {
  const reply = deferred();
  const ui = app({ timers: true, fetchResponse: async () => reply.promise });
  nativeFixture(ui);
  ui.elements.get("autosave").checked = true; ui.elements.get("autosave").events.change();
  await commitInput(ui, "Player.Health", 90);
  ui.elements.get("backup-limit").value = "2";
  const applying = ui.elements.get("apply-backup-limit").events.click();
  const input = draft(ui, "Player.Health");
  input.value = "bad"; await input.events.input();
  reply.resolve({ ok: true, json: async () => ({ backupLimit: 2, backupPath: "C:\\Synthetic\\new.bak" }) });
  await applying;
  await ui.flushTimers();
  assert.equal(ui.fetches.length, 1);
  assert.equal(input.value, "bad");
  assert.equal(input.getAttribute("aria-invalid"), "true");
  assert.equal(draft(ui, "Player.Health"), input);
});

test("malformed limits and canceled zero consent never send retention requests", async () => {
  const ui = app({ confirm: () => false });
  nativeFixture(ui);
  for (const bad of ["", "-1", "2.5", "9007199254740992", "no"]) {
    ui.elements.get("backup-limit").value = bad;
    await ui.elements.get("apply-backup-limit").events.click();
    assert.match(ui.elements.get("backup-status").textContent, /whole number/);
  }
  ui.elements.get("backup-limit").value = "0";
  await ui.elements.get("apply-backup-limit").events.click();
  assert.equal(ui.fetches.length, 0);
  assert.equal(vm.runInContext("nativeSource.backupLimit", ui.context), 3);
});

test("a committed save with cleanup errors adopts its baseline and pauses autosave without claiming failure", async () => {
  const ui = app({ timers: true, fetchResponse: async () => ({ ok: true, json: async () => ({
    saved: true, contentBase64: Buffer.from(healthText(90)).toString("base64"),
    backupLimit: 1, backupPath: "C:\\Synthetic\\protected.bak", retentionWarning: "Access denied deleting an older backup"
  }) }) });
  nativeFixture(ui);
  ui.elements.get("autosave").checked = true; ui.elements.get("autosave").events.change();
  await commitInput(ui, "Player.Health", 90);
  await ui.flushTimers();
  assert.equal(vm.runInContext("doc.fields[0].value", ui.context), 90);
  assert.equal(vm.runInContext("changes.size", ui.context), 0);
  assert.match(ui.elements.get("backup-status").textContent, /Save succeeded.*cleanup is incomplete/);
  assert.match(ui.elements.get("autosave-status").textContent, /Autosaved.*cleanup failed/);
  assert.doesNotMatch(ui.elements.get("message").textContent, /Save failed/);
  await commitInput(ui, "Player.Health", 80);
  await ui.flushTimers();
  assert.equal(ui.fetches.length, 1);
  assert.equal(draft(ui, "Player.Health").value, "80");
});

test("autosave serializes delayed writes, coalesces committed edits, and retains newer drafts", async () => {
  const replies = [deferred(), deferred()];
  const payloads = [];
  const ui = app({ timers: true, confirm: () => { throw Error("Autosave must not prompt"); }, fetchResponse: async (url, init) => {
    assert.equal(url, "/api/save");
    payloads.push(JSON.parse(init.body));
    return replies[payloads.length - 1].promise;
  } });
  nativeFixture(ui);
  ui.elements.get("autosave").checked = true;
  ui.elements.get("autosave").events.change();
  await commitInput(ui, "Player.Health", 90);
  await ui.flushTimers();
  assert.equal(payloads.length, 1);
  await commitInput(ui, "Player.Health", 80);
  await commitInput(ui, "Player.Health", 70);
  await ui.flushTimers();
  assert.equal(payloads.length, 1, "Only one request may be in flight");
  replies[0].resolve(saveReply(healthText(90)));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(draft(ui, "Player.Health").value, "70");
  assert.equal(vm.runInContext("doc.fields[0].value", ui.context), 90);
  await ui.flushTimers();
  assert.equal(payloads.length, 2);
  assert.deepEqual(payloads[1].changes, { "Player.Health": 70 });
  assert.equal(payloads[1].autosave, true);
  replies[1].resolve(saveReply(healthText(70)));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(vm.runInContext("changes.size", ui.context), 0);
  assert.match(ui.elements.get("autosave-status").textContent, /Autosaved/);
  assert.equal(JSON.parse(ui.stored()).autosave, true);
});

test("autosave never saves invalid or uncommitted drafts, including during delayed writes", async () => {
  const reply = deferred();
  let requests = 0;
  const ui = app({ timers: true, fetchResponse: async () => ++requests === 1 ? reply.promise : saveReply(healthText(80)) });
  nativeFixture(ui);
  ui.elements.get("autosave").checked = true;
  ui.elements.get("autosave").events.change();
  await commitInput(ui, "Player.Health", 101);
  await ui.flushTimers();
  assert.equal(ui.fetches.length, 0);
  assert.match(ui.elements.get("autosave-status").textContent, /paused/);
  await commitInput(ui, "Player.Health", 90);
  await ui.flushTimers();
  assert.equal(ui.fetches.length, 1);
  await commitInput(ui, "Player.Health", -1);
  reply.resolve(saveReply(healthText(90)));
  await new Promise(resolve => setImmediate(resolve));
  await ui.flushTimers();
  assert.equal(ui.fetches.length, 1);
  assert.equal(draft(ui, "Player.Health").value, "-1");
  assert.equal(draft(ui, "Player.Health").getAttribute("aria-invalid"), "true");
  const pending = draft(ui, "Player.Health");
  pending.value = "80";
  await pending.events.input();
  await ui.flushTimers();
  assert.equal(ui.fetches.length, 1, "Keystrokes alone must never save");
  await pending.events.change();
  await ui.flushTimers();
  assert.equal(ui.fetches.length, 2);
  assert.equal(vm.runInContext("changes.size", ui.context), 0);
});

test("delayed autosave refreshes item and vehicle baselines without replacing controls or newer drafts", async () => {
  const reply = deferred();
  const ui = app({ timers: true, fetchResponse: async () => reply.promise });
  seedWorldItems(ui, true);
  const text = ui.context.worldText;
  nativeFixture(ui, text);
  vm.runInContext('selectItem(doc.items[0].id);', ui.context);
  const id = vm.runInContext("doc.items[0].fieldIds[0]", ui.context);
  const input = draft(ui, id);
  ui.elements.get("item-filter").value = "engine";
  ui.elements.get("item-filter").events.input();
  ui.elements.get("autosave").checked = true; ui.elements.get("autosave").events.change();
  await commitInput(ui, id, 90);
  await ui.flushTimers();
  input.value = "70";
  await input.events.input();
  reply.resolve(saveReply(Save.serialize(text, { [id]: 90 })));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(draft(ui, id), input);
  assert.equal(input.value, "70");
  assert.equal(ui.elements.get("item-filter").value, "engine");
  assert.equal(vm.runInContext("selectedItemId === doc.items[0].id", ui.context), true);
  assert.equal(ui.elements.get("item-editor").parentNode, vm.runInContext("itemRows.get(doc.items[0].id).editorCell", ui.context));
  assert.equal(vm.runInContext("itemRows.get(doc.items[0].id).expansion.hidden", ui.context), false);
  assert.match(vm.runInContext("itemRows.get(doc.items[0].id).summary.textContent", ui.context), /90%/);
  assert.match(vm.runInContext("vehicleSummaryRows.get(doc.vehicles[0].id).parts.textContent", ui.context), /90%/);
  await ui.flushTimers();
  assert.equal(ui.fetches.length, 1, "The newer uncommitted draft must stay unsaved");
});

test("unchecking autosave cancels queued writes; failures latch without automatic retries", async () => {
  const ui = app({ timers: true, fetchResponse: async () => ({ ok: false, json: async () => ({ error: "stale source" }) }) });
  nativeFixture(ui);
  const toggle = ui.elements.get("autosave");
  toggle.checked = true; toggle.events.change();
  await commitInput(ui, "Player.Health", 80);
  toggle.checked = false; toggle.events.change();
  await ui.flushTimers();
  assert.equal(ui.fetches.length, 0);
  toggle.checked = true; toggle.events.change();
  await ui.flushTimers();
  assert.equal(ui.fetches.length, 1);
  await commitInput(ui, "Player.Health", 70);
  await ui.flushTimers();
  assert.equal(ui.fetches.length, 1);
  assert.equal(draft(ui, "Player.Health").value, "70");
  assert.match(ui.elements.get("autosave-status").textContent, /stopped after an error/);
});

test("player bulk action is one coherent autosave, sets exact values, and preserves protected data", async () => {
  const text = JSON.stringify({ Player: pm({ Health: scalar(40) }), Ammo: pm({ armor: scalar(5), ammo_9mm: { __type: "int", value: 250 } }),
    global: pm({ Hunger: scalar(10), Thirst: scalar(10), Fatigue: scalar(10), Radiation: scalar(10), Money: { __type: "int", value: 39 }, Sanity: scalar(-27) }) });
  let payload;
  const ui = app({ timers: true, fetchResponse: async (url, init) => {
    payload = JSON.parse(init.body);
    return saveReply(Save.serialize(text, payload.changes));
  } });
  nativeFixture(ui, text);
  ui.elements.get("autosave").checked = true;
  ui.elements.get("autosave").events.change();
  ui.elements.get("maximize-player").events.click();
  await ui.flushTimers();
  assert.equal(ui.fetches.length, 1);
  assert.deepEqual(payload.changes, { "Player.Health": 100, "Ammo.ammo_9mm": 100, "global.Hunger": 0, "global.Thirst": 0, "global.Fatigue": 0, "global.Radiation": 0, "global.Money": 900000 });
  assert.equal(vm.runInContext("doc.fields.find(field => field.id === 'global.Money').value", ui.context), 900000);
  assert.equal(vm.runInContext("doc.fields.find(field => field.id === 'Ammo.armor').value", ui.context), 5);
  assert.equal(vm.runInContext("changes.size", ui.context), 0);
});

test("Saved Items omits the weapon-type section without changing carried supplies or saved counters", () => {
  const text = JSON.stringify({
    Ammo: pm({ ammo_9mm: { __type: "int", value: 42 } }),
    weaponsAmmoInGun: pm({ ammoakms: { __type: "int", value: 17 } })
  });
  const ui = app();
  nativeFixture(ui, text);
  const legends = ui.elements.get("fields").children.map(group => group.children[0].textContent);
  assert.ok(legends.includes("Supplies"));
  assert.equal(legends.includes("Ammunition by weapon type"), false);
  assert.equal(draft(ui, "Ammo.ammo_9mm").value, "42");
  const typeRow = vm.runInContext("fieldRows.get('weaponsAmmoInGun.ammoakms')", ui.context);
  assert.equal(typeRow.parentNode, undefined);
  assert.equal(vm.runInContext("changes.size", ui.context), 0);
  assert.equal(vm.runInContext("ApocalypterSave.serialize(doc.text, changes)", ui.context), text);
});

test("Nuts can be edited and saved with the requested bulk target", async () => {
  const text = JSON.stringify({ global: pm({ Money: { __type: "int", value: 42 } }), Player: pm({ Health: scalar(50) }) });
  let payload;
  const ui = app({ fetchResponse: async (url, init) => {
    payload = JSON.parse(init.body);
    return saveReply(Save.serialize(text, payload.changes));
  } });
  nativeFixture(ui, text);
  assert.equal(draft(ui, "global.Money").value, "42");
  await commitInput(ui, "global.Money", 500);
  ui.elements.get("maximize-player").events.click();
  assert.equal(draft(ui, "global.Money").value, "900000");
  await ui.elements.get("save").events.click();
  assert.equal(payload.changes["global.Money"], 900000);
  assert.equal(vm.runInContext("doc.fields.find(field => field.id === 'global.Money').value", ui.context), 900000);
});

test("all-vehicle bulk action is one coherent autosave with exactly the selected-action targets", async () => {
  let payload;
  let text;
  const ui = app({ timers: true, fetchResponse: async (url, init) => {
    payload = JSON.parse(init.body);
    return saveReply(Save.serialize(text, payload.changes));
  } });
  seedWorldItems(ui, true);
  text = ui.context.worldText;
  nativeFixture(ui, text);
  ui.elements.get("autosave").checked = true; ui.elements.get("autosave").events.change();
  ui.elements.get("all-vehicles").events.click();
  await ui.flushTimers();
  assert.equal(ui.fetches.length, 1);
  assert.deepEqual(payload.changes, { "item:9000:0:Condition": 100, "vehicle:car-1:0:fuel": 20 });
  assert.equal(ui.elements.get("message").textContent, "");
  assert.equal(vm.runInContext("doc.items[0].condition", ui.context), 100);
  assert.match(vm.runInContext("itemRows.get(doc.items[0].id).summary.textContent", ui.context), /100%/);
  assert.match(vm.runInContext("vehicleSummaryRows.get(doc.vehicles[0].id).fuel.textContent", ui.context), /20 \/ 20/);
  assert.match(vm.runInContext("vehicleSummaryRows.get(doc.vehicles[0].id).parts.textContent", ui.context), /100%/);
});

test("vehicle batch fills attached engine and radiator but not loose coolant, in one autosave", async () => {
  let payload, text;
  const ui = app({ timers: true, fetchResponse: async (url, init) => {
    payload = JSON.parse(init.body);
    return saveReply(Save.serialize(text, payload.changes));
  } });
  seedWorldItems(ui, true);
  const root = JSON.parse(ui.context.worldText);
  const engineName = "3.8L V6 165HP 285Nm Gasoline(Clone)1";
  const engine = root.newGOArray_Items.value.array[0];
  const engineRecord = root["engine(Clone)1"];
  delete root["engine(Clone)1"];
  root[engineName] = engineRecord;
  engine.name = engineName;
  engine.es3Prefab = { prefabId: "5945172545298182391" };
  engineRecord.value.objs.owner.es3Prefab = engine.es3Prefab;
  root["car(Clone)1"].value.objs.hinge_radiator = { transformID: "rad-mount" };
  for (const [index, parent] of [[0, "rad-mount"], [1, null]]) {
    const name = `radiator_medium_race(Clone)${index + 10}`, ref = `rad-${index}`;
    const prefab = { prefabId: "2169926468007209799" };
    root.newGOArray_Items.value.array.push({ name, _ES3Ref: ref, es3Prefab: prefab,
      components: [{ __type: "Transform", parent: parent ? { _ES3Ref: parent } : null }] });
    root[name] = pm({ owner: { _ES3Ref: ref, es3Prefab: prefab }, Liquid: scalar(0.3) });
  }
  text = JSON.stringify(root);
  nativeFixture(ui, text);
  ui.elements.get("autosave").checked = true; ui.elements.get("autosave").events.change();
  ui.elements.get("all-vehicles").events.click();
  await ui.flushTimers();
  assert.equal(ui.fetches.length, 1);
  assert.equal(payload.changes["item:9000:0:Liquid"], 6);
  assert.equal(payload.changes["item:rad-0:3:Liquid"], 14);
  assert.equal(payload.changes["item:rad-1:4:Liquid"], undefined);
  assert.equal(vm.runInContext("doc.items[4].liquid.value", ui.context), 0.3);
});

test("Repair & Top Off batches verified consumables and Nuts while preserving armor and plates", async () => {
  let payload, text;
  const ui = app({ timers: true, fetchResponse: async (url, init) => {
    payload = JSON.parse(init.body);
    return saveReply(Save.serialize(text, payload.changes));
  } });
  seedWorldItems(ui, true);
  const root = JSON.parse(ui.context.worldText);
  root.Ammo = pm({ armor: scalar(0), armorPlates: { __type: "int", value: 0 },
    ammo_9mm: { __type: "int", value: 3 }, ammo_9mm_capacity: { __type: "int", value: 40 } });
  root.global = pm({ Money: { __type: "int", value: 50 } });
  root.weaponsAmmoInGun = pm({ ammoakms: { __type: "int", value: 20 }, ammoUnknown: { __type: "int", value: 12 } });
  const entries = [
    ["bandage_1", "688495819279421776", "Quantity"],
    ["first_aid_1", "3955095449936337101", "Quantity"],
    ["Repairbox_Medium", "7600464120049698740", "Quantity"],
    ["sanity_pills", "4398581480533230246", "Quantity"],
    ["weed_bag", "2856772050428381491", "Quantity"],
    ["ammo_box_9mm", "3733066396143753576", "ammo"],
    ["ammo_arrow", "3766863323530176910", "ammo"],
    ["cigarette_bactrian", "7947724335221001397", "Quantity"],
    ["cigar", "6706846953073870613", "Quantity"],
    ["flashlight_batteries", "6027655925999442117", "batteries"],
    ["mystery_food", "unknown", "Quantity"],
    ["first_aid_1", "3955095449936337101", "Quantity"]
  ];
  for (const [index, [name, id, key]] of entries.entries()) {
    const savedName = `${name}(Clone)${index + 100}`, ref = `consumable-${index}`;
    const prefab = { prefabId: id };
    root.newGOArray_Items.value.array.push({ name: savedName, _ES3Ref: ref, es3Prefab: prefab,
      components: [{ __type: "Transform", parent: null }] });
    root[savedName] = pm({ owner: { _ES3Ref: ref, es3Prefab: index === 11 ? { prefabId: "wrong" } : prefab },
      [key]: { __type: "int", value: 4 } });
  }
  text = JSON.stringify(root);
  nativeFixture(ui, text);
  ui.elements.get("autosave").checked = true; ui.elements.get("autosave").events.change();
  ui.elements.get("all-vehicles").events.click();
  await ui.flushTimers();
  assert.equal(ui.fetches.length, 1);
  assert.equal(payload.changes["Ammo.ammo_9mm"], 999);
  assert.equal(payload.changes["weaponsAmmoInGun.ammoakms"], 999);
  assert.equal(payload.changes["global.Money"], 900000);
  for (let index = 0; index < 10; index++) {
    const key = index === 9 ? "batteries" : index === 5 || index === 6 ? "ammo" : "Quantity";
    assert.equal(payload.changes[`item:consumable-${index}:${index + 3}:${key}`], 999);
  }
  for (const id of ["Ammo.armor", "Ammo.armorPlates", "Ammo.ammo_9mm_capacity",
    "weaponsAmmoInGun.ammoUnknown", "item:consumable-10:13:Quantity", "item:consumable-11:14:Quantity"]) {
    assert.equal(payload.changes[id], undefined, id);
  }
  const saved = JSON.parse(Save.serialize(text, payload.changes));
  assert.equal(saved.Ammo.value.objs.armor.value, 0);
  assert.equal(saved.Ammo.value.objs.armorPlates.value, 0);
  assert.match(ui.elements.get("vehicle-action-status").textContent, /Armor, plates, unknown counters/);
});

test("Repair & Top Off remains available for supplies when a save has no vehicles", () => {
  const text = JSON.stringify({ Ammo: pm({ ammo_9mm: { __type: "int", value: 5 }, armor: scalar(0) }),
    global: pm({ Money: { __type: "int", value: 42 } }) });
  const ui = app();
  nativeFixture(ui, text);
  assert.equal(vm.runInContext("doc.sections.some(section => section.id === 'vehicles')", ui.context), true);
  assert.equal(ui.elements.get("vehicle-actions").hidden, false);
  assert.equal(ui.elements.get("all-vehicles").disabled, false);
  ui.elements.get("all-vehicles").events.click();
  assert.equal(draft(ui, "Ammo.ammo_9mm").value, "999");
  assert.equal(draft(ui, "global.Money").value, "900000");
  assert.equal(draft(ui, "Ammo.armor").value, "0");
});

test("editable-only reports zero matches rather than no instances for an all-read-only list", () => {
  const ui = app();
  seedWorldItems(ui);
  vm.runInContext("doc = ApocalypterSave.inspect(JSON.stringify({ ...JSON.parse(worldText), 'engine(Clone)1': {}, 'engine(Clone)2': {} })); render();", ui.context);
  ui.elements.get("editable-only").checked = true;
  ui.elements.get("editable-only").events.change();
  assert.match(ui.elements.get("item-filter-status").textContent, /Showing 0 of 3.*No items match/);
});

test("editable-only filter combines with search, persists, and keeps hidden drafts", () => {
  const ui = app();
  seedWorldItems(ui);
  vm.runInContext('inputs.get(doc.items[0].fieldIds[0]).value = "91"; refresh();', ui.context);
  ui.elements.get("editable-only").checked = true;
  ui.elements.get("editable-only").events.change();
  ui.elements.get("item-filter").value = "wheel";
  ui.elements.get("item-filter").events.input();
  assert.match(ui.elements.get("item-filter-status").textContent, /No items match/);
  assert.equal(vm.runInContext("changes.get(doc.items[0].fieldIds[0])", ui.context), 91);
  assert.equal(JSON.parse(ui.stored()).editableOnly, true);
  ui.elements.get("item-filter").value = "engine";
  ui.elements.get("item-filter").events.input();
  assert.match(ui.elements.get("item-filter-status").textContent, /Showing 2 of 3/);
});

test("all Save buttons share availability, exact destination confirmation, and cancellation", async () => {
  let confirmations = 0;
  const ui = app({ confirm: text => { assert.match(text, /C:\\Synthetic\\SaveGame1\.es3/); confirmations++; return false; } });
  nativeFixture(ui);
  await commitInput(ui, "Player.Health", 90);
  for (const id of ["save", "save-top", "save-side"]) {
    assert.equal(ui.elements.get(id).disabled, false);
    await ui.elements.get(id).events.click();
  }
  assert.equal(confirmations, 3);
  assert.equal(ui.fetches.length, 0);
});
test("editing numeric values dismisses help without removing their accessible descriptions", () => {
  const ui = app();
  nativeFixture(ui);
  const input = draft(ui, "Player.Health");
  assert.match(input.getAttribute("aria-describedby"), /help-/);
  for (const event of ["focus", "pointerenter", "pointerdown"]) {
    ui.elements.get("floating-help").hidden = false;
    input.events[event]();
    assert.equal(ui.elements.get("floating-help").hidden, true, event);
    assert.equal(input.value, "100");
  }
});

test("canceling manual Save also cancels a queued autosave so cancel cannot cause a write", async () => {
  const ui = app({ timers: true, confirm: () => false });
  nativeFixture(ui);
  ui.elements.get("autosave").checked = true; ui.elements.get("autosave").events.change();
  await commitInput(ui, "Player.Health", 90);
  await ui.elements.get("save-top").events.click();
  await ui.flushTimers();
  assert.equal(ui.fetches.length, 0);
  assert.equal(draft(ui, "Player.Health").value, "90");
  assert.match(ui.elements.get("message").textContent, /canceled.*drafts remain/);
});

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
      assert.deepEqual(Object.keys(request).sort(), ["backupLimit", "changes", "confirmed", "handle"]);
      assert.equal(request.backupLimit, 3);
      assert.equal(request.handle, "opaque-handle");
      return {
        ok: true,
        json: async () => ({
          backupLimit: 3, backupPath: `C:\\Synthetic\\backup-${confirmations}.bak`,
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
test("item editors expand beside their rows, toggle closed, and follow filters without losing drafts", () => {
  const ui = app();
  seedWorldItems(ui);
  vm.runInContext("selectItem(doc.items[0].id);", ui.context);
  const first = vm.runInContext("itemRows.get(doc.items[0].id)", ui.context);
  assert.equal(ui.elements.get("item-editor").parentNode, first.editorCell);
  assert.equal(first.expansion.hidden, false);
  assert.equal(first.button.getAttribute("aria-expanded"), "true");
  vm.runInContext('inputs.get(doc.items[0].fieldIds[0]).value = "91"; refresh();', ui.context);
  ui.elements.get("item-filter").value = "9001";
  ui.elements.get("item-filter").events.input();
  assert.equal(first.expansion.hidden, true);
  ui.elements.get("item-filter").value = "";
  ui.elements.get("item-filter").events.input();
  assert.equal(first.expansion.hidden, false);
  vm.runInContext("selectItem(doc.items[1].id);", ui.context);
  assert.equal(first.expansion.hidden, true);
  assert.equal(ui.elements.get("item-editor").parentNode, vm.runInContext("itemRows.get(doc.items[1].id).editorCell", ui.context));
  assert.equal(vm.runInContext("changes.get(doc.items[0].fieldIds[0])", ui.context), 91);
  vm.runInContext("selectItem(doc.items[1].id);", ui.context);
  assert.equal(ui.elements.get("item-editor").hidden, true);
  assert.equal(ui.elements.get("item-editor").parentNode, ui.elements.get("item-editor-home"));
  assert.equal(vm.runInContext("itemRows.get(doc.items[1].id).button.getAttribute('aria-expanded')", ui.context), "false");
});

test("Saved items Maximize all includes hidden and mounted targets in a single autosave", async () => {
  let text;
  let payload;
  const ui = app({ timers: true, fetchResponse: async (url, init) => {
    payload = JSON.parse(init.body);
    return saveReply(Save.serialize(text, payload.changes));
  } });
  seedWorldItems(ui, true);
  const root = JSON.parse(ui.context.worldText);
  root["engine(Clone)2"].value.objs.Liquid = scalar(2);
  root["engine(Clone)2"].value.objs.LiquidCapacity = scalar(5);
  root["engine(Clone)2"].value.objs.Quantity = { __type: "int", value: 3 };
  root["engine(Clone)2"].value.objs.ammo = { __type: "int", value: 4 };
  root.weaponsAmmoInGun = pm({ ammoakms: { __type: "int", value: 10 } });
  text = JSON.stringify(root);
  nativeFixture(ui, text);
  ui.elements.get("autosave").checked = true; ui.elements.get("autosave").events.change();
  ui.elements.get("item-filter").value = "wheel";
  ui.elements.get("item-filter").events.input();
  ui.elements.get("maximize-items").events.click();
  await ui.flushTimers();
  assert.equal(ui.fetches.length, 1);
  assert.deepEqual(payload.changes, { "item:9000:0:Condition": 100, "item:9001:1:Condition": 100, "item:9001:1:Liquid": 5, "weaponsAmmoInGun.ammoakms": 100 });
  assert.match(ui.elements.get("item-action-status").textContent, /staged 4.*2 unverified counters and 0 invalid/);
  assert.equal(vm.runInContext("changes.size", ui.context), 0);
  assert.equal(ui.elements.get("item-filter").value, "wheel");
});

test("item batch stages verified requested counts, preserves invalid drafts and saves once", async () => {
  let text, payload;
  const ui = app({ timers: true, fetchResponse: async (url, init) => {
    payload = JSON.parse(init.body);
    return saveReply(Save.serialize(text, payload.changes));
  } });
  seedWorldItems(ui);
  const root = JSON.parse(ui.context.worldText);
  for (const [i, name, prefabId, key, value] of [
    [0, "bandage_1", "688495819279421776", "Quantity", 150],
    [1, "Repairbox_Medium", "7600464120049698740", "Quantity", 10],
    [2, "ammo_box_9mm", "3733066396143753576", "ammo", 10]
  ]) {
    const savedName = `${name}(Clone)10`, ref = `new-${i}`, prefab = { prefabId };
    root.newGOArray_Items.value.array.push({ name: savedName, _ES3Ref: ref, es3Prefab: prefab });
    root[savedName] = pm({ owner: { _ES3Ref: ref, es3Prefab: prefab }, [key]: { __type: "int", value } });
  }
  text = JSON.stringify(root);
  nativeFixture(ui, text);
  ui.elements.get("autosave").checked = true; ui.elements.get("autosave").events.change();
  await commitInput(ui, "item:new-2:5:ammo", "");
  ui.elements.get("maximize-items").events.click();
  await ui.flushTimers();
  assert.equal(ui.fetches.length, 0, "invalid draft blocks autosave of all staged changes");
  assert.equal(draft(ui, "item:new-0:3:Quantity").value, "100");
  assert.equal(draft(ui, "item:new-1:4:Quantity").value, "999");
  assert.equal(draft(ui, "item:new-2:5:ammo").value, "");
  assert.match(ui.elements.get("item-action-status").textContent, /1 invalid target drafts skipped/);
  await commitInput(ui, "item:new-2:5:ammo", 100);
  await ui.flushTimers();
  assert.equal(ui.fetches.length, 1);
  assert.equal(payload.changes["item:new-0:3:Quantity"], 100);
  assert.equal(payload.changes["item:new-1:4:Quantity"], 999);
  assert.equal(payload.changes["item:new-2:5:ammo"], 100);
});
test("manual Save and Reset reopen the selected inline editor without clearing the filter", async () => {
  let text;
  const ui = app({ fetchResponse: async (url, init) => saveReply(Save.serialize(text, JSON.parse(init.body).changes)) });
  seedWorldItems(ui);
  text = ui.context.worldText;
  nativeFixture(ui, text);
  vm.runInContext('selectItem(doc.items[1].id); inputs.get(doc.items[1].fieldIds[0]).value = "91"; refresh();', ui.context);
  ui.elements.get("item-filter").value = "9001";
  ui.elements.get("item-filter").events.input();
  await ui.elements.get("save").events.click();
  assert.equal(vm.runInContext("doc.items[1].condition", ui.context), 91);
  assert.equal(ui.elements.get("item-editor").parentNode, vm.runInContext("itemRows.get(doc.items[1].id).editorCell", ui.context));
  assert.equal(vm.runInContext("itemRows.get(doc.items[1].id).expansion.hidden", ui.context), false);
  assert.equal(ui.elements.get("item-filter").value, "9001");
  vm.runInContext('inputs.get(doc.items[1].fieldIds[0]).value = "80"; refresh();', ui.context);
  ui.elements.get("reset").events.click();
  assert.equal(vm.runInContext("inputs.get(doc.items[1].fieldIds[0]).value", ui.context), "91");
  assert.equal(vm.runInContext("itemRows.get(doc.items[1].id).expansion.hidden", ui.context), false);
  assert.equal(ui.elements.get("item-filter").value, "9001");
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

test("pictured wheel condition and coolant are editable in the inline item inspector", () => {
  const ui = app();
  seedWorldItems(ui);
  vm.runInContext(`
    const root = JSON.parse(worldText);
    const wheel = { name: "small_wheel_3(Clone)10", _ES3Ref: "wheel-1", active: true,
      es3Prefab: { prefabId: "2321790605670812229" }, components: [{ __type: "Transform", parent: null }] };
    const radiator = { name: "radiator_medium_race(Clone)11", _ES3Ref: "rad-1", active: true,
      es3Prefab: { prefabId: "2169926468007209799" }, components: [{ __type: "Transform", parent: null }] };
    root.newGOArray_Items.value.array.push(wheel, radiator);
    root[wheel.name] = { __type: "System.Object", value: { __type: "float", value: 24 } };
    root[radiator.name] = { __type: "ES3PlayMaker.PMDataWrapper,Assembly-CSharp-firstpass",
      value: { objs: { owner: { _ES3Ref: "rad-1", es3Prefab: radiator.es3Prefab }, Liquid: { __type: "float", value: 0.3 } } } };
    doc = ApocalypterSave.inspect(JSON.stringify(root)); render(); selectItem(doc.items[3].id);
  `, ui.context);
  assert.equal(vm.runInContext('inputs.get(doc.items[3].fieldIds[0]).value', ui.context), "24");
  vm.runInContext('inputs.get(doc.items[3].fieldIds[0]).value = "100"; refresh(); selectItem(doc.items[4].id);', ui.context);
  assert.equal(vm.runInContext('changes.get(doc.items[3].fieldIds[0])', ui.context), 100);
  assert.equal(vm.runInContext('inputs.get(doc.items[4].fieldIds[0]).value', ui.context), "0.3");
  assert.equal(vm.runInContext('doc.items[4].liquid.capacity', ui.context), 14);
});
