# Apocalypter Save Editor

An offline editor for the **actual text-based Easy Save 3 / ES3PlayMaker format** used by Apocalypter. On Windows, double-click `run.bat` to start the local picker bridge and open the editor in your default browser. The picker uses built-in Windows PowerShell and Windows Forms. Saving changes back to the original additionally requires Node.js 18+ to validate edits using the same lossless parser as the UI; there are no npm dependencies. Alternatively, open `index.html` directly in a current desktop browser for export-only editing.

The local Tools Menu discovers `run.bat` automatically under **Game Editors** as **Apocalypta Editor** (the display name comes from the repository folder). Refresh the menu's tool list if it was already open when the launcher was added. The launcher works from any working directory, including paths containing spaces.

## Use

1. Close Apocalypter.
2. Launch **Apocalypta Editor** from the Tools Menu or double-click `run.bat`. It opens maximized and automatically opens the most recently modified numbered `SaveGameN.es3` in the **current Windows user's** `%USERPROFILE%\AppData\LocalLow\SawyerK Games\Apocalypter` folder. With a positive backup limit (default **3**), it verifies an exact-byte backup before editing is available; **0 disables backups**. The file, loaded version's local modification time, and recovery status appear on the left. It never uses a remembered picker directory, browser downloads, the repository, or an output folder for normal autoload.
3. Use **Choose File** to open another game slot or `SaveSettings.es3`; the same backup policy applies to manually selected native files. Set **Backups to keep per save** and click **Apply backup limit** to change the persistent limit. The confirmation explains removal and zero-mode recovery risk. Optionally use **Download original backup** to download the editor's exact baseline bytes (updated after each successful save).
4. Edit supported fields and review the before/after list. Invalid values block saving and export.
5. For a native-opened file, choose **Save** in the sticky header or left panel (or **Save changes** below the fields), check the exact destination and backup policy in the confirmation, and confirm replacement. With a positive limit its current bytes are backed up before replacement; an identical verified backup may be reused. **With 0, no recovery backup is created.** Cancel makes no writes. Alternatively, explicitly enable **Autosave on change** as described below.
6. Or choose **Export edited copy** to download a separate `.edited.es3` file. Browser-opened files support only this option; with the game closed, manually copy an exported file to the original filename after backing up that original.

Autoload accepts only numbered slot names matching `^SaveGame[0-9]+\.es3$`, ordered by last-modified time (name breaks ties). Settings, `.edited.es3` exports, and backups cannot outrank a game slot. No slots, a missing folder, an unreadable newest slot, an invalid newest slot, or a failed backup produces an explicit message and manual chooser; the editor never silently opens an older slot.

The Windows launcher reads the current user's save folder (not a hardcoded account path). If that folder does not exist, the editor reports its full expected path. The local PowerShell bridge listens only on `127.0.0.1`, uses a per-launch random token and exact Host/Origin checks, serves only its fixed editor assets, and accepts only numbered slots from that fixed folder or a native-selected `.es3` file up to 20 MiB. Writes are bound server-side to an opaque handle issued for the native-opened file; client-supplied destination paths are rejected. It does not expose arbitrary file reads, writes, or command execution. Close the picker bridge window when finished; it also stops after an hour without requests. It normally uses port 58643; if occupied it uses another available port. Appearance/autosave/filter browser preferences are separate on a different port, but the **native backup limit survives port changes**.

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

Backups are stored **beside the selected original**, named like `SaveGame1.es3.20261111T133000123Z.<32-lowercase-hex-GUID>.original.bak` (UTC filename stamp). With a positive limit, opening or refreshing verifies a backup of the exact baseline bytes. An eligible existing backup is reused only after matching size and SHA-256; otherwise a unique new backup is created and verified. Byte-identical launches do not pile up duplicate backups. Backup failure leaves editing unavailable. Manual saves preserve the exact preceding bytes, reusing an identical verified backup or creating one. Failed replacements retain that backup.

### Backup retention: default 3, or your chosen count

