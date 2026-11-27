# Apocalypta Save Editor

An offline Windows Tkinter editor for the **actual text-based Easy Save 3 / ES3PlayMaker format** used by Apocalypter. Double-click `run.bat` or launch **Apocalypta Editor** from the local Tools Menu. The launcher starts `native_gui.py` using Python 3.12 when available, then falls back to another `py -3` installation or `python`. Python 3 is required; Node.js is not.

The Tools Menu discovers tools by finding `run.bat` in each immediate subfolder of **Game Editors**. Refresh the menu's tool list if it was already open before the launcher was added. `run.bat` works from any current directory and with spaces in the editor's path.

## Use

1. Close Apocalypter and back up your saves.
2. Launch **Apocalypta Editor** from the Tools Menu or double-click `run.bat`. Use **Browse...** to choose a save, or **Load newest** to open the most recently modified save from the current Windows user's `%USERPROFILE%\AppData\LocalLow\SawyerK Games\Apocalypter` folder.
3. Choose a task: **Player & Supplies**, **Vehicles**, **Saved Items**, **Item Map**, or **Settings**. Select a field, vehicle, or saved item to review and edit supported values. Bulk actions and targets are available where applicable.
4. Choose **Save changes** and confirm the overwrite, or enable **Autosave on change**. You can also use **More actions** to export an edited or original copy. Canceling a save/export does not write the source.
5. Keep Apocalypter closed while editing. Verify changes in-game only after preserving a backup.

The editor uses native Windows file dialogs and reads the selected `.es3` file directly. If the default save folder is missing, browse to the save location yourself. Appearance, font size, autosave, and editing preferences are stored locally in `editor_settings.json`; that per-user file is not tracked by Git.

Default Windows saves:

```text
%USERPROFILE%\AppData\LocalLow\SawyerK Games\Apocalypter
```

The game's installation folder is not the save folder. Do not copy edited files into `Apocalypter_Data`. When exporting a copy, choose a separate destination rather than overwriting the original save.

## Saves and backups

Before replacing a save, the editor creates a unique backup beside the selected original. It verifies the file has not changed since opening and uses a temporary file plus Windows replacement operations to avoid silently overwriting external edits. A failed backup or replacement is reported and does not silently fall back to an unsafe write. After a successful save, the editor adopts the saved content as its new baseline and clears pending edits. Exporting writes a separate copy and leaves the original unchanged.

## Appearance and vehicle actions

The theme button switches between light and dark; the initial appearance follows the operating system, and the selected theme is persisted locally. Choose Spring, Summer, Autumn, or Winter for a coordinated UI color palette. Each season has readable light and dark colors for page surfaces, text, controls, tables, warnings, and focus states. Seasonal appearance is UI-only, persists locally, and never alters or dirties a game save.

In the **Vehicles** section, select a saved vehicle and use **Repair components** or **Top off fuel** to stage changes to its supported, reference-matched component `Condition` fields (to 100%) or its verified fuel `Liquid` value (to its saved `LiquidCapacity`). The buttons are disabled if the selected vehicle has no eligible fields. Unrelated draft edits are preserved; an invalid target field is left unchanged. These actions use the existing before/after review and validation; nothing is written until a separate confirmed save or copy export. They do not modify vehicle-body state, unlinked components, or unknown fields.

## Supported fields and limits

Only fields already present with the expected type are exposed. No new fields, objects, items, or references are invented.

