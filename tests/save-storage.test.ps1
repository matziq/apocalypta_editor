param([string]$Root)
$ErrorActionPreference = "Stop"
. (Join-Path (Split-Path -Parent $PSScriptRoot) "save-storage.ps1")
$nodePath = (Get-Command node.exe).Source
$original = [Text.Encoding]::UTF8.GetBytes('{"peacefulMode":{"__type":"bool","value":false}}')

function Assert-BytesEqual {
    param([byte[]]$Actual, [byte[]]$Expected)
    if ((Get-SaveHash $Actual) -cne (Get-SaveHash $Expected)) { throw "Byte content differs." }
}
function Assert-Fails {
    param([scriptblock]$Action, [string]$Pattern)
    try { & $Action | Out-Null }
    catch {
        if ($_.Exception.Message -notmatch $Pattern) { throw }
        return
    }
    throw "Expected an error matching $Pattern."
}
function New-Fixture {
    param([string]$Name)
    $path = Join-Path $Root "$Name.es3"
    [IO.File]::WriteAllBytes($path, $original)
    return @{ Path = $path; Hash = Get-SaveHash $original }
}
function Backup-Count { return @(Get-ChildItem -LiteralPath $Root -File -Filter "*.original.bak").Count }

$source = New-Fixture "repeat"
$result = Save-OpenedDocument -Source $source -Changes @{ peacefulMode = $true } -Confirmed $false -NodePath $nodePath
if (-not $result.canceled -or (Backup-Count) -ne 0) { throw "Cancel caused a write." }
Assert-BytesEqual ([IO.File]::ReadAllBytes($source.Path)) $original

$first = Save-OpenedDocument -Source $source -Changes @{ peacefulMode = $true } -Confirmed $true -NodePath $nodePath
Assert-BytesEqual ([IO.File]::ReadAllBytes($first.backupPath)) $original
$firstSaved = [IO.File]::ReadAllBytes($source.Path)
if ($source.Hash -cne (Get-SaveHash $firstSaved)) { throw "Successful save did not update its baseline." }
if ($first.backupPath -notmatch '\.\d{8}T\d{9}Z\.[a-f0-9]{32}\.original\.bak$') { throw "Unexpected backup filename." }
$second = Save-OpenedDocument -Source $source -Changes @{ peacefulMode = $false } -Confirmed $true -NodePath $nodePath
if ($first.backupPath -ceq $second.backupPath) { throw "Repeated backup reused a path." }
Assert-BytesEqual ([IO.File]::ReadAllBytes($second.backupPath)) $firstSaved
Assert-BytesEqual ([IO.File]::ReadAllBytes($first.backupPath)) $original
Assert-BytesEqual ([IO.File]::ReadAllBytes($source.Path)) $original

$count = Backup-Count
Assert-Fails { Save-OpenedDocument -Source $source -Changes @{ unknown = 12 } -Confirmed $true -NodePath $nodePath } "not supported"
if ((Backup-Count) -ne $count) { throw "Validation failure created a backup." }
Assert-BytesEqual ([IO.File]::ReadAllBytes($source.Path)) $original

$external = [Text.Encoding]::UTF8.GetBytes([Text.Encoding]::UTF8.GetString($original) + " ")
[IO.File]::WriteAllBytes($source.Path, $external)
Assert-Fails { Save-OpenedDocument -Source $source -Changes @{ peacefulMode = $true } -Confirmed $true -NodePath $nodePath } "changed outside"
Assert-BytesEqual ([IO.File]::ReadAllBytes($source.Path)) $external
if ((Backup-Count) -ne $count) { throw "Stale-file refusal created a backup." }

$source = New-Fixture "backup-failure"
$realBackup = ${function:New-OriginalBackup}
try {
    function New-OriginalBackup { throw "Simulated backup failure" }
    Assert-Fails { Open-BackedUpSave $source.Path } "backup failure"
    Assert-Fails { Save-OpenedDocument -Source $source -Changes @{ peacefulMode = $true } -Confirmed $true -NodePath $nodePath } "backup failure"
    Assert-BytesEqual ([IO.File]::ReadAllBytes($source.Path)) $original
} finally { ${function:New-OriginalBackup} = $realBackup }

