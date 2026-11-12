"use strict";
const $ = id => document.getElementById(id);
let doc = null;
let originalBytes = null;
let fileName = "";
let changes = new Map();
let inputs = new Map();
let fieldRows = new Map();
let fieldHomes = new Map();
let itemFieldIds = new Set();
let itemRows = new Map();
let vehicleSummaryRows = new Map();
let selectedItemId = null;
let readGeneration = 0;
let activeSection = null;
let nativeSource = null;
let saving = false;
let savingAutomatically = false;
let openingNative = false;
let autosaveTimer = null;
let autosaveRequested = false;
let autosaveFailed = false;
let autosaveFailureMessage = "";
let helpCounter = 0;
let helpCloseTimer = null;
let helpTarget = null;
let helpPinned = false;
const saveButtons = ["save", "save-top", "save-side"];
const themeQuery = window.matchMedia("(prefers-color-scheme: dark)");
let preferences;
try {
  preferences = ApocalypterUi.load(localStorage, themeQuery.matches);
} catch (error) {
  preferences = { theme: "system", season: "spring", prefersDark: themeQuery.matches, autosave: false, editableOnly: false };
  $("appearance-status").textContent = `Appearance preferences could not be loaded: ${error.message}. Default appearance is active; file opening is still available.`;
}
const pickerToken = document.querySelector('meta[name="save-picker-token"]')?.content || "";