| File | Editable fields |
| --- | --- |
| Game slot | `Player.value.objs.Health`, `Ammo.value.objs.armor` (0-100); inspected ammunition counts and capacities in `Ammo.value.objs` (nonnegative signed 32-bit integers) |
| Game slot | `global.value.objs.Hunger`, `Thirst`, `Fatigue`, and `Radiation` (0-100, higher is worse), bounded by the inspected gameplay FSM clamps |
| Settings | Peaceful mode, disable thirst/hunger, disable fatigue, map cheat, disable insanity, head bob, FPS, footsteps, toggle ADS |
| Settings | Automatic gearbox, automatic clutch, normalized driving input, bloom, and sharpening; only the top-level keys in the opened settings file change |
| Settings | Master, ambient, engine, boss, ambient music and main-menu music volumes (0-1); FOV (30-120) |
| Game slot | Existing item instances, names, exact references, active state, tags, saved parent references, and available local positions (inspection only) |
| Game slot | Existing item stack `Quantity` values (1-2,147,483,647), per-item `ammo` counts (0-2,147,483,647), and verified item `Condition` scalars (0-100%), including loose world items and camp spares |
| Game slot | Per-item `Liquid` bounded by that item's valid saved `LiquidCapacity`, or an exact verified container prefab identity when capacity is absent; units are left as saved units |
| Game slot | Existing `weaponsAmmoInGun` counters by weapon type (nonnegative signed 32-bit integers); these are **not** per-instance ammunition |
| Game slot | Existing vehicle fuel `Liquid` values, bounded by that vehicle's saved `LiquidCapacity` and labeled in L based on the game's player-facing units |
| Game slot | Engine, radiator, and other existing part `Condition` values independently of mounting; attribution to a vehicle still requires a unique saved parent/mount reference |

These are conservative **editor limits**, not claims about every limit enforced by the game. Edits outside these bounds are rejected rather than silently clamped. An already-saved recognized numeric value outside its editor range is shown **read-only with its reason**, rather than blocking opening or unrelated edits. Its original token is preserved, including on export or save. A file containing only such read-only values can still be inspected and backed up. Incompatible recognized field types and ambiguous scalar structures still fail closed.

The survival values are the actual global scalars, not `Player.SanityAdd`/`SanityRemove` triggers. The inspected Hunger, Thirst, Fatigue, and Radiation FSMs clamp them to 0-100. Money remains read-only because purchase/debt bounds are unverified. Direct Sanity remains read-only: the active FSM clamps 0-100, but actual saves contain negative values, and disabled-insanity behavior is not yet resolved. The separate `global.PlayerHealth` copy remains read-only because its load precedence against `Player.Health` is unverified.

Additional driving/graphics toggles were traced to their individual `SaveSettings.es3` Load/Save and UI FSMs. Editing one changes only its explicit top-level settings key; similarly named copies under a slot's `global` wrapper are not synchronized or substituted. Driving copies are displayed read-only in a game slot with instructions to edit the settings file. This is not a promise that duplicate scopes are interchangeable.

Object creation/deletion, ownership transfers, transforms, sanity triggers, save timestamps, and unverified settings remain untouched. Increasing a quantity changes only an existing saved stack; it does not create an item or infer that the object is carried.

The **Saved items** view lists all existing item objects saved in `newGOArray_Items`, including inactive objects, loose engines, spare parts, supplies, and objects with unknown containers. Filter by saved name, instance reference, or location, then select **Edit values** beside an item. Its editor shows the exact saved instance ID and reference, local position when present, and its supported fields. Different instances with the same friendly name have separate controls and review entries. Changing the selected item or filter keeps other pending edits, including invalid drafts; **Reset all changes** restores every item.

World or camp items do not need to be attached to a vehicle or proven to belong to the player before their saved scalar values can be edited. The same mounted-part control is shared between the item and vehicle views, so edits stay consistent with **Repair components**. A parent reference that cannot be resolved is still shown as unknown; this list is not presented as a carried-inventory count.

When an item's saved parent appears uniquely in a matched vehicle's `es3Prefab.refs` map, its location says **Vehicle-associated**. This establishes reference-map membership only: it does not distinguish mounting from storage or prove player possession. Ambiguous maps stay unresolved. These associations never add component-repair or vehicle-top-off targets; those actions still require the existing explicit mount/tank evidence.

**Inspect** opens items with no safely editable fields and explains the limitation. Available unsupported scalar values are shown read-only with reasons. In the inspected saves, loose engines and radiators save `Condition`, and ammo boxes save their own `ammo` count. Many exhausts, wheels, and tools have no supported per-item scalar record. Engine, radiator, and growing-item liquids still lack verified bounds and remain read-only. Unknown timers, growth values, gearing, and purchase-state fields remain unchanged. This does not claim that every property of every prefab is stored or editable.

