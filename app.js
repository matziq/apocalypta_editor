"use strict";
const $ = id => document.getElementById(id);
let doc = null;
let originalBytes = null;
let fileName = "";
let changes = new Map();
let inputs = new Map();
let readGeneration = 0;
let activeSection = null;

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
  $("save-hint").textContent = errors.length ? "Resolve invalid values before exporting." : changes.size ? "Review the changes above, then export a separate copy." : "No pending changes.";
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
$("file").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;
  if (pending() && !window.confirm("Discard the pending changes and open another save?")) {
    event.target.value = "";
    return;
  }
  const generation = ++readGeneration;
  try {
    if (file.size > ApocalypterSave.MAX_BYTES) throw new Error("Save exceeds the 20 MiB limit.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    const next = ApocalypterSave.inspect(text);
    if (generation !== readGeneration) return;
    doc = next;
    originalBytes = bytes;
    fileName = file.name;
    render();
  } catch (error) {
    if (generation === readGeneration) message(`Could not open ${file.name}: ${error.message} Your current file has not changed.`);
  }
  if (generation === readGeneration) event.target.value = "";
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
