(function (root) {
  "use strict";
  const storageKey = "apocalypta-editor-ui";
  const palettes = ["wasteland", "desert", "nuclear-winter", "apocalypse"];
  const legacyPalettes = { spring: "wasteland", summer: "desert", autumn: "apocalypse", winter: "nuclear-winter" };
  function checkedFontSize(value) {
    if (!Number.isInteger(value) || value < 80 || value > 140 || value % 10 !== 0) throw new Error("Text size must be 80% to 140% in 10% steps.");
    return value;
  }

  function load(storage, prefersDark) {
    const raw = storage.getItem(storageKey);
    if (!raw) return { theme: "system", palette: "wasteland", prefersDark, autosave: false, editableOnly: false, targets: null, fontSize: 100 };
    const saved = JSON.parse(raw);
    return {
      theme: ["light", "dark"].includes(saved.theme) ? saved.theme : "system",
      palette: palettes.includes(saved.palette) ? saved.palette : Object.hasOwn(legacyPalettes, saved.season) ? legacyPalettes[saved.season] : "wasteland",
      prefersDark,
      autosave: saved.autosave === true,
      editableOnly: saved.editableOnly === true,
      targets: saved.targets === undefined ? null : saved.targets,
      fontSize: saved.fontSize === undefined ? 100 : checkedFontSize(saved.fontSize)
    };
  }

  function save(storage, preferences) {
    storage.setItem(storageKey, JSON.stringify({
      theme: preferences.theme,
      palette: preferences.palette,
      autosave: preferences.autosave === true,
      editableOnly: preferences.editableOnly === true,
      targets: preferences.targets,
      fontSize: checkedFontSize(preferences.fontSize ?? 100)
    }));
  }

  function apply(element, preferences) {
    const theme = preferences.theme === "system"
      ? (preferences.prefersDark ? "dark" : "light")
      : preferences.theme;
    element.dataset.theme = theme;
    element.dataset.palette = preferences.palette;
    return { theme };
  }

  const api = { load, save, apply, checkedFontSize, storageKey, palettes };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ApocalypterUi = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
