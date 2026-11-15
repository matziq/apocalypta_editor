(function (root) {
  "use strict";
  const storageKey = "apocalypta-editor-ui";
  const palettes = ["wasteland", "desert", "nuclear-winter", "apocalypse"];
  const legacyPalettes = { spring: "wasteland", summer: "desert", autumn: "apocalypse", winter: "nuclear-winter" };

  function load(storage, prefersDark) {
    const raw = storage.getItem(storageKey);
    if (!raw) return { theme: "system", palette: "wasteland", prefersDark, autosave: false, editableOnly: false, targets: null };
    const saved = JSON.parse(raw);
    return {
      theme: ["light", "dark"].includes(saved.theme) ? saved.theme : "system",
      palette: palettes.includes(saved.palette) ? saved.palette : Object.hasOwn(legacyPalettes, saved.season) ? legacyPalettes[saved.season] : "wasteland",
      prefersDark,
      autosave: saved.autosave === true,
      editableOnly: saved.editableOnly === true,
      targets: saved.targets === undefined ? null : saved.targets
    };
  }

  function save(storage, preferences) {
    storage.setItem(storageKey, JSON.stringify({
      theme: preferences.theme,
      palette: preferences.palette,
      autosave: preferences.autosave === true,
      editableOnly: preferences.editableOnly === true,
      targets: preferences.targets
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

  const api = { load, save, apply, storageKey, palettes };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ApocalypterUi = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