**Backups to keep per save** accepts a nonnegative whole number (0 through JavaScript's safe-integer limit, 9,007,199,254,740,991). **Apply backup limit** saves the setting and immediately applies it to the native-opened file without saving, resetting, or rebuilding any draft controls. Other files use the same setting when next opened or saved; the editor does not sweep unopened save files. The limit is **per exact original filename**, not shared across slots. Reducing the limit explicitly confirms removal. **0 removes eligible existing backups and disables all new automatic backups**, including manual-save and autosave backups. It provides no automatic recovery if a save becomes damaged or an edit is regretted; zero is never silently replaced with a hidden minimum of one. Separately downloaded copies remain available and are never managed by this control.

The native setting is stored at `%LOCALAPPDATA%\ApocalypterSaveEditor\settings.json`, not in browser localStorage, the game installation, or game save data. It survives browser changes, relaunches, and fallback localhost ports. A missing setting defaults to 3; malformed, unreadable, unsupported, or linked settings **block automatic opening/pruning/saving instead of silently defaulting**. Set a valid count and Apply to explicitly recover. The bridge reads this setting **before** automatic or manual opening. It serializes policy operations across launcher processes and locks the acknowledged setting during save; if another tab/process changes the limit, a stale tab's Save/autosave is refused before writing or pruning. Reapply your chosen limit in that tab and resolve any error before resuming autosave.

Pruning recognizes only regular, single-link sibling files in the exact editor-generated timestamp/GUID naming format for that original. Invalid dates, similarly named files, other originals, plain `.original.bak` downloads, directories, symbolic links, junctions, hard links, and unrelated files are not deleted or reused. A small built-in C# helper opens the actual entry without following reparse points, verifies its file identity/size/modification time again, and deletes through that same handle; an externally changed candidate is left intact with an error. This avoids check-then-delete link substitution. Exact-format historical editor backups are eligible; custom/renamed backups deliberately are not.

When retention is positive, the newly verified recovery point is **always protected**, even if it is an older byte-identical backup being reused. Remaining slots keep the newest filename timestamps first, with full path breaking ties. At a limit of 1, each manual save may rotate the protected point to its immediately preceding bytes; subsequent autosaves protect that current point rather than referring to a pruned old path. Autosave does not create per-change history. Switching from 0 to a positive count verifies a recovery point of the current disk baseline before pruning or allowing backed-up writes. Original hashes, drafts, filters, inline selection, and focus are preserved; changing a backup count never commits an uncommitted draft.

With Node.js available, native opening validates UTF-8/format/schema using the same parser **before creating or pruning backups**. A malformed/unsupported newest slot is rejected without touching its historical backups, and no older slot is silently substituted. Declining to discard drafts happens before any picker/open request, so a rejected open cannot create/prune another file's backups. Without Node.js, native inspection/export still works: a positive limit creates/verifies the baseline copy, but destructive pruning is deferred with a visible warning because server validation is unavailable. At 0, it creates no backup and still defers deletion. The limit is not claimed to have been enforced in that mode.

Pruning errors are visible and may leave more copies than the chosen limit. The verified recovery point remains protected, failed candidates remain, and safe remaining candidates can still be cleaned. Resolve access/external-change issues and Apply again; autosave pauses while cleanup is incomplete. If replacement succeeded but later pruning failed, the UI says **Save succeeded, but backup cleanup is incomplete**, adopts the saved baseline, and preserves newer drafts; it does not pretend the save failed or retry it automatically.

After backing up, the bridge writes and flushes a uniquely named temporary file in the same directory, checks the original again, then uses Windows atomic file replacement. A filesystem that cannot support that operation causes an explicit error rather than a non-atomic fallback. After success, the editor adopts the saved bytes as its new baseline and clears the pending changes. If a connection fails after the server may have written, reopen the source to check its current state before retrying.

### Autosave on change

The checkbox is **off by default** and persists locally. It is available only for native-bound files with Node.js 18+ and either a verified recovery point or an explicitly configured zero-backup policy. Checking it is consent to overwrite the exact displayed source without a confirmation for each automatic save. Committed changes (change/blur/Enter, toggles, and completed bulk actions) save after a short debounce, not on every keystroke. Writes are serialized; committed edits during a pending save are coalesced into the next write, while newer drafts, focus, selection, and filters remain intact. Each bulk action is one coherent change.

Invalid drafts pause autosave until corrected and committed. Stale-file, validation, backup, permission, and connection failures stop automatic retries and keep the drafts. Resolve the cause before toggling autosave off/on or reopening. Unchecking cancels queued writes and leaves unsaved drafts staged; it cannot cancel an atomic write already sent. The status shows the local completion time. With positive retention, autosaves reuse the verified recovery point, **not a new backup for each change**, and refuse to write if it is missing or changed. Manual Save or explicitly applying a positive policy can advance that recovery point; intermediate autosaved versions are not individually backed up. **With 0, there is no recovery point or backup-presence requirement.** Manual Save always retains its exact-destination confirmation.

Browser-opened files remain export-only: no automatic disk backup, autosave, or in-place Save. Appearance changes and filters never change the save or trigger autosave.

## Help, bulk actions, and appearance

Every editable field, read-only scalar, and settings toggle has a **?** help trigger with a per-field accessible description. Hover, keyboard-focus, or tap the **? trigger** to reveal its effect, units/range/direction where known, scope, and any read-only reason. Focusing or pointing at the editing control dismisses help rather than opening a popup over its input/spin buttons; its screen-reader description remains available. Unverified effects are explicitly identified rather than guessed. Help stays hoverable, fits the viewport, and closes with Escape; changing sections dismisses obsolete help. Live autosave status changes do not scroll-anchor the page to the sidebar, so numeric controls stay stationary while editing.

**Maximize all** in **Player & supplies** stages editable Health, Armor, and supply/ammo counters to exactly **100**, Nuts to **1,000,000**, and Hunger, Thirst, Fatigue, and Radiation to **0**. It may lower values above those targets. Read-only Sanity, duplicate global health, items, and vehicles are untouched. Invalid target drafts are skipped and named. Review shows the exact changes; autosave applies only when explicitly enabled.

The separate **Maximize all** button on **Saved items**, beside its filters, stages every editable item's `Condition` to 100 and `Liquid` to its verified capacity, including exact-prefab container bounds and mounted part conditions. It also sets verified bandage quantities and ammo-box counts to **100**, verified repair-kit quantities to **999**, and weapon-type loaded-round counters to **100**. These requested counts are not verified game maxima: they may exceed normal capacity, and higher counts are lowered. It applies to all saved items, even those hidden by either filter. Unrecognized or ambiguous item counters and invalid drafts are skipped; changed/skipped counts and preserved read-only values are reported. This stages one coherent autosave transaction when autosave is enabled, or leaves changes for manual Save/export.

**Show editable items only** combines with the Saved items text search, persists locally, and starts off by default. Eligible items have at least one currently editable field, matching the **Edit values** action. Counts retain the actual total even when no items match. Filtering does not discard hidden drafts.

The theme button switches between light and dark; the initial appearance follows the operating system, and the selected theme is persisted locally. Choose Spring, Summer, Autumn, or Winter for a coordinated UI color palette. Each season has readable light and dark colors for page surfaces, text, controls, tables, warnings, and focus states. Seasonal appearance is UI-only, persists locally, and never alters or dirties a game save.

In the **Vehicles** section, select a saved vehicle and use **Repair components** or **Top off fuel** to stage changes to its supported, reference-matched component `Condition` fields (to 100%) or its verified fuel and uniquely mounted engine-oil and radiator liquids (to their verified capacities). **Repair and top off fuel for all vehicles** stages those same targets across every vehicle, reporting missing mappings and invalid targets skipped (including vehicles with no verified repair target). Other mounted liquids without a verified mapping and loose cargo are not included. The selected buttons are disabled if no eligible fields exist. Unrelated draft edits are preserved; an invalid target field is left unchanged. These actions use the existing before/after review and validation; they write only through an explicitly enabled autosave or a separate confirmed Save, or export. They do not modify vehicle-body state, unlinked components, or unknown fields.

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
| Game slot | Per-item `Liquid` bounded by that item's valid saved `LiquidCapacity`, or an exact verified prefab identity when capacity is absent; units are left as saved units |
| Game slot | Existing `weaponsAmmoInGun` counters by weapon type (nonnegative signed 32-bit integers); these are **not** per-instance ammunition |
| Game slot | Existing vehicle fuel `Liquid` values, bounded by that vehicle's saved `LiquidCapacity` and labeled in L based on the game's player-facing units |
| Game slot | Engine, radiator, and other existing part `Condition` values independently of mounting; attribution to a vehicle still requires a unique saved parent/mount reference |

These are conservative **editor limits**, not claims about every limit enforced by the game. Edits outside these bounds are rejected rather than silently clamped. An already-saved recognized numeric value outside its editor range is shown **read-only with its reason**, rather than blocking opening or unrelated edits. Its original token is preserved, including on export or save. A file containing only such read-only values can still be inspected and backed up. Incompatible recognized field types and ambiguous scalar structures still fail closed.

The survival values are the actual global scalars, not `Player.SanityAdd`/`SanityRemove` triggers. The inspected Hunger, Thirst, Fatigue, and Radiation FSMs clamp them to 0-100. **Player & supplies → Currency → Nuts** edits the existing `global.Money` integer, used by the HUD and purchases. The editor accepts whole numbers from 0 to 1,000,000; this is a conservative editor limit, **not a verified game maximum**, and in-game earnings can increase the value afterward. Existing values outside the editor's range remain read-only and unchanged. Player Maximize all sets Nuts to 1,000,000. Direct Sanity remains read-only: the active FSM clamps 0-100, but actual saves contain negative values, and disabled-insanity behavior is not yet resolved. The separate `global.PlayerHealth` copy remains read-only because its load precedence against `Player.Health` is unverified.

Additional driving/graphics toggles were traced to their individual `SaveSettings.es3` Load/Save and UI FSMs. Editing one changes only its explicit top-level settings key; similarly named copies under a slot's `global` wrapper are not synchronized or substituted. Driving copies are displayed read-only in a game slot with instructions to edit the settings file. This is not a promise that duplicate scopes are interchangeable.

Object creation/deletion, ownership transfers, transforms, sanity triggers, save timestamps, and unverified settings remain untouched. Increasing a quantity changes only an existing saved stack; it does not create an item or infer that the object is carried.

The **Saved items** view lists all existing item objects saved in `newGOArray_Items`, including inactive objects, loose engines, spare parts, supplies, and objects with unknown containers. Filter by saved name, instance reference, or location, then select **Edit values** beside an item. Its editor expands **directly under that row**, without jumping to the top of the list; clicking the same button collapses it. Switching to another item keeps the clicked row in place even when an expanded item above it collapses. The inline region shows the exact saved instance ID/reference, local position when present, supported fields, capacity evidence, read-only reasons, and help triggers. It fits within the 390px table's horizontal scrolling area.

Different instances with the same friendly name have separate controls and review entries. Changing the selected item or filter keeps other pending edits, including invalid drafts. Filtering hides/restores an expansion with its row without discarding it. Autosave updates saved summaries without closing/rebuilding the inline editor, changing focus, or dropping drafts. Manual Save and **Reset all changes** reopen the still-selected item and retain the text filter; Reset restores every field to the current saved baseline.

World or camp items do not need to be attached to a vehicle or proven to belong to the player before their saved scalar values can be edited. The same mounted-part control is shared between the item and vehicle views, so edits stay consistent with **Repair components**. A parent reference that cannot be resolved is still shown as unknown; this list is not presented as a carried-inventory count.

When an item's saved parent appears uniquely in a matched vehicle's `es3Prefab.refs` map, its location says **Vehicle-associated** unless a specific mount is independently verified. General reference-map membership does not distinguish mounting from storage or prove player possession. Ambiguous maps stay unresolved. General associations never add component-repair or vehicle-top-off targets; those actions require explicit mount/tank evidence.

**Inspect** opens items with no safely editable fields and explains the limitation. Available unsupported scalar values are shown read-only with reasons. In the inspected saves, loose engines and radiators save `Condition`, and ammo boxes save their own `ammo` count. The pictured Small wheel T1, Small wheel T2, and Armored Street Wheel save condition as a standalone float keyed by the exact instance name: these are editable only with a unique item name and reference and the verified matching prefab. Their scalar has no owner reference, and its name alone does not establish mounting. Use **Saved items → Edit values** or that page's **Maximize all**; Vulture wheels at uniquely resolved wheel-hinge parents are also included in vehicle repair. A wheel at the physics-lock parent is not treated as mounted. Other wheels, exhausts, tools, unverified liquids, and growing-item liquids may remain read-only. Grip, radiator cooling, and supercharger power are prefab/gameplay properties, not verified per-instance saved scalars. Unknown timers, growth values, gearing, and purchase-state fields remain unchanged.

Missing-capacity mappings were verified against the installed game's actual prefab IDs and `LiquidAmount` FSM variables:

| Saved prefab base name | Exact ES3 prefab ID | Capacity (saved units) |
| --- | --- | --- |
| `MotorOil_Can_Small` | `5864412579365047585` | 5 |
| `Gasoline_Can` | `6858519991654959144` | 20 |
| `Water_Can_Plastic` | `4230013134874058846` | 13 |
| `Diesel_Barrel` | `608293236901033563` | 150 |
| `MotorOil_Can_Big` | `5623108999256334996` | 30 |
| `radiator_medium_race` | `2169926468007209799` | 14 |
| `Diesel_Can` | `9030660213298172268` | 20 |
| `radiator_medium` | `8205777586039224731` | 9 |
| `radiator_motorcycle` | `2705209445545947911` | 3 |
| `radiator_small` | `5669857674379848146` | 6 |
| `radiator_truck` | `5421126813566889844` | 18 |
| `radiator_truck_big` | `2031828300969920981` | 24 |
| `radiator_truck_ultra` | `3587043590766116916` | 28 |
| `594cc I2 23HP 39Nm Gasoline` | `3634296406011431456` | 2 |
| `3L I5 87HP 172Nm Diesel` | `6089072345908897270` | 5.1 |
| `3.8L V6 165HP 285Nm Gasoline` | `5945172545298182391` | 6 |
| `3.7L I6 145HP 292Nm Gasoline` | `624016700395080820` | 5.3 |
| `5.8L I6 120HP 356Nm Diesel` | `7861181815379186` | 7 |
| `18L V8 335HP 1700Nm Diesel` | `4167795411855106502` | 16 |
| `2.8L V6 115HP 183Nm Gasoline` | `7876660059110608148` | 5 |
| `5.2L V8 230HP 340Nm Gasoline` | `9035087652290305727` | 7 |
| `7L V8 355HP 569Nm Gasoline` | `5126044545507921876` | 9 |
| `1.3L v2 55HP 94Nm Gasoline` | `884780215855984285` | 3.3 |
| `1.2L I4 59HP 87Nm Gasoline` | `6758790462075466819` | 3.3 |
| `2.3L I4 89HP 165Nm Gasoline` | `374403439354623823` | 3.9 |
| `7L I6 165HP 542Nm Diesel` | `1298474360822390476` | 7.5 |
| `8.2L V8 400HP 746Nm Gasoline` | `4674809622967151223` | 10 |
| `11.5L V12 274HP 854Nm Gasoline` | `873555013045931076` | 13 |

Fallback requires the exact base name and matching prefab IDs in **both** the saved object and its reference-matched scalar owner. The inspector displays the capacity source. A present capacity always takes precedence; an invalid present capacity is never replaced with a prefab guess. No `LiquidCapacity` field is inserted into the save. Other or conflicting prefab identities stay read-only. These mappings reflect the inspected game assets, not an assurance for future versions that reuse IDs with changed behavior.

Duplicate object references across item and vehicle arrays are marked ambiguous and withheld from editing. The `akms(Clone)50` instance is labeled by its saved identifier (AKMS); it is not renamed AK47. Its loaded-round counter remains weapon-type scoped; an ammo box's own `ammo` value is separately instance-scoped.

The **Vehicles** view joins each vehicle to its scalar record by a unique matching ES3 reference. Fuel is editable only when both `Liquid` and `LiquidCapacity` are valid and consistent; the save has no explicit unit label, so L follows the game's player-facing units as described by the user. Engine, radiator, and exhaust condition is shown only when its saved transform parent matches that vehicle's corresponding mount. The three verified wheel prefabs also appear when their unique parent matches a verified Vulture wheel hinge and both vehicle prefab identities agree. A separate vehicle-body damage/condition scalar was not found. Unresolved or ambiguous associations remain read-only with an explanation; the editor does not spawn, delete, or relink objects.

## Format and compatibility

Inspected against local `SaveGame1.es3`, `SaveGame2.es3`, and `SaveSettings.es3`, with additional read-only assembly and prefab/FSM checks on November 12, 2026. No explicit save-schema marker was observed; support is **structural**, not a guarantee for every release.

Mapping evidence in the installed Unity 2020.3.49f1 `data.unity3d`: `sharedassets1.assets` oil/gasoline/water GameObjects 13681/8948/20904 have matching ES3Prefab IDs and `LiquidAmount` FSMs 105672/104007/108401; their live capacity variables are 5/20/13. `level1` survival FSMs 11831/11833/11842/11836 clamp Hunger/Thirst/Fatigue/Radiation from 0 to 100. Per-key settings Load/Save FSMs 13403/12636/11994/12123/13387 correspond to automatic gearbox/autoclutch/normalized input/bloom/sharpen. These assets were inspected in memory only; the editor needs no installation assets at runtime.

Additional `sharedassets1.assets` evidence: Diesel Barrel and big oil can GameObjects 31081/32544 have `LiquidAmount` FSMs 112013/112440 with capacities 150/30; the medium race radiator GameObject 24474 has a cap-child `LiquidAmount` FSM 109626 with capacity 14. Wheel GameObjects 19728/24165/10145 use `saveItemVar` FSMs 103785/103388/104446 to save and load `Condition` by object name; their HUD FSMs 107940/109448/104440 identify the three wheel labels. Vulture GameObject 9130's ES3Prefab 108980 maps the verified wheel-hinge keys to four transforms, separately from its PhysicsLock transform. A current save value matching a screenshot is suggestive, not proof of the same instance.

Additional liquid evidence: engine GameObjects 8943/12433 have cap-child `LiquidAmount` FSMs 107368/106676 that clamp engine oil at 2/6; radiator GameObjects 20476/20449 have cap FSMs 108196/108178 clamping water at 6/3. Their save/load FSMs persist the matching liquid value. Other engine/radiator IDs in the table were checked against their corresponding cap, clamp, and save/load FSMs. Diesel_Can GameObject 22228 has `LiquidAmount` FSM 108841 with capacity 20. Decimal capacities in the table round to Unity's stored single-precision floats; the editor also accepts their nine-digit serialized representations.

`first_aid_1` and `weed_bag` expose their existing stack `Quantity` under **Saved items → Edit values**. The First Aid prefab's item-use UI displays “Health +50”; that is its per-use effect, not the editable stack count. The Weed prefab displays `Weed` and formats its saved `Quantity` as a piece count. Search for `first_aid` or `weed_bag`; no verified bulk maximum exists, so **Maximize all** leaves both quantities unchanged. A First Aid parent that resolves only through a vehicle prefab reference is labeled vehicle-associated, not claimed to be a particular mounted part or box; unresolved parent/container references remain unresolved. `plant_weed` is a distinct growing object, not the pictured Weed stack. Cigarette quantities are also individually editable but have no verified bulk maximum. `blastlance_1` objects in the inspected save have a zero `Quantity`, but prefab save/load FSM 110681 does not establish it as an ammunition counter, so it remains read-only; plant/dew-collector liquids without a verified capacity also remain unchanged.

Currency evidence: `level1` HUD FSM 11830 converts global `Money` to its HUD text; global save/load FSM 13238 saves and loads the `global` record. `sharedassets1.assets` purchase FSM 103214 labels prices “Nuts” and compares `Money` with `BuyValue`; sell FSM 103560 adds `PriceInt` to `Money`. The editable ceiling is not derived from those actions. Real game reload of an edited currency value has not been verified.

Bulk counter evidence: `sharedassets1.assets` bandage GameObject 18626 save/load FSM 104971 persists `Quantity`; repair-box Small/Medium/Large GameObjects 34453/28030/27034 use save/load FSMs 103376/105185/111705 for the `UseRepair` quantity. Ammo-box save/load FSMs persist `ammo`, including 103900 (20 gauge), 111217 (9mm), and 105996 (7.62mm). The editor requires the exact verified prefab name and matching object/owner prefab IDs before applying these item count targets. Other counters remain unchanged.

First Aid and Weed stack evidence: `first_aid_1` prefab ID `3955095449936337101` has a `Quantity` comparison/destruction FSM and save/load FSM 111458 that persists `Quantity`; UI FSM 103333 identifies “First Aid” and “Health +50”. `weed_bag` prefab ID `2856772050428381491` uses `Quantity` for its displayed piece count, its use FSM reads that counter, and save/load FSM 112107 persists it. The displayed benefits are prefab behavior; only the existing saved count is editable.

Settings use ordinary typed entries such as:

```json
{"peacefulMode":{"__type":"bool","value":false}}
```

PlayMaker data uses a nonstandard inline value, for example:

```text
{"Health":{"__type":"float"100}}
```

**Do not run the game save through JSON.parse / JSON.stringify.** The parser understands both formats and records exact scalar source spans. Serialization replaces only edited numeric or boolean tokens, preserving unknown content, 64-bit reference literals, ordering, whitespace, line endings, escapes, and a UTF-8 BOM. A no-change roundtrip returns identical text; backup download uses the exact original bytes.

Only UTF-8 text up to 20 MiB is accepted. Invalid UTF-8, encrypted/binary data, duplicate keys, malformed syntax, excessive nesting, unknown files, and incompatible recognized field types are rejected explicitly. Native opening applies the saved recovery/retention policy without modifying the source. Only confirmed manual Save or explicitly enabled autosave replaces the source. Browser opening/export never writes it. The browser warns about pending drafts or an in-flight save before leaving; native refresh autoloads the newest slot again using the saved backup limit.

## Development

Node.js 18+ is needed for tests and native in-place save validation; the native picker and export-only editor work without it. Windows-only launcher and atomic-save tests run under Windows PowerShell and are skipped elsewhere. There are no npm dependencies.

```powershell
npm test
npm run check
```

`APOCALYPTER_TEST_OUTPUT` can specify the directory for disposable synthetic write-test files (otherwise the OS temporary directory is used). The tests never write to actual game saves.

For isolated native/browser validation, `run.bat -NoLaunch -SaveFolderOverride "<APOCALYPTER_TEST_OUTPUT>\help-ui"` serves only that CLI-specified fixture folder and isolates its native policy in that folder's `.apocalypter-editor-settings.json` (never the real user's settings). The override is **test-only**, not a remembered user preference or HTTP parameter; normal Tools Menu/run.bat startup always derives the current Windows user's real save folder. Never test startup/autosave/retention against real saves. Native tests cover default/selected/zero counts, per-original isolation, reuse/newest protection, limit-1 manual/autosave rotation, settings errors and recovery, port-changing relaunches, stale cross-window/process policies, invalid-save-before-pruning, no-Node deferred cleanup, exact-name/link exclusions, external candidate changes, and partial cleanup/committed-save warnings. The real batch integration test also verifies fixed assets, authorization, exact Host/Origin, newest-slot exclusions, backup deduplication, and synthetic writes. Delayed-response UI tests cover coalescing, invalid/uncommitted drafts, failure latching, baseline summaries, and coherent bulk edits.

