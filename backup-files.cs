using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace Apocalypter {
    public static class BackupFiles {
        [StructLayout(LayoutKind.Sequential)]
        private struct FileInfo {
            public uint Attributes;
            public System.Runtime.InteropServices.ComTypes.FILETIME Creation, Access, Write;
            public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
        }
        [StructLayout(LayoutKind.Sequential)]
        private struct Disposition { [MarshalAs(UnmanagedType.U1)] public bool Delete; }
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security, uint mode, uint flags, IntPtr template);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GetFileInformationByHandle(SafeFileHandle file, out FileInfo info);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetFileInformationByHandle(SafeFileHandle file, int kind, ref Disposition info, uint size);

        private static SafeFileHandle Open(string path, bool deleting) {
            // Open the directory entry itself, never a reparse target; deletion holds out writers and renames.
            var file = CreateFile(path, deleting ? 0x10080u : 0x80u, deleting ? 1u : 7u, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero);
            if (file.IsInvalid) {
                int error = Marshal.GetLastWin32Error();
                file.Dispose();
                throw new Win32Exception(error, "Cannot inspect backup entry: " + path);
            }
            return file;
        }
        private static string Identity(SafeFileHandle file) {
            FileInfo info;
            if (!GetFileInformationByHandle(file, out info)) throw new Win32Exception(Marshal.GetLastWin32Error());
            if ((info.Attributes & (0x10u | 0x400u)) != 0 || info.Links != 1) return null;
            return String.Join(":", info.Volume, info.IndexHigh, info.IndexLow, info.SizeHigh, info.SizeLow, info.Write.dwHighDateTime, info.Write.dwLowDateTime);
        }
        public static string Fingerprint(string path) {
            using (var file = Open(path, false)) return Identity(file);
        }
        public static void DeleteUnchanged(string path, string expected) {
            using (var file = Open(path, true)) {
                if (expected == null || !String.Equals(expected, Identity(file), StringComparison.Ordinal))
                    throw new IOException("Backup changed, is a link, or is no longer a regular single-link file: " + path);
                var disposition = new Disposition { Delete = true };
                if (!SetFileInformationByHandle(file, 4, ref disposition, (uint)Marshal.SizeOf(typeof(Disposition))))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not remove backup: " + path);
            }
        }
    }
}
