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
    toggleADS: "Toggle aim down sights",
    automatic_gearbox: "Automatic gearbox",
    autoclutch: "Automatic clutch",
    normalizeinput: "Normalize driving input",
    bloom: "Bloom",
    sharpen: "Sharpen"
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
  // Exact prefab IDs and live LiquidAmount FSM variables in the inspected game assets.
  const liquidPrefabs = {
    "5864412579365047585": { name: "MotorOil_Can_Small", capacity: 5 },
    "6858519991654959144": { name: "Gasoline_Can", capacity: 20 },
    "4230013134874058846": { name: "Water_Can_Plastic", capacity: 13 },
    "608293236901033563": { name: "Diesel_Barrel", capacity: 150 },
    "5623108999256334996": { name: "MotorOil_Can_Big", capacity: 30 },
    "9030660213298172268": { name: "Diesel_Can", capacity: 20 },
    "2169926468007209799": { name: "radiator_medium_race", capacity: 14, mount: "hinge_radiator" },
    "8205777586039224731": { name: "radiator_medium", capacity: 9, mount: "hinge_radiator" },
    "2705209445545947911": { name: "radiator_motorcycle", capacity: 3, mount: "hinge_radiator" },
    "5669857674379848146": { name: "radiator_small", capacity: 6, mount: "hinge_radiator" },
    "5421126813566889844": { name: "radiator_truck", capacity: 18, mount: "hinge_radiator" },
    "2031828300969920981": { name: "radiator_truck_big", capacity: 24, mount: "hinge_radiator" },
    "3587043590766116916": { name: "radiator_truck_ultra", capacity: 28, mount: "hinge_radiator" },
    "3634296406011431456": { name: "594cc I2 23HP 39Nm Gasoline", capacity: 2, mount: "hinge_engine" },
    "6089072345908897270": { name: "3L I5 87HP 172Nm Diesel", capacity: 5.1, mount: "hinge_engine" },
    "5945172545298182391": { name: "3.8L V6 165HP 285Nm Gasoline", capacity: 6, mount: "hinge_engine" },
    "624016700395080820": { name: "3.7L I6 145HP 292Nm Gasoline", capacity: 5.3, mount: "hinge_engine" },
    "7861181815379186": { name: "5.8L I6 120HP 356Nm Diesel", capacity: 7, mount: "hinge_engine" },
    "4167795411855106502": { name: "18L V8 335HP 1700Nm Diesel", capacity: 16, mount: "hinge_engine" },
    "7876660059110608148": { name: "2.8L V6 115HP 183Nm Gasoline", capacity: 5, mount: "hinge_engine" },
    "9035087652290305727": { name: "5.2L V8 230HP 340Nm Gasoline", capacity: 7, mount: "hinge_engine" },
    "5126044545507921876": { name: "7L V8 355HP 569Nm Gasoline", capacity: 9, mount: "hinge_engine" },
    "884780215855984285": { name: "1.3L v2 55HP 94Nm Gasoline", capacity: 3.3, mount: "hinge_engine" },
    "6758790462075466819": { name: "1.2L I4 59HP 87Nm Gasoline", capacity: 3.3, mount: "hinge_engine" },
    "374403439354623823": { name: "2.3L I4 89HP 165Nm Gasoline", capacity: 3.9, mount: "hinge_engine" },
    "1298474360822390476": { name: "7L I6 165HP 542Nm Diesel", capacity: 7.5, mount: "hinge_engine" },
    "4674809622967151223": { name: "8.2L V8 400HP 746Nm Gasoline", capacity: 10, mount: "hinge_engine" },
    "873555013045931076": { name: "11.5L V12 274HP 854Nm Gasoline", capacity: 13, mount: "hinge_engine" }
  };
  // These prefabs save Condition as a float under the object's exact name, without an owner wrapper.
  const wheelPrefabs = {
    "2321790605670812229": { name: "small_wheel_3", label: "Small wheel T1" },
    "2184613845620177162": { name: "small_wheel_2", label: "Small wheel T2" },
    "2663761577720072192": { name: "wheel_2_armored", label: "Armored Street Wheel" }
  };
  // Vulture prefab transform reference keys resolved to the four wheel hinges.
  const wheelMounts = {
    "3278462540176318831": "Front right wheel",
    "1533047110744586257": "Rear left wheel",
    "5305950010086703831": "Front left wheel",
    "1324165727380696362": "Rear right wheel"
  };
  // Exact prefab identities whose save/load FSMs use these item counters.
  const bulkItemPrefabs = {
    "688495819279421776": { name: "bandage_1", key: "Quantity", target: 100 },
    "9121322384858893382": { name: "Repairbox_Small", key: "Quantity", target: 999 },
    "7600464120049698740": { name: "Repairbox_Medium", key: "Quantity", target: 999 },
    "4165647324065915868": { name: "Repairbox_Large", key: "Quantity", target: 999 },
    "5513939087385948062": { name: "ammo_box_20gauge", key: "ammo", target: 100 },
    "3910063457913955151": { name: "ammo_box_22", key: "ammo", target: 100 },
    "5744510244793180658": { name: "ammo_box_big_22", key: "ammo", target: 100 },
    "2411824388914619091": { name: "ammo_box_big_12gauge", key: "ammo", target: 100 },
    "3133067563820807118": { name: "ammo_box_big_762mm", key: "ammo", target: 100 },
    "3377769854383720206": { name: "ammo_box_762mm", key: "ammo", target: 100 },
    "8401587218543670294": { name: "ammo_box_556mm", key: "ammo", target: 100 },
    "8519476287603981168": { name: "ammo_box_12gauge", key: "ammo", target: 100 },
    "2704672928494571242": { name: "ammo_box_3006", key: "ammo", target: 100 },
    "7095138909402377063": { name: "ammo_box_big_3006", key: "ammo", target: 100 },
    "2992344171066298429": { name: "ammo_box_big_9mm", key: "ammo", target: 100 },
    "6949040989765713240": { name: "ammo_box_big_20gauge", key: "ammo", target: 100 },
    "1625578815151821771": { name: "ammo_box_big_arrow", key: "ammo", target: 100 },
    "3733066396143753576": { name: "ammo_box_9mm", key: "ammo", target: 100 },
    "6082136355384846395": { name: "ammo_box_big_556mm", key: "ammo", target: 100 }
  };
  const topOffConsumablePrefabs = {
    ...bulkItemPrefabs,
    "3766863323530176910": { name: "ammo_arrow", key: "ammo" },
    "3955095449936337101": { name: "first_aid_1", key: "Quantity" },
    "2856772050428381491": { name: "weed_bag", key: "Quantity" },
    "7947724335221001397": { name: "cigarette_bactrian", key: "Quantity" },
    "6706846953073870613": { name: "cigar", key: "Quantity" },
    "4398581480533230246": { name: "sanity_pills", key: "Quantity" },
    "6027655925999442117": { name: "flashlight_batteries", key: "batteries" }
  };
  const switchHelp = {
    peacefulMode: "True enables the game's peaceful-mode setting. The exact affected enemy behaviors have not been independently verified.",
    disableThirstHunger: "True disables the game's thirst/hunger system; false enables it.",
    disableFatigue: "True disables the game's fatigue system; false enables it.",
    mapCheat: "True enables the saved map-cheat toggle. The exact map overlays affected have not been verified.",
    disableInsanity: "True disables the insanity system. Negative saved Sanity behavior while disabled is not verified.",
    toggleHeadbob: "True enables head-bob camera movement.",
    toggleFPS: "True displays the FPS counter.",
    toggleFootstepSounds: "True enables footstep sounds.",
    toggleADS: "Selects toggle-style aiming down sights rather than hold-style aiming.",
    automatic_gearbox: "True enables automatic gearbox control.",
    autoclutch: "True enables automatic clutch control.",
    normalizeinput: "Enables the game's normalized driving-input option. Its exact mathematical scaling has not been verified.",
    bloom: "True enables the bloom graphics effect.",
    sharpen: "True enables the sharpening graphics effect."
  };

  function fieldHelp(field) {
    let effect = switchHelp[field.id];
    if (!effect && field.id === "Player.Health") effect = "Player Health scalar. Higher values mean more health; 100 is the editor's healthy endpoint. The separate global.PlayerHealth copy is not changed.";
    if (!effect && field.id === "Ammo.armor") effect = "Saved armor amount. Bulk actions leave it unchanged; the game may reset armor without plates. Editing this value does not grant plates or the separate body-armor flag.";
    if (!effect && field.id === "global.Money") effect = "Nuts currency shown in the HUD and used for purchases. The 1,000,000 maximum is an editor safety limit, not a verified game maximum; future in-game earnings can still increase the amount.";
    if (!effect && field.id.startsWith("Ammo.ammo_")) effect = field.id.endsWith("_capacity")
      ? "Saved player ammunition supply capacity for this type. Increasing it changes only this counter, not the current amount."
      : "Saved player ammunition supply count for this type. Higher means more supply, not per-weapon loaded rounds.";
    if (!effect && Object.hasOwn(volumes, field.id)) effect = "Audio volume level: 0 is silent and 1 is full saved volume.";
    if (!effect && field.id === "FOV") effect = "Camera field of view in degrees. Higher values widen the view; lower values narrow it.";
    if (!effect && field.id.endsWith(":Condition")) effect = "Saved component condition in percent. Higher means healthier; 100 is the verified repair endpoint.";
    if (!effect && field.id.endsWith(":fuel")) effect = "This vehicle's fuel amount in liters per the game's player-facing units. Higher means more fuel; the maximum is its saved tank capacity.";
    if (!effect && field.id.endsWith(":Quantity")) effect = "Number of units in this existing stack. Higher means more units; minimum 1 prevents deleting the object. No ownership changes.";
    if (!effect && field.id.endsWith(":Liquid")) effect = "Liquid amount in saved units (the save specifies no unit). Higher means more liquid. Its verified capacity is the maximum; it does not change the liquid's type.";
    if (!effect && field.id.endsWith(":ammo")) effect = "Round count stored on this exact item. Higher means more rounds; this does not change player supplies or weapon-type loaded-round counters.";
    if (!effect && field.id.startsWith("weaponsAmmoInGun.")) effect = "Loaded-round counter for this weapon type, not one specific weapon instance. Higher means more rounds in that shared counter.";
    if (!effect) effect = field.description || "This exact saved scalar only; additional gameplay effects have not been verified.";
    const range = field.type === "bool" ? "Boolean: true or false." : field.type
      ? `${field.type === "int" ? "Whole numbers" : "Numbers"} from ${field.min} to ${field.max}.`
      : "";
    return [effect, range, field.description !== effect ? field.description : "", field.reason ? `Read-only: ${field.reason}` : ""].filter(Boolean).join(" ");
  }
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
    const readOnlyFields = [];
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
      if (type !== "bool" && (!Number.isFinite(scalar.value) || (type === "int" && !Number.isInteger(scalar.value)) || scalar.value < min || scalar.value > max)) {
        const readOnly = { ...field, reason: `Outside this editor's supported ${type === "int" ? "whole-number " : ""}range (${min} to ${max}); preserved unchanged. Other supported values can still be edited.` };
        readOnly.help = fieldHelp(readOnly);
        readOnlyFields.push(readOnly);
        return null;
      }
      field.help = fieldHelp(field);
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
        const field = add(`Ammo.${name}`, name.replace(/^ammo_/, "").replaceAll("_", " "), "Supplies", at(ammo, "value", "objs", name), "int", 0, 2147483647, "player");
        if (field && (!name.endsWith("_capacity") || ["ammo_9mm_capacity", "ammo_20gauge_capacity", "ammo_arrow_capacity"].includes(name))) field.topOffConsumable = true;
      }
    }
    const globals = at(tree, "global");
    if (at(globals, "__type")?.value === wrapper) {
      const data = at(globals, "value", "objs");
      for (const name of ["Hunger", "Thirst", "Fatigue", "Radiation"]) {
        add(`global.${name}`, name, "Survival state", at(data, name), "float", 0, 100, "player", "Saved global state; the inspected gameplay FSM clamps this value from 0 to 100. Higher values are worse.");
      }
      const money = at(data, "Money");
      const moneyValue = money?.implicit || at(money, "value");
      const supportedMoney = at(money, "__type")?.value === "int" && moneyValue?.kind === "number" &&
        !(money?.implicit && at(money, "value"));
      if (supportedMoney) add("global.Money", "Nuts", "Currency", money, "int", 0, 1000000, "player",
        "Saved global Money. The 1,000,000 editor limit is conservative, not a verified game maximum; bulk actions set it to 900,000.");
      for (const [name, reason] of [
        ...(!supportedMoney ? [["Money", "This Money record is not a uniquely represented integer; preserved unchanged."]] : []),
        ["Sanity", "The active gameplay FSM clamps 0 to 100, but inspected saves also contain negative values; behavior with insanity disabled has not been verified."],
        ["PlayerHealth", "A separate saved health copy; its load precedence relative to Player.Health has not been verified."],
        ...["automatic_gearbox", "autoclutch", "normalizeinput"].map(name => [name, "Game-slot copy only. Edit the verified per-key setting in SaveSettings.es3; duplicate scopes are not synchronized."])
      ]) {
        const node = at(data, name);
        const value = node?.implicit || at(node, "value");
        if (value && ["number", "boolean"].includes(value.kind)) {
          const field = { id: `global.${name}`, label: `global.${name}`, group: "Other saved state (read-only)", section: "player", value: value.value, reason };
          field.help = fieldHelp(field);
          readOnlyFields.push(field);
        }
      }
    }
    for (const [name, label] of Object.entries(switches)) add(name, label, "Gameplay settings", at(tree, name), "bool", undefined, undefined, "settings", "This file's top-level setting only. The game loads this key from SaveSettings.es3; game-slot copies are not synchronized.");
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
        const parentNode = at(transform, "parent");
        const positionNode = at(transform, "localPosition");
        const position = positionNode ? Object.fromEntries([...props(positionNode)].map(([key, value]) => [key, scalar(value)])) : null;
        return {
          index,
          name: at(object, "name")?.value ?? `Unnamed ${rootKey} object ${index + 1}`,
          ref: at(object, "_ES3Ref")?.value ?? null,
          transformId: at(object, "transformID")?.value ?? null,
          parentRef: typeof parentRef === "string" ? parentRef : null,
          parentState: parentNode?.kind === "null" ? "root" :
            typeof parentRef === "string" && parentRef ? "linked" : "unresolved",
          active: at(object, "active")?.value ?? null,
          tag: at(object, "tag")?.value ?? null,
          position,
          transform,
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
    const playerObject = at(player, "value", "objs", "Player");
    const playerTransform = at(playerObject, "components")?.items?.find(component => at(component, "__type")?.value === "Transform");
    const playerAnchorMatches = at(playerObject, "_ES3Ref")?.value === "4908172907895950466" &&
      at(playerObject, "transformID")?.value === "9005913460443800891";
    let knownSlots = playerAnchorMatches ? {
      "6374689825314962276": "Bandage slot",
      "9124196666788711796": "First Aid Kit slot",
      "3656544721015511630": "Weapon slot 1",
      "1591285762866710851": "Weapon slot 2",
      "2901622336603839876": "Weapon slot 3",
      "6707555155505277952": "Flashlight slot (L)",
      "1007585140629016984": "Body armor slot",
      "5762072836280993281": "Backpack slot",
      "6960692475879471560": "Binoculars slot"
    } : {};
    const transformObjects = [...itemObjects, ...carObjects];
    if (playerTransform) transformObjects.push({ transform: playerTransform, transformId: at(playerObject, "transformID")?.value, ref: at(playerObject, "_ES3Ref")?.value });
    const transforms = new Map();
    const ownerCounts = new Map();
    const transformCounts = new Map();
    for (const object of transformObjects) {
      if (typeof object.ref === "string") ownerCounts.set(object.ref, (ownerCounts.get(object.ref) || 0) + 1);
      if (typeof object.transformId === "string") transformCounts.set(object.transformId, (transformCounts.get(object.transformId) || 0) + 1);
    }
    for (const object of transformObjects) {
      const id = object.transformId;
      if (typeof id !== "string" || at(object.transform, "_ES3Ref")?.value !== id ||
          at(object.transform, "goID")?.value !== object.ref || ownerCounts.get(object.ref) !== 1 ||
          transformCounts.get(id) !== 1) continue;
      transforms.set(id, object.transform);
    }
    if (transforms.get(at(playerObject, "transformID")?.value) !== playerTransform) knownSlots = {};
    function vector(node, keys) {
      const result = Object.fromEntries(keys.map(key => [key, scalar(at(node, key))]));
      return keys.every(key => Number.isFinite(result[key])) ? result : null;
    }
    function worldPosition(transform) {
      const ownId = at(transform, "_ES3Ref")?.value;
      if (typeof ownId !== "string" || transforms.get(ownId) !== transform) return null;
      let point = vector(at(transform, "localPosition"), ["x", "y", "z"]);
      if (!point) return null;
      const visited = new Set([at(transform, "_ES3Ref")?.value]);
      while (true) {
        const parent = at(transform, "parent");
        if (parent?.kind === "null") return point;
        const id = at(parent, "_ES3Ref")?.value;
        if (typeof id !== "string" || visited.has(id) || !transforms.get(id)) return null;
        visited.add(id);
        transform = transforms.get(id);
        const position = vector(at(transform, "localPosition"), ["x", "y", "z"]);
        const scale = vector(at(transform, "localScale"), ["x", "y", "z"]);
        const q = vector(at(transform, "localRotation"), ["x", "y", "z", "w"]);
        if (!position || !scale || !q || Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1) > 0.001) return null;
        const x = point.x * scale.x, y = point.y * scale.y, z = point.z * scale.z;
        const tx = 2 * (q.y * z - q.z * y), ty = 2 * (q.z * x - q.x * z), tz = 2 * (q.x * y - q.y * x);
        point = {
          x: position.x + x + q.w * tx + q.y * tz - q.z * ty,
          y: position.y + y + q.w * ty + q.z * tx - q.x * tz,
          z: position.z + z + q.w * tz + q.x * ty - q.y * tx
        };
        if (!Object.values(point).every(Number.isFinite)) return null;
      }
    }
    const playerPosition = playerTransform ? worldPosition(playerTransform) : null;
    const refCounts = new Map();
    const nameCounts = new Map();
    const parentCounts = new Map();
    for (const item of [...itemObjects, ...carObjects]) {
      if (item.ref !== null) refCounts.set(item.ref, (refCounts.get(item.ref) || 0) + 1);
      nameCounts.set(item.name, (nameCounts.get(item.name) || 0) + 1);
    }
    for (const item of itemObjects) {
      if (item.parentRef) parentCounts.set(item.parentRef, (parentCounts.get(item.parentRef) || 0) + 1);
    }

    const carMounts = new Map();
    const vehicleByRef = new Map();
    const prefabVehicles = new Map();
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
        for (const [, ref] of props(at(car.object, "es3Prefab", "refs"))) {
          if (ref.kind !== "string") continue;
          if (!prefabVehicles.has(ref.value)) prefabVehicles.set(ref.value, new Set());
          prefabVehicles.get(ref.value).add(vehicle);
        }
        for (const [mountKey, mountLabel] of [["hinge_engine", "Engine"], ["hinge_radiator", "Radiator"], ["hinge_exhaust", "Exhaust"]]) {
          const transformId = at(associated.data, mountKey, "transformID")?.value;
          if (typeof transformId === "string") {
            if (!carMounts.has(transformId)) carMounts.set(transformId, []);
            carMounts.get(transformId).push({ vehicle, mountKey, mountLabel });
          }
        }
        if (at(car.object, "es3Prefab", "prefabId")?.value === "8734799950597450027" &&
            at(associated.owner, "es3Prefab", "prefabId")?.value === "8734799950597450027") {
          for (const [key, mountLabel] of Object.entries(wheelMounts)) {
            const transformId = at(car.object, "es3Prefab", "refs", key)?.value;
            if (typeof transformId !== "string") continue;
            if (!carMounts.has(transformId)) carMounts.set(transformId, []);
            carMounts.get(transformId).push({ vehicle, mountKey: key, mountLabel, wheelOnly: true });
          }
        }
        const liquid = numericValue(at(associated.data, "Liquid"), "float", car.name);
        const capacity = numericValue(at(associated.data, "LiquidCapacity"), "float", car.name);
        if (/trailer/i.test(car.name)) {
          vehicle.warnings.push("Trailer liquid fields are not identified as fuel and are not changed by fuel top-off.");
        } else if (liquid.value !== undefined && capacity.value !== undefined && capacity.value > 0 && liquid.value >= 0 && liquid.value <= capacity.value) {
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

    const confirmedContainers = new Map();
    for (const car of carObjects) {
      const prefab = at(car.object, "es3Prefab", "prefabId")?.value;
      const refs = at(car.object, "es3Prefab", "refs");
      const uniqueContainerRef = ref => carObjects.filter(candidate =>
        [...props(at(candidate.object, "es3Prefab", "refs")).values()].some(value => value.kind === "string" && value.value === ref)).length === 1;
      if (car.ref && refCounts.get(car.ref) === 1 && prefab === "3545007504786799582" && uniqueContainerRef("1052945493227557322") &&
          at(refs, "8038138322462240083")?.value === "1052945493227557322")
        confirmedContainers.set("1052945493227557322", "User-identified trailer container");
      if (car.ref && refCounts.get(car.ref) === 1 && prefab === "8734799950597450027" && uniqueContainerRef("7489528302310536125") &&
          at(refs, "2086200191613234582")?.value === "7489528302310536125")
        confirmedContainers.set("7489528302310536125", "User-identified box in vehicle trunk");
    }
    function identifiedContainer(item) {
      let parent = item.parentRef;
      const visited = new Set();
      while (parent && !visited.has(parent)) {
        if (confirmedContainers.has(parent)) return confirmedContainers.get(parent);
        visited.add(parent);
        const transform = transforms.get(parent);
        parent = at(transform, "parent", "_ES3Ref")?.value;
      }
      return null;
    }
    for (const item of itemObjects) {
      const referenceIsUnique = item.ref !== null && refCounts.get(item.ref) === 1;
      const associated = referenceIsUnique ? wrapperOwner(item.name) : null;
      const matched = associated && associated.ref === item.ref;
      const prefabId = at(item.object, "es3Prefab", "prefabId")?.value;
      const bulkPrefab = Object.hasOwn(bulkItemPrefabs, prefabId) ? bulkItemPrefabs[prefabId] : null;
      const verifiedBulkPrefab = matched && bulkPrefab && readableName(item.name) === bulkPrefab.name &&
        at(associated.owner, "es3Prefab", "prefabId")?.value === prefabId ? bulkPrefab : null;
      const topOffPrefab = Object.hasOwn(topOffConsumablePrefabs, prefabId) ? topOffConsumablePrefabs[prefabId] : null;
      const verifiedTopOffPrefab = matched && topOffPrefab && readableName(item.name) === topOffPrefab.name &&
        at(associated.owner, "es3Prefab", "prefabId")?.value === prefabId ? topOffPrefab : null;
      const wheel = Object.hasOwn(wheelPrefabs, prefabId) ? wheelPrefabs[prefabId] : null;
      const wheelRecord = at(tree, item.name);
      const wheelMatches = referenceIsUnique && nameCounts.get(item.name) === 1 && wheel &&
        new RegExp(`^${wheel.name}\\(Clone\\)\\d+$`).test(item.name) &&
        at(wheelRecord, "__type")?.value === "System.Object";
      const itemRecord = {
        id: `item:${item.ref ?? item.name}:${item.index}`,
        name: item.name,
        displayName: wheel && readableName(item.name) === wheel.name ? `${wheel.label} (saved ID: ${item.name})` :
          item.name.startsWith("akms(Clone)") ? `AKMS (saved ID: ${item.name})` : readableName(item.name),
        ref: item.ref,
        active: item.active,
        tag: item.tag,
        parentRef: item.parentRef,
        position: item.position,
        worldPosition: item.transform ? worldPosition(item.transform) : null,
        location: item.parentState === "root" ? "Unparented / world-root" : "Unresolved parent / container",
        parentState: item.parentState,
        quantity: null,
        condition: null,
        ammo: null,
        liquid: null,
        loadedAmmo: null,
        associatedVehicle: null,
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
              if (verifiedBulkPrefab?.key === "Quantity") field.bulkTarget = verifiedBulkPrefab.target;
              if (verifiedTopOffPrefab?.key === "Quantity") field.topOffConsumable = true;
              itemRecord.quantity = field.value;
              itemRecord.fieldIds.push(field.id);
            }
          } else itemRecord.warnings.push("Saved quantity is outside the safe editable range (1 to 2,147,483,647); shown read-only.");
        } else if (at(associated.data, "Quantity")) itemRecord.warnings.push(quantity.error);
        if (verifiedTopOffPrefab?.key === "batteries" && at(associated.data, "batteries")) {
          const count = numericValue(at(associated.data, "batteries"), "int", item.name);
          if (count.value !== undefined && !(count.node.implicit && at(count.node, "value")) &&
            Number.isInteger(count.value) && count.value >= 0 && count.value <= 2147483647) {
            const field = add(`${itemRecord.id}:batteries`, `${item.name} battery count`, "Existing item batteries",
              count.node, "int", 0, 2147483647, "items",
              "Battery count in this exact verified flashlight battery pack; its pickup FSM adds these units to player ammo_battery. No pack is created.");
            if (field) {
              field.topOffConsumable = true;
              itemRecord.fieldIds.push(field.id);
            }
          } else itemRecord.warnings.push(count.error || "Battery count must contain one nonnegative signed 32-bit integer; shown read-only.");
        }
      } else if (referenceIsUnique && !wheelMatches) {
        itemRecord.warnings.push("No uniquely matching typed item record; this existing object is shown read-only.");
      }

      const partLinks = item.parentRef ? carMounts.get(item.parentRef) || [] : [];
      const linkedCars = partLinks.filter(link => link.vehicle && link.vehicle.ref &&
        vehicleByRef.get(link.vehicle.ref) === link.vehicle &&
        (!link.wheelOnly || (wheelMatches && parentCounts.get(item.parentRef) === 1)));
      itemRecord.attachedTo = linkedCars.length === 1 ? `${linkedCars[0].vehicle.name} · ${linkedCars[0].mountLabel}` : null;
      if (linkedCars.length === 1) {
        itemRecord.location = `Attached to ${linkedCars[0].vehicle.name} (${linkedCars[0].mountLabel})`;
        linkedCars[0].vehicle.parts.push(itemRecord);
      } else if (partLinks.length > 1 || linkedCars.length > 1) {
        itemRecord.location = "Ambiguous vehicle mount";
        itemRecord.warnings.push("More than one vehicle mount matches this parent reference; component association is not editable.");
      } else if (referenceIsUnique && item.parentRef) {
        const candidates = [...(prefabVehicles.get(item.parentRef) || [])];
        if (candidates.length === 1) {
          itemRecord.associatedVehicle = candidates[0].name;
          itemRecord.location = `Vehicle-associated: ${candidates[0].name} (prefab reference; mounting/storage unknown)`;
        } else if (candidates.length > 1) {
          itemRecord.warnings.push("Parent reference occurs in more than one vehicle prefab map; vehicle association is withheld.");
        }
      }
      const slot = knownSlots[item.parentRef];
      const needsZeroOffset = item.parentRef === "6374689825314962276" || item.parentRef === "9124196666788711796";
      if (referenceIsUnique && slot && (!needsZeroOffset || ["x", "y", "z"].every(axis => item.position?.[axis] === 0))) {
        itemRecord.location = `User-identified ${slot}${parentCounts.get(item.parentRef) === 1 ? "" : " (multiple children)"}`;
      } else {
        const container = referenceIsUnique && identifiedContainer(item);
        if (container) itemRecord.location = `${container} (saved parent link)`;
      }

      if (wheelMatches) {
        const node = at(wheelRecord, "value");
        const condition = numericValue(node, "float", item.name);
        if (condition.value !== undefined && Boolean(node.implicit) !== Boolean(at(node, "value")) &&
            condition.value >= 0 && condition.value <= 100) {
          const field = add(`${itemRecord.id}:Condition`, `${item.name} condition (%)`,
            linkedCars.length === 1 ? `${linkedCars[0].vehicle.name} components` : "Other saved item condition",
            node, "float", 0, 100, linkedCars.length === 1 ? "vehicles" : "items",
            "Wheel condition saved under this unique object name; the scalar has no owner reference. Mounting is not established by this name.");
          itemRecord.condition = field.value;
          itemRecord.fieldIds.push(field.id);
          if (linkedCars.length === 1) linkedCars[0].vehicle.fieldIds.push(field.id);
        } else {
          itemRecord.warnings.push(condition.error || "Wheel condition has an ambiguous structure or is outside 0–100; preserved read-only.");
        }
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
          if (verifiedBulkPrefab?.key === "ammo") field.bulkTarget = verifiedBulkPrefab.target;
          if (verifiedTopOffPrefab?.key === "ammo") field.topOffConsumable = true;
          itemRecord.ammo = field.value;
          itemRecord.fieldIds.push(field.id);
        } else if (at(associated.data, "ammo")) itemRecord.warnings.push(ammoCount.error || "Item ammo must be a nonnegative signed 32-bit integer; shown read-only.");

        const liquid = numericValue(at(associated.data, "Liquid"), "float", item.name);
        const capacityNode = at(associated.data, "LiquidCapacity");
        const knownPrefab = Object.hasOwn(liquidPrefabs, prefabId) ? liquidPrefabs[prefabId] : null;
        const verifiedPrefab = knownPrefab && readableName(item.name) === knownPrefab.name &&
          at(associated.owner, "es3Prefab", "prefabId")?.value === prefabId ? knownPrefab : null;
        // Unity may serialize a float32 capacity with up to nine significant digits.
        const capacity = !capacityNode && verifiedPrefab
          ? { value: Math.max(verifiedPrefab.capacity, Number(Math.fround(verifiedPrefab.capacity).toPrecision(9))) }
          : numericValue(capacityNode, "float", item.name);
        if (liquid.value !== undefined && capacity.value !== undefined && capacity.value > 0 && liquid.value >= 0 && liquid.value <= capacity.value) {
          const capacitySource = !capacityNode && verifiedPrefab ? `Verified ${verifiedPrefab.name} prefab ${prefabId}; LiquidAmount FSM capacity ${capacity.value}.` : null;
          const mountedLiquid = linkedCars.length === 1 && verifiedPrefab?.mount === linkedCars[0].mountKey &&
            parentCounts.get(item.parentRef) === 1;
          const field = add(`${itemRecord.id}:Liquid`, `${item.name} liquid amount`,
            mountedLiquid ? `${linkedCars[0].vehicle.name} components` : "Existing item liquids",
            liquid.node, "float", 0, capacity.value, mountedLiquid ? "vehicles" : "items", capacitySource || "This item's saved Liquid amount, bounded by its own saved LiquidCapacity. Units are not specified by the save.");
          itemRecord.liquid = { value: field.value, capacity: capacity.value };
          if (capacitySource) itemRecord.liquid.capacitySource = capacitySource;
          itemRecord.fieldIds.push(field.id);
          if (mountedLiquid) linkedCars[0].vehicle.fieldIds.push(field.id);
        }

        const editableKeys = new Set(itemRecord.fieldIds.map(id => id.slice(id.lastIndexOf(":") + 1)));
        for (const [name, node] of props(associated.data)) {
          const value = node.implicit || at(node, "value");
          if (!value || !["number", "boolean"].includes(value.kind) || editableKeys.has(name)) continue;
          const reason = name === "Liquid"
            ? "No valid saved capacity or exact verified prefab capacity supports this amount; no capacity or units are guessed."
            : name === "LiquidCapacity"
              ? "Saved capacity is a limit, not an editable amount."
              : ["Quantity", "Condition", "ammo", "batteries"].includes(name)
                ? "This saved value does not meet the supported type or range; it is preserved unchanged."
                : "This field's gameplay meaning or safe range has not been verified; it is preserved unchanged.";
          itemRecord.readOnlyFields.push({ name, value: value.value, reason, help: `Saved ${name}: ${value.value}. Read-only: ${reason} No gameplay effect, unit, or safe range beyond the stated evidence is assumed.` });
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
        if (field) {
          if (Object.hasOwn(weaponAmmoLabels, name)) {
            field.bulkTarget = 100;
            field.topOffConsumable = true;
          }
          weaponFields.set(name, field);
        }
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
    const identifiedSlots = Object.entries(knownSlots).map(([ref, label]) => ({
      ref, label,
      items: items.filter(item => item.parentRef === ref && item.location.startsWith("User-identified "))
        .map(item => ({ id: item.id, name: item.name }))
    }));
    if (!fields.length && !readOnlyFields.length) throw new Error("No supported Apocalypter fields found. Open SaveGameN.es3 or SaveSettings.es3.");
    const sectionFields = [...fields, ...readOnlyFields];
    const presentSections = sections.filter(section =>
      section.id === "items" ? items.length > 0 || sectionFields.some(field => field.section === "items") :
      section.id === "vehicles" ? vehicles.length > 0 || sectionFields.some(field => field.section === "vehicles") ||
        fields.some(field => field.topOffConsumable || field.id === "global.Money") :
      sectionFields.some(field => field.section === section.id)
    );
    return { fields, readOnlyFields, items, vehicles, playerPosition, identifiedSlots, sections: presentSections, kind: player || globals ? "Game save" : "Settings", text };
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