Three missing-capacity container mappings were verified against the installed game's actual prefab IDs and live `LiquidAmount` FSM variables:

| Saved prefab base name | Exact ES3 prefab ID | Capacity (saved units) |
| --- | --- | --- |
| `MotorOil_Can_Small` | `5864412579365047585` | 5 |
| `Gasoline_Can` | `6858519991654959144` | 20 |
| `Water_Can_Plastic` | `4230013134874058846` | 13 |

Fallback requires the exact base name and matching prefab IDs in **both** the saved object and its reference-matched scalar owner. The inspector displays the capacity source. A present capacity always takes precedence; an invalid present capacity is never replaced with a prefab guess. No `LiquidCapacity` field is inserted into the save. Other or conflicting prefab identities stay read-only. These mappings reflect the inspected game assets, not an assurance for future versions that reuse IDs with changed behavior.

Duplicate object references across item and vehicle arrays are marked ambiguous and withheld from editing. The `akms(Clone)50` instance is labeled by its saved identifier (AKMS); it is not renamed AK47. Its loaded-round counter remains weapon-type scoped; an ammo box's own `ammo` value is separately instance-scoped.

The **Vehicles** view joins each vehicle to its scalar record by a unique matching ES3 reference. Fuel is editable only when both `Liquid` and `LiquidCapacity` are valid and consistent; the save has no explicit unit label, so L follows the game's player-facing units as described by the user. Engine, radiator, and exhaust condition is shown only when its saved transform parent matches that vehicle's corresponding mount. A separate vehicle-body damage/condition scalar was not found. Unresolved or ambiguous associations remain read-only with an explanation; the editor does not spawn, delete, or relink objects.

## Format and compatibility

Inspected against local `SaveGame1.es3`, `SaveGame2.es3`, and `SaveSettings.es3`, with additional read-only assembly and prefab/FSM checks on November 12, 2026. No explicit save-schema marker was observed; support is **structural**, not a guarantee for every release.

Mapping evidence in the installed Unity 2020.3.49f1 `data.unity3d`: `sharedassets1.assets` oil/gasoline/water GameObjects 13681/8948/20904 have matching ES3Prefab IDs and `LiquidAmount` FSMs 105672/104007/108401; their live capacity variables are 5/20/13. `level1` survival FSMs 11831/11833/11842/11836 clamp Hunger/Thirst/Fatigue/Radiation from 0 to 100. Per-key settings Load/Save FSMs 13403/12636/11994/12123/13387 correspond to automatic gearbox/autoclutch/normalized input/bloom/sharpen. These assets were inspected in memory only; the editor needs no installation assets at runtime.

Settings use ordinary typed entries such as:

```json
{"peacefulMode":{"__type":"bool","value":false}}
```

PlayMaker data uses a nonstandard inline value, for example:

```text
{"Health":{"__type":"float"100}}
```

**Do not run the game save through JSON.parse / JSON.stringify.** The parser understands both formats and records exact scalar source spans. Serialization replaces only edited numeric or boolean tokens, preserving unknown content, 64-bit reference literals, ordering, whitespace, line endings, escapes, and a UTF-8 BOM. A no-change roundtrip returns identical text; backups preserve the exact original bytes.

Only UTF-8 text up to 20 MiB is accepted. Invalid UTF-8, encrypted/binary data, duplicate keys, malformed syntax, excessive nesting, unknown files, and incompatible recognized field types are rejected explicitly. Opening, editing, and exporting do not write to the source; only confirmed native **Save changes** writes it after the mandatory backup. Closing or opening another file with pending edits requires the editor to resolve those changes first.

## Development

Python 3.12 is the preferred runtime. Run the tests from the repository root with:

```powershell
python -m unittest discover tests
```

The tests use synthetic fixtures and temporary files; they do not write to actual game saves. The Windows launcher tests are skipped on non-Windows platforms. `build_exe.ps1` builds a standalone executable with the optional dependencies in `requirements-build.txt`.

Game-load compatibility still requires a manual load in Apocalypter after making a backup; the editor does not launch or modify the game.
