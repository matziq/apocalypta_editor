"use strict";
const $ = id => document.getElementById(id);
let doc = null;
let originalBytes = null;
let fileName = "";
let changes = new Map();
let inputs = new Map();
let readGeneration = 0;
let activeSection = null;
let nativeSource = null;
let saving = false;
const themeQuery = window.matchMedia("(prefers-color-scheme: dark)");
let preferences;
try {
  preferences = ApocalypterUi.load(localStorage, themeQuery.matches);
} catch (error) {
  preferences = { theme: "system", season: "spring", prefersDark: themeQuery.matches };
  $("appearance-status").textContent = `Appearance preferences could not be loaded: ${error.message}. Default appearance is active; file opening is still available.`;
}
const pickerToken = document.querySelector('meta[name="save-picker-token"]')?.content || "";

function updateAppearance() {
  const result = ApocalypterUi.apply(document.body, preferences);
  $("theme-toggle").textContent = result.theme === "dark" ? "Use light mode" : "Use dark mode";
  $("theme-toggle").setAttribute("aria-pressed", String(result.theme === "dark"));
  $("season-select").value = preferences.season;
}

function saveAppearance() {
  updateAppearance();
  try {
    ApocalypterUi.save(localStorage, preferences);
    $("appearance-status").textContent = "";
  } catch (error) {
    $("appearance-status").textContent = `Appearance changed for this visit but could not be saved: ${error.message}.`;
  }
}

function setupPicker() {
  const native = !!pickerToken && location.protocol === "http:" && location.hostname === "127.0.0.1";
  $("native-picker-controls").hidden = !native;
  $("browser-picker-controls").hidden = native;
  $("browser-picker-hint").textContent = native
    ? "Native connection unavailable. This browser fallback cannot control the starting folder; relaunch run.bat for the save-folder picker."
    : "This is the browser-only version. Launch run.bat for the Windows save-folder picker and backed-up overwrite saves.";
}

setupPicker();
updateAppearance();
themeQuery.addEventListener("change", () => {
  preferences.prefersDark = themeQuery.matches;
  updateAppearance();
});
$("theme-toggle").addEventListener("click", () => {
  const isDark = document.body.dataset.theme === "dark";
  preferences.theme = isDark ? "light" : "dark";
  saveAppearance();
});
$("season-select").addEventListener("change", () => {
  preferences.season = $("season-select").value;
  saveAppearance();
});

