(function (root) {
  "use strict";
  const MAX_BYTES = 20 * 1024 * 1024;
  const wrapper = "ES3PlayMaker.PMDataWrapper,Assembly-CSharp-firstpass";
  const ammoNames = [
    "ammo_22caliber", "ammo_22caliber_capacity", "ammo_9mm",
    "ammo_9mm_capacity", "ammo_20gauge", "ammo_20gauge_capacity",
    "ammo_arrow", "ammo_arrow_capacity", "ammo_battery_capacity",
    "ammo_grenade", "ammo_12gauge", "ammo_556", "ammo_762",
    "ammo_3006", "ammo_battery"
  ];
  const switches = {
    peacefulMode: "Peaceful mode",
    disableThirstHunger: "Disable thirst and hunger",
    disableFatigue: "Disable fatigue",
    mapCheat: "Map cheat",
    disableInsanity: "Disable insanity",
    toggleHeadbob: "Head bob",
    toggleFPS: "Show FPS",
    toggleFootstepSounds: "Footstep sounds",
    toggleADS: "Toggle aim down sights"
  };
  const volumes = {
    ambient_volume: "Ambient volume",
    enginesoundvolume: "Engine volume",
    boss_music: "Boss music",
    ambient_music: "Ambient music",
    audio_volume: "Master volume",
    main_menu_music: "Main menu music"
  };

  // ES3PlayMaker writes an unnamed value immediately after its __type string.
  // Retain source spans instead of normalizing this non-JSON extension.
  function parse(text) {
    if (typeof text !== "string" || !text.trim()) throw new Error("The save is empty.");
    if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error("Save exceeds the 20 MiB limit.");
    let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
    let count = 0;
    function fail(message) { throw new Error(`${message} at character ${pos + 1}.`); }
    function space() { while (pos < text.length && /[ \t\r\n]/.test(text[pos])) pos++; }
    function value(depth) {
      if (depth > 150 || ++count > 500000) fail("Save structure is too complex");
      space();
      const start = pos;
      const ch = text[pos];
      if (ch === "{") {
        pos++;
        const props = new Map();
        let implicit = null;
        space();
        if (text[pos] !== "}") {
          while (true) {
            space();
            if (text[pos] !== '"') fail("Expected a property name");
            const key = value(depth + 1);
            if (props.has(key.value)) fail("Duplicate property");
            space();
            if (text[pos++] !== ":") fail("Expected a colon");
            const child = value(depth + 1);
            props.set(key.value, child);
            space();
            if (key.value === "__type" && text[pos] !== "," && text[pos] !== "}") {
              if (child.kind !== "string" || implicit) fail("Invalid inline type");
              implicit = value(depth + 1);
              space();
            }
            if (text[pos] !== ",") break;
            pos++;
          }
        }
        if (text[pos++] !== "}") fail("Expected closing brace");
        return { kind: "object", props, implicit, start, end: pos };
      }
      if (ch === "[") {
        pos++;
        const items = [];
        space();
        if (text[pos] !== "]") {
          while (true) {
            items.push(value(depth + 1));
            space();
            if (text[pos] !== ",") break;
            pos++;
          }
        }
        if (text[pos++] !== "]") fail("Expected closing bracket");
        return { kind: "array", items, start, end: pos };
      }
      if (ch === '"') {
        pos++;
        while (pos < text.length) {
          const next = text[pos++];
          if (next === "\\") { pos++; continue; }
          if (next === '"') {
            let decoded;
            try { decoded = JSON.parse(text.slice(start, pos)); }
            catch { fail("Invalid string"); }
            return { kind: "string", value: decoded, start, end: pos };
          }
        }
        fail("Unterminated string");
      }
      const token = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(pos));
      if (!token) fail("Expected a value; encrypted and binary saves are not supported");
      pos += token[0].length;
      const raw = token[0];
      return { kind: raw === "null" ? "null" : /^(true|false)$/.test(raw) ? "boolean" : "number", value: JSON.parse(raw), start, end: pos };
    }
    const tree = value(0);
    space();
    if (pos !== text.length || tree.kind !== "object") fail("Expected a single save object");
    return tree;
  }

  function at(node, ...keys) {
    for (const key of keys) node = node?.kind === "object" ? node.props.get(key) : undefined;
    return node;
  }

  function validate(field, value) {
    if (field.type === "bool") {
      if (typeof value !== "boolean") throw new Error(`${field.label} must be true or false.`);
    } else {
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${field.label} must be a finite number.`);
      if (field.type === "int" && !Number.isInteger(value)) throw new Error(`${field.label} must be a whole number.`);
      if (value < field.min || value > field.max) throw new Error(`${field.label} must be between ${field.min} and ${field.max}.`);
    }
    return value;
  }

  function inspect(text) {
    const tree = parse(text);
    const fields = [];
    function add(id, label, group, node, type, min, max) {
      if (!node) return;
      const declared = at(node, "__type");
      const scalar = node.implicit || at(node, "value");
      if (node.implicit && at(node, "value")) throw new Error(`Ambiguous value for ${id}.`);
      if (declared?.value !== type || !scalar || scalar.kind !== (type === "bool" ? "boolean" : "number")) {
        throw new Error(`Unsupported structure for ${id}; this save version cannot be edited safely.`);
      }
      const field = { id, label, group, type, min, max, value: scalar.value, start: scalar.start, end: scalar.end };
      validate(field, scalar.value);
      fields.push(field);
    }
    const player = at(tree, "Player");
    const ammo = at(tree, "Ammo");
    if (player && at(player, "__type")?.value === wrapper) {
      add("Player.Health", "Health", "Player", at(player, "value", "objs", "Health"), "float", 0, 100);
    }
    if (ammo && at(ammo, "__type")?.value === wrapper) {
      add("Ammo.armor", "Armor", "Supplies", at(ammo, "value", "objs", "armor"), "float", 0, 100);
      for (const name of ammoNames) {
        add(`Ammo.${name}`, name.replace(/^ammo_/, "").replaceAll("_", " "), "Supplies", at(ammo, "value", "objs", name), "int", 0, 2147483647);
      }
    }
    for (const [name, label] of Object.entries(switches)) add(name, label, "Gameplay settings", at(tree, name), "bool");
    for (const [name, label] of Object.entries(volumes)) add(name, label, "Audio settings", at(tree, name), "float", 0, 1);
    add("FOV", "Field of view", "Display settings", at(tree, "FOV"), "float", 30, 120);
    if (!fields.length) throw new Error("No supported Apocalypter fields found. Open SaveGameN.es3 or SaveSettings.es3.");
    return { fields, kind: player ? "Game save" : "Settings", text };
  }

  function serialize(text, changes) {
    const doc = inspect(text);
    const entries = changes instanceof Map ? [...changes] : Object.entries(changes);
    const edits = entries.map(([id, value]) => {
      const field = doc.fields.find(item => item.id === id);
      if (!field) throw new Error(`Editing ${id} is not supported.`);
      validate(field, value);
      return { ...field, replacement: Object.is(value, field.value) ? text.slice(field.start, field.end) : JSON.stringify(value) };
    }).sort((a, b) => b.start - a.start);
    let result = text;
    for (const edit of edits) result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
    inspect(result);
    return result;
  }

  const api = { inspect, serialize, validate, MAX_BYTES };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ApocalypterSave = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
