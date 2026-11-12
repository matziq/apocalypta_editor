(function (root) {
  "use strict";
  const storageKey = "apocalypta-editor-ui";
  const seasons = ["spring", "summer", "autumn", "winter"];

  function load(storage, prefersDark) {
    const raw = storage.getItem(storageKey);
    if (!raw) return { theme: "system", season: "spring", prefersDark, autosave: false, editableOnly: false };
    const saved = JSON.parse(raw);
    return {
      theme: ["light", "dark"].includes(saved.theme) ? saved.theme : "system",
      season: seasons.includes(saved.season) ? saved.season : "spring",
      prefersDark,
      autosave: saved.autosave === true,
      editableOnly: saved.editableOnly === true
    };
  }

  function save(storage, preferences) {
    storage.setItem(storageKey, JSON.stringify({
      theme: preferences.theme,
      season: preferences.season,
      autosave: preferences.autosave === true,
      editableOnly: preferences.editableOnly === true
    }));
  }

  function apply(element, preferences) {
    const theme = preferences.theme === "system"
      ? (preferences.prefersDark ? "dark" : "light")
      : preferences.theme;
    element.dataset.theme = theme;
    element.dataset.season = preferences.season;
    return { theme };
  }

  const api = { load, save, apply, storageKey, seasons };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ApocalypterUi = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
