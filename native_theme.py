"""Native editor palette and font settings."""

import tkinter.font as tkfont
from tkinter import ttk

PALETTES = {
    ("wasteland", False): ("#dedfc4", "#f7f3e5", "#292d22", "#4e5543", "#9da38b", "#e5e5cf", "#fffbef", "#883b22"),
    ("wasteland", True): ("#171b14", "#292f22", "#f1eedc", "#c9cbb7", "#5d6850", "#384131", "#1b2118", "#f0ad82"),
    ("desert", False): ("#e9d3a6", "#fff4dc", "#3a291d", "#5d4734", "#bb9a6f", "#efddbc", "#fffaf0", "#94451a"),
    ("desert", True): ("#23180f", "#38281b", "#faebd1", "#dbc5a5", "#765a3c", "#4b3521", "#261b12", "#efbb73"),
    ("nuclear-winter", False): ("#cdd2d2", "#f5f2e8", "#1d2c37", "#45535d", "#98a6ab", "#dce1dc", "#fffdf4", "#284b67"),
    ("nuclear-winter", True): ("#111d2a", "#293743", "#f4f1e5", "#ccd2ce", "#5d7179", "#3b4b55", "#182630", "#adcedb"),
    ("apocalypse", False): ("#ead2bc", "#fff1df", "#2d211b", "#63483b", "#c19a7e", "#efd1b9", "#fff9ef", "#9b371d"),
    ("apocalypse", True): ("#18100d", "#2e2019", "#fff0dd", "#e0c5ae", "#805340", "#4b3023", "#21150f", "#ffad58"),
}
THEME_LABELS = {
    "wasteland": "Wasteland", "desert": "Desert",
    "nuclear-winter": "Nuclear Winter", "apocalypse": "Apocalypse",
}


def apply(root, world: str, dark: bool, size: int) -> dict[str, str]:
    canvas, surface, ink, muted, line, head, entry, accent = PALETTES[(world, dark)]
    colors = dict(canvas=canvas, surface=surface, ink=ink, muted=muted,
                  line=line, head=head, entry=entry, accent=accent)
    style = ttk.Style(root)
    style.theme_use("clam")
    for name in ("TkDefaultFont", "TkTextFont", "TkMenuFont", "TkHeadingFont",
                 "TkCaptionFont", "TkSmallCaptionFont", "TkIconFont", "TkTooltipFont"):
        font = tkfont.nametofont(name, root=root)
        if not hasattr(root, "_base_font_sizes"):
            root._base_font_sizes = {}
        root._base_font_sizes.setdefault(name, abs(font.cget("size")))
        font.configure(size=max(1, round(root._base_font_sizes[name] * size / 100)))
    root.configure(background=canvas)
    style.configure(".", background=canvas, foreground=ink)
    style.configure("TFrame", background=canvas)
    style.configure("Panel.TFrame", background=surface)
    style.configure("TLabel", background=canvas, foreground=ink)
    style.configure("Panel.TLabel", background=surface, foreground=ink)
    style.configure("Muted.TLabel", background=canvas, foreground=muted)
    style.configure("Danger.TLabel", background=canvas, foreground="#ffb6a8" if dark else "#9a2c20")
    style.configure("TLabelframe", background=canvas, foreground=ink)
    style.configure("TLabelframe.Label", background=canvas, foreground=ink)
    style.configure("TCheckbutton", background=canvas, foreground=ink)
    style.map("TCheckbutton", background=[("active", canvas)], foreground=[("disabled", muted)])
    style.configure("TEntry", fieldbackground=entry, foreground=ink)
    style.configure("TCombobox", fieldbackground=entry, foreground=ink, background=head)
    style.map("TCombobox", fieldbackground=[("readonly", entry), ("disabled", surface)],
              foreground=[("readonly", ink), ("disabled", muted)],
              selectbackground=[("readonly", entry)], selectforeground=[("readonly", ink)])
    style.configure("TCombobox", arrowcolor=ink)
    style.configure("TMenubutton", background=head, foreground=ink, arrowcolor=ink, bordercolor=line)
    style.map("TMenubutton", background=[("active", line)], foreground=[("disabled", muted)])
    style.configure("TScrollbar", background=head, troughcolor=canvas, arrowcolor=ink, bordercolor=line)
    style.map("TScrollbar", background=[("disabled", surface), ("active", line)],
              arrowcolor=[("disabled", muted)])
    style.configure("TButton", background=head, foreground=ink, bordercolor=line, padding=(6, 2))
    style.map("TButton", background=[("active", line)], foreground=[("disabled", muted)])
    for name, background in (("Select", "#245a87"), ("Bulk", "#276338"), ("Danger", "#992f29")):
        style.configure(f"{name}.TButton", background=background, foreground="#ffffff", padding=(6, 2))
        style.map(f"{name}.TButton", background=[("active", background)], foreground=[("disabled", "#dedede")])
    linespace = tkfont.nametofont("TkDefaultFont", root=root).metrics("linespace")
    style.configure("Treeview", background=entry, fieldbackground=entry, foreground=ink,
                    rowheight=max(20, linespace + 6), bordercolor=line)
    style.configure("Treeview.Heading", background=head, foreground=ink)
    style.map("Treeview", background=[("selected", "#245a87")], foreground=[("selected", "#ffffff")])
    return colors