function message(text) { $("message").textContent = text; }
function numericText(value) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}
function download(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function refresh() {
  changes = new Map();
  const errors = [];
  $("changes").replaceChildren();
  if (!doc) return;
  for (const field of doc.fields) {
    const input = inputs.get(field.id);
    const value = field.type === "bool" ? input.checked : input.value.trim() === "" ? NaN : Number(input.value);
    try {
      ApocalypterSave.validate(field, value);
      input.removeAttribute("aria-invalid");
      if (value !== field.value) {
        changes.set(field.id, value);
        const row = document.createElement("li");
        row.textContent = `${field.label}: ${field.value} \u2192 ${value}`;
        $("changes").append(row);
      }
    } catch (error) {
      input.setAttribute("aria-invalid", "true");
      errors.push(error.message);
    }
  }
  $("review").hidden = !changes.size;
  $("dirty").textContent = changes.size ? `${changes.size} changed` : errors.length ? "Invalid values" : "Original values";
  $("export").disabled = !!errors.length || !changes.size;
  $("save").disabled = saving || !!errors.length || !changes.size || !nativeSource?.canSave;
  $("save-hint").textContent = errors.length
    ? "Resolve invalid values before saving or exporting."
    : changes.size
      ? nativeSource?.canSave
        ? `Review changes, then save over ${nativeSource.path} with an automatic backup, or export a copy.`
        : "Export a copy, or reopen through the native picker with Node.js available to save in place."
      : nativeSource ? `No pending changes. Source: ${nativeSource.path}` : "No pending changes. Browser-opened files support export only.";
  message(errors.join(" "));
}
function pending() {
  return changes.size > 0 || [...inputs.values()].some(input => input.getAttribute("aria-invalid") === "true");
}
function render() {
  $("fields").replaceChildren();
  $("sections").replaceChildren();
  inputs = new Map();
  const groups = new Map();
  activeSection = doc.sections[0]?.id || null;
  for (const section of doc.sections) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.id = `tab-${section.id}`;
    tab.role = "tab";
    tab.textContent = section.label;
    tab.setAttribute("aria-controls", "fields");
    tab.setAttribute("aria-selected", String(section.id === activeSection));
    tab.tabIndex = section.id === activeSection ? 0 : -1;
    tab.addEventListener("click", () => selectSection(section.id));
    $("sections").append(tab);
  }
  $("sections").hidden = !doc.sections.length;
  for (const [index, field] of doc.fields.entries()) {
    const groupKey = `${field.section}\u0000${field.group}`;
    let group = groups.get(groupKey);
    if (!group) {
      group = document.createElement("fieldset");
      group.dataset.section = field.section;
      const legend = document.createElement("legend");
      legend.textContent = field.group;
      group.append(legend);
      groups.set(groupKey, group);
      $("fields").append(group);
    }
    const row = document.createElement("div");
    row.className = "field";
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.id = `field-${index}`;
    label.htmlFor = input.id;
    label.textContent = field.label;
    input.type = field.type === "bool" ? "checkbox" : "number";
    if (field.type === "bool") input.checked = field.value;
    else {
      input.value = field.value;
      input.min = field.min;
      input.max = field.max;
      input.step = field.type === "int" ? "1" : "any";
      const hint = document.createElement("small");
      hint.id = `${input.id}-hint`;
      hint.textContent = `${field.type === "int" ? "Whole number" : "Number"} \u00b7 ${field.min} to ${field.max}`;
      label.append(hint);
      input.setAttribute("aria-describedby", hint.id);
    }
    if (field.description) {
      input.title = field.description;
      input.setAttribute("aria-description", field.description);
    }
    input.addEventListener("input", refresh);
    inputs.set(field.id, input);
    row.append(label, input);
    group.append(row);
  }
  $("fields").hidden = false;
  $("empty").hidden = true;
  $("backup").disabled = false;
  $("reset").disabled = false;
  $("filename").textContent = fileName;
  $("details").textContent = `${doc.kind} \u00b7 ${doc.fields.length} verified fields \u00b7 original preserved`;
  renderItems();
  renderVehicles();
  selectSection(activeSection);
  refresh();
}

function selectSection(sectionId) {
  activeSection = sectionId;
  for (const tab of $("sections").querySelectorAll('[role="tab"]')) {
    const selected = tab.id === `tab-${sectionId}`;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  for (const group of $("fields").querySelectorAll("fieldset[data-section]")) {
    group.classList.toggle("visible", group.dataset.section === sectionId);
  }
  $("items-panel").hidden = sectionId !== "items";
  $("vehicles-panel").hidden = sectionId !== "vehicles";
  $("fields").hidden = !doc || !doc.fields.some(field => field.section === sectionId);
}

function renderItems() {
  const rows = $("item-rows");
  rows.replaceChildren();
  $("item-filter").value = "";
  const itemCount = doc.items.length;
  const unparented = doc.items.filter(item => item.parentRef === null).length;
  const unresolved = doc.items.filter(item => item.parentRef !== null && !item.attachedTo).length;
  $("items-note").textContent = itemCount
    ? `${itemCount} saved item object${itemCount === 1 ? "" : "s"} in newGOArray_Items. ${unparented} unparented/world-root; ${unresolved} with an unresolved parent. The save does not identify which unresolved containers are player inventory or storage, so this is not a carried-inventory count.`
    : "This save contains no newGOArray_Items list.";
  if (!itemCount) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.className = "empty-row";
    cell.textContent = "No item instance records were found.";
    row.append(cell);
    rows.append(row);
    return;
  }
  for (const item of doc.items) {
    const row = document.createElement("tr");
    row.dataset.search = `${item.name} ${item.location} ${item.parentRef || ""}`.toLowerCase();
    const name = document.createElement("td");
    name.textContent = item.displayName;
    if (!item.matchedRecord) {
      const readOnly = document.createElement("small");
      readOnly.textContent = item.warnings[0] || "No linked editable item values.";
      name.append(readOnly);
    }
    const location = document.createElement("td");
    location.className = `location${item.parentRef !== null && !item.attachedTo ? " unknown" : ""}`;
    location.textContent = item.active === false ? `Inactive · ${item.location}` : item.location;
    if (item.parentRef) {
      const reference = document.createElement("small");
      reference.textContent = `Parent ref ${item.parentRef}`;
      location.append(reference);
    }
    const instance = document.createElement("td");
    const reference = document.createElement("code");
    reference.textContent = item.ref || "Reference unavailable";
    instance.append(reference);
    if (item.tag) {
      const tag = document.createElement("small");
      tag.textContent = `Tag: ${item.tag}`;
      instance.append(tag);
    }
    const savedValues = document.createElement("td");
    const values = [];
    if (item.quantity !== null) values.push(`Quantity: ${item.quantity}`);
    if (item.condition !== null) values.push(`Condition: ${numericText(item.condition)}%`);
    if (item.loadedAmmo) values.push(`Loaded rounds (${item.loadedAmmo.fieldId}; ${item.loadedAmmo.scope}): ${item.loadedAmmo.value}`);
    savedValues.textContent = values.length ? values.join(" · ") : "No verified scalar values";
    row.append(name, location, instance, savedValues);
    rows.append(row);
  }
}