function hideHelp() {
  clearTimeout(helpCloseTimer);
  $("floating-help").hidden = true;
  helpTarget = null;
  helpPinned = false;
}
function showHelp(target, text, pinned = false) {
  clearTimeout(helpCloseTimer);
  const popup = $("floating-help");
  helpTarget = target;
  helpPinned = pinned;
  popup.textContent = text;
  popup.hidden = false;
  const bounds = target.getBoundingClientRect();
  const size = popup.getBoundingClientRect();
  popup.style.left = `${Math.max(12, Math.min(bounds.left, document.documentElement.clientWidth - size.width - 12))}px`;
  const below = bounds.bottom + 8;
  popup.style.top = `${Math.max(12, Math.min(below + size.height <= innerHeight - 12 ? below : bounds.top - size.height - 8, innerHeight - size.height - 12))}px`;
}
function attachHelp(container, text, label, input) {
  if (!text) throw new Error(`Missing help for ${label}.`);
  const description = document.createElement("span");
  description.className = "sr-only";
  description.id = `help-${++helpCounter}`;
  description.textContent = text;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "help-trigger";
  button.textContent = "?";
  button.setAttribute("aria-label", `Help: ${label}`);
  button.setAttribute("aria-describedby", description.id);
  function leave() {
    if (!helpPinned) helpCloseTimer = setTimeout(hideHelp, 200);
  }
  button.addEventListener("mouseenter", () => showHelp(button, text));
  button.addEventListener("mouseleave", leave);
  button.addEventListener("focus", () => showHelp(button, text));
  button.addEventListener("blur", leave);
  button.addEventListener("click", event => {
    event.preventDefault();
    if (helpTarget === button && helpPinned) hideHelp();
    else showHelp(button, text, true);
  });
  if (input) {
    const previous = input.getAttribute("aria-describedby");
    input.setAttribute("aria-describedby", [previous, description.id].filter(Boolean).join(" "));
    input.addEventListener("focus", hideHelp);
    input.addEventListener("pointerenter", hideHelp);
    input.addEventListener("pointerdown", hideHelp);
  }
  container.append(button, description);
}
$("floating-help").addEventListener("mouseenter", () => clearTimeout(helpCloseTimer));
$("floating-help").addEventListener("mouseleave", () => { if (!helpPinned) hideHelp(); });
window.addEventListener("keydown", event => { if (event.key === "Escape") hideHelp(); });
window.addEventListener("resize", hideHelp);
window.addEventListener("scroll", () => {
  if (!helpTarget) return;
  const bounds = helpTarget.getBoundingClientRect();
  if (bounds.bottom < 0 || bounds.top > innerHeight) hideHelp();
  else showHelp(helpTarget, $("floating-help").textContent, helpPinned);
});

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
  for (const id of saveButtons) $(id).disabled = saving || openingNative || !!errors.length || !changes.size || !nativeSource?.canSave;
  $("autosave").disabled = !nativeSource?.canSave || !nativeSource?.backupPath || openingNative;
  $("autosave").checked = preferences.autosave;
  $("maximize-items").disabled = saving && !savingAutomatically || !doc.items.length;
  if (!nativeSource?.canSave) $("autosave-status").textContent = "Autosave unavailable: open through run.bat with Node.js 18+; browser files support export only.";
  else if (!preferences.autosave) $("autosave-status").textContent = "Autosave is off. Changes stay staged until a confirmed Save.";
  else if (autosaveFailed) $("autosave-status").textContent = `Autosave stopped after an error: ${autosaveFailureMessage}. Drafts are kept; resolve the problem, then turn autosave off and on to retry.`;
  else if (errors.length) $("autosave-status").textContent = "Autosave paused: correct invalid drafts and commit the corrected value.";
  else if (savingAutomatically) $("autosave-status").textContent = `Autosaving ${nativeSource.path}...`;
  else if (changes.size) $("autosave-status").textContent = `Autosave enabled for ${nativeSource.path}. Commit a valid change to save.`;
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
  hideHelp();
  $("fields").replaceChildren();
  $("sections").replaceChildren();
  inputs = new Map();
  fieldRows = new Map();
  fieldHomes = new Map();
  itemFieldIds = new Set(doc.items.flatMap(item => item.fieldIds));
  const groups = new Map();
  activeSection = doc.sections.some(section => section.id === activeSection) ? activeSection : doc.sections[0]?.id || null;
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
  function groupFor(field) {
    const key = `${field.section}\u0000${field.group}`;
    if (!groups.has(key)) {
      const group = document.createElement("fieldset");
      group.dataset.section = field.section;
      const legend = document.createElement("legend");
      legend.textContent = field.group;
      group.append(legend);
      groups.set(key, group);
      $("fields").append(group);
    }
    return groups.get(key);
  }
  for (const [index, field] of doc.fields.entries()) {
    const itemOnly = field.section === "items" && itemFieldIds.has(field.id);
    const group = itemOnly ? null : groupFor(field);
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
      input.setAttribute("aria-description", field.description);
    }
    input.addEventListener("input", refresh);
    input.addEventListener("input", cancelQueuedAutosave);
    input.addEventListener("change", requestAutosave);
    input.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); requestAutosave(); }
    });
    attachHelp(label, field.help, field.label, input);
    inputs.set(field.id, input);
    row.append(label, input);
    fieldRows.set(field.id, row);
    if (group) {
      group.append(row);
      if (itemFieldIds.has(field.id)) fieldHomes.set(field.id, group);
    }
  }
  for (const field of doc.readOnlyFields) {
    const row = document.createElement("div");
    row.className = "field";
    const label = document.createElement("div");
    label.className = "field-label";
    label.textContent = `${field.label} (read-only)`;
    const reason = document.createElement("small");
    reason.textContent = field.reason;
    label.append(reason);
    attachHelp(label, field.help, field.label);
    const value = document.createElement("span");
    value.textContent = String(field.value);
    row.append(label, value);
    groupFor(field).append(row);
  }
  $("fields").hidden = false;
  $("empty").hidden = true;
  $("backup").disabled = false;
  $("reset").disabled = false;
  $("filename").textContent = fileName;
  $("details").textContent = `${doc.kind} \u00b7 ${doc.fields.length} editable fields \u00b7 ${doc.readOnlyFields.length} other read-only values \u00b7 original preserved`;
  $("source-status").textContent = nativeSource
    ? `Source: ${nativeSource.path}. Loaded version modified ${new Date(nativeSource.modifiedUtc).toLocaleString()}. Verified original backup: ${nativeSource.backupPath}`
    : "Browser file: no automatic disk backup or in-place saving. Download an original backup and export a copy.";
  renderItems();
  renderVehicles();
  selectSection(activeSection);
  refresh();
}

