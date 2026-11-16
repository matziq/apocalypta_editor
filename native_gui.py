"""Tk desktop interface for the native save editor."""

from __future__ import annotations

import ctypes
import math
import os
import sys
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

import preferences
from editor_model import EditorModel
from editor_storage import EditorStorage
from es3_document import serialize_document
from es3_parser import at
from native_theme import THEME_LABELS, apply as apply_theme


class ToolTip:
    def __init__(self, widget, text):
        self.widget, self.text, self.window, self.timer = widget, text, None, None
        widget.bind("<Enter>", self.schedule, add=True)
        widget.bind("<Leave>", self.hide, add=True)
        widget.bind("<Destroy>", self.hide, add=True)

    def schedule(self, _event=None):
        self.timer = self.widget.after(600, self.show)

    def show(self):
        if self.window or not self.text or not self.widget.winfo_exists():
            return
        self.window = tk.Toplevel(self.widget)
        self.window.wm_overrideredirect(True)
        self.window.wm_geometry(f"+{self.widget.winfo_rootx() + 12}+{self.widget.winfo_rooty() + self.widget.winfo_height()}")
        ttk.Label(self.window, text=self.text, wraplength=420, padding=8, relief="solid").pack()

    def hide(self, _event=None):
        if self.timer:
            self.widget.after_cancel(self.timer)
            self.timer = None
        if self.window:
            self.window.destroy()
            self.window = None