function renderVehicles() {
  const rows = $("vehicle-rows");
  rows.replaceChildren();
  $("vehicle-action-status").textContent = "";
  const select = $("vehicle-select");
  const previousSelection = select.value;
  select.replaceChildren();
  for (const vehicle of doc.vehicles) {
    const option = document.createElement("option");
    option.value = vehicle.id;
    option.textContent = vehicle.name;
    select.append(option);
  }
  if (doc.vehicles.some(vehicle => vehicle.id === previousSelection)) select.value = previousSelection;
  $("vehicle-actions").hidden = doc.vehicles.length === 0;
  $("vehicles-note").textContent = doc.vehicles.length
    ? "Vehicle objects are joined to their saved records by matching ES3 references. Fuel uses the saved Liquid value and is capped by that vehicle's LiquidCapacity (shown in L per the game's player-facing units; the save itself stores no unit label). Only components linked by a saved parent reference to a vehicle's engine, radiator, or exhaust mount are attributed to that vehicle. No separate vehicle-body Condition field was found."
    : "This save contains no newGOArray_Cars list.";
  if (!doc.vehicles.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.className = "empty-row";
    cell.textContent = "No saved vehicle records were found.";
    row.append(cell);
    rows.append(row);
    return;
  }
  for (const vehicle of doc.vehicles) {
    const row = document.createElement("tr");
    const name = document.createElement("td");
    name.textContent = vehicle.name;
    const fuel = document.createElement("td");
    fuel.textContent = vehicle.fuel ? `${numericText(vehicle.fuel.value)} / ${numericText(vehicle.fuel.capacity)} L` : "Fuel not safely mapped";
    if (vehicle.warnings.length) {
      const warning = document.createElement("small");
      warning.textContent = vehicle.warnings.join(" ");
      fuel.append(warning);
    }
    const parts = document.createElement("td");
    if (vehicle.parts.length) {
      parts.textContent = vehicle.parts.map(part => {
        const role = part.attachedTo?.split(" · ")[1] || "Component";
        const condition = part.condition === null ? "condition not saved" : `${numericText(part.condition)}% condition`;
        return `${role}: ${part.displayName} · ${condition}`;
      }).join("; ");
    } else parts.textContent = "No component mount references matched.";
    const reference = document.createElement("td");
    const code = document.createElement("code");
    code.textContent = vehicle.ref || "Reference unavailable";
    reference.append(code);
    row.append(name, fuel, parts, reference);
    rows.append(row);
  }
  updateVehicleActions();
}

function selectedVehicle() {
  return doc?.vehicles.find(vehicle => vehicle.id === $("vehicle-select").value) || null;
}

function vehicleActionFields(vehicle) {
  return (vehicle?.fieldIds || [])
    .map(id => doc.fields.find(field => field.id === id))
    .filter(Boolean);
}

function updateVehicleActions() {
  const fields = vehicleActionFields(selectedVehicle());
  $("repair-vehicle").disabled = saving || !fields.some(field => field.id.endsWith(":Condition"));
  $("topoff-vehicle").disabled = saving || !fields.some(field => field.id.endsWith(":fuel"));
}

