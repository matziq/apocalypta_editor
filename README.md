# Apocalypter Save Editor

A dependency-free, offline editor for the **actual text-based Easy Save 3 / ES3PlayMaker format** used by Apocalypter. Open `index.html` in a current desktop browser. No installation, server, account, upload, or build step is required.

## Use

1. Close Apocalypter and back up your saves.
2. Open `index.html`, then choose `SaveGame1.es3` (or another slot) or `SaveSettings.es3`.
3. Use **Download original backup** to preserve the exact opened bytes.
4. Edit supported fields and review the before/after list. Invalid values block export.
5. Choose **Export edited copy**. The browser downloads `SaveGame1.edited.es3` or `SaveSettings.edited.es3`; it never overwrites a file or writes to the game installation.
6. With the game still closed, manually copy the edited file into the save folder under the original filename, keeping the backup somewhere separate. Load the matching slot. Restore the backup if needed.

Default Windows saves:

```text
%USERPROFILE%\AppData\LocalLow\SawyerK Games\Apocalypter
```

The game's installation folder is not the save folder. Do not copy edited files into `Apocalypter_Data`. Browser downloads go to your browser's configured download location; choose a different location in its save dialog if needed.

## Supported fields and limits

Only fields already present with the expected type are exposed. No new fields, objects, items, or references are invented.

| File | Editable fields |
| --- | --- |
| Game slot | `Player.value.objs.Health`, `Ammo.value.objs.armor` (0-100); inspected ammunition counts and capacities in `Ammo.value.objs` (nonnegative signed 32-bit integers) |
| Settings | Peaceful mode, disable thirst/hunger, disable fatigue, map cheat, disable insanity, head bob, FPS, footsteps, toggle ADS |
| Settings | Master, ambient, engine, boss, ambient music and main-menu music volumes (0-1); FOV (30-120) |

These are conservative **editor limits**, not claims about every limit enforced by the game. Saves whose supported values are outside these bounds are rejected rather than silently clamped. Inventory instances, weapon-loaded ammunition, world state, transforms, sanity triggers, save timestamps, and unverified settings remain untouched. Increasing a count does not create its associated inventory item.

## Format and compatibility

Inspected against local `SaveGame1.es3` and `SaveSettings.es3` on November 10, 2026. No explicit game-version or save-schema marker was observed; support is **structural**, not a guarantee for every release.

Settings use ordinary typed entries such as:

```json
{"peacefulMode":{"__type":"bool","value":false}}
```

PlayMaker data uses a nonstandard inline value, for example:

```text
{"Health":{"__type":"float"100}}
```

**Do not run the game save through JSON.parse / JSON.stringify.** The parser understands both formats and records exact scalar source spans. Serialization replaces only edited numeric or boolean tokens, preserving unknown content, 64-bit reference literals, ordering, whitespace, line endings, escapes, and a UTF-8 BOM. A no-change roundtrip returns identical text; backup download uses the exact original bytes.

Only UTF-8 text up to 20 MiB is accepted. Invalid UTF-8, encrypted/binary data, duplicate keys, malformed syntax, excessive nesting, unknown files, and incompatible recognized field types are rejected explicitly. Files are held in memory only. Reloading closes the document; the browser warns about pending changes.

## Development

Node.js 18+ is needed only for tests. There are no npm dependencies.

```powershell
npm test
npm run check
```

`save-format.js` contains the parser, verified field allowlist, validation, and lossless serializer. `app.js`, `index.html`, and `style.css` provide the offline UI. `tests\save-format.test.js` contains small synthetic fixtures matching the observed syntax; no user's save or proprietary game assets are included.

Game-load compatibility still requires a manual load in Apocalypter after making a backup; the editor does not launch or modify the game.
