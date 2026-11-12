# Apocalypter Save Editor

An offline editor for the **actual text-based Easy Save 3 / ES3PlayMaker format** used by Apocalypter. On Windows, double-click `run.bat` to start the local picker bridge and open the editor in your default browser. The picker uses built-in Windows PowerShell and Windows Forms. Saving changes back to the original additionally requires Node.js 18+ to validate edits using the same lossless parser as the UI; there are no npm dependencies. Alternatively, open `index.html` directly in a current desktop browser for export-only editing.

The local Tools Menu discovers `run.bat` automatically under **Game Editors** as **Apocalypta Editor** (the display name comes from the repository folder). Refresh the menu's tool list if it was already open when the launcher was added. The launcher works from any working directory, including paths containing spaces.

## Use

1. Close Apocalypter.
2. Launch **Apocalypta Editor** from the Tools Menu or double-click `run.bat`. It opens maximized, automatically opens the most recently modified numbered `SaveGameN.es3` in the **current Windows user's** `%USERPROFILE%\AppData\LocalLow\SawyerK Games\Apocalypter` folder, and verifies an exact-byte backup before editing is available. The file, loaded version's local modification time, and backup path appear on the left. It never uses a remembered picker directory, browser downloads, the repository, or an output folder for normal autoload.
3. Use **Choose File** to open another game slot or `SaveSettings.es3` in that same save folder; manually selected native files also receive an immediate verified backup. Optionally use **Download original backup** to download the editor's exact baseline bytes (updated after each successful save).
4. Edit supported fields and review the before/after list. Invalid values block saving and export.
5. For a native-opened file, choose **Save** in the sticky header or left panel (or **Save changes** below the fields), check the exact destination in the confirmation, and confirm replacement. Its current bytes are backed up before replacement; an identical verified load-time backup may be reused. Cancel makes no writes. Alternatively, explicitly enable **Autosave on change** as described below.
6. Or choose **Export edited copy** to download a separate `.edited.es3` file. Browser-opened files support only this option; with the game closed, manually copy an exported file to the original filename after backing up that original.

Autoload accepts only numbered slot names matching `^SaveGame[0-9]+\.es3$`, ordered by last-modified time (name breaks ties). Settings, `.edited.es3` exports, and backups cannot outrank a game slot. No slots, a missing folder, an unreadable newest slot, an invalid newest slot, or a failed backup produces an explicit message and manual chooser; the editor never silently opens an older slot.

The Windows launcher reads the current user's save folder (not a hardcoded account path). If that folder does not exist, the editor reports its full expected path. The local PowerShell bridge listens only on `127.0.0.1`, uses a per-launch random token and exact Host/Origin checks, serves only its fixed editor assets, and accepts only numbered slots from that fixed folder or a native-selected `.es3` file up to 20 MiB. Writes are bound server-side to an opaque handle issued for the native-opened file; client-supplied destination paths are rejected. It does not expose arbitrary file reads, writes, or command execution. Close the picker bridge window when finished; it also stops after an hour without requests. It normally uses port 58643 so browser preferences persist across launches; if that port is occupied it uses another available port, whose browser preferences are separate.

When opening `index.html` directly instead of using `run.bat`, only **Browser picker (folder not controlled)** is available. Its folder is controlled by the browser and may start at your Windows profile root; navigate to the save folder yourself. The working native launch shows **only the native Choose File button**, not a second browser chooser. The explicitly limited browser fallback appears only if the native connection fails. It is not evidence that the native picker worked. Canceling either chooser leaves the open save and its drafts unchanged.

The launcher requests a new maximized window for Chromium browsers and uses a bounded Windows maximize request for the editor-titled window, including default-browser fallbacks. Launching and maximization were observed in Microsoft Edge. Other browsers/OS restrictions may prevent the maximize request; the bridge warns rather than preventing editing. Directly opening `index.html` cannot force the browser window maximized.