function stageVehicleAction(action) {
  if (saving) return;
  const vehicle = selectedVehicle();
  const result = ApocalypterVehicleActions.stage(
    vehicle,
    doc.fields,
    action,
    field => {
      const input = inputs.get(field.id);
      return { value: input?.value, invalid: input?.getAttribute("aria-invalid") === "true" };
    },
    (field, value) => { inputs.get(field.id).value = value; },
    ApocalypterSave.validate
  );
  refresh();
  $("vehicle-action-status").textContent = result.staged
    ? `${action === "repair" ? "Repair" : "Top-off"} staged ${result.staged} supported field${result.staged === 1 ? "" : "s"} for ${vehicle.name}.${result.skippedInvalid ? ` ${result.skippedInvalid} invalid target field${result.skippedInvalid === 1 ? " was" : "s were"} left unchanged.` : ""} Review the changes before saving or exporting.`
    : result.skippedInvalid
      ? `${result.skippedInvalid} invalid target field${result.skippedInvalid === 1 ? " was" : "s were"} left unchanged. Correct it before staging this action.`
      : `No eligible ${action === "repair" ? "component condition" : "fuel"} values needed updating for ${vehicle?.name || "the selected vehicle"}.`;
  updateVehicleActions();
}

$("fields").addEventListener("submit", event => event.preventDefault());
$("sections").addEventListener("keydown", event => {
  const tabs = [...$("sections").querySelectorAll('[role="tab"]')];
  const index = tabs.indexOf(event.target);
  if (index < 0 || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 :
    (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next].focus();
  selectSection(doc.sections[next].id);
});
$("item-filter").addEventListener("input", () => {
  const term = $("item-filter").value.trim().toLowerCase();
  for (const row of $("item-rows").querySelectorAll("tr[data-search]")) row.hidden = !row.dataset.search.includes(term);
});
async function openFile(file) {
  if (!file) return false;
  if (saving) {
    message("Wait for the current save operation to finish before opening another file.");
    return false;
  }
  if (pending() && !window.confirm("Discard the pending changes and open another save?")) {
    return false;
  }
  const generation = ++readGeneration;
  try {
    if (file.size > ApocalypterSave.MAX_BYTES) throw new Error("Save exceeds the 20 MiB limit.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    const next = ApocalypterSave.inspect(text);
    if (generation !== readGeneration) return false;
    doc = next;
    originalBytes = bytes;
    fileName = file.name;
    nativeSource = null;
    render();
    return true;
  } catch (error) {
    if (generation === readGeneration) message(`Could not open ${file.name}: ${error.message} Your current file has not changed.`);
    return false;
  }
}
$("file").addEventListener("change", async event => {
  await openFile(event.target.files[0]);
  event.target.value = "";
});
$("native-picker").addEventListener("click", async () => {
  if (saving) return;
  const button = $("native-picker");
  button.disabled = true;
  button.textContent = "Checking native bridge...";
  $("picker-hint").textContent = "Checking the local launcher's connection before opening the Windows dialog.";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let status;
    try {
      const readiness = await fetch("/api/status", {
        method: "POST",
        headers: { "X-Editor-Token": pickerToken },
        signal: controller.signal
      });
      if (!readiness.ok) throw new Error("This native bridge is unavailable or outdated. Relaunch run.bat and use its newly opened page.");
      status = await readiness.json();
    } catch (error) {
      if (error.name === "AbortError") throw new Error('The native bridge did not respond within 5 seconds. Check for an already open "Choose an Apocalypter save" dialog, or relaunch run.bat and use its newly opened page.');
      throw error;
    } finally { clearTimeout(timeout); }
    if (status.protocolVersion !== 2) throw new Error("This page is connected to an older native bridge. Relaunch run.bat and use its newly opened page.");
    if (!status.folderExists) throw new Error(`The current user's Apocalypter save folder does not exist: ${status.saveFolder}`);
    button.textContent = "Waiting for Windows dialog...";
    $("picker-hint").textContent = `Windows picker requested for ${status.saveFolder}. Select a file or cancel in "Choose an Apocalypter save"; check the taskbar if necessary.`;
    const response = await fetch("/api/pick", {
      method: "POST",
      headers: { "X-Editor-Token": pickerToken }
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Picker request failed (${response.status}).`);
    if (result.canceled) {
      $("picker-hint").textContent = "File selection canceled; the open save and pending edits are unchanged.";
      return;
    }
    const binary = atob(result.contentBase64);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    const loaded = await openFile(new File([bytes], result.name, { type: "application/octet-stream" }));
    if (loaded) {
      nativeSource = result.source || null;
      refresh();
      $("picker-hint").textContent = nativeSource?.canSave
        ? `Loaded ${result.name}. Save changes can back up and replace ${nativeSource.path} after confirmation.`
        : `Loaded ${result.name}. Saving in place needs Node.js 18 or newer; export remains available.`;
    }
    else if (!pending()) $("picker-hint").textContent = "The selected file was not opened; the current save is unchanged.";
  } catch (error) {
    message(`Save picker failed: ${error.message}`);
    $("browser-picker-controls").hidden = false;
    $("picker-hint").textContent = "The native picker failed. Use the browser chooser below or relaunch with run.bat.";
  } finally {
    button.disabled = false;
    button.textContent = "Choose File";
  }
});
$("vehicle-select").addEventListener("change", updateVehicleActions);
$("repair-vehicle").addEventListener("click", () => stageVehicleAction("repair"));
$("topoff-vehicle").addEventListener("click", () => stageVehicleAction("topoff"));
$("save").addEventListener("click", async () => {
  refresh();
  if ($("save").disabled) return;
  const source = nativeSource;
  if (!window.confirm(`Overwrite this save?\n\n${source.path}\n\nAn automatic, uniquely named backup of its current bytes will be created beside it before replacement. Close the game first. Cancel makes no changes.`)) return;
  saving = true;
  ++readGeneration;
  $("save").textContent = "Saving...";
  $("fields").inert = true;
  $("native-picker").disabled = true;
  $("file").disabled = true;
  $("reset").disabled = true;
  $("vehicle-select").disabled = true;
  $("repair-vehicle").disabled = true;
  $("topoff-vehicle").disabled = true;
  refresh();
  try {
    const response = await fetch("/api/save", {
      method: "POST",
      headers: { "X-Editor-Token": pickerToken, "Content-Type": "application/json" },
      body: JSON.stringify({ handle: source.handle, changes: Object.fromEntries(changes), confirmed: true })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Save failed (${response.status}).`);
    if (result.canceled) {
      message("Save canceled; the file and pending edits are unchanged.");
      return;
    }
    const bytes = Uint8Array.from(atob(result.contentBase64), character => character.charCodeAt(0));
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    doc = ApocalypterSave.inspect(text);
    originalBytes = bytes;
    render();
    message(`Saved ${source.path}. Backup: ${result.backupPath}`);
  } catch (error) {
    message(`Save failed: ${error.message} Pending edits remain available. If the connection failed after writing, reopen the file to check its current state before retrying.`);
  } finally {
    saving = false;
    $("save").textContent = "Save changes";
    $("fields").inert = false;
    $("native-picker").disabled = false;
    $("file").disabled = false;
    $("reset").disabled = !doc;
    $("vehicle-select").disabled = false;
    updateVehicleActions();
    $("save").disabled = !changes.size || !source.canSave || [...inputs.values()].some(input => input.getAttribute("aria-invalid") === "true");
  }
});
$("backup").addEventListener("click", () => download(originalBytes, `${fileName}.original.bak`));
$("reset").addEventListener("click", () => {
  if (pending() && !window.confirm("Reset all pending changes to the opened original?")) return;
  render();
});
$("export").addEventListener("click", () => {
  refresh();
  if ($("export").disabled) return;
  try {
    const text = ApocalypterSave.serialize(doc.text, changes);
    download(new TextEncoder().encode(text), fileName.replace(/\.es3$/i, "") + ".edited.es3");
    message("Edited copy downloaded. Keep your original backup and close the game before replacing a save. Pending changes remain available.");
  } catch (error) { message(`Export failed: ${error.message}`); }
});
window.addEventListener("beforeunload", event => {
  if (pending()) { event.preventDefault(); event.returnValue = ""; }
});
