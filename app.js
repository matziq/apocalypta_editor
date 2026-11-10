"use strict";
const $ = id => document.getElementById(id);
let doc = null;
let originalBytes = null;
let fileName = "";
let changes = new Map();
let inputs = new Map();
let readGeneration = 0;

function message(text) { $("message").textContent = text; }
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
  inputs = new Map();
  const groups = new Map();
  for (const [index, field] of doc.fields.entries()) {
    let group = groups.get(field.group);
    if (!group) {
      group = document.createElement("fieldset");
      const legend = document.createElement("legend");
      legend.textContent = field.group;
      group.append(legend);
      groups.set(field.group, group);
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
  refresh();
}
$("fields").addEventListener("submit", event => event.preventDefault());
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