class EditorGUI(tk.Tk):
    def __init__(self, settings_file=None, legacy_dir=None, *, startup_path=None, discover_latest=True):
        super().__init__()
        self.title("Apocalypter Save Editor")
        self.geometry("1280x720")
        self.minsize(720, 480)
        self.storage = EditorStorage(
            Path(settings_file) if settings_file else preferences.settings_path(),
            Path(legacy_dir) if legacy_dir else Path(os.environ.get("LOCALAPPDATA", "")) / "ApocalypterSaveEditor",
        )
        self.model = None
        self.uncommitted = set()
        self.pending_autosave = None
        self.pending_resize = None
        self.pending_startup = None
        self.autosave_failed = False
        self.active_task = "Player & Supplies"
        self.selection = None
        self.colors = {}
        self.detail_canvas = None
        self.map_canvas = None
        self.map_draw = None
        self.scaled_trees = []
        self.settings = self.storage.settings()
        self.path_var = tk.StringVar()
        self.limit_var = tk.StringVar(value=str(self.settings["backupLimit"]))
        self.theme_var = tk.StringVar(value=THEME_LABELS[self.settings["worldTheme"]])
        self.dark_var = tk.BooleanVar(value=self.settings["dark"])
        self.autosave_var = tk.BooleanVar(value=self.settings["autosave"])
        self.status_var = tk.StringVar(value="Choose a save to begin. Saves are never changed until you save or enable autosave.")
        self.warning_var = tk.StringVar()
        self.filter_var = tk.StringVar()
        self.sort_reverse = {}
        self.group_items = tk.BooleanVar(value=True)
        self.editable_only = tk.BooleanVar(value=self.settings["editableOnly"])
        self._build()
        self._theme()
        self.show_task(self.active_task)
        self._backup_warning()
        self.protocol("WM_DELETE_WINDOW", self.close)
        if startup_path is not None:
            self.pending_startup = self.after_idle(lambda: self._startup(lambda: self.open_path(Path(startup_path))))
        elif discover_latest:
            self.pending_startup = self.after_idle(lambda: self._startup(self.load_latest))

    def _startup(self, callback):
        self.pending_startup = None
        callback()

    def _build(self):
        viewport = ttk.Frame(self)
        viewport.pack(fill="both", expand=True)
        viewport.columnconfigure(0, weight=1)
        viewport.rowconfigure(0, weight=1)
        self.outer_canvas = tk.Canvas(viewport, highlightthickness=0)
        self.outer_canvas.grid(row=0, column=0, sticky="nsew")
        vertical = ttk.Scrollbar(viewport, orient="vertical", command=self.outer_canvas.yview)
        horizontal = ttk.Scrollbar(viewport, orient="horizontal", command=self.outer_canvas.xview)
        vertical.grid(row=0, column=1, sticky="ns")
        horizontal.grid(row=1, column=0, sticky="ew")
        self.outer_canvas.configure(yscrollcommand=vertical.set, xscrollcommand=horizontal.set)
        shell = ttk.Frame(self.outer_canvas, padding=8)
        self.shell = shell
        self.shell_window = self.outer_canvas.create_window(0, 0, window=shell, anchor="nw")
        self.outer_canvas.bind("<Configure>", self._resize_shell)
        shell.columnconfigure(0, weight=1)
        shell.rowconfigure(3, weight=1)
        setup = ttk.LabelFrame(shell, text="Setup", padding=8)
        setup.grid(row=0, column=0, sticky="ew")
        setup.columnconfigure(1, weight=1)
        ttk.Label(setup, text="Save file").grid(row=0, column=0, sticky="w")
        ttk.Entry(setup, textvariable=self.path_var, state="readonly").grid(row=0, column=1, sticky="ew", padx=8)
        ttk.Button(setup, text="Browse...", command=self.browse).grid(row=0, column=2, padx=2)
        ttk.Button(setup, text="Load newest", command=self.load_latest).grid(row=0, column=3, padx=2)
        row = ttk.Frame(setup)
        row.grid(row=1, column=0, columnspan=4, sticky="ew", pady=(6, 0))
        ttk.Label(row, text="Keep last").pack(side="left")
        ttk.Entry(row, textvariable=self.limit_var, width=6).pack(side="left", padx=5)
        ttk.Label(row, text="backups").pack(side="left")
        ttk.Button(row, text="Apply", command=self.apply_limit).pack(side="left", padx=5)
        ttk.Button(row, text="Prune now", command=self.prune).pack(side="left")
        ttk.Label(row, textvariable=self.warning_var, style="Danger.TLabel").pack(side="left", padx=8)
        nav = ttk.Frame(shell)
        nav.grid(row=1, column=0, sticky="ew", pady=(10, 4))
        ttk.Label(nav, text="Choose a task:").pack(side="left", padx=(0, 8))
        for task in ("Player & Supplies", "Vehicles", "Saved Items", "Item Map", "Settings"):
            ttk.Button(nav, text=task, command=lambda name=task: self.show_task(name)).pack(side="left", padx=2)
        controls = ttk.Frame(shell)
        controls.grid(row=2, column=0, sticky="ew", pady=(0, 8))
        ttk.Button(controls, text="Quick start help", command=self.help).pack(side="left")
        ttk.Button(controls, text="Bulk targets", command=self.targets_dialog).pack(side="left", padx=5)
        ttk.Checkbutton(controls, text="Autosave on change", variable=self.autosave_var,
                        command=self.set_autosave).pack(side="left", padx=5)
        ttk.Button(controls, text="Save changes", style="Select.TButton", command=self.save).pack(side="left", padx=5)
        more = ttk.Menubutton(controls, text="More actions")
        menu = tk.Menu(more, tearoff=False)
        menu.add_command(label="Review staged changes", command=self.review_changes)
        menu.add_command(label="Export edited copy...", command=lambda: self.export_copy(edited=True))
        menu.add_command(label="Export original copy...", command=lambda: self.export_copy(edited=False))
        menu.add_command(label="Reset drafts", command=self.reset_drafts)
        more.configure(menu=menu)
        more.pack(side="left", padx=5)
        appearance = ttk.Frame(shell)
        appearance.grid(row=3, column=0, sticky="ew", pady=(0, 6))
        ttk.Label(appearance, text="Theme").pack(side="left", padx=(0, 4))
        theme = ttk.Combobox(appearance, width=15, state="readonly", textvariable=self.theme_var,
                             values=list(THEME_LABELS.values()))
        theme.pack(side="left")
        theme.bind("<<ComboboxSelected>>", self.set_appearance)
        ttk.Checkbutton(appearance, text="Dark", variable=self.dark_var, command=self.set_appearance).pack(side="left", padx=5)
        ttk.Label(appearance, text="Text size").pack(side="left", padx=(8, 4))
        self.minus = ttk.Button(appearance, text="-", width=3, command=lambda: self.change_font(-10))
        self.minus.pack(side="left")
        ToolTip(self.minus, "Decrease interface text size.")
        self.size_label = ttk.Label(appearance)
        self.size_label.pack(side="left", padx=4)
        self.plus = ttk.Button(appearance, text="+", width=3, command=lambda: self.change_font(10))
        self.plus.pack(side="left")
        ToolTip(self.plus, "Increase interface text size.")
        self.task_frame = ttk.Frame(shell)
        shell.rowconfigure(3, weight=0)
        shell.rowconfigure(4, weight=1)
        self.task_frame.grid(row=4, column=0, sticky="nsew")
        ttk.Label(shell, textvariable=self.status_var, anchor="w", relief="sunken", padding=5).grid(
            row=5, column=0, sticky="ew", pady=(8, 0))
        self.show_task(self.active_task)

    def _theme(self):
        self.colors = apply_theme(self, self.settings["worldTheme"], self.settings["dark"], self.settings["fontSize"])
        self.outer_canvas.configure(background=self.colors["canvas"])
        self.size_label.configure(text=f'{self.settings["fontSize"]}%')
        self.minus.state(["disabled"] if self.settings["fontSize"] <= 80 else ["!disabled"])
        self.plus.state(["disabled"] if self.settings["fontSize"] >= 140 else ["!disabled"])
        self._apply_task_theme()
        if self.detail_canvas is not None:
            self.detail_canvas.configure(background=self.colors["canvas"])
        if self.map_canvas is not None:
            self.map_canvas.configure(background=self.colors["entry"], highlightbackground=self.colors["line"])
            self.map_draw()
        for tree, columns in self.scaled_trees:
            self._scale_tree(tree, columns)
        self._schedule_resize()

    def _scale_tree(self, tree, columns):
        size = self.settings["fontSize"]
        previous = getattr(tree, "_font_scale", None)
        if previous == size:
            return
        for column, min_width, base_width in columns:
            width = (base_width * size / 100 if previous is None
                     else int(tree.column(column, "width")) * size / previous)
            tree.column(column, minwidth=round(min_width * size / 100), width=round(width))
        tree._font_scale = size

    def _register_tree(self, tree, columns):
        self.scaled_trees.append((tree, columns))
        self._scale_tree(tree, columns)

    def _schedule_resize(self):
        if self.pending_resize:
            self.after_cancel(self.pending_resize)
        self.pending_resize = self.after_idle(self._run_resize)

    def _run_resize(self):
        self.pending_resize = None
        self._resize_shell()

    def _resize_shell(self, event=None):
        if not self.outer_canvas.winfo_exists():
            return
        width = max(self.outer_canvas.winfo_width(), self.shell.winfo_reqwidth())
        height = max(self.outer_canvas.winfo_height(), round(680 * self.settings["fontSize"] / 100))
        self.outer_canvas.itemconfigure(self.shell_window, width=width, height=height)
        self.outer_canvas.configure(scrollregion=(0, 0, width, height))

    def _backup_warning(self):
        self.warning_var.set("Backups off: saving overwrites the original." if self.settings["backupLimit"] == 0 else "")

    def error(self, title, error):
        self.status_var.set(str(error))
        messagebox.showerror(title, str(error), parent=self)

    def set_appearance(self, _event=None):
        world = next(key for key, label in THEME_LABELS.items() if label == self.theme_var.get())
        try:
            self.settings = self.storage.update_settings({"worldTheme": world, "dark": self.dark_var.get()})
            self._theme()
        except (OSError, ValueError) as exc:
            self.theme_var.set(THEME_LABELS[self.settings["worldTheme"]])
            self.dark_var.set(self.settings["dark"])
            self.error("Appearance not saved", exc)

    def change_font(self, step):
        value = max(80, min(140, self.settings["fontSize"] + step))
        try:
            self.settings = self.storage.update_settings({"fontSize": value})
            self._theme()
        except (OSError, ValueError) as exc:
            self.error("Text size not saved", exc)

    def set_autosave(self):
        try:
            self.settings = self.storage.update_settings({"autosave": self.autosave_var.get()})
            self.autosave_failed = False
            if not self.settings["autosave"] and self.pending_autosave:
                self.after_cancel(self.pending_autosave)
                self.pending_autosave = None
            if self.settings["autosave"] and self.model and self.model.drafts:
                self.schedule_autosave()
        except (OSError, ValueError) as exc:
            self.autosave_var.set(self.settings["autosave"])
            self.error("Autosave preference not saved", exc)

    def set_editable_only(self):
        try:
            self.settings = self.storage.update_settings({"editableOnly": self.editable_only.get()})
            self._refresh_tree()
        except (OSError, ValueError) as exc:
            self.editable_only.set(self.settings["editableOnly"])
            self.error("Item filter not saved", exc)

    def apply_limit(self):
        try:
            text = self.limit_var.get()
            if not text.isascii() or not text.isdecimal():
                raise ValueError("Backup limit must be a nonnegative whole number.")
            if int(text) > 9007199254740991:
                raise ValueError("Backup limit cannot exceed 9007199254740991.")
            if not messagebox.askyesno(
                    "Confirm backup retention",
                    ("Disable backups and remove all eligible editor backups for the open file?"
                     if int(text) == 0 else
                     f"Keep at most {text} eligible backups for the open file and remove older ones?")
                    + "\n\nUnrelated files are not removed.",
                    parent=self, default="no"):
                return
            warning = self.storage.apply_backup_limit(int(text))
            self.settings = self.storage.settings()
            self._backup_warning()
            self.status_var.set(warning or "Backup limit applied.")
        except (OSError, ValueError) as exc:
            self.error("Backup limit not applied", exc)

    def prune(self):
        try:
            if not messagebox.askyesno("Confirm backup pruning",
                                      "Apply the current retention limit to eligible backups for this save?",
                                      parent=self, default="no"):
                return
            warning = self.storage.prune_now()
            self.status_var.set(warning or "Backup retention applied.")
        except (OSError, ValueError) as exc:
            self.error("Backups not pruned", exc)

    def _can_discard(self):
        if not self.model or not self.model.drafts:
            return True
        try:
            if not self.model.changes():
                return True
        except ValueError:
            pass
        return messagebox.askyesno("Discard drafts?", "Discard unsaved or invalid drafts?", parent=self, default="no")

    def browse(self):
        path = filedialog.askopenfilename(parent=self, title="Open Apocalypter save",
                                          filetypes=[("Apocalypter saves", "*.es3"), ("All files", "*.*")])
        if path:
            self.open_path(Path(path))

    def load_latest(self):
        folder = Path(os.environ.get("USERPROFILE", str(Path.home()))) / "AppData" / "LocalLow" / "SawyerK Games" / "Apocalypter"
        if not folder.is_dir():
            self.status_var.set("No Apocalypter save folder found. Choose a file manually.")
            return
        slots = [path for path in folder.glob("SaveGame*.es3")
                 if path.stem.removeprefix("SaveGame").isdigit() and path.is_file()]
        if not slots:
            self.status_var.set("No SaveGameN.es3 slots found. Choose a file manually.")
            return
        slots.sort(key=lambda path: path.name)
        slots.sort(key=lambda path: path.stat().st_mtime_ns, reverse=True)
        self.open_path(slots[0])

    def open_path(self, path):
        if not self._can_discard():
            return
        previous_source = self.storage.source
        previous_model = self.model
        previous_settings = self.settings
        previous_path = self.path_var.get()
        try:
            source = self.storage.open(Path(path))
            model = EditorModel(source.content)
            settings = self.storage.settings()
            if self.pending_autosave:
                self.after_cancel(self.pending_autosave)
                self.pending_autosave = None
            self.model = model
            self.uncommitted.clear()
            self.path_var.set(str(source.path))
            self.settings = settings
            self.limit_var.set(str(self.settings["backupLimit"]))
            self._backup_warning()
            self.status_var.set(source.retention_warning or f"Opened {source.path.name}.")
            self.selection = None
            self.show_task(self.active_task)
        except (OSError, UnicodeError, ValueError) as exc:
            self.storage.source = previous_source
            self.model = previous_model
            self.settings = previous_settings
            self.path_var.set(previous_path)
            self.error("Could not open save", exc)

    def schedule_autosave(self):
        if self.pending_autosave:
            self.after_cancel(self.pending_autosave)
            self.pending_autosave = None
        if self.settings["autosave"] and not self.autosave_failed:
            self.pending_autosave = self.after(900, self._autosave)

    def _autosave(self):
        self.pending_autosave = None
        if self.settings["autosave"]:
            self.save(automatic=True)

    def save(self, automatic=False):
        if not self.model:
            self.status_var.set("Open a save first.")
            return False
        if automatic and self.uncommitted:
            self.status_var.set("Autosave paused until the active numeric edit is committed.")
            return False
        if not automatic and self.pending_autosave:
            self.after_cancel(self.pending_autosave)
            self.pending_autosave = None
        try:
            changes = self.model.changes()
        except ValueError as exc:
            if automatic:
                self.status_var.set(f"Autosave paused until the invalid draft is corrected: {exc}")
            else:
                self.error("Save failed; drafts retained", exc)
            return False
        if not changes:
            if not automatic:
                self.uncommitted.clear()
            return True
        if not automatic and not messagebox.askyesno(
                "Confirm overwrite",
                f"Close the game first. Overwrite this save with the staged changes?\n\n{self.storage.source.path}\n\n"
                + ("BACKUPS ARE DISABLED; no recovery copy will be created."
                   if self.settings["backupLimit"] == 0 else "A verified recovery backup is required."),
                parent=self, default="no"):
            return False
        try:
            result = self.storage.save(changes, confirmed=True, autosave=automatic)
            self.model = EditorModel(self.storage.source.content)
            self.uncommitted.clear()
            self._sync_tree_values()
            warning = result["retentionWarning"]
            if warning:
                self.autosave_failed = True
                self.status_var.set(f"Save succeeded, but backup cleanup is incomplete: {warning} "
                                    "Resolve it, then turn autosave off and on to retry.")
            else:
                self.status_var.set("Autosaved changes." if automatic else "Saved changes.")
            return True
        except (OSError, UnicodeError, ValueError) as exc:
            if automatic:
                self.autosave_failed = True
                self.status_var.set(f"Autosave stopped: {exc} Turn autosave off and on to retry.")
            else:
                self.error("Save failed; drafts retained", exc)
            return False

    def close(self):
        if not self._can_discard():
            return
        if self.pending_autosave:
            self.after_cancel(self.pending_autosave)
            self.pending_autosave = None
        self.destroy()

    def destroy(self):
        for attribute in ("pending_autosave", "pending_resize", "pending_startup"):
            handle = getattr(self, attribute, None)
            if handle:
                self.after_cancel(handle)
                setattr(self, attribute, None)
        super().destroy()

    def show_task(self, task):
        self.active_task = task
        self._schedule_resize()
        for child in self.task_frame.winfo_children():
            child.destroy()
        self.detail_canvas = None
        self.map_canvas = None
        self.map_draw = None
        self.scaled_trees = []
        frame = self.task_frame
        frame.configure(style="Task.TFrame")
        self._apply_task_theme()
        frame.columnconfigure(0, weight=1)
        frame.rowconfigure(2, weight=1)
        ttk.Label(frame, text=task, style="Task.TLabel", font="TkHeadingFont").grid(row=0, column=0, sticky="w")
        notes = {
            "Player & Supplies": "Edit verified player values. Maximize leaves armor and unverified capacities unchanged.",
            "Vehicles": "Repair and top off verified components and fuel. Trailer fuel is excluded.",
            "Saved Items": "Select an existing item to inspect editable fields and known location evidence.",
            "Item Map": "Read-only world X/Z positions, not the in-game map. Unresolved positions are not plotted.",
            "Settings": "Edit verified game settings. Game-slot copies and settings files are not synchronized.",
        }
        ttk.Label(frame, text=notes[task], style="TaskMuted.TLabel").grid(row=1, column=0, sticky="w", pady=(2, 6))
        if not self.model:
            ttk.Label(frame, text="Open a save file to inspect its supported values.", style="Task.TLabel").grid(row=2, column=0, sticky="nw", pady=24)
            return
        content = ttk.Frame(frame)
        content.grid(row=2, column=0, sticky="nsew")
        content.columnconfigure(0, weight=1)
        content.rowconfigure(1, weight=1)
        if task == "Item Map":
            self._map_view(content)
            return
        toolbar = ttk.Frame(content)
        toolbar.grid(row=0, column=0, sticky="ew", pady=(0, 6))
        ttk.Label(toolbar, text="Search").pack(side="left")
        self.filter_var.set("")
        search = ttk.Entry(toolbar, textvariable=self.filter_var, width=24)
        search.pack(side="left", padx=5)
        if task in ("Player & Supplies", "Saved Items"):
            ttk.Button(toolbar, text="Maximize All", style="Bulk.TButton",
                       command=self._maximize).pack(side="left", padx=5)
        if task == "Saved Items":
            ttk.Checkbutton(toolbar, text="Group by location", variable=self.group_items,
                            command=self._refresh_tree).pack(side="left", padx=5)
            ttk.Checkbutton(toolbar, text="Editable only", variable=self.editable_only,
                            command=self.set_editable_only).pack(side="left", padx=5)
        ttk.Button(toolbar, text="Expand", command=lambda: self._expand(True)).pack(side="left", padx=2)
        ttk.Button(toolbar, text="Collapse", command=lambda: self._expand(False)).pack(side="left", padx=2)
        if task == "Vehicles":
            ttk.Button(toolbar, text="Repair & Top Off All", style="Bulk.TButton",
                       command=lambda: self._vehicle_action(None, "both")).pack(side="left", padx=5)
            ttk.Button(toolbar, text="Repair selected", style="Select.TButton",
                       command=lambda: self._vehicle_action(self.selection, "repair")).pack(side="left", padx=5)
            ttk.Button(toolbar, text="Top off selected", style="Select.TButton",
                       command=lambda: self._vehicle_action(self.selection, "topoff")).pack(side="left", padx=5)
        paned = ttk.Panedwindow(content, orient="horizontal")
        paned.grid(row=1, column=0, sticky="nsew")
        left, right = ttk.Frame(paned), ttk.Frame(paned, padding=(12, 0))
        paned.add(left, weight=3)
        paned.add(right, weight=2)
        left.columnconfigure(0, weight=1)
        left.rowconfigure(0, weight=1)
        self.tree = ttk.Treeview(left, columns=("value", "location"), show="tree headings", selectmode="browse")
        self.tree.heading("#0", text="Name", command=lambda: self._sort("#0"))
        self.tree.heading("value", text="Value", command=lambda: self._sort("value"))
        self.tree.heading("location", text="Location / notes", command=lambda: self._sort("location"))
        self.tree.column("#0", minwidth=140, width=260, stretch=True)
        self.tree.column("value", minwidth=80, width=110, stretch=False)
        self.tree.column("location", minwidth=120, width=260, stretch=True)
        self._register_tree(self.tree, (("#0", 140, 260), ("value", 80, 110), ("location", 120, 260)))
        self.tree.grid(row=0, column=0, sticky="nsew")
        vertical = ttk.Scrollbar(left, orient="vertical", command=self.tree.yview)
        vertical.grid(row=0, column=1, sticky="ns")
        horizontal = ttk.Scrollbar(left, orient="horizontal", command=self.tree.xview)
        horizontal.grid(row=1, column=0, sticky="ew")
        self.tree.configure(yscrollcommand=vertical.set, xscrollcommand=horizontal.set)
        self.tree.bind("<<TreeviewSelect>>", self._selected)
        tip = ToolTip(self.tree, "")
        hovered = {"row": None}
        def hover(event):
            row = self.tree.identify_row(event.y)
            if row == hovered["row"]:
                return
            tip.hide()
            hovered["row"] = row
            if row.startswith("field|"):
                tip.text = self.model.by_id[row.removeprefix("field|")]["help"]
            elif row:
                details = self.tree.item(row)
                tip.text = " - ".join(str(part) for part in (details["text"], *details["values"]) if part)
            else:
                tip.text = ""
            if tip.text:
                tip.schedule()
        self.tree.bind("<Motion>", hover, add=True)
        right.columnconfigure(0, weight=1)
        right.rowconfigure(0, weight=1)
        detail_canvas = tk.Canvas(right, highlightthickness=0, background=self.colors["canvas"])
        self.detail_canvas = detail_canvas
        detail_canvas.grid(row=0, column=0, sticky="nsew")
        detail_scroll = ttk.Scrollbar(right, orient="vertical", command=detail_canvas.yview)
        detail_scroll.grid(row=0, column=1, sticky="ns")
        detail_canvas.configure(yscrollcommand=detail_scroll.set)
        self.detail = ttk.Frame(detail_canvas)
        detail_window = detail_canvas.create_window(0, 0, window=self.detail, anchor="nw")
        self.detail.bind("<Configure>", lambda _event: detail_canvas.configure(scrollregion=detail_canvas.bbox("all")))
        detail_canvas.bind("<Configure>", lambda event: detail_canvas.itemconfigure(detail_window, width=event.width))
        detail_canvas.bind("<MouseWheel>", lambda event: detail_canvas.yview_scroll(-int(event.delta / 120), "units"))
        self._refresh_tree()
        search.bind("<KeyRelease>", lambda _event: self._refresh_tree())

    def _apply_task_theme(self):
        weight = {"Player & Supplies": 0.02, "Vehicles": 0.06, "Saved Items": 0.10,
                  "Item Map": 0.14, "Settings": 0.04}[self.active_task]
        base, accent = self.colors.get("surface", "#f7f3e5"), self.colors.get("accent", "#883b22")
        tint = "#" + "".join(f"{round(int(base[i:i+2], 16) * (1-weight) + int(accent[i:i+2], 16) * weight):02x}"
                              for i in (1, 3, 5))
        style = ttk.Style(self)
        style.configure("Task.TFrame", background=tint)
        style.configure("Task.TLabel", background=tint, foreground=self.colors.get("ink", "#292d22"))
        style.configure("TaskMuted.TLabel", background=tint, foreground=self.colors.get("muted", "#4e5543"))

    def _sort(self, column):
        reverse = self.sort_reverse.get(column, False)
        def sort_children(parent):
            entries = list(self.tree.get_children(parent))
            entries.sort(key=lambda item: str(self.tree.item(item, "text") if column == "#0"
                                              else self.tree.set(item, column)).casefold(), reverse=reverse)
            for index, item in enumerate(entries):
                self.tree.move(item, parent, index)
                sort_children(item)
        sort_children("")
        self.sort_reverse[column] = not reverse

    def _expand(self, opened):
        def visit(parent):
            for child in self.tree.get_children(parent):
                self.tree.item(child, open=opened)
                visit(child)
        visit("")

    def _refresh_tree(self):
        selected = self.tree.selection()
        self.tree.delete(*self.tree.get_children())
        query = self.filter_var.get().casefold().strip()
        groups = {}
        def group(name):
            if name not in groups:
                groups[name] = self.tree.insert("", "end", text=name, open=True)
            return groups[name]
        if self.active_task in ("Player & Supplies", "Settings"):
            section = "player" if self.active_task == "Player & Supplies" else "settings"
            for field in self.model.fields:
                if field["section"] != section or query and query not in (field["label"] + field["id"]).casefold():
                    continue
                state = self.model.read(field)
                value = self.model.drafts.get(field["id"], field["value"]) if state["invalid"] else state["value"]
                self.tree.insert(group(field["group"]), "end", iid="field|" + field["id"],
                                 text=field["label"], values=(value, "Invalid draft" if state["invalid"] else ""))
            for field in self.model.document.readonly:
                if (field.id.startswith(("Player.", "Ammo.", "global.")) == (section == "player")
                        and (not query or query in field.id.casefold())):
                    self.tree.insert(group("Read-only"), "end", iid="readonly|" + field.id,
                                     text=field.id, values=(field.value, "Preserved unchanged"))
        elif self.active_task == "Saved Items":
            for item in self.model.document.items:
                if self.editable_only.get() and not item.fields:
                    continue
                if query and query not in (item.object.name + item.location + str(item.object.ref)).casefold():
                    continue
                parent = group(item.location) if self.group_items.get() else ""
                self.tree.insert(parent, "end", iid="item|" + item.id,
                                 text=item.object.name, values=(len(item.fields), item.location))
        else:
            for vehicle in self.model.document.vehicles:
                if query and query not in vehicle.name.casefold():
                    continue
                self.tree.insert("", "end", iid="vehicle|" + vehicle.id, text=vehicle.name,
                                 values=(len(vehicle.fields), "; ".join(vehicle.warnings)))
        if selected and self.tree.exists(selected[0]):
            self.tree.selection_set(selected[0])
            self._selected()

    def _sync_tree_values(self):
        if self.active_task == "Item Map" or not hasattr(self, "tree") or not self.tree.winfo_exists():
            return
        for field in self.model.fields:
            identifier = "field|" + field["id"]
            if self.tree.exists(identifier):
                self.tree.item(identifier, values=(field["value"], ""))

    def _selected(self, _event=None):
        selected = self.tree.selection()
        if not selected:
            return
        kind, separator, identifier = selected[0].partition("|")
        if not separator:
            return
        self.selection = identifier
        for child in self.detail.winfo_children():
            child.destroy()
        if kind == "field":
            self._field_editor(self.detail, self.model.by_id[identifier])
        elif kind == "readonly":
            scalar = next(entry for entry in self.model.document.readonly if entry.id == identifier)
            reason = getattr(scalar, "reason", "The saved value is outside verified editor bounds and is preserved unchanged.")
            ttk.Label(self.detail, text=identifier, font="TkHeadingFont", wraplength=320).pack(anchor="w")
            ttk.Label(self.detail, text=f"Saved value: {scalar.value}\n\n{reason}", wraplength=320).pack(anchor="w", pady=6)
        elif kind == "item":
            item = next(item for item in self.model.document.items if item.id == identifier)
            ttk.Label(self.detail, text=item.object.name, font="TkHeadingFont", wraplength=320).pack(anchor="w")
            ttk.Label(self.detail, text=item.location, wraplength=320).pack(anchor="w", pady=(4, 8))
            obj = item.object
            active = at(obj.object, "active")
            tag = at(obj.object, "tag")
            prefab = at(obj.object, "es3Prefab", "prefabId")
            position = self.model.document.world._vector(at(obj.transform, "localPosition"), ("x", "y", "z"))
            parent = (obj.parent_ref if obj.parent_state == "linked"
                      else "World root" if obj.parent_state == "root" else "Unresolved")
            details = [f"Reference: {obj.ref if isinstance(obj.ref, str) else 'Unresolved'}",
                       f"Transform: {obj.transform_id if isinstance(obj.transform_id, str) else 'Unresolved'}",
                       f"Parent: {parent}",
                       "Local position: " + (", ".join(str(position[axis]) for axis in ("x", "y", "z"))
                                             if position is not None else "Unresolved")]
            if active is not None and active.kind == "boolean":
                details.append(f"Active: {'Yes' if active.value else 'No'}")
            if tag is not None and tag.kind == "string":
                details.append(f"Tag: {tag.value}")
            if prefab is not None and prefab.kind == "string":
                details.append(f"Prefab: {prefab.value}")
            if item.liquid_source:
                details.append(f"Liquid capacity source: {item.liquid_source}")
            ttk.Label(self.detail, text="\n".join(details), wraplength=320, justify="left").pack(anchor="w", pady=(0, 8))
            for scalar in item.fields:
                self._field_editor(self.detail, self.model.by_id[scalar.id])
            for note in item.warnings:
                ttk.Label(self.detail, text=note, wraplength=320).pack(anchor="w", pady=3)
            for value in item.readonly:
                ttk.Label(self.detail, text=f'{value["name"]}: {value["value"]} - {value["reason"]}',
                          wraplength=320).pack(anchor="w", pady=3)
            if not item.fields and not item.readonly and not item.warnings:
                ttk.Label(self.detail, text="No verified editable values.", wraplength=320).pack(anchor="w")
        elif kind == "vehicle":
            vehicle = next(vehicle for vehicle in self.model.document.vehicles if vehicle.id == identifier)
            ttk.Label(self.detail, text=vehicle.name, font="TkHeadingFont", wraplength=320).pack(anchor="w")
            for scalar in vehicle.fields:
                self._field_editor(self.detail, self.model.by_id[scalar.id])
            for note in vehicle.warnings:
                ttk.Label(self.detail, text=note, wraplength=320).pack(anchor="w", pady=3)

    def _field_editor(self, parent, field):
        box = ttk.Frame(parent)
        box.pack(fill="x", pady=5)
        label = ttk.Label(box, text=field["label"], wraplength=300)
        label.pack(anchor="w")
        ToolTip(label, field["help"])
        current = self.model.drafts.get(field["id"], field["value"])
        variable = tk.BooleanVar(value=current) if field["type"] == "bool" else tk.StringVar(value=str(current))
        if field["type"] == "bool":
            widget = ttk.Checkbutton(box, text="Enabled", variable=variable)
        else:
            widget = ttk.Entry(box, textvariable=variable)
        widget.pack(fill="x")
        ToolTip(widget, field["help"])
        error = ttk.Label(box, style="Danger.TLabel", wraplength=300,
                          text=self.model.read(field).get("error", ""))
        error.pack(anchor="w")
        def changed(*_args):
            self.model.stage(field["id"], variable.get())
            state = self.model.read(field)
            error.configure(text=state.get("error", ""))
            self.status_var.set("Invalid draft; saving is blocked." if state["invalid"] else "Changes staged.")
            if field["type"] == "bool" and not state["invalid"]:
                self.schedule_autosave()
            elif field["type"] != "bool":
                self.uncommitted.add(field["id"])
        variable.trace_add("write", changed)
        if field["type"] != "bool":
            def commit(_event):
                if not self.model.read(field)["invalid"]:
                    self.uncommitted.discard(field["id"])
                    self.schedule_autosave()
            widget.bind("<FocusOut>", commit)
            widget.bind("<Return>", commit)

    def _maximize(self):
        try:
            result = (self.model.maximize_player(self.settings["targets"])
                      if self.active_task == "Player & Supplies"
                      else self.model.maximize_items(self.settings["targets"]))
            self.status_var.set(f"Staged {result['staged']} values; invalid and unverified values are unchanged.")
            self._refresh_tree()
            self.schedule_autosave()
        except ValueError as exc:
            self.error("Maximize failed", exc)

    def _vehicle_action(self, vehicle_id, action):
        try:
            if action != "both" and not any(vehicle.id == vehicle_id for vehicle in self.model.document.vehicles):
                raise ValueError("Select a vehicle first.")
            result = self.model.vehicle_action(vehicle_id, action, self.settings["targets"])
            self.status_var.set(f"Staged {result['staged']} values; invalid and unverified values are unchanged.")
            self._refresh_tree()
            self.schedule_autosave()
        except ValueError as exc:
            self.error("Vehicle action failed", exc)

    def targets_dialog(self):
        window = tk.Toplevel(self)
        window.configure(background=self.colors["canvas"])
        window.title("Bulk targets")
        window.transient(self)
        window.grab_set()
        body = ttk.Frame(window, padding=16)
        body.pack(fill="both", expand=True)
        ttk.Label(body, text="Used by Maximize All and Repair & Top Off; changing targets never edits the save.",
                  wraplength=420).grid(row=0, column=0, columnspan=2, sticky="w", pady=(0, 10))
        variables = {}
        for row, (key, label) in enumerate((
                ("ammo", "Ammo and verified capacities"), ("consumables", "Consumables"),
                ("nuts", "Nuts"), ("liquids", "Liquids (% of verified capacity)")), 1):
            ttk.Label(body, text=label).grid(row=row, column=0, sticky="w", pady=4)
            variables[key] = tk.StringVar(value=str(self.settings["targets"][key]))
            ttk.Entry(body, textvariable=variables[key], width=12).grid(row=row, column=1, padx=(12, 0), pady=4)
        def save_targets():
            try:
                values = {}
                for key, var in variables.items():
                    text = var.get()
                    if not text.isascii() or not text.isdecimal():
                        raise ValueError(f"{key} must be a nonnegative whole number.")
                    values[key] = int(text)
                self.settings = self.storage.update_settings({"targets": values})
                self.status_var.set("Bulk targets saved; save values were not changed.")
                window.destroy()
            except (OSError, ValueError) as exc:
                messagebox.showerror("Targets not saved", str(exc), parent=window)
        ttk.Button(body, text="Save targets", style="Select.TButton", command=save_targets).grid(
            row=5, column=0, sticky="w", pady=(12, 0))
        ttk.Button(body, text="Cancel", command=window.destroy).grid(row=5, column=1, pady=(12, 0))

    def reset_drafts(self):
        if not self.model or not self.model.drafts:
            return
        if not messagebox.askyesno("Reset drafts", "Discard all staged changes?", parent=self, default="no"):
            return
        if self.pending_autosave:
            self.after_cancel(self.pending_autosave)
            self.pending_autosave = None
        self.model = EditorModel(self.storage.source.content)
        self.uncommitted.clear()
        self.status_var.set("Drafts discarded; the saved file was not changed.")
        self.show_task(self.active_task)

    def review_changes(self):
        if not self.model:
            self.status_var.set("Open a save first.")
            return
        window = tk.Toplevel(self)
        window.configure(background=self.colors["canvas"])
        window.title("Review staged changes")
        window.geometry("720x400")
        tree = ttk.Treeview(window, columns=("saved", "draft", "status"), show="tree headings")
        for column, title in (("#0", "Field"), ("saved", "Saved"), ("draft", "Draft"), ("status", "Status")):
            tree.heading(column, text=title)
            tree.column(column, width=180 if column == "#0" else 140, stretch=True)
        tree.pack(fill="both", expand=True, padx=10, pady=10)
        for identifier, draft in self.model.drafts.items():
            field = self.model.by_id[identifier]
            state = self.model.read(field)
            tree.insert("", "end", text=field["label"],
                        values=(field["value"], draft, state.get("error", "Ready")))
        ttk.Button(window, text="Close", command=window.destroy).pack(pady=(0, 10))

    def export_copy(self, *, edited):
        if not self.model:
            self.status_var.set("Open a save first.")
            return
        try:
            changes = self.model.changes() if edited else {}
            content = (serialize_document(self.model.content.decode("utf-8"), changes).encode("utf-8")
                       if edited else self.model.content)
            source = self.storage.source.path
            name = source.stem + (".edited.es3" if edited else ".original.bak")
            target = filedialog.asksaveasfilename(parent=self, title="Export copy",
                                                  initialfile=name, initialdir=str(source.parent))
            if not target:
                return
            with Path(target).open("xb") as stream:
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
            self.status_var.set(f"Exported copy to {target}; drafts remain staged.")
        except (OSError, UnicodeError, ValueError) as exc:
            self.error("Export failed; an incomplete copy may remain", exc)

    def help(self):
        messagebox.showinfo(
            "Quick start help",
            "1. Browse to an Apocalypter .es3 file or load the newest game slot.\n"
            "2. Choose a task and select a field, vehicle, or saved item to edit.\n"
            "3. Save changes and confirm the overwrite, or enable autosave.\n\n"
            "Opening creates a verified backup when retention is above zero. "
            "Autosave reuses the recovery point. Zero disables backups. "
            "Only verified existing fields can be edited. The item map is an uncalibrated world-coordinate plot.",
            parent=self,
        )

    def _map_view(self, parent):
        objects = self.model.document.items
        world = self.model.document.world
        positioned = [(item, world.position(item.object.transform)) for item in objects]
        resolved = [(item, point) for item, point in positioned if point is not None]
        player = world.position(world.player_transform)
        summary = tk.StringVar(value=f"{len(resolved)} items resolved; {len(objects) - len(resolved)} unresolved. "
                                   + ("Player position resolved." if player else "Player position unresolved."))
        ttk.Label(parent, textvariable=summary).grid(row=0, column=0, sticky="w")
        map_panes = ttk.Panedwindow(parent, orient="horizontal")
        map_panes.grid(row=1, column=0, sticky="nsew", pady=8)
        plot = ttk.Frame(map_panes)
        listing = ttk.Frame(map_panes)
        map_panes.add(plot, weight=3)
        map_panes.add(listing, weight=2)
        plot.columnconfigure(0, weight=1)
        plot.rowconfigure(0, weight=1)
        listing.columnconfigure(0, weight=1)
        listing.rowconfigure(0, weight=1)
        canvas = tk.Canvas(plot, background=self.colors["entry"], highlightthickness=1,
                           highlightbackground=self.colors["line"], height=360)
        self.map_canvas = canvas
        canvas.grid(row=0, column=0, sticky="nsew")
        selected = tk.StringVar(value="Select a plotted point to inspect it.")
        ttk.Label(parent, textvariable=selected, wraplength=950).grid(row=2, column=0, sticky="w")
        tree = ttk.Treeview(listing, columns=("position",), show="tree headings")
        tree.heading("#0", text="Saved item")
        tree.heading("position", text="World X / Z")
        tree.column("#0", minwidth=100, width=180)
        tree.column("position", minwidth=90, width=150)
        self._register_tree(tree, (("#0", 100, 180), ("position", 90, 150)))
        tree.grid(row=0, column=0, sticky="nsew")
        scroll = ttk.Scrollbar(listing, orient="vertical", command=tree.yview)
        scroll.grid(row=0, column=1, sticky="ns")
        tree.configure(yscrollcommand=scroll.set)
        labels = {}
        selected_index = {"value": None}
        for index, (item, point) in enumerate(positioned):
            position = f'{point["x"]:.2f} / {point["z"]:.2f}' if point else "Unresolved"
            distance = (f' | {math.hypot(point["x"] - player["x"], point["z"] - player["z"]):.2f} units from player'
                        if point and player else "")
            labels[str(index)] = f"{item.object.name} | {position}{distance} | {item.location}"
            tree.insert("", "end", iid=str(index), text=item.object.name, values=(position,))
        def show_item():
            index = selected_index["value"]
            if index is None:
                return
            item = positioned[index][0]
            if self.editable_only.get():
                try:
                    self.settings = self.storage.update_settings({"editableOnly": False})
                except (OSError, ValueError) as exc:
                    self.error("Item filter not saved", exc)
                    return
                self.editable_only.set(False)
            self.show_task("Saved Items")
            row = "item|" + item.id
            parent_id = self.tree.parent(row)
            if parent_id:
                self.tree.item(parent_id, open=True)
            self.tree.selection_set(row)
            self.tree.see(row)
            self._selected()

        show_button = ttk.Button(parent, text="Show in Saved Items", style="Select.TButton",
                                 command=show_item, state="disabled")
        show_button.grid(row=3, column=0, sticky="w", pady=(6, 0))

        def select_item(index):
            selected_index["value"] = index
            selected.set(labels[str(index)])
            show_button.state(["!disabled"])
            draw()

        def select_from_list(_event=None):
            selection = tree.selection()
            if selection:
                select_item(int(selection[0]))

        def select_from_plot(index):
            tree.selection_set(str(index))
            tree.see(str(index))
            select_item(index)

        tree.bind("<<TreeviewSelect>>", select_from_list)
        def draw(_event=None):
            canvas.delete("all")
            points = [point for _, point in resolved] + ([player] if player else [])
            if not points:
                canvas.create_text(20, 20, anchor="nw", text="No positions can be resolved.",
                                   fill=self.colors["ink"])
                return
            width, height = max(80, canvas.winfo_width()), max(80, canvas.winfo_height())
            xs, zs = [p["x"] for p in points], [p["z"] for p in points]
            minx, maxx, minz, maxz = min(xs), max(xs), min(zs), max(zs)
            scale = min((width - 40) / max(maxx - minx, 1), (height - 40) / max(maxz - minz, 1))
            def screen(p):
                return 20 + (p["x"] - minx) * scale, height - 20 - (p["z"] - minz) * scale
            for index, (item, point) in enumerate(positioned):
                if point is None:
                    continue
                x, y = screen(point)
                tag = f"item{index}"
                canvas.create_oval(x-4, y-4, x+4, y+4, fill=self.colors["accent"],
                                   outline=self.colors["ink"],
                                   width=3 if selected_index["value"] == index else 1, tags=(tag,))
                canvas.tag_bind(tag, "<Button-1>", lambda _event, i=index: select_from_plot(i))
            if player:
                x, y = screen(player)
                canvas.create_rectangle(x-5, y-5, x+5, y+5, fill=self.colors["ink"], outline=self.colors["entry"])
        canvas.bind("<Configure>", draw)
        self.map_draw = draw


def main():
    if os.name == "nt":
        if len(sys.argv) == 3 and sys.argv[1] == "--smoke-test":
            path = Path(sys.argv[2])
            app = EditorGUI(path.parent / "smoke-settings.json", path.parent / "smoke-legacy",
                            discover_latest=False)
            app.withdraw()
            try:
                source = app.storage.open(path)
                app.model = EditorModel(source.content)
                for task in ("Player & Supplies", "Vehicles", "Saved Items", "Item Map", "Settings"):
                    app.show_task(task)
                    app.update()
                app.after(100, app.destroy)
                app.mainloop()
            except (OSError, UnicodeError, ValueError):
                app.destroy()
                raise
            return
        try:
            ctypes.windll.shcore.SetProcessDpiAwareness(1)
        except (AttributeError, OSError):
            ctypes.windll.user32.SetProcessDPIAware()
    try:
        app = EditorGUI()
    except (OSError, UnicodeError, ValueError) as exc:
        root = tk._default_root or tk.Tk()
        root.withdraw()
        messagebox.showerror("Could not start Apocalypter Save Editor", str(exc), parent=root)
        root.destroy()
        return
    app.mainloop()


if __name__ == "__main__":
    main()