`tests\help-browser.test.js` is optional browser regression coverage, with no editor/runtime dependency. Point `APOCALYPTER_BROWSER_DRIVER` at an already installed `playwright-core` module and `APOCALYPTER_BROWSER_TEST_URL` at a running `run.bat -NoLaunch` bridge configured with `-SaveFolderOverride "<APOCALYPTER_TEST_OUTPUT>\help-ui"`. Create that disposable folder first. The test verifies the bridge's authenticated folder **before opening the page** and refuses other folders; it creates synthetic fixtures only. `APOCALYPTER_BROWSER_EXECUTABLE` optionally selects an installed Chromium browser (default: standard Microsoft Edge path). With those variables unset, browser tests are skipped. Coverage includes the actual backup-count controls, zero/positive transitions, relaunch persistence, pending/invalid drafts, refusal before a canceled native open, cross-tab stale-policy autosave, stationary pointer/spinner editing at desktop/short/390px sizes, an 80-item list, far-apart row switching/collapse, filters/focus, all eight palettes, and a single bulk save including filtered-out items. No browser is downloaded automatically.

`save-format.js` contains the parser, verified field allowlist, validation, and lossless serializer. `app.js`, `index.html`, and `style.css` provide the offline UI. `tests\save-format.test.js` contains small synthetic fixtures matching the observed syntax; no user's save or proprietary game assets are included.

Game-load compatibility still requires a manual load in Apocalypter after making a backup; the editor does not launch or modify the game.
