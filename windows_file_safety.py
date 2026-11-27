"""Windows entry identity and handle-bound deletion for editor backups."""

from __future__ import annotations

import ctypes
import hashlib
from contextlib import contextmanager
from ctypes import wintypes
from pathlib import Path

if not hasattr(ctypes, "WinDLL"):
    raise OSError("Backup entry protection requires Windows.")

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value


class _FileInfo(ctypes.Structure):
    _fields_ = [
        ("attributes", wintypes.DWORD),
        ("creation", wintypes.FILETIME),
        ("access", wintypes.FILETIME),
        ("write", wintypes.FILETIME),
        ("volume", wintypes.DWORD),
        ("size_high", wintypes.DWORD),
        ("size_low", wintypes.DWORD),
        ("links", wintypes.DWORD),
        ("index_high", wintypes.DWORD),
        ("index_low", wintypes.DWORD),
    ]


class _Disposition(ctypes.Structure):
    _fields_ = [("delete", ctypes.c_ubyte)]


kernel32.CreateFileW.argtypes = (
    wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p,
    wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE,
)
kernel32.CreateFileW.restype = wintypes.HANDLE
kernel32.GetFileInformationByHandle.argtypes = (wintypes.HANDLE, ctypes.POINTER(_FileInfo))
kernel32.GetFileInformationByHandle.restype = wintypes.BOOL
kernel32.SetFileInformationByHandle.argtypes = (wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD)
kernel32.SetFileInformationByHandle.restype = wintypes.BOOL
kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
kernel32.CloseHandle.restype = wintypes.BOOL
kernel32.ReplaceFileW.argtypes = (wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.LPCWSTR,
                                  wintypes.DWORD, ctypes.c_void_p, ctypes.c_void_p)
kernel32.ReplaceFileW.restype = wintypes.BOOL
kernel32.CreateMutexW.argtypes = (ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR)
kernel32.CreateMutexW.restype = wintypes.HANDLE
kernel32.WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)
kernel32.WaitForSingleObject.restype = wintypes.DWORD
kernel32.ReleaseMutex.argtypes = (wintypes.HANDLE,)
kernel32.ReleaseMutex.restype = wintypes.BOOL


def _open(path: Path, deleting: bool, protected: bool = False):
    handle = kernel32.CreateFileW(
        str(path), 0x10080 if deleting else 0x80000080 if protected else 0x80,
        1 if deleting or protected else 7, None, 3, 0x02200000, None,
    )
    if handle == INVALID_HANDLE_VALUE:
        raise ctypes.WinError(ctypes.get_last_error())
    return handle


def _identity(handle):
    info = _FileInfo()
    if not kernel32.GetFileInformationByHandle(handle, ctypes.byref(info)):
        raise ctypes.WinError(ctypes.get_last_error())
    if info.attributes & (0x10 | 0x400) or info.links != 1:
        return None
    return (info.volume, info.index_high, info.index_low, info.size_high, info.size_low,
            info.write.dwHighDateTime, info.write.dwLowDateTime)


def fingerprint(path: Path):
    handle = _open(path, False)
    try:
        return _identity(handle)
    finally:
        kernel32.CloseHandle(handle)


def delete_unchanged(path: Path, expected) -> None:
    handle = _open(path, True)
    try:
        if expected is None or _identity(handle) != expected:
            raise OSError(f"Backup changed, is a link, or is no longer a regular single-link file: {path}")
        disposition = _Disposition(1)
        if not kernel32.SetFileInformationByHandle(handle, 4, ctypes.byref(disposition), ctypes.sizeof(disposition)):
            raise ctypes.WinError(ctypes.get_last_error())
    finally:
        kernel32.CloseHandle(handle)


@contextmanager
def hold_unchanged(path: Path, expected):
    handle = _open(path, False, protected=True)
    try:
        if expected is None or _identity(handle) != expected:
            raise OSError(f"Backup changed, is a link, or is no longer a regular single-link file: {path}")
        yield
    finally:
        kernel32.CloseHandle(handle)


def replace_file(temporary: Path, destination: Path) -> None:
    if not kernel32.ReplaceFileW(str(destination), str(temporary), None, 0, None, None):
        raise ctypes.WinError(ctypes.get_last_error())


@contextmanager
def policy_lock(settings_path: Path, timeout_ms: int = 5000):
    normalized = str(settings_path.absolute()).upper().encode("utf-8")
    name = "Local\\ApocalypterPolicy-" + hashlib.sha256(normalized).hexdigest()
    handle = kernel32.CreateMutexW(None, False, name)
    if not handle:
        raise ctypes.WinError(ctypes.get_last_error())
    acquired = False
    try:
        status = kernel32.WaitForSingleObject(handle, timeout_ms)
        if status not in (0, 0x80):
            if status == 0x102:
                raise TimeoutError("The editor settings are locked by another session.")
            raise ctypes.WinError(ctypes.get_last_error())
        acquired = True
        yield
    finally:
        if acquired and not kernel32.ReleaseMutex(handle):
            error = ctypes.WinError(ctypes.get_last_error())
            kernel32.CloseHandle(handle)
            raise error
        kernel32.CloseHandle(handle)