function selectSection(sectionId) {
  hideHelp();
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
  $("player-actions").hidden = sectionId !== "player";
  $("maximize-player").disabled = saving && !savingAutomatically || !doc?.fields.some(field => field.section === "player");
  $("fields").hidden = !doc || ![...doc.fields, ...doc.readOnlyFields].some(field => field.section === sectionId && (sectionId !== "items" || !itemFieldIds.has(field.id)));
  if (sectionId === "items") renderItemEditor();
  else restoreItemFields();
}

function restoreItemFields() {
  for (const [id, home] of fieldHomes) home.append(fieldRows.get(id));
}

function renderItemEditor() {
  restoreItemFields();
  const item = doc.items.find(candidate => candidate.id === selectedItemId);
  $("item-fields").replaceChildren();
  $("item-read-only").replaceChildren();
  $("item-editor").hidden = !item;
  for (const [id, { row, button, expansion }] of itemRows) {
    row.dataset.selected = String(id === item?.id);
    button.setAttribute("aria-expanded", String(id === item?.id));
    expansion.hidden = id !== item?.id || row.hidden;
  }
  if (!item) {
    $("item-editor-home").append($("item-editor"));
    return;
  }
  itemRows.get(item.id).editorCell.append($("item-editor"));
  $("item-editor-title").textContent = item.name;
  const position = ["x", "y", "z"].every(axis => Number.isFinite(item.position?.[axis]))
    ? ` Local position (parent-relative): ${["x", "y", "z"].map(axis => `${axis} ${numericText(item.position[axis])}`).join(", ")}.`
    : "";
  $("item-editor-note").textContent = `${item.location}. Instance ref ${item.ref || "unavailable"}.${position}`;
  if (item.liquid?.capacitySource) $("item-editor-note").textContent += ` Liquid bound: ${item.liquid.capacitySource}`;
  for (const id of item.fieldIds) $("item-fields").append(fieldRows.get(id));
  $("item-edit-status").textContent = item.fieldIds.length
    ? "Edit this existing item, then review and save or export. Other item drafts are kept when you change selection."
    : "This object has no safely matched editable scalar values in this save. Missing condition, quantity, or other fields are not invented.";
  if (item.warnings.length) $("item-edit-status").textContent += ` ${item.warnings.join(" ")}`;
  for (const field of item.readOnlyFields) {
    const term = document.createElement("dt");
    term.textContent = `${field.name}: ${field.value}`;
    attachHelp(term, field.help, field.name);
    const detail = document.createElement("dd");
    detail.textContent = field.reason;
    $("item-read-only").append(term, detail);
  }
  $("item-read-only").hidden = !item.readOnlyFields.length;
}

function selectItem(itemId) {
  if (saving && !savingAutomatically) return;
  const row = itemRows.get(itemId)?.row;
  const top = row?.getBoundingClientRect().top;
  selectedItemId = itemId === selectedItemId ? null : itemId;
  selectSection("items");
  if (row && top !== undefined) {
    const delta = row.getBoundingClientRect().top - top;
    if (delta) window.scrollBy(0, delta);
  }
  const item = doc.items.find(candidate => candidate.id === selectedItemId);
  if (item) (inputs.get(item.fieldIds[0]) || $("item-editor-title")).focus({ preventScroll: true });
  else itemRows.get(itemId)?.button.focus({ preventScroll: true });
}

