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
  const sections = [
    { id: "player", label: "Player & supplies" },
    { id: "items", label: "Saved items" },
    { id: "vehicles", label: "Vehicles" },
    { id: "settings", label: "Settings" }
  ];
  const weaponAmmoLabels = {
    ammoakms: "AKMS (saved item ID: akms)",
    ammoakmdrum: "AKM drum",
    ammoakmtrash: "AKM trash",
    ammo22pipepistol: "22 pipe pistol",
    ammo22piperevolver: "22 pipe revolver",
    ammoborzsmg: "BorZ SMG",
    ammocrossbow: "Crossbow",
    ammofolk17: "Folk 17",
    ammom16a1: "M16A1",
    ammorochesterm24: "Rochester M24",
    ammorochesterm24chopped: "Chopped Rochester M24",
    ammoslamberg500: "Slamberg 500",
    ammoslamberg500chopped: "Chopped Slamberg 500",
    ammoslamfireshotgun: "Flare shotgun",
    ammoredmarkm11: "Redmark M11",
    ammoredmarkm11scoped: "Scoped Redmark M11",
    ammo22pipesmg: "22 pipe SMG"
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
    const items = [];
    const vehicles = [];
    function add(id, label, group, node, type, min, max, section, description) {
      if (!node) return null;
      const declared = at(node, "__type");
      const scalar = node.implicit || at(node, "value");
      if (node.implicit && at(node, "value")) throw new Error(`Ambiguous value for ${id}.`);
      if (declared?.value !== type || !scalar || scalar.kind !== (type === "bool" ? "boolean" : "number")) {
        throw new Error(`Unsupported structure for ${id}; this save version cannot be edited safely.`);
      }
      const field = { id, label, group, type, min, max, section, description, value: scalar.value, start: scalar.start, end: scalar.end };
      validate(field, scalar.value);
      fields.push(field);
      return field;
    }
    const player = at(tree, "Player");
    const ammo = at(tree, "Ammo");
    if (player && at(player, "__type")?.value === wrapper) {
      add("Player.Health", "Health", "Player", at(player, "value", "objs", "Health"), "float", 0, 100, "player");
    }
    if (ammo && at(ammo, "__type")?.value === wrapper) {
      add("Ammo.armor", "Armor", "Supplies", at(ammo, "value", "objs", "armor"), "float", 0, 100, "player");
      for (const name of ammoNames) {
        add(`Ammo.${name}`, name.replace(/^ammo_/, "").replaceAll("_", " "), "Supplies", at(ammo, "value", "objs", name), "int", 0, 2147483647, "player");
      }
    }
    for (const [name, label] of Object.entries(switches)) add(name, label, "Gameplay settings", at(tree, name), "bool", undefined, undefined, "settings");
    for (const [name, label] of Object.entries(volumes)) add(name, label, "Audio settings", at(tree, name), "float", 0, 1, "settings");
    add("FOV", "Field of view", "Display settings", at(tree, "FOV"), "float", 30, 120, "settings");

    function props(node) { return node?.kind === "object" ? node.props : new Map(); }
    function scalar(node) {
      if (!node) return undefined;
      if (node.implicit) return node.implicit.value;
      if (node.value !== undefined) return node.value;
      return undefined;
    }
    function numericValue(node, expectedType, context) {
      if (!node) return { error: "Not present in this save." };
      const declared = at(node, "__type");
      const valueNode = node.implicit || at(node, "value");
      if (declared?.value !== expectedType || !valueNode || valueNode.kind !== "number") {
        return { error: `Unsupported ${expectedType} field in ${context}; shown read-only.` };
      }
      if (!Number.isFinite(valueNode.value)) return { error: `Invalid number in ${context}; shown read-only.` };
      return { value: valueNode.value, node };
    }
    function gameObjects(rootKey) {
      const array = at(tree, rootKey, "value", "array");
      if (!array || array.kind === "null") return [];
      if (array.kind !== "array") throw new Error(`${rootKey} has an unsupported structure.`);
      return array.items.map((object, index) => {
        const transform = at(object, "components")?.items?.find(component => at(component, "__type")?.value === "Transform");
        const parentRef = at(transform, "parent", "_ES3Ref")?.value;
        const positionNode = at(transform, "localPosition");
        const position = positionNode ? Object.fromEntries([...props(positionNode)].map(([key, value]) => [key, scalar(value)])) : null;
        return {
          index,
          name: at(object, "name")?.value ?? `Unnamed ${rootKey} object ${index + 1}`,
          ref: at(object, "_ES3Ref")?.value ?? null,
          transformId: at(object, "transformID")?.value ?? null,
          parentRef: typeof parentRef === "string" ? parentRef : null,
          active: at(object, "active")?.value ?? null,
          tag: at(object, "tag")?.value ?? null,
          position,
          object
        };
      });
    }
    function wrapperOwner(rootName) {
      const record = at(tree, rootName);
      if (at(record, "__type")?.value !== wrapper) return null;
      const data = at(record, "value", "objs");
      const owner = at(data, "owner");
      if (!data || !owner) return null;
      return { record, data, owner, ref: at(owner, "_ES3Ref")?.value ?? null };
    }
    function readableName(name) {
      return name.replace(/\(Clone\)\d*$/, "");
    }

    const itemObjects = gameObjects("newGOArray_Items");
    const carObjects = gameObjects("newGOArray_Cars");
    const refCounts = new Map();
    for (const item of [...itemObjects, ...carObjects]) {
      if (item.ref !== null) refCounts.set(item.ref, (refCounts.get(item.ref) || 0) + 1);
    }

    const carMounts = new Map();
    const vehicleByRef = new Map();
    for (const car of carObjects) {
      const associated = wrapperOwner(car.name);
      const matched = associated && car.ref && associated.ref === car.ref;
      const objectRefCount = car.ref ? refCounts.get(car.ref) : 0;
      const vehicle = {
        id: `vehicle:${car.ref ?? car.name}:${car.index}`,
        name: car.name,
        ref: car.ref,
        active: car.active,
        fuel: null,
        fieldIds: [],
        parts: [],
        warnings: []
      };
      if (matched && objectRefCount === 1) {
        vehicleByRef.set(car.ref, vehicle);
        for (const [mountKey, mountLabel] of [["hinge_engine", "Engine"], ["hinge_radiator", "Radiator"], ["hinge_exhaust", "Exhaust"]]) {
          const transformId = at(associated.data, mountKey, "transformID")?.value;
          if (typeof transformId === "string") {
            if (!carMounts.has(transformId)) carMounts.set(transformId, []);
            carMounts.get(transformId).push({ vehicle, mountKey, mountLabel });
          }
        }
        const liquid = numericValue(at(associated.data, "Liquid"), "float", car.name);
        const capacity = numericValue(at(associated.data, "LiquidCapacity"), "float", car.name);
        if (liquid.value !== undefined && capacity.value !== undefined && capacity.value > 0 && liquid.value >= 0 && liquid.value <= capacity.value) {
          const id = `${vehicle.id}:fuel`;
          const field = add(id, `${car.name} fuel`, "Fuel tank (L)", liquid.node, "float", 0, capacity.value, "vehicles", "Saved Liquid amount; capacity comes from this vehicle's LiquidCapacity field.");
          if (field) {
            vehicle.fuel = { value: field.value, capacity: capacity.value, unit: "L" };
            vehicle.fieldIds.push(field.id);
          }
        } else {
          vehicle.warnings.push(liquid.error || capacity.error || "Fuel amount or saved tank capacity is invalid; fuel is shown read-only.");
        }
      } else {
        vehicle.warnings.push("Vehicle object and saved scalar record could not be uniquely matched by its reference; editable fields are withheld.");
      }
      vehicles.push(vehicle);
    }

    for (const item of itemObjects) {
      const referenceIsUnique = item.ref !== null && refCounts.get(item.ref) === 1;
      const associated = referenceIsUnique ? wrapperOwner(item.name) : null;
      const matched = associated && associated.ref === item.ref;
      const itemRecord = {
        id: `item:${item.ref ?? item.name}:${item.index}`,
        name: item.name,
        displayName: item.name.startsWith("akms(Clone)") ? `AKMS (saved ID: ${item.name})` : readableName(item.name),
        ref: item.ref,
        active: item.active,
        tag: item.tag,
        parentRef: item.parentRef,
        position: item.position,
        location: item.parentRef === null ? "Unparented / world-root" : "Unresolved parent / container",
        quantity: null,
        condition: null,
        ammo: null,
        liquid: null,
        loadedAmmo: null,
        readOnlyFields: [],
        fieldIds: [],
        matchedRecord: !!matched,
        warnings: []
      };
      if (item.ref !== null && !referenceIsUnique) {
        itemRecord.location = "Ambiguous duplicate object reference";
        itemRecord.warnings.push("Duplicate ES3 reference; scalar data is not attached to either object.");
      } else if (matched) {
        const quantity = numericValue(at(associated.data, "Quantity"), "int", item.name);
        if (quantity.value !== undefined) {
          if (quantity.value >= 1 && quantity.value <= 2147483647) {
            const id = `${itemRecord.id}:Quantity`;
            const field = add(id, `${item.name} quantity`, "Existing item quantities", quantity.node, "int", 1, 2147483647, "items", "Changes this existing stack only, regardless of its world/container location; minimum 1 prevents deleting the object.");
            if (field) {
              itemRecord.quantity = field.value;
              itemRecord.fieldIds.push(field.id);
            }
          } else itemRecord.warnings.push("Saved quantity is outside the safe editable range (1 to 2,147,483,647); shown read-only.");
        } else if (at(associated.data, "Quantity")) itemRecord.warnings.push(quantity.error);
      } else if (referenceIsUnique) {
        itemRecord.warnings.push("No uniquely matching typed item record; this existing object is shown read-only.");
      }

      const partLinks = item.parentRef ? carMounts.get(item.parentRef) || [] : [];
      const linkedCars = partLinks.filter(link => link.vehicle && link.vehicle.ref && vehicleByRef.get(link.vehicle.ref) === link.vehicle);
      itemRecord.attachedTo = linkedCars.length === 1 ? `${linkedCars[0].vehicle.name} · ${linkedCars[0].mountLabel}` : null;
      if (linkedCars.length === 1) {
        itemRecord.location = `Attached to ${linkedCars[0].vehicle.name} (${linkedCars[0].mountLabel})`;
        linkedCars[0].vehicle.parts.push(itemRecord);
      } else if (partLinks.length > 1 || linkedCars.length > 1) {
        itemRecord.location = "Ambiguous vehicle mount";
        itemRecord.warnings.push("More than one vehicle mount matches this parent reference; component association is not editable.");
      }

      if (matched) {
        const condition = numericValue(at(associated.data, "Condition"), "float", item.name);
        if (condition.value !== undefined) {
          if (condition.value >= 0 && condition.value <= 100) {
            const section = linkedCars.length === 1 ? "vehicles" : "items";
            const group = linkedCars.length === 1
              ? `${linkedCars[0].vehicle.name} components`
              : "Other saved item condition";
            const description = linkedCars.length === 1
              ? `Condition scalar on this existing ${linkedCars[0].mountLabel.toLowerCase()} object, attached by its saved parent reference.`
              : "Condition on this existing item; vehicle or storage association is not established by its saved references.";
            const id = `${itemRecord.id}:Condition`;
            const label = `${item.name} condition (%)`;
            const field = add(id, label, group, condition.node, "float", 0, 100, section, description);
            if (field) {
              itemRecord.condition = field.value;
              itemRecord.fieldIds.push(field.id);
              if (linkedCars.length === 1) linkedCars[0].vehicle.fieldIds.push(field.id);
            }
          } else itemRecord.warnings.push("Condition value is outside the observed 0–100 percent range; shown read-only.");
        } else if (at(associated.data, "Condition")) itemRecord.warnings.push(condition.error);

        const ammoCount = numericValue(at(associated.data, "ammo"), "int", item.name);
        if (ammoCount.value !== undefined && Number.isInteger(ammoCount.value) && ammoCount.value >= 0 && ammoCount.value <= 2147483647) {
          const field = add(`${itemRecord.id}:ammo`, `${item.name} ammo count`, "Existing item ammunition", ammoCount.node, "int", 0, 2147483647, "items", "The ammo count stored on this exact item, not the player supply or a weapon-type counter.");
          itemRecord.ammo = field.value;
          itemRecord.fieldIds.push(field.id);
        } else if (at(associated.data, "ammo")) itemRecord.warnings.push(ammoCount.error || "Item ammo must be a nonnegative signed 32-bit integer; shown read-only.");

        const liquid = numericValue(at(associated.data, "Liquid"), "float", item.name);
        const capacity = numericValue(at(associated.data, "LiquidCapacity"), "float", item.name);
        if (liquid.value !== undefined && capacity.value !== undefined && capacity.value > 0 && liquid.value >= 0 && liquid.value <= capacity.value) {
          const field = add(`${itemRecord.id}:Liquid`, `${item.name} liquid amount`, "Existing item liquids", liquid.node, "float", 0, capacity.value, "items", "This item's saved Liquid amount, bounded by its own saved LiquidCapacity. Units are not specified by the save.");
          itemRecord.liquid = { value: field.value, capacity: capacity.value };
          itemRecord.fieldIds.push(field.id);
        }

        const editableKeys = new Set(itemRecord.fieldIds.map(id => id.slice(id.lastIndexOf(":") + 1)));
        for (const [name, node] of props(associated.data)) {
          const value = node.implicit || at(node, "value");
          if (!value || !["number", "boolean"].includes(value.kind) || editableKeys.has(name)) continue;
          const reason = name === "Liquid"
            ? "A valid amount and matching capacity are not both stored on this item; no capacity or units are guessed."
            : name === "LiquidCapacity"
              ? "Saved capacity is a limit, not an editable amount."
              : ["Quantity", "Condition", "ammo"].includes(name)
                ? "This saved value does not meet the supported type or range; it is preserved unchanged."
                : "This field's gameplay meaning or safe range has not been verified; it is preserved unchanged.";
          itemRecord.readOnlyFields.push({ name, value: value.value, reason });
        }
      }
      items.push(itemRecord);
    }

    const weaponFields = new Map();
    const weaponData = at(tree, "weaponsAmmoInGun");
    if (weaponData && at(weaponData, "__type")?.value === wrapper) {
      const weaponValues = at(weaponData, "value", "objs");
      for (const [name, valueNode] of props(weaponValues)) {
        const parsed = numericValue(valueNode, "int", `weaponsAmmoInGun.${name}`);
        if (parsed.value === undefined || !Number.isInteger(parsed.value) || parsed.value < 0 || parsed.value > 2147483647) continue;
        const label = weaponAmmoLabels[name] || `${name} weapon type`;
        const field = add(
          `weaponsAmmoInGun.${name}`,
          `${label} loaded rounds (type-level counter)`,
          "Ammunition by weapon type",
          valueNode,
          "int",
          0,
          2147483647,
          "items",
          "This existing weaponsAmmoInGun counter is keyed by weapon type, not linked to an individual weapon instance."
        );
        if (field) weaponFields.set(name, field);
      }
    }

    for (const item of items) {
      const weaponKey = item.name.match(/^([^(]+)\(Clone\)/)?.[1];
      const ammoKey = weaponKey ? ({ akms: "ammoakms", akmdrum: "ammoakmdrum", akmtrash: "ammoakmtrash" })[weaponKey] : null;
      const ammoField = ammoKey && weaponFields.get(ammoKey);
      if (ammoField) item.loadedAmmo = { fieldId: ammoField.id, value: ammoField.value, scope: "weapon type" };
      if (item.ref && vehicleByRef.has(item.ref)) item.location = `Vehicle ${vehicleByRef.get(item.ref).name}`;
    }
    for (const vehicle of vehicles) {
      for (const item of items) {
        if (item.attachedTo?.startsWith(`${vehicle.name} · `) && !vehicle.parts.includes(item)) vehicle.parts.push(item);
      }
    }
    if (!fields.length) throw new Error("No supported Apocalypter fields found. Open SaveGameN.es3 or SaveSettings.es3.");
    const presentSections = sections.filter(section =>
      section.id === "items" ? items.length > 0 || fields.some(field => field.section === "items") :
      section.id === "vehicles" ? vehicles.length > 0 || fields.some(field => field.section === "vehicles") :
      section.id === "player" ? fields.some(field => field.section === "player") :
      fields.some(field => field.section === section.id)
    );
    return { fields, items, vehicles, sections: presentSections, kind: player ? "Game save" : "Settings", text };
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
