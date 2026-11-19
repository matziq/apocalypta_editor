import json
import math
import os
import sys
import tempfile
import tkinter as tk
import tkinter.font as tkfont
import unittest
from pathlib import Path
from tkinter import ttk
from unittest.mock import patch

from native_gui import EditorGUI, main
from native_theme import PALETTES, THEME_LABELS
from test_es3_items import fixture
from test_es3_scalars import GAME
from test_es3_vehicles import synthetic_vehicle_save
from test_es3_world import synthetic_save


class NativeGuiTests(unittest.TestCase):
    @staticmethod
    def button(root, text):
        widgets = [root]
        while widgets:
            widget = widgets.pop()
            if widget.winfo_class() == "TButton" and widget.cget("text") == text:
                return widget
            widgets.extend(widget.winfo_children())
        raise AssertionError(f"Missing button: {text}")

    @staticmethod
    def descendant(root, widget_class):
        widgets = [root]
        while widgets:
            widget = widgets.pop()
            if widget.winfo_class() == widget_class:
                return widget
            widgets.extend(widget.winfo_children())
        raise AssertionError(f"Missing widget: {widget_class}")

    def test_only_normal_entry_point_requests_maximized_start(self):
        with patch.object(sys, "argv", ["native_gui.py"]), \
                patch("native_gui.ctypes.windll") as windows, \
                patch("native_gui.EditorGUI") as editor:
            main()
        windows.shcore.SetProcessDpiAwareness.assert_called_once_with(1)
        editor.assert_called_once_with(start_zoomed=True)
        editor.return_value.mainloop.assert_called_once_with()

    def test_startup_zoom_is_opt_in_and_falls_back_to_fixed_geometry(self):
        calls = []

        def unavailable_zoom(app, value=None):
            if value == "zoomed":
                calls.append(app.winfo_ismapped())
                raise tk.TclError("zoom unavailable")
            return tk.Tk.state(app, value)

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(EditorGUI, "state", unavailable_zoom):
                app = EditorGUI(root / "settings.json", root / "legacy", discover_latest=False)
                app.withdraw()
                try:
                    self.assertEqual(calls, [])
                finally:
                    app.destroy()
                app = EditorGUI(root / "settings.json", root / "legacy", discover_latest=False,
                                start_zoomed=True)
                app.withdraw()
                try:
                    self.assertEqual(len(calls), 1)
                    self.assertEqual(calls[0], 0)
                    app.update_idletasks()
                    self.assertTrue(app.geometry().startswith("1280x720"))
                finally:
                    app.destroy()

    @unittest.skipUnless(sys.platform == "win32", "Windows maximized window behavior")
    def test_maximized_large_font_layout_matches_manually_maximized_window(self):
        original_init = tk.Tk.__init__

        def transparent_init(app, *args, **kwargs):
            original_init(app, *args, **kwargs)
            app.attributes("-alpha", 0.0)

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "SaveGame1.es3"
            original = GAME.encode("utf-8")
            path.write_bytes(original)
            measurements = []
            with patch.object(tk.Tk, "__init__", transparent_init):
                for start_zoomed in (False, True):
                    app = EditorGUI(root / f"settings-{start_zoomed}.json", root / "legacy",
                                    startup_path=path, discover_latest=False, start_zoomed=start_zoomed)
                    try:
                        if app.winfo_screenwidth() < 1920 or app.winfo_screenheight() < 1080:
                            self.skipTest("Requires a screen of at least 1920x1080")
                        if not start_zoomed:
                            app.state("zoomed")
                        app.update()
                        self.assertEqual(app.state(), "zoomed")
                        app._base_font_sizes["TkDefaultFont"] = 16
                        results = []
                        for size in (80, 140):
                            app.settings["fontSize"] = size
                            app._theme()
                            app.update()
                            tree = app.tree
                            rowheight = int(ttk.Style(app).lookup("Treeview", "rowheight"))
                            linespace = tkfont.nametofont("TkDefaultFont", root=app).metrics("linespace")
                            rows = [row for group in tree.get_children()
                                    for row in (group, *tree.get_children(group)) if tree.bbox(row)]
                            self.assertGreaterEqual(len(rows), 3)
                            self.assertGreaterEqual(rowheight, linespace + 6)
                            self.assertEqual(app.outer_canvas.xview(), (0.0, 1.0))
                            self.assertEqual(tree.xview(), (0.0, 1.0))
                            results.append((app.winfo_width(), app.winfo_height(),
                                            tree.winfo_width(), tree.winfo_height(), rowheight, len(rows)))
                        measurements.append(results)
                    finally:
                        app.destroy()
            self.assertEqual(measurements[0], measurements[1])
            self.assertEqual(path.read_bytes(), original)

    def test_synthetic_open_drafts_bulk_save_and_preferences(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "SaveGame1.es3"
            path.write_bytes(GAME.encode("utf-8"))
            app = EditorGUI(root / "settings.json", root / "legacy", startup_path=path, discover_latest=False)
            app.withdraw()
            try:
                app.update()
                self.assertIsNotNone(app.model)
                self.assertEqual(len(list(root.glob("*.original.bak"))), 1)
                self.button(app, "Maximize All").invoke()
                self.assertEqual(app.model.changes()["Ammo.ammo_9mm"], 999)
                self.assertEqual(app.model.changes()["Ammo.ammo_22caliber_capacity"], 999)
                self.assertNotIn("Ammo.armor", app.model.changes())
                original = path.read_bytes()
                app.change_font(-10)
                self.assertEqual(path.read_bytes(), original)
                with patch("native_gui.messagebox.askyesno", return_value=True):
                    self.assertTrue(app.save())
                self.assertNotEqual(path.read_bytes(), original)
                for task in ("Vehicles", "Saved Items", "Item Map", "Settings", "Player & Supplies"):
                    self.button(app, task).invoke()
                    app.update()
                    self.assertEqual(app.active_task, task)
                self.assertEqual(app.storage.settings()["fontSize"], 90)
            finally:
                app.destroy()

    def test_browse_starts_in_game_save_folder_when_present(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            folder = root / "AppData" / "LocalLow" / "SawyerK Games" / "Apocalypter"
            app = EditorGUI(root / "settings.json", root / "legacy", discover_latest=False)
            app.withdraw()
            try:
                with patch.dict(os.environ, {"USERPROFILE": str(root)}), \
                        patch("native_gui.filedialog.askopenfilename", return_value="") as dialog:
                    app.browse()
                    self.assertNotIn("initialdir", dialog.call_args.kwargs)
                    folder.mkdir(parents=True)
                    app.browse()
                    self.assertEqual(dialog.call_args.kwargs["initialdir"], str(folder))
                    self.assertIsNone(app.model)
            finally:
                app.destroy()

    def test_ui_keeps_invalid_draft_across_tasks_and_refuses_save(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "SaveGame1.es3"
            original = GAME.encode("utf-8")
            path.write_bytes(original)
            app = EditorGUI(root / "settings.json", root / "legacy", startup_path=path, discover_latest=False)
            app.withdraw()
            try:
                app.update()
                app.tree.selection_set("field|Player.Health")
                app._selected()
                editor = app.detail.winfo_children()[0]
                entry = next(child for child in editor.winfo_children() if child.winfo_class() == "TEntry")
                entry.delete(0, "end")
                entry.insert(0, "invalid")
                app.show_task("Settings")
                app.show_task("Player & Supplies")
                self.assertEqual(app.model.drafts["Player.Health"], "invalid")
                with patch("native_gui.messagebox.showerror") as error:
                    self.assertFalse(app.save())
                error.assert_called_once()
                self.assertEqual(path.read_bytes(), original)
            finally:
                app.destroy()

    def test_custom_targets_are_persistent_and_invalid_targets_do_not_stage(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "SaveGame1.es3"
            path.write_bytes(GAME.encode("utf-8"))
            app = EditorGUI(root / "settings.json", root / "legacy", startup_path=path, discover_latest=False)
            app.withdraw()
            try:
                app.update()
                targets = {"ammo": 432, "consumables": 300, "nuts": 4567, "liquids": 50}
                app.settings = app.storage.update_settings({"targets": targets})
                app._maximize()
                self.assertEqual(app.model.changes()["Ammo.ammo_9mm"], 432)
                self.assertEqual(app.storage.settings()["targets"], targets)
                app.model.drafts.clear()
                app.settings["targets"]["ammo"] = -1
                with patch("native_gui.messagebox.showerror") as error:
                    app._maximize()
                error.assert_called_once()
                self.assertEqual(app.model.drafts, {})
            finally:
                app.destroy()
            restarted = EditorGUI(root / "settings.json", root / "legacy", startup_path=path, discover_latest=False)
            restarted.withdraw()
            try:
                restarted.update()
                self.assertEqual(restarted.settings["targets"], targets)
                self.button(restarted, "Maximize All").invoke()
                self.assertEqual(restarted.model.changes()["Ammo.ammo_9mm"], 432)
            finally:
                restarted.destroy()

    def test_disabling_autosave_cancels_pending_write(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "SaveGame1.es3"
            original = GAME.encode("utf-8")
            path.write_bytes(original)
            app = EditorGUI(root / "settings.json", root / "legacy", startup_path=path, discover_latest=False)
            app.withdraw()
            try:
                app.update()
                app.autosave_var.set(True)
                app.set_autosave()
                app.model.stage("Player.Health", "75")
                app.schedule_autosave()
                self.assertIsNotNone(app.pending_autosave)
                app.autosave_var.set(False)
                app.set_autosave()
                self.assertIsNone(app.pending_autosave)
                app._autosave()
                self.assertEqual(path.read_bytes(), original)
                self.assertEqual(app.model.changes(), {"Player.Health": 75})
            finally:
                app.destroy()

    def test_canceling_manual_save_cancels_pending_autosave(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "SaveGame1.es3"
            original = GAME.encode("utf-8")
            path.write_bytes(original)
            app = EditorGUI(root / "settings.json", root / "legacy", startup_path=path, discover_latest=False)
            app.withdraw()
            try:
                app.update()
                app.autosave_var.set(True)
                app.set_autosave()
                app.model.stage("Player.Health", "75")
                app.schedule_autosave()
                with patch("native_gui.messagebox.askyesno", return_value=False):
                    self.assertFalse(app.save())
                self.assertIsNone(app.pending_autosave)
                self.assertEqual(app.model.changes(), {"Player.Health": 75})
                self.assertEqual(path.read_bytes(), original)
            finally:
                app.destroy()

    def test_numeric_typing_does_not_schedule_until_committed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "SaveGame1.es3"
            original = GAME.encode("utf-8")
            path.write_bytes(original)
            app = EditorGUI(root / "settings.json", root / "legacy", startup_path=path, discover_latest=False)
            app.withdraw()
            try:
                app.update()
                app.autosave_var.set(True)
                app.set_autosave()
                app.tree.selection_set("field|Player.Health")
                app._selected()
                editor = app.detail.winfo_children()[0]
                entry = next(child for child in editor.winfo_children() if child.winfo_class() == "TEntry")
                entry.delete(0, "end")
                entry.insert(0, "75")
                self.assertIsNone(app.pending_autosave)
                self.assertEqual(app.model.changes(), {"Player.Health": 75})
                self.assertEqual(path.read_bytes(), original)
                app.schedule_autosave()
                app.after_cancel(app.pending_autosave)
                app._autosave()
                self.assertEqual(path.read_bytes(), original)
                self.assertEqual(app.model.changes(), {"Player.Health": 75})
                self.assertIn("committed", app.status_var.get())
                entry.event_generate("<FocusOut>")
                app.update()
                self.assertNotIn("Player.Health", app.uncommitted)
                app.save(automatic=True)
                self.assertIn(b'"float"75', path.read_bytes())
            finally:
                app.destroy()

    def test_committed_save_with_cleanup_warning_pauses_autosave(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "SaveGame1.es3"
            path.write_bytes(GAME.encode("utf-8"))
            app = EditorGUI(root / "settings.json", root / "legacy", startup_path=path, discover_latest=False)
            app.withdraw()
            try:
               app.update()
               app.autosave_var.set(True)
               app.set_autosave()
               app.model.stage("Player.Health", "75")
               with patch("native_storage._retain", return_value="synthetic cleanup failure"):
                   self.assertTrue(app.save(automatic=True))
               self.assertIn(b'"float"75', path.read_bytes())
               self.assertEqual(app.model.changes(), {})
               self.assertTrue(app.autosave_failed)
               self.assertIn("Save succeeded", app.status_var.get())
               self.assertIn("cleanup", app.status_var.get())
               app.schedule_autosave()
               self.assertIsNone(app.pending_autosave)
            finally:
               app.destroy()

    def test_autosave_failure_stops_retries_until_reenabled(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "SaveGame1.es3"
            original = GAME.encode("utf-8")
            path.write_bytes(original)
            app = EditorGUI(root / "settings.json", root / "legacy", startup_path=path, discover_latest=False)
            app.withdraw()
            try:
                app.update()
                app.autosave_var.set(True)
                app.set_autosave()
                app.model.stage("Player.Health", "75")
                with patch.object(app.storage, "save", side_effect=OSError("synthetic failure")) as save:
                    app._autosave()
                    self.assertTrue(app.autosave_failed)
                    app.schedule_autosave()
                    self.assertIsNone(app.pending_autosave)
                    save.assert_called_once()
                self.assertEqual(path.read_bytes(), original)
                self.assertEqual(app.model.changes(), {"Player.Health": 75})
                app.autosave_var.set(False)
                app.set_autosave()
                app.autosave_var.set(True)
                app.set_autosave()
                self.assertFalse(app.autosave_failed)
                self.assertIsNotNone(app.pending_autosave)
                app.after_cancel(app.pending_autosave)
            finally:
                app.destroy()

    def test_theme_and_size_changes_persist_without_writing_save(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "SaveGame1.es3"
            original = GAME.encode("utf-8")
            path.write_bytes(original)
            app = EditorGUI(root / "settings.json", root / "legacy", startup_path=path, discover_latest=False)
            app.withdraw()
            try:
                app.update()
                app.filter_var.set("Health")
                app._refresh_tree()
                app.tree.selection_set("field|Player.Health")
                app._selected()
                tree = app.tree
                entry = self.descendant(app.detail, "TEntry")
                entry.delete(0, "end")
                entry.insert(0, "75")
                for label in THEME_LABELS.values():
                    for dark in (False, True):
                        app.theme_var.set(label)
                        app.dark_var.set(dark)
                        app.set_appearance()
                        self.assertEqual(app.storage.settings()["dark"], dark)
                        self.assertEqual(THEME_LABELS[app.storage.settings()["worldTheme"]], label)
                        self.assertIs(app.tree, tree)
                        self.assertEqual(app.filter_var.get(), "Health")
                        self.assertEqual(app.tree.selection(), ("field|Player.Health",))
                        self.assertEqual(entry.get(), "75")
                        self.assertEqual(app.detail_canvas.cget("background"), app.colors["canvas"])
                for _ in range(3):
                    app.change_font(-10)
                small = tkfont.nametofont("TkDefaultFont", root=app).measure("Save changes")
                small_column = int(tree.column("#0", "minwidth"))
                self.assertEqual(app.settings["fontSize"], 80)
                for _ in range(7):
                    app.change_font(10)
                large = tkfont.nametofont("TkDefaultFont", root=app).measure("Save changes")
                self.assertEqual(app.settings["fontSize"], 140)
                self.assertGreater(large, small)
                self.assertGreater(int(tree.column("#0", "minwidth")), small_column)
                app.show_task("Item Map")
                map_canvas = app.map_canvas
                app.dark_var.set(False)
                app.set_appearance()
                self.assertIs(app.map_canvas, map_canvas)
                self.assertEqual(map_canvas.cget("background"), app.colors["entry"])
                self.assertEqual(path.read_bytes(), original)
            finally:
                app.destroy()

    def test_theme_readonly_controls_have_contrast_in_all_palettes(self):
        def luminance(color):
            channels = [int(color[index:index + 2], 16) / 255 for index in (1, 3, 5)]
            linear = [value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4
                      for value in channels]
            return sum(weight * value for weight, value in zip((0.2126, 0.7152, 0.0722), linear))

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            app = EditorGUI(root / "settings.json", root / "legacy", discover_latest=False)
            app.withdraw()
            try:
                for world, dark in PALETTES:
                    app.theme_var.set(THEME_LABELS[world])
                    app.dark_var.set(dark)
                    app.set_appearance()
                    style = ttk.Style(app)
                    ink, entry = app.colors["ink"], app.colors["entry"]
                    self.assertEqual(style.lookup("TCombobox", "fieldbackground", ["readonly"]), entry)
                    self.assertEqual(style.lookup("TCombobox", "foreground", ["readonly"]), ink)
                    for name in ("TCombobox", "TMenubutton", "TScrollbar"):
                        self.assertEqual(style.lookup(name, "arrowcolor"), ink)
                    light, dark_value = sorted((luminance(ink), luminance(entry)), reverse=True)
                    self.assertGreaterEqual((light + 0.05) / (dark_value + 0.05), 4.5)
            finally:
                app.destroy()

    def test_tree_rows_fit_large_default_fonts_at_both_size_extremes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "SaveGame1.es3"
            path.write_bytes(GAME.encode("utf-8"))
            app = EditorGUI(root / "settings.json", root / "legacy", startup_path=path, discover_latest=False)
            app.withdraw()
            try:
               app.update()
               app._base_font_sizes["TkDefaultFont"] = 16
               for target in (80, 140):
                   while app.settings["fontSize"] != target:
                       app.change_font(10 if app.settings["fontSize"] < target else -10)
                   font = tkfont.nametofont("TkDefaultFont", root=app)
                   rowheight = int(ttk.Style(app).lookup("Treeview", "rowheight"))
                   self.assertGreaterEqual(rowheight, font.metrics("linespace") + 6)
            finally:
               app.destroy()

    def test_export_and_reset_keep_original_safe(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "SaveGame1.es3"
            original = GAME.encode("utf-8")
            path.write_bytes(original)
            app = EditorGUI(root / "settings.json", root / "legacy", startup_path=path, discover_latest=False)
            app.withdraw()
            try:
                app.update()
                app.model.stage("Player.Health", "75")
                output = root / "copy.es3"
                with patch("native_gui.filedialog.asksaveasfilename", return_value=str(output)):
                    app.export_copy(edited=True)
                self.assertIn(b'"float"75', output.read_bytes())
                self.assertEqual(path.read_bytes(), original)
                self.assertEqual(app.model.changes(), {"Player.Health": 75})
                with patch("native_gui.filedialog.asksaveasfilename", return_value=str(path)):
                    with patch("native_gui.messagebox.showerror") as error:
                        app.export_copy(edited=True)
                error.assert_called_once()
                self.assertEqual(path.read_bytes(), original)
                with patch("native_gui.messagebox.askyesno", return_value=True):
                    app.reset_drafts()
                self.assertEqual(app.model.changes(), {})
                self.assertEqual(path.read_bytes(), original)
            finally:
                app.destroy()

    def test_canceling_zero_retention_preserves_existing_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "SaveGame1.es3"
            original = GAME.encode("utf-8")
            path.write_bytes(original)
            app = EditorGUI(root / "settings.json", root / "legacy", startup_path=path, discover_latest=False)
            app.withdraw()
            try:
                app.update()
                backup = app.storage.source.load_backup
                app.limit_var.set("0")
                with patch("native_gui.messagebox.askyesno", return_value=False):
                    app.apply_limit()
                self.assertEqual(app.storage.settings()["backupLimit"], 3)
                self.assertTrue(backup.exists())
                self.assertEqual(path.read_bytes(), original)
            finally:
                app.destroy()

    def test_refusing_to_discard_drafts_does_not_open_or_back_up_another_save(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "SaveGame1.es3"
            other = root / "SaveGame2.es3"
            original = GAME.encode("utf-8")
            path.write_bytes(original)
            other.write_bytes(original)
            app = EditorGUI(root / "settings.json", root / "legacy", startup_path=path, discover_latest=False)
            app.withdraw()
            try:
               app.update()
               app.model.stage("Player.Health", "invalid")
               with patch("native_gui.messagebox.askyesno", return_value=False):
                   app.open_path(other)
               self.assertEqual(app.storage.source.path, path)
               self.assertEqual(app.model.drafts["Player.Health"], "invalid")
               self.assertEqual(other.read_bytes(), original)
               self.assertEqual(list(root.glob("SaveGame2.es3.*.original.bak")), [])
            finally:
               app.destroy()

    def test_item_filter_and_selection_preserve_separate_drafts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "SaveGame1.es3"
            original = fixture().encode("utf-8")
            path.write_bytes(original)
            app = EditorGUI(root / "settings.json", root / "legacy", startup_path=path, discover_latest=False)
            app.withdraw()
            try:
                app.update()
                self.button(app, "Saved Items").invoke()
                app.tree.selection_set("item|item:r1:0")
                app._selected()
                box = next(child for child in app.detail.winfo_children() if child.winfo_class() == "TFrame")
                entry = next(child for child in box.winfo_children() if child.winfo_class() == "TEntry")
                entry.delete(0, "end")
                entry.insert(0, "12")
                app.filter_var.set("radiator")
                app._refresh_tree()
                app.tree.selection_set("item|item:r4:3")
                app._selected()
                app.model.stage("item:r4:3:Condition", "80")
                app.filter_var.set("")
                app._refresh_tree()
                app.tree.selection_set("item|item:r1:0")
                app._selected()
                self.assertEqual(app.model.changes(), {"item:r1:0:Quantity": 12, "item:r4:3:Condition": 80})
                self.assertEqual(path.read_bytes(), original)
            finally:
                app.destroy()

    def test_item_inspector_shows_saved_identity_and_capacity_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "SaveGame1.es3"
            original = fixture().encode("utf-8")
            path.write_bytes(original)
            app = EditorGUI(root / "settings.json", root / "legacy", startup_path=path, discover_latest=False)
            app.withdraw()
            try:
                app.update()
                self.button(app, "Saved Items").invoke()
                app.tree.selection_set("item|item:r4:3")
                app._selected()
                labels = "\n".join(child.cget("text") for child in app.detail.winfo_children()
                                   if child.winfo_class() == "TLabel")
                for evidence in ("Reference: r4", "Transform: t3", "Parent: World root",
                                 "Local position: 0.0, 0.0, 0.0", "Prefab: 5669857674379848146",
                                 "Liquid capacity source: verified prefab"):
                    self.assertIn(evidence, labels)
                self.assertEqual(path.read_bytes(), original)
            finally:
                app.destroy()

    def test_editable_only_filter_persists_without_writing_the_save(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "SaveGame1.es3"
            original = fixture().encode("utf-8")
            path.write_bytes(original)
            app = EditorGUI(root / "settings.json", root / "legacy", startup_path=path, discover_latest=False)
            app.withdraw()
            try:
                app.update()
                self.button(app, "Saved Items").invoke()
                app.editable_only.set(True)
                app.set_editable_only()
                self.assertTrue(app.storage.settings()["editableOnly"])
                self.assertFalse(app.tree.exists("item|item:r3:2"))
                self.assertEqual(path.read_bytes(), original)
            finally:
                app.destroy()
            restarted = EditorGUI(root / "settings.json", root / "legacy", startup_path=path, discover_latest=False)
            restarted.withdraw()
            try:
                restarted.update()
                self.assertTrue(restarted.editable_only.get())
                self.button(restarted, "Saved Items").invoke()
                self.assertFalse(restarted.tree.exists("item|item:r3:2"))
                self.assertEqual(path.read_bytes(), original)
            finally:
                restarted.destroy()

    def test_item_maximize_includes_filtered_items_and_keeps_invalid_drafts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "SaveGame1.es3"
            original = fixture().encode("utf-8")
            path.write_bytes(original)
            app = EditorGUI(root / "settings.json", root / "legacy", startup_path=path, discover_latest=False)
            app.withdraw()
            try:
               app.update()
               self.button(app, "Saved Items").invoke()
               app.model.stage("item:r4:3:Condition", "invalid")
               app.filter_var.set("radiator")
               app._refresh_tree()
               self.assertFalse(app.tree.exists("item|item:r1:0"))
               self.button(app, "Maximize All").invoke()
               self.assertEqual(app.model.drafts["item:r1:0:Quantity"], "999")
               self.assertEqual(app.model.drafts["item:r2:1:ammo"], "999")
               self.assertEqual(app.model.drafts["item:r4:3:Condition"], "invalid")
               with patch("native_gui.messagebox.showerror") as error:
                   self.assertFalse(app.save())
               error.assert_called_once()
               self.assertEqual(path.read_bytes(), original)
            finally:
               app.destroy()

    def test_all_vehicle_action_uses_targets_even_with_no_vehicles(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "SaveGame1.es3"
            original = fixture().encode("utf-8")
            path.write_bytes(original)
            app = EditorGUI(root / "settings.json", root / "legacy", startup_path=path, discover_latest=False)
            app.withdraw()
            try:
                app.update()
                app.settings = app.storage.update_settings({"targets": {
                    "ammo": 321, "consumables": 456, "nuts": 12345, "liquids": 50,
                }})
                self.button(app, "Vehicles").invoke()
                self.button(app, "Repair & Top Off All").invoke()
                self.assertEqual(app.model.changes()["item:r1:0:Quantity"], 456)
                self.assertEqual(app.model.changes()["item:r2:1:ammo"], 321)
                self.assertNotIn("item:r4:3:Liquid", app.model.changes())
                self.assertEqual(path.read_bytes(), original)
            finally:
                app.destroy()

    def test_ammo_capacity_targets_apply_through_both_bulk_buttons(self):
        extra = (',"ammo_9mm_capacity":{"__type":"int"10}'
                ',"ammo_20gauge_capacity":{"__type":"int"11}'
                ',"ammo_arrow_capacity":{"__type":"int"12}'
                ',"ammo_battery_capacity":{"__type":"int"13}')
        original = GAME.replace('"ammo_9mm":{"__type":"int"12}',
                               '"ammo_9mm":{"__type":"int"12}' + extra).encode("utf-8")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "SaveGame1.es3"
            path.write_bytes(original)
            app = EditorGUI(root / "settings.json", root / "legacy", startup_path=path, discover_latest=False)
            app.withdraw()
            try:
               app.update()
               app.settings = app.storage.update_settings(
                   {"targets": {"ammo": 777, "consumables": 555, "nuts": 12345, "liquids": 50}})
               for task, button in (("Player & Supplies", "Maximize All"),
                                    ("Vehicles", "Repair & Top Off All")):
                   app.show_task(task)
                   self.button(app, button).invoke()
                   changes = app.model.changes()
                   for kind in ("22caliber", "9mm", "20gauge", "arrow"):
                       self.assertEqual(changes[f"Ammo.ammo_{kind}_capacity"], 777)
                   self.assertNotIn("Ammo.ammo_battery_capacity", changes)
                   self.assertNotIn("Ammo.armor", changes)
                   app.model.drafts.clear()
               self.assertEqual(path.read_bytes(), original)
            finally:
               app.destroy()

    def test_selected_vehicle_actions_target_only_its_verified_parts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "SaveGame1.es3"
            original = synthetic_vehicle_save().encode("utf-8")
            path.write_bytes(original)
            app = EditorGUI(root / "settings.json", root / "legacy", startup_path=path, discover_latest=False)
            app.withdraw()
            try:
               app.update()
               app.settings = app.storage.update_settings(
                  {"targets": {"ammo": 777, "consumables": 555, "nuts": 12345, "liquids": 50}})
               self.button(app, "Vehicles").invoke()
               car = app.model.document.vehicles[0]
               app.tree.selection_set("vehicle|" + car.id)
               app._selected()
               self.button(app, "Repair selected").invoke()
               self.button(app, "Top off selected").invoke()
               changes = app.model.changes()
               self.assertEqual(changes["vehicle:car:0:fuel"], 10)
               self.assertEqual(changes["item:part:0:Condition"], 100)
               self.assertEqual(changes["item:part:0:Liquid"], 3)
               self.assertFalse(any("trailer" in identifier for identifier in changes))
               self.assertEqual(path.read_bytes(), original)
            finally:
               app.destroy()

    def test_map_lists_resolved_and_unresolved_items_without_staging(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "SaveGame1.es3"
            data = json.loads(synthetic_save())
            data["Player"]["value"]["objs"]["Player"]["components"][0]["localPosition"]["x"] = 2
            original = json.dumps(data).encode("utf-8")
            path.write_bytes(original)
            app = EditorGUI(root / "settings.json", root / "legacy", startup_path=path, discover_latest=False)
            app.withdraw()
            try:
                app.update()
                self.button(app, "Item Map").invoke()
                tree = self.descendant(app.task_frame, "Treeview")
                rows = {tree.item(item, "text"): tree.set(item, "position") for item in tree.get_children()}
                self.assertEqual(rows["root(Clone)1"], "100.00 / 200.00")
                self.assertEqual(rows["zero(Clone)3"], "100.00 / 198.00")
                self.assertEqual(rows["missing(Clone)4"], "Unresolved")
                self.assertEqual(rows["malformed(Clone)5"], "Unresolved")
                app.tk.call(tree.heading("position", "command"))
                self.assertEqual(tree.get_children()[0], "player")
                self.assertEqual(tree.set(tree.get_children()[-1], "position"), "Unresolved")
                app.tk.call(tree.heading("position", "command"))
                self.assertNotEqual(tree.get_children()[0], "player")
                self.assertEqual(tree.set(tree.get_children()[-1], "position"), "Unresolved")
                self.assertEqual(app.model.changes(), {})
                self.assertEqual(path.read_bytes(), original)
            finally:
                app.destroy()

    def test_map_marker_and_list_selection_link_to_saved_items(self):
        data = json.loads(synthetic_save())
        items = data["newGOArray_Items"]["value"]["array"]
        items[1]["components"][0]["localPosition"]["x"] = 30
        original = json.dumps(data).encode("utf-8")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "SaveGame1.es3"
            path.write_bytes(original)
            app = EditorGUI(root / "settings.json", root / "legacy", startup_path=path, discover_latest=False)
            app.geometry("1280x720-32000-32000")
            try:
                app.update()
                app.editable_only.set(True)
                app.set_editable_only()
                app.show_task("Item Map")
                app.update()
                tree = self.descendant(app.task_frame, "Treeview")
                canvas = app.map_canvas
                coords = canvas.coords("item0")
                canvas.event_generate("<Button-1>", x=int((coords[0] + coords[2]) / 2),
                                      y=int((coords[1] + coords[3]) / 2))
                app.update()
                self.assertEqual(tree.selection(), ("0",))
                self.assertEqual(float(canvas.itemcget("item0", "width")), 3)
                tree.selection_set("1")
                app.update()
                self.assertEqual(float(canvas.itemcget("item0", "width")), 1)
                self.assertEqual(float(canvas.itemcget("item1", "width")), 3)
                tree.selection_set("3")
                app.update()
                self.assertEqual(float(canvas.itemcget("item1", "width")), 1)
                item_id = app.model.document.items[3].id
                self.button(app, "Show in Saved Items").invoke()
                app.update()
                self.assertEqual(app.active_task, "Saved Items")
                self.assertEqual(app.tree.selection(), ("item|" + item_id,))
                self.assertTrue(app.tree.item(app.tree.parent("item|" + item_id), "open"))
                self.assertFalse(app.editable_only.get())
                self.assertEqual(app.filter_var.get(), "")
                self.assertEqual(app.model.changes(), {})
                self.assertEqual(path.read_bytes(), original)
            finally:
                app.destroy()

    def test_map_zoom_centers_preserves_selection_and_fits_after_resize(self):
        data = json.loads(synthetic_save())
        items = data["newGOArray_Items"]["value"]["array"]
        items[0]["components"][0]["localPosition"] = {"x": 20, "y": 0, "z": 20}
        items[1]["components"][0].update(parent=None, localPosition={"x": 12, "y": 0, "z": 20})
        items[2]["components"][0].update(parent=None, localPosition={"x": 14, "y": 0, "z": 20})
        items[3]["components"][0].update(parent=None, localPosition={"x": 100, "y": 0, "z": 20})
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "SaveGame1.es3"
            original = json.dumps(data).encode("utf-8")
            path.write_bytes(original)
            app = EditorGUI(root / "settings.json", root / "legacy", startup_path=path, discover_latest=False)
            app.attributes("-alpha", 0.0)
            try:
                app.update()
                app.show_task("Item Map")
                app.update()
                canvas = app.map_canvas
                tree = self.descendant(app.task_frame, "Treeview")

                def center(tag):
                    left, top, right, bottom = canvas.coords(tag)
                    return ((left + right) / 2, (top + bottom) / 2)

                def spacing():
                    return math.dist(center("item1"), center("item2"))

                def assert_centered(tag):
                    self.assertEqual(center(tag), (canvas.winfo_width() / 2, canvas.winfo_height() / 2))

                full_spacing = spacing()
                search = self.descendant(app.task_frame, "TEntry")
                search.insert(0, "child")
                tree.selection_set("1")
                app.update()
                self.button(app, "Zoom in").invoke()
                assert_centered("item1")
                self.assertAlmostEqual(spacing(), 2 * full_spacing)
                self.button(app, "Zoom out").invoke()
                self.assertAlmostEqual(spacing(), full_spacing)
                self.button(app, "Zoom to player").invoke()
                assert_centered("player")
                self.assertAlmostEqual(spacing(), 8 * full_spacing)
                self.assertFalse(canvas.coords("item3"))
                self.assertEqual(tree.get_children(), ("1",))
                self.assertEqual(tree.selection(), ("1",))
                self.assertEqual(float(canvas.itemcget("item1", "width")), 3)
                app.geometry("1100x680")
                app.dark_var.set(True)
                app.set_appearance()
                app.change_font(20)
                app.update()
                assert_centered("player")
                self.button(app, "Fit map").invoke()
                self.assertTrue(canvas.coords("item3"))
                self.assertEqual(tree.selection(), ("1",))
                self.assertEqual(app.model.changes(), {})
                self.assertEqual(path.read_bytes(), original)
            finally:
                app.destroy()

    def test_map_zoom_handles_missing_coincident_and_extreme_positions(self):
        for case in ("missing", "coincident", "extreme"):
            with self.subTest(case=case), tempfile.TemporaryDirectory() as directory:
                data = json.loads(synthetic_save())
                items = data["newGOArray_Items"]["value"]["array"]
                player = data["Player"]["value"]["objs"]["Player"]["components"][0]
                if case == "missing":
                    del player["localPosition"]
                    items.clear()
                else:
                    x = 1.7e308
                    player["localPosition"] = {"x": x, "y": 0, "z": 0}
                    items[:] = items[:1]
                    items[0]["components"][0]["localPosition"] = {
                        "x": -x if case == "extreme" else x, "y": 0, "z": 0,
                    }
                root = Path(directory)
                path = root / "SaveGame1.es3"
                path.write_text(json.dumps(data), encoding="utf-8")
                app = EditorGUI(root / "settings.json", root / "legacy", startup_path=path, discover_latest=False)
                app.attributes("-alpha", 0.0)
                try:
                    app.update()
                    app.show_task("Item Map")
                    app.update()
                    canvas = app.map_canvas
                    zoom_in = self.button(app, "Zoom in")
                    focus_player = self.button(app, "Zoom to player")
                    content = canvas.master.master.master
                    summary = next(w.cget("text") for w in content.grid_slaves(row=0))
                    if case == "missing":
                        self.assertIn("Player position unresolved; zoom unavailable.", summary)
                        self.assertTrue(focus_player.instate(["disabled"]))
                        self.assertTrue(zoom_in.instate(["disabled"]))
                        continue
                    self.assertIn("1 items resolved; 0 unresolved.", summary)
                    self.assertTrue(canvas.coords("item0"))
                    self.assertTrue(canvas.coords("player"))
                    focus_player.invoke()
                    for _ in range(10):
                        zoom_in.invoke()
                    self.assertTrue(zoom_in.instate(["disabled"]))
                    left, top, right, bottom = canvas.coords("player")
                    self.assertEqual((left + right, top + bottom), (canvas.winfo_width(), canvas.winfo_height()))
                    self.assertEqual(bool(canvas.coords("item0")), case == "coincident")
                    self.button(app, "Fit map").invoke()
                    self.assertTrue(canvas.coords("item0"))
                    self.assertTrue(all(math.isfinite(coord) for item in canvas.find_all()
                                        for coord in canvas.coords(item)))
                finally:
                    app.destroy()

    def test_map_remains_scrollable_at_large_text_and_small_windows(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "SaveGame1.es3"
            path.write_text(synthetic_save(), encoding="utf-8")
            app = EditorGUI(root / "settings.json", root / "legacy", startup_path=path, discover_latest=False)
            app.attributes("-alpha", 0.0)
            try:
                app.update()
                app._base_font_sizes["TkDefaultFont"] = 16
                app.show_task("Item Map")
                for geometry, text_size in (("1280x720", 100), ("720x480", 80), ("720x480", 140)):
                    with self.subTest(geometry=geometry, text_size=text_size):
                        app.geometry(geometry)
                        app.settings["fontSize"] = text_size
                        app._theme()
                        app.update()
                        app.outer_canvas.yview_moveto(1)
                        app.update()
                        tree = self.descendant(app.task_frame, "Treeview")
                        self.assertLess(app.outer_canvas.yview()[0], app.outer_canvas.yview()[1])
                        self.assertEqual(app.outer_canvas.yview()[1], 1)
                        self.assertGreaterEqual(app.map_canvas.winfo_height(), 300)
                        self.assertTrue(tree.bbox(tree.get_children()[0]))
                        button = self.button(app, "Zoom to player")
                        self.assertGreaterEqual(button.winfo_width(), button.winfo_reqwidth())
            finally:
                app.destroy()

    def test_map_sort_filter_coordinates_and_player_highlights(self):
        data = json.loads(synthetic_save())
        items = data["newGOArray_Items"]["value"]["array"]
        items[0]["components"][0]["parent"] = {"_ES3Ref": "pt"}
        original = json.dumps(data).encode("utf-8")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "SaveGame1.es3"
            path.write_bytes(original)
            app = EditorGUI(root / "settings.json", root / "legacy", startup_path=path, discover_latest=False)
            app.withdraw()
            try:
                app.update()
                app.show_task("Item Map")
                app.update()
                tree = self.descendant(app.task_frame, "Treeview")
                self.assertIn("player", tree.item("player", "tags"))
                for key in ("0", "1", "2"):
                    self.assertIn("player-owned", tree.item(key, "tags"))
                self.assertFalse(tree.item("3", "tags"))
                app.tk.call(tree.heading("#0", "command"))
                names = [tree.item(key, "text").casefold() for key in tree.get_children()]
                self.assertEqual(names, sorted(names))
                app.tk.call(tree.heading("#0", "command"))
                self.assertEqual([tree.item(key, "text").casefold() for key in tree.get_children()],
                                 list(reversed(names)))
                search = self.descendant(app.task_frame, "TEntry")
                search.insert(0, "player-owned")
                self.assertEqual(set(tree.get_children()), {"0", "1", "2"})
                toggle = self.descendant(app.task_frame, "TCheckbutton")
                toggle.invoke()
                app.update()
                self.assertEqual(tree.get_children(), ())
                toggle.invoke()
                app.update()
                self.assertEqual(set(tree.get_children()), {"0", "1", "2"})
                search.delete(0, "end")
                toggle.invoke()
                app.update()
                self.assertEqual(tree.get_children(), ("player",))
                tree.selection_set("player")
                app.update()
                self.assertIn("disabled", self.button(app, "Show in Saved Items").state())
                for world, label in THEME_LABELS.items():
                    for dark in (False, True):
                        app.theme_var.set(label)
                        app.dark_var.set(dark)
                        app.set_appearance()
                        self.assertEqual(str(tree.tag_configure("player", "background")), app.colors["accent"])
                        self.assertEqual(str(tree.tag_configure("player-owned", "foreground")), app.colors["ink"])
                self.assertEqual(path.read_bytes(), original)
                self.assertEqual(app.model.changes(), {})
            finally:
                app.destroy()


if __name__ == "__main__":
    unittest.main()