function itemSummary(item) {
  const values = [];
  if (item.quantity !== null) values.push(`Quantity: ${item.quantity}`);
  if (item.condition !== null) values.push(`Condition: ${numericText(item.condition)}%`);
  if (item.ammo !== null) values.push(`Item ammo: ${item.ammo}`);
  if (item.liquid) values.push(`Liquid: ${numericText(item.liquid.value)} / ${numericText(item.liquid.capacity)} (saved units)`);
  if (item.loadedAmmo) values.push(`Loaded rounds (${item.loadedAmmo.fieldId}; ${item.loadedAmmo.scope}): ${item.loadedAmmo.value}`);
  return values.length ? values.join(" · ") : item.readOnlyFields.length
    ? `${item.readOnlyFields.length} saved scalar value${item.readOnlyFields.length === 1 ? "" : "s"} (read-only)`
    : "No supported scalar record";
}
function vehiclePartsSummary(vehicle) {
  return vehicle.parts.length ? vehicle.parts.map(part => {
    const role = part.attachedTo?.split(" · ")[1] || "Component";
    const condition = part.condition === null ? "condition not saved" : `${numericText(part.condition)}% condition`;
    return `${role}: ${part.displayName} · ${condition}`;
  }).join("; ") : "No component mount references matched.";
}
function updateSavedSummaries() {
  for (const item of doc.items) {
    const row = itemRows.get(item.id);
    if (row) row.summary.textContent = itemSummary(item);
  }
  for (const vehicle of doc.vehicles) {
    const row = vehicleSummaryRows.get(vehicle.id);
    if (!row) continue;
    row.fuel.textContent = vehicle.fuel ? `${numericText(vehicle.fuel.value)} / ${numericText(vehicle.fuel.capacity)} L` : "Fuel not safely mapped";
    row.parts.textContent = vehiclePartsSummary(vehicle);
  }
}
function renderItems() {
  const rows = $("item-rows");
  $("item-editor-home").append($("item-editor"));
  rows.replaceChildren();
  itemRows = new Map();
  $("editable-only").checked = preferences.editableOnly;
  const itemCount = doc.items.length;
  const unparented = doc.items.filter(item => item.parentRef === null).length;
  const associated = doc.items.filter(item => item.associatedVehicle).length;
  const unresolved = doc.items.filter(item => item.parentRef !== null && !item.attachedTo && !item.associatedVehicle).length;
  $("items-note").textContent = itemCount
    ? `${itemCount} saved item object${itemCount === 1 ? "" : "s"}. ${unparented} unparented/world-root; ${associated} vehicle-associated by prefab references; ${unresolved} with an unresolved parent. Vehicle association does not establish mounting or storage, and unknown containers are not counted as carried inventory. Select an item to edit its supported saved values.`
    : "This save contains no newGOArray_Items list.";
  if (!itemCount) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.className = "empty-row";
    cell.textContent = "No item instance records were found.";
    row.append(cell);
    rows.append(row);
    filterItems();
    return;
  }
  for (const item of doc.items) {
    const row = document.createElement("tr");
    row.dataset.search = `${item.name} ${item.ref || ""} ${item.location} ${item.parentRef || ""}`.toLowerCase();
    row.dataset.editable = String(item.fieldIds.length > 0);
    const name = document.createElement("td");
    name.textContent = item.displayName;
    const savedId = document.createElement("small");
    savedId.textContent = `Saved ID: ${item.name}`;
    name.append(savedId);
    if (!item.matchedRecord) {
      const readOnly = document.createElement("small");
      readOnly.textContent = item.warnings[0] || "No linked editable item values.";
      name.append(readOnly);
    }
    const location = document.createElement("td");
    location.className = `location${item.parentRef !== null && !item.attachedTo && !item.associatedVehicle ? " unknown" : ""}`;
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
    const summary = document.createElement("span");
    summary.textContent = itemSummary(item);
    savedValues.append(summary);
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "item-action";
    edit.textContent = item.fieldIds.length ? "Edit values" : "Inspect";
    edit.setAttribute("aria-label", `${edit.textContent}: ${item.name}, ref ${item.ref || "unavailable"}`);
    edit.setAttribute("aria-controls", "item-editor");
    edit.setAttribute("aria-expanded", String(item.id === selectedItemId));
    edit.addEventListener("click", () => selectItem(item.id));
    savedValues.append(edit);
    const expansion = document.createElement("tr");
    expansion.className = "item-expansion";
    expansion.hidden = true;
    const editorCell = document.createElement("td");
    editorCell.colSpan = 4;
    expansion.append(editorCell);
    itemRows.set(item.id, { row, button: edit, summary, expansion, editorCell });
    row.append(name, location, instance, savedValues);
    rows.append(row, expansion);
  }
  filterItems();
}