The native dialog is titled **Choose an Apocalypter save**. It uses the classic Windows file dialog with an explicit initial directory on every opening, avoiding the modern shell dialog's remembered location. It is owned by a visible, topmost **Apocalypter Save Editor - file selection** window so it is discoverable rather than hidden behind the browser. The button first checks the authenticated bridge connection; a stopped, outdated, or unresponsive bridge produces instructions within five seconds instead of waiting indefinitely. Check the taskbar for an already open dialog before relaunching: this small single-threaded bridge waits for selection or cancellation while its dialog is active. After updating or relaunching, use the **newly opened browser URL**, not an old tab: a stale tab cannot restart its old bridge.

Default Windows saves:

```text
%USERPROFILE%\AppData\LocalLow\SawyerK Games\Apocalypter
```

The game's installation folder is not the save folder. Do not copy edited files into `Apocalypter_Data`. Browser downloads go to your browser's configured download location; choose a different location in its save dialog if needed.

## Confirmed saves and automatic backups

Every native save, manual or automatic, validates the proposed scalar edits again on the server and checks the original's SHA-256 against the version opened or last saved by this editor. An external change causes refusal: reopen the current file instead of overwriting another program's work. Close the game while editing.

Backups are stored **beside the selected original**, named like `SaveGame1.es3.20261111T133000123Z.<unique-id>.original.bak` (UTC filename stamp). Opening or refreshing verifies a load-time backup of the exact baseline bytes. An existing sibling `.original.bak` is reused only after matching size and SHA-256; otherwise a unique new backup is created and verified. Byte-identical launches do not pile up duplicate backups. Failure leaves editing unavailable. Manual saves preserve the exact preceding bytes, reusing the load-time backup only when those bytes are identical to it; otherwise they create a new backup. Older backups are never overwritten or deleted. Failed replacements retain the backup.

After backing up, the bridge writes and flushes a uniquely named temporary file in the same directory, checks the original again, then uses Windows atomic file replacement. A filesystem that cannot support that operation causes an explicit error rather than a non-atomic fallback. After success, the editor adopts the saved bytes as its new baseline and clears the pending changes. If a connection fails after the server may have written, reopen the source to check its current state before retrying.

### Autosave on change

The checkbox is **off by default** and persists locally. It is available only for native-bound files with Node.js 18+ and a verified load-time backup. Checking it is consent to overwrite the exact displayed source without a confirmation for each automatic save. Committed changes (change/blur/Enter, toggles, and completed bulk actions) save after a short debounce, not on every keystroke. Writes are serialized; committed edits during a pending save are coalesced into the next write, while newer drafts, focus, selection, and filters remain intact. Each bulk action is one coherent change.

Invalid drafts pause autosave until corrected and committed. Stale-file, validation, backup, permission, and connection failures stop automatic retries and keep the drafts. Resolve the cause before toggling autosave off/on or reopening. Unchecking cancels queued writes and leaves unsaved drafts staged; it cannot cancel an atomic write already sent. The status shows the local completion time. Autosaves reuse the verified load-time backup, **not a new backup for each change**; they refuse to write if that backup is missing or changed. The original opened version remains recoverable, but intermediate autosaved versions are not individually backed up. Manual Save always retains its exact-destination confirmation and preceding-bytes backup behavior.

Browser-opened files remain export-only: no automatic disk backup, autosave, or in-place Save. Appearance changes and filters never change the save or trigger autosave.

## Help, bulk actions, and appearance

Every editable field, read-only scalar, and settings toggle has a **?** help trigger with a per-field accessible description. Hover, keyboard focus, or tap reveals its effect, units/range/direction where known, scope, and any read-only reason. Unverified effects are explicitly identified rather than guessed. Help stays hoverable, fits the viewport, and closes with Escape; changing sections dismisses obsolete help.

