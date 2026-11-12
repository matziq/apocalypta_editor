param([Parameter(Mandatory = $true)][string]$Url)
$ErrorActionPreference = "Stop"

# A separate short-lived helper lets the bridge serve the page while its window opens.
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class EditorBrowserWindow {
    public delegate bool Callback(IntPtr window, IntPtr data);
    [DllImport("user32.dll")] public static extern bool EnumWindows(Callback callback, IntPtr data);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int length);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr window, int command);
    public static List<IntPtr> Editors() {
        var result = new List<IntPtr>();
        EnumWindows((window, data) => {
            var title = new StringBuilder(512);
            GetWindowText(window, title, title.Capacity);
            if (IsWindowVisible(window) && title.ToString().Contains("Apocalypter Save Editor")) result.Add(window);
            return true;
        }, IntPtr.Zero);
        return result;
    }
}
'@
$before = @([EditorBrowserWindow]::Editors())
$launched = $false
try {
    $choice = Get-ItemProperty "HKCU:\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice" -ErrorAction Stop
    $command = (Get-Item ("Registry::HKEY_CLASSES_ROOT\" + $choice.ProgId + "\shell\open\command") -ErrorAction Stop).GetValue("")
    if ($command -match '^\s*"([^"]+)"') {
        $executable = $Matches[1]
        if ([IO.Path]::GetFileName($executable) -match '^(msedge|chrome|brave|vivaldi)\.exe$') {
            Start-Process -FilePath $executable -ArgumentList "--new-window --start-maximized `"$Url`""
            $launched = $true
        }
    }
} catch {
    Write-Warning "Could not detect a Chromium browser; using the default URL handler. $($_.Exception.Message)"
}
if (-not $launched) { Start-Process $Url }
for ($attempt = 0; $attempt -lt 80; $attempt++) {
    Start-Sleep -Milliseconds 250
    $current = @([EditorBrowserWindow]::Editors())
    $windows = @($current | Where-Object { $_ -notin $before })
    if ($attempt -ge 60 -and -not $windows.Count) { $windows = $current }
    if ($windows.Count) {
        foreach ($window in $windows) { [void][EditorBrowserWindow]::ShowWindowAsync($window, 3) }
        Write-Output "Requested maximized Apocalypter Save Editor browser window."
        exit 0
    }
}
Write-Warning "No new editor window was found within 20 seconds. The browser may have reused an existing tab; maximize that window manually."