function filterItems() {
  const term = $("item-filter").value.trim().toLowerCase();
  let visible = 0;
  for (const [id, { row, expansion }] of itemRows) {
    row.hidden = !row.dataset.search.includes(term) || ($("editable-only").checked && row.dataset.editable !== "true");
    expansion.hidden = row.hidden || id !== selectedItemId;
    if (row.hidden && id === selectedItemId) hideHelp();
    if (!row.hidden) visible++;
  }
  $("item-filter-status").textContent = visible
    ? `Showing ${visible} of ${doc.items.length} items. Select Edit values or Inspect.`
    : doc.items.length ? `Showing 0 of ${doc.items.length} items. No items match these filters. Clear the text filter or turn off editable-only; drafts are kept.` : "No saved item instances (0 total).";
}

function renderVehicles() {
  const rows = $("vehicle-rows");
  rows.replaceChildren();
  vehicleSummaryRows = new Map();
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
    const fuelSummary = document.createElement("span");
    fuelSummary.textContent = vehicle.fuel ? `${numericText(vehicle.fuel.value)} / ${numericText(vehicle.fuel.capacity)} L` : "Fuel not safely mapped";
    fuel.append(fuelSummary);
    if (vehicle.warnings.length) {
      const warning = document.createElement("small");
      warning.textContent = vehicle.warnings.join(" ");
      fuel.append(warning);
    }
    const parts = document.createElement("td");
    const partsSummary = document.createElement("span");
    partsSummary.textContent = vehiclePartsSummary(vehicle);
    parts.append(partsSummary);
    vehicleSummaryRows.set(vehicle.id, { fuel: fuelSummary, parts: partsSummary });
    const reference = document.createElement("td");
    const code = document.createElement("code");
    code.textContent = vehicle.ref || "Reference unavailable";
    reference.append(code);
    attachHelp(fuel, vehicle.fuel
      ? "Saved vehicle Liquid / LiquidCapacity in the game's displayed liters. More fuel means more available fuel; capacity bounds edits. This table shows the last saved baseline; staged edits appear in the fields and Review."
      : `Read-only: no verified fuel/capacity mapping for this vehicle. ${vehicle.warnings.join(" ")} No capacity is inferred.`, `${vehicle.name} fuel`);
    attachHelp(parts, "Only exact saved parent-to-mount matches are listed here. Condition is percent, with 100 healthy; absence is not zero. No separate vehicle-body damage scalar was found. Storage/association alone does not qualify for repair.", `${vehicle.name} components`);
    attachHelp(reference, "Exact saved ES3 object reference. Read-only: changing references could break object links. It does not establish player ownership.", `${vehicle.name} reference`);
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
  $("all-vehicles").disabled = saving || !doc?.vehicles.some(vehicle => vehicle.fieldIds.length);
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
  requestAutosave();
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
$("item-filter").addEventListener("input", filterItems);
$("editable-only").addEventListener("change", () => {
  preferences.editableOnly = $("editable-only").checked;
  saveAppearance();
  filterItems();
});
function cancelQueuedAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = null;
  autosaveRequested = false;
}
function requestAutosave() {
  refresh();
  if (!preferences.autosave || autosaveFailed || !nativeSource?.canSave || !nativeSource.backupPath) return;
  autosaveRequested = true;
  clearTimeout(autosaveTimer);
  if (saving) return;
  autosaveTimer = setTimeout(() => { autosaveTimer = null; void saveDocument(true); }, 350);
}
$("autosave").addEventListener("change", () => {
  preferences.autosave = $("autosave").checked;
  autosaveFailed = false;
  cancelQueuedAutosave();
  saveAppearance();
  refresh();
  if (preferences.autosave) requestAutosave();
});
async function openFile(file, source = null) {
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
    cancelQueuedAutosave();
    autosaveFailed = false;
    nativeSource = source;
    selectedItemId = null;
    $("item-filter").value = "";
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
async function bridgeStatus() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch("/api/status", { method: "POST", headers: { "X-Editor-Token": pickerToken }, signal: controller.signal });
    if (!response.ok) throw new Error("This native bridge is unavailable or outdated. Relaunch run.bat and use its newly opened page.");
    const status = await response.json();
    if (status.protocolVersion !== 3) throw new Error("This page is connected to an older native bridge. Relaunch run.bat and use its newly opened page.");
    if (!status.folderExists) throw new Error(`The current user's Apocalypter save folder does not exist: ${status.saveFolder}`);
    return status;
  } catch (error) {
    if (error.name === "AbortError") throw new Error('The native bridge did not respond within 5 seconds. Check for an already open "Choose an Apocalypter save" dialog, or relaunch run.bat and use its newly opened page.');
    throw error;
  } finally { clearTimeout(timeout); }
}
async function openNative(latest = false) {
  if (saving || openingNative) return;
  openingNative = true;
  cancelQueuedAutosave();
  const button = $("native-picker");
  button.disabled = true;
  $("file").disabled = true;
  button.textContent = "Checking native bridge...";
  $("picker-hint").textContent = "Checking the local launcher's connection before opening the Windows dialog.";
  try {
    const status = await bridgeStatus();
    button.textContent = latest ? "Opening newest slot..." : "Waiting for Windows dialog...";
    $("picker-hint").textContent = latest
      ? `Opening the most recently modified SaveGameN.es3 in ${status.saveFolder} and verifying its backup.`
      : `Windows picker requested for ${status.saveFolder}. Select a file or cancel in "Choose an Apocalypter save"; check the taskbar if necessary.`;
    const response = await fetch(latest ? "/api/latest" : "/api/pick", {
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
    if (!result.source?.backupPath) throw new Error("The native bridge did not verify an original backup. Relaunch run.bat; editing is unavailable for this response.");
    const loaded = await openFile(new File([bytes], result.name, { type: "application/octet-stream" }), result.source);
    if (loaded) {
      refresh();
      $("picker-hint").textContent = nativeSource?.canSave
        ? `Loaded ${result.name}; original backup verified at ${nativeSource.backupPath}. Manual Save asks before overwriting.`
        : `Loaded ${result.name}. Saving in place needs Node.js 18 or newer; export remains available.`;
    }
    else if (!pending()) $("picker-hint").textContent = "The selected file was not opened. No older slot was selected; choose a file manually.";
  } catch (error) {
    message(`${latest ? "Automatic opening" : "Save picker"} failed: ${error.message}`);
    $("browser-picker-controls").hidden = false;
    $("picker-hint").textContent = "Choose a file manually, use the limited browser chooser, or relaunch with run.bat. No older slot was selected automatically.";
  } finally {
    openingNative = false;
    button.disabled = false;
    $("file").disabled = false;
    button.textContent = "Choose File";
    if (doc?.fields) {
      const feedback = $("message").textContent;
      refresh();
      if (feedback) message(feedback);
    }
  }
}
$("native-picker").addEventListener("click", () => openNative());
window.addEventListener("DOMContentLoaded", () => {
  if (pickerToken && location.protocol === "http:" && location.hostname === "127.0.0.1") void openNative(true);
});
$("vehicle-select").addEventListener("change", updateVehicleActions);
$("repair-vehicle").addEventListener("click", () => stageVehicleAction("repair"));
$("topoff-vehicle").addEventListener("click", () => stageVehicleAction("topoff"));
function readDraft(field) {
  const input = inputs.get(field.id);
  return { value: input?.value, invalid: input?.getAttribute("aria-invalid") === "true" };
}
function writeDraft(field, value) { inputs.get(field.id).value = value; }
$("maximize-player").addEventListener("click", () => {
  if (!doc || (saving && !savingAutomatically)) return;
  refresh();
  const result = ApocalypterVehicleActions.maximize(doc.fields, readDraft, writeDraft, ApocalypterSave.validate);
  refresh();
  $("player-action-status").textContent = `Maximize all staged ${result.staged} values: editable health, armor and supplies to 100; Hunger, Thirst, Fatigue and Radiation to 0. Read-only values were untouched.${result.skipped.length ? ` Could not set: ${result.skipped.join(", ")} (invalid draft or unsupported target).` : ""}`;
  requestAutosave();
});
$("maximize-items").addEventListener("click", () => {
  if (!doc || (saving && !savingAutomatically)) return;
  refresh();
  const result = ApocalypterVehicleActions.maximizeItems(doc.items, doc.fields, readDraft, writeDraft, ApocalypterSave.validate);
  refresh();
  $("item-action-status").textContent = `Maximize all staged ${result.staged} verified condition/liquid values across all saved items, regardless of filters. ${result.skippedUnverified} counters skipped (no verified game maximum); ${result.skippedInvalid} invalid target drafts skipped. ${result.readOnly} read-only values were untouched. No values were lowered.`;
  requestAutosave();
});
$("all-vehicles").addEventListener("click", () => {
  if (!doc || saving) return;
  refresh();
  const result = ApocalypterVehicleActions.all(doc.vehicles, doc.fields, readDraft, writeDraft, ApocalypterSave.validate);
  refresh();
  $("vehicle-action-status").textContent = `All vehicles: staged ${result.staged} verified repair/fuel values. ${result.missingRepair} vehicles had no verified repair target; ${result.missingFuel} had no verified tank. ${result.skippedInvalid} invalid target drafts were left unchanged. Unrelated and read-only values were untouched.`;
  requestAutosave();
});
async function saveDocument(automatic = false) {
  if (saving || openingNative) return;
  refresh();
  if ($("save").disabled) return;
  if (automatic && (!preferences.autosave || autosaveFailed || !autosaveRequested || !nativeSource?.backupPath)) return;
  const source = nativeSource;
  if (!automatic) {
    cancelQueuedAutosave();
    if (!window.confirm(`Overwrite this save?\n\n${source.path}\n\nIts current bytes will be backed up before replacement (an identical verified load-time backup may be reused). Close the game first. Cancel makes no changes.`)) {
      message("Save canceled; queued writes were canceled and drafts remain staged.");
      return;
    }
  }
  const submitted = new Map(changes);
  cancelQueuedAutosave();
  saving = true;
  savingAutomatically = automatic;
  ++readGeneration;
  for (const id of saveButtons) $(id).textContent = "Saving...";
  $("fields").inert = !automatic;
  $("items-panel").inert = !automatic;
  $("native-picker").disabled = true;
  $("file").disabled = true;
  $("reset").disabled = true;
  $("vehicle-select").disabled = true;
  $("repair-vehicle").disabled = true;
  $("topoff-vehicle").disabled = true;
  $("all-vehicles").disabled = true;
  $("maximize-player").disabled = !automatic;
  refresh();
  try {
    const response = await fetch("/api/save", {
      method: "POST",
      headers: { "X-Editor-Token": pickerToken, "Content-Type": "application/json" },
      body: JSON.stringify({ handle: source.handle, changes: Object.fromEntries(submitted), confirmed: true, ...(automatic ? { autosave: true } : {}) })
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
    if (!automatic) render();
    else { updateSavedSummaries(); refresh(); }
    if (automatic) $("autosave-status").textContent = `Autosaved ${new Date().toLocaleTimeString()}. ${source.path}`;
    else message(`Saved ${source.path}. Backup: ${result.backupPath}`);
  } catch (error) {
    if (automatic) { autosaveFailed = true; autosaveFailureMessage = error.message; cancelQueuedAutosave(); }
    message(`Save failed: ${error.message} Pending edits remain available. If the connection failed after writing, reopen the file to check its current state before retrying.`);
  } finally {
    saving = false;
    savingAutomatically = false;
    for (const id of saveButtons) $(id).textContent = id === "save" ? "Save changes" : "Save";
    $("fields").inert = false;
    $("items-panel").inert = false;
    $("native-picker").disabled = false;
    $("file").disabled = false;
    $("reset").disabled = !doc;
    $("vehicle-select").disabled = false;
    $("maximize-player").disabled = !doc?.fields.some(field => field.section === "player");
    $("maximize-items").disabled = !doc?.items.length;
    updateVehicleActions();
    const disabled = !changes.size || !source.canSave || [...inputs.values()].some(input => input.getAttribute("aria-invalid") === "true");
    for (const id of saveButtons) $(id).disabled = disabled;
    if (automatic && autosaveFailed) $("autosave-status").textContent = `Autosave stopped after an error: ${autosaveFailureMessage}. Drafts are kept; turn it off and on only after resolving the error.`;
    if (autosaveRequested && preferences.autosave && !autosaveFailed) requestAutosave();
  }
}
for (const id of saveButtons) $(id).addEventListener("click", () => saveDocument());
$("backup").addEventListener("click", () => download(originalBytes, `${fileName}.original.bak`));
$("reset").addEventListener("click", () => {
  if (pending() && !window.confirm("Reset all pending changes to the opened original?")) return;
  cancelQueuedAutosave();
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
  if (saving || pending()) { event.preventDefault(); event.returnValue = ""; }
});
for (const [id, text] of [
  ["theme-toggle", "Changes only this editor's light/dark appearance. It does not change save data."],
  ["season-select", "Selects this editor's seasonal color palette. It does not change the game's weather or season."],
  ["autosave", "Consent to overwrite the exact native-opened file after each committed valid change, without a separate prompt. A verified load-time backup is required. Invalid drafts pause saving; errors stop automatic retries. Turning it off keeps pending drafts."],
  ["editable-only", "Shows only item instances with at least one currently editable field. Combines with text search; hidden items and their drafts are not deleted."],
  ["maximize-player", "Stages editable Player & supplies values to exactly 100, except Hunger, Thirst, Fatigue and Radiation to 0. This can lower ammo values above 100. Read-only fields and invalid target drafts are skipped."],
  ["maximize-items", "Stages every saved item's editable Condition to 100 and Liquid to its verified capacity, including matched mounted parts and hidden filtered items. Never lowers values. Quantity, item ammo and weapon-type counters have no verified game maximum and are skipped, as are invalid drafts and read-only values."],
  ["all-vehicles", "Stages the same verified component repairs and tank top-offs as the selected-vehicle actions, across all vehicles. Unknown parts, storage associations and invalid target drafts are skipped."],
  ["repair-vehicle", "Stages this selected vehicle's reference-matched component Condition values to 100%. It does not repair unlinked or stored spare parts."],
  ["topoff-vehicle", "Stages this selected vehicle's Liquid amount to its verified saved tank capacity. Missing/invalid fuel mappings are skipped."]
]) {
  const element = $(id);
  const container = document.createElement("span");
  container.className = "control-help";
  if (element.type === "checkbox") element.parentNode.append(container);
  else element.insertAdjacentElement("afterend", container);
  attachHelp(container, text, element.getAttribute("aria-label") || element.textContent || id, element);
}