$source = New-Fixture "replace-failure"
$realReplace = ${function:Install-EditedSave}
$count = Backup-Count
try {
    function Install-EditedSave { throw "Simulated replacement failure" }
    Assert-Fails { Save-OpenedDocument -Source $source -Changes @{ peacefulMode = $true } -Confirmed $true -NodePath $nodePath } "Backup retained"
    Assert-BytesEqual ([IO.File]::ReadAllBytes($source.Path)) $original
    if ((Backup-Count) -ne $count + 1) { throw "Replacement failure did not retain the backup." }
    if (@(Get-ChildItem -LiteralPath $Root -Force -Filter ".apocalypter-*.tmp").Count) { throw "Owned temporary replacement was not cleaned up." }
} finally { ${function:Install-EditedSave} = $realReplace }

foreach ($name in @("SaveGame1", "SaveGame2", "SaveSettings", "SaveGame2.edited")) { New-Fixture $name | Out-Null }
New-Fixture ("SaveGame" + [char]0x0663) | Out-Null
[IO.File]::SetLastWriteTimeUtc((Join-Path $Root "SaveGame1.es3"), [DateTime]::UtcNow.AddMinutes(-3))
[IO.File]::SetLastWriteTimeUtc((Join-Path $Root "SaveGame2.es3"), [DateTime]::UtcNow.AddMinutes(-2))
if ([IO.Path]::GetFileName((Get-LatestGameSlot $Root)) -cne "SaveGame2.es3") { throw "Latest slot included a newer setting or edited export." }
$newestPath = Get-LatestGameSlot $Root
$locked = [IO.File]::Open($newestPath, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
try {
    Assert-Fails { Open-BackedUpSave (Get-LatestGameSlot $Root) } "used by another process"
} finally { $locked.Dispose() }
$source = Open-BackedUpSave (Get-LatestGameSlot $Root)
$source.Remove("Bytes")
$loadBackup = $source.LoadBackup
$count = Backup-Count
Assert-BytesEqual ([IO.File]::ReadAllBytes($loadBackup)) $original
$same = Open-BackedUpSave $source.Path
if ($same.LoadBackup -cne $loadBackup -or (Backup-Count) -ne $count) { throw "Repeated open did not deduplicate exact-byte backups." }
$first = Save-OpenedDocument $source @{ peacefulMode = $true } $true $nodePath -Autosave $true
$second = Save-OpenedDocument $source @{ peacefulMode = $false } $true $nodePath -Autosave $true
if ((Backup-Count) -ne $count) { throw "Autosave created per-change backups." }
Assert-BytesEqual ([IO.File]::ReadAllBytes($loadBackup)) $original
$manual = Save-OpenedDocument $source @{ peacefulMode = $true } $true $nodePath
if ($manual.backupPath -cne $loadBackup) { throw "Manual save did not reuse an identical load-time backup." }
$manual = Save-OpenedDocument $source @{ peacefulMode = $false } $true $nodePath
if ($manual.backupPath -ceq $loadBackup) { throw "Manual save did not preserve the changed preceding bytes." }
[IO.File]::WriteAllBytes($loadBackup, $external)
Assert-Fails { Save-OpenedDocument $source @{ peacefulMode = $true } $true $nodePath -Autosave $true } "backup is missing or changed"
Assert-BytesEqual ([IO.File]::ReadAllBytes($source.Path)) $original
$fresh = Open-BackedUpSave $source.Path
if ($fresh.LoadBackup -ceq $loadBackup) { throw "Open reused a corrupted backup." }
[IO.File]::WriteAllBytes($source.Path, $external)
Assert-Fails { Save-OpenedDocument $fresh @{ peacefulMode = $true } $true $nodePath -Autosave $true } "changed outside"

Write-Output "Storage tests passed: cancel/no writes, exact backup bytes, repeat backup isolation, validation, stale-file refusal, backup failure, atomic replacement failure and baseline refresh."