**Maximize all** in **Player & supplies** stages editable Health, Armor, and every supply/ammo counter to exactly **100**, including lowering values above 100. Hunger, Thirst, Fatigue, and Radiation become **0**. Read-only Money, Sanity, duplicate global health, items, and vehicles are untouched. Invalid target drafts are skipped and named. Review shows the exact changes; autosave applies only when explicitly enabled.

**Show editable items only** combines with the Saved items text search, persists locally, and starts off by default. Eligible items have at least one currently editable field, matching the **Edit values** action. Counts retain the actual total even when no items match. Filtering does not discard hidden drafts.

The theme button switches between light and dark; the initial appearance follows the operating system, and the selected theme is persisted locally. Choose Spring, Summer, Autumn, or Winter for a coordinated UI color palette. Each season has readable light and dark colors for page surfaces, text, controls, tables, warnings, and focus states. Seasonal appearance is UI-only, persists locally, and never alters or dirties a game save.

In the **Vehicles** section, select a saved vehicle and use **Repair components** or **Top off fuel** to stage changes to its supported, reference-matched component `Condition` fields (to 100%) or its verified fuel `Liquid` value (to its saved `LiquidCapacity`). **Repair and top off fuel for all vehicles** stages those same targets across every vehicle, reporting missing mappings and invalid targets skipped (including vehicles with no verified repair target). The selected buttons are disabled if no eligible fields exist. Unrelated draft edits are preserved; an invalid target field is left unchanged. These actions use the existing before/after review and validation; they write only through an explicitly enabled autosave or a separate confirmed Save, or export. They do not modify vehicle-body state, unlinked components, or unknown fields.

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

**Do not run the game save through JSON.parse / JSON.stringify.** The parser understands both formats and records exact scalar source spans. Serialization replaces only edited numeric or boolean tokens, preserving unknown content, 64-bit reference literals, ordering, whitespace, line endings, escapes, and a UTF-8 BOM. A no-change roundtrip returns identical text; backup download uses the exact original bytes.

Only UTF-8 text up to 20 MiB is accepted. Invalid UTF-8, encrypted/binary data, duplicate keys, malformed syntax, excessive nesting, unknown files, and incompatible recognized field types are rejected explicitly. Native opening creates/verifies an adjacent backup without modifying the source. Only confirmed manual Save or explicitly enabled autosave replaces the source. Browser opening/export never writes it. The browser warns about pending drafts or an in-flight save before leaving; native refresh autoloads the newest slot again with backup verification.

## Development

Node.js 18+ is needed for tests and native in-place save validation; the native picker and export-only editor work without it. Windows-only launcher and atomic-save tests run under Windows PowerShell and are skipped elsewhere. There are no npm dependencies.

```powershell
npm test
npm run check
```

`APOCALYPTER_TEST_OUTPUT` can specify the directory for disposable synthetic write-test files (otherwise the OS temporary directory is used). The tests never write to actual game saves.

For isolated native/browser validation, `run.bat -NoLaunch -SaveFolderOverride "D:\AI_Output\Apocalypta_editor\save-tests\<synthetic-folder>"` serves only that CLI-specified fixture folder. The override is **test-only**, not a remembered user preference or HTTP parameter; normal Tools Menu/run.bat startup always derives the current Windows user's real save folder. Never test startup/autosave against real saves. The real batch integration test verifies every fixed static asset, authorization, exact Host/Origin, newest-slot exclusions, backup deduplication, and synthetic autosave writes. Delayed-response UI tests cover coalescing, invalid/uncommitted drafts, failure latching, baseline summaries, and coherent bulk edits.

`save-format.js` contains the parser, verified field allowlist, validation, and lossless serializer. `app.js`, `index.html`, and `style.css` provide the offline UI. `tests\save-format.test.js` contains small synthetic fixtures matching the observed syntax; no user's save or proprietary game assets are included.

Game-load compatibility still requires a manual load in Apocalypter after making a backup; the editor does not launch or modify the game.
