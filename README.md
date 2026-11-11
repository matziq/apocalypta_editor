# Apocalypter Save Editor

A dependency-free, offline editor for the **actual text-based Easy Save 3 / ES3PlayMaker format** used by Apocalypter. On Windows, double-click `run.bat` to start the local picker bridge and open the editor in your default browser. The bridge uses built-in Windows PowerShell and Windows Forms; no packages or installation are needed. Alternatively, open `index.html` directly in a current desktop browser.

The local Tools Menu discovers `run.bat` automatically under **Game Editors** as **Apocalypta Editor** (the display name comes from the repository folder). Refresh the menu's tool list if it was already open when the launcher was added. The launcher works from any working directory, including paths containing spaces.

## Use

1. Close Apocalypter and back up your saves.
2. Launch **Apocalypta Editor** from the Tools Menu or double-click `run.bat`. Click **Choose File** to open the current Windows user's `%USERPROFILE%\AppData\LocalLow\SawyerK Games\Apocalypter` folder. Choose `SaveGame1.es3` (or another slot) or `SaveSettings.es3`.
3. Use **Download original backup** to preserve the exact opened bytes.
4. Edit supported fields and review the before/after list. Invalid values block export.
5. Choose **Export edited copy**. The browser downloads `SaveGame1.edited.es3` or `SaveSettings.edited.es3`; it never overwrites a file or writes to the game installation.
6. With the game still closed, manually copy the edited file into the save folder under the original filename, keeping the backup somewhere separate. Load the matching slot. Restore the backup if needed.

The Windows launcher reads the current user's save folder (not a hardcoded account path). If that folder does not exist, the editor reports its full expected path. The local PowerShell bridge listens only on `127.0.0.1`, uses a per-launch random token and exact Host/Origin checks, serves only its fixed editor assets, and accepts only a user-selected `.es3` file up to 20 MiB. It does not expose arbitrary file reads, writes, or command execution. Close the **Apocalypter Save Editor picker bridge** PowerShell window when finished; it also stops after an hour without requests. It normally uses port 58643 so browser preferences persist across launches; if that port is occupied it uses another available port, whose browser preferences are separate.

When opening `index.html` directly instead of using `run.bat`, the browser file chooser is used and may not start in the game's save folder. This fallback has no native picker bridge; navigate to the save folder in the browser chooser. The browser chooser is also always available below the launcher's native button. Native failures display an error and advise relaunching with `run.bat` or using that fallback; canceling either chooser leaves the open save and its drafts unchanged.

The native dialog is titled **Choose an Apocalypter save**. It uses the classic Windows file dialog with an explicit initial directory on every opening, avoiding the modern shell dialog's remembered location. If Windows places it behind the browser, select it from the taskbar. The button shows an opening state until the dialog is completed or canceled. If the bridge has stopped, relaunch `run.bat`; a stale browser tab cannot restart it. After updating the launcher, close its old bridge window and launch `run.bat` again so the new picker code is used.

Default Windows saves:

```text
%USERPROFILE%\AppData\LocalLow\SawyerK Games\Apocalypter
```

The game's installation folder is not the save folder. Do not copy edited files into `Apocalypter_Data`. Browser downloads go to your browser's configured download location; choose a different location in its save dialog if needed.

## Appearance and vehicle actions

The theme button switches between light and dark; the initial appearance follows the operating system, and the selected theme is persisted locally. Choose Spring, Summer, Autumn, or Winter for a coordinated UI color palette. Each season has readable light and dark colors for page surfaces, text, controls, tables, warnings, and focus states. Seasonal appearance is UI-only, persists locally, and never alters or dirties a game save.

In the **Vehicles** section, select a saved vehicle and use **Repair components** or **Top off fuel** to stage changes to its supported, reference-matched component `Condition` fields (to 100%) or its verified fuel `Liquid` value (to its saved `LiquidCapacity`). The buttons are disabled if the selected vehicle has no eligible fields. Unrelated draft edits are preserved; an invalid target field is left unchanged. These actions use the existing before/after review, validation, and separate-copy export safeguards. They do not modify vehicle-body state, unlinked components, unknown fields, or the original save.

## Supported fields and limits

Only fields already present with the expected type are exposed. No new fields, objects, items, or references are invented.

| File | Editable fields |
| --- | --- |
| Game slot | `Player.value.objs.Health`, `Ammo.value.objs.armor` (0-100); inspected ammunition counts and capacities in `Ammo.value.objs` (nonnegative signed 32-bit integers) |
| Settings | Peaceful mode, disable thirst/hunger, disable fatigue, map cheat, disable insanity, head bob, FPS, footsteps, toggle ADS |
| Settings | Master, ambient, engine, boss, ambient music and main-menu music volumes (0-1); FOV (30-120) |
| Game slot | Existing item instances, names, exact references, active state, tags, saved parent references, and available local positions (inspection only) |
| Game slot | Existing item stack `Quantity` values (1-2,147,483,647) and verified item `Condition` scalars (0-100%) |
| Game slot | Existing `weaponsAmmoInGun` counters by weapon type (nonnegative signed 32-bit integers); these are **not** per-instance ammunition |
| Game slot | Existing vehicle fuel `Liquid` values, bounded by that vehicle's saved `LiquidCapacity` and labeled in L based on the game's player-facing units |
| Game slot | `Condition` (%) for existing engine, radiator, or exhaust components only when a unique saved parent/mount reference proves the association |

These are conservative **editor limits**, not claims about every limit enforced by the game. Saves whose supported values are outside these bounds are rejected rather than silently clamped. Object creation/deletion, ownership transfers, transforms, sanity triggers, save timestamps, and unverified settings remain untouched. Increasing a quantity changes only an existing saved stack; it does not create an item or infer that the object is carried.

The **Saved items** view lists existing item objects, including inactive objects, and reports their saved names, references, parent/container evidence, and any safely matched scalar values. A parent reference that cannot be resolved is explicitly shown as unknown; the save does not consistently prove whether such an object is carried, stored, or in the world. The editor therefore does not present this list as a player inventory count. Duplicate object references are marked ambiguous, and their scalar fields are withheld. The `akms(Clone)50` instance is labeled by its saved identifier (AKMS); it is not renamed AK47. Ammunition counters are presented only at their saved weapon-type scope.

The **Vehicles** view joins each vehicle to its scalar record by a unique matching ES3 reference. Fuel is editable only when both `Liquid` and `LiquidCapacity` are valid and consistent; the save has no explicit unit label, so L follows the game's player-facing units as described by the user. Engine, radiator, and exhaust condition is shown only when its saved transform parent matches that vehicle's corresponding mount. A separate vehicle-body damage/condition scalar was not found. Unresolved or ambiguous associations remain read-only with an explanation; the editor does not spawn, delete, or relink objects.

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

Node.js 18+ is needed only for tests. The Windows-only launcher self-test runs under Windows PowerShell; its test is skipped on other platforms. There are no npm dependencies.

```powershell
npm test
npm run check
```

`save-format.js` contains the parser, verified field allowlist, validation, and lossless serializer. `app.js`, `index.html`, and `style.css` provide the offline UI. `tests\save-format.test.js` contains small synthetic fixtures matching the observed syntax; no user's save or proprietary game assets are included.

Game-load compatibility still requires a manual load in Apocalypter after making a backup; the editor does not launch or modify the game.
