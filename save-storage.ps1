$saveByteLimit = 20 * 1024 * 1024
$validatorPath = Join-Path $PSScriptRoot "save-edit-validator.js"
if (-not ("Apocalypter.BackupFiles" -as [type])) { Add-Type -Path (Join-Path $PSScriptRoot "backup-files.cs") }

function ConvertTo-BackupLimit {
    param($Value)
    if (($Value -isnot [int] -and $Value -isnot [long] -and $Value -isnot [double] -and $Value -isnot [decimal]) -or
        $Value -lt 0 -or $Value -gt 9007199254740991 -or [double]::IsNaN([double]$Value) -or [Math]::Truncate([double]$Value) -ne $Value) {
        throw "Backup limit must be a whole number from 0 to 9007199254740991."
    }
    return [long]$Value
}

function Read-BackupLimit {
    param([string]$SettingsPath)
    try { $file = Get-Item -LiteralPath $SettingsPath -Force -ErrorAction Stop }
    catch [System.Management.Automation.ItemNotFoundException] { return [long]3 }
    if ($file.Length -gt 4096 -or -not [Apocalypter.BackupFiles]::Fingerprint($file.FullName)) { throw "Backup settings must be a small regular file, not a directory or link." }
    $text = [IO.File]::ReadAllText($file.FullName)
    if ($text -cnotmatch '\A\s*\{\s*"version"\s*:\s*1\s*,\s*"backupLimit"\s*:\s*(?:0|[1-9][0-9]*)\s*\}\s*\z') {
        throw "Backup settings are malformed or are not in the editor-managed version-1 format."
    }
    $settings = $text | ConvertFrom-Json
    if ($settings.version -isnot [int] -or $settings.version -ne 1 -or @($settings.PSObject.Properties.Name | Where-Object { $_ -cnotin @("version", "backupLimit") }).Count) {
        throw "Backup settings have an unsupported structure."
    }
    return ConvertTo-BackupLimit $settings.backupLimit
}

function Write-BackupLimit {
    param([string]$SettingsPath, $Limit)
    $limitValue = ConvertTo-BackupLimit $Limit
    $directory = [IO.Path]::GetDirectoryName($SettingsPath)
    [void][IO.Directory]::CreateDirectory($directory)
    $temporary = Join-Path $directory (".apocalypter-settings-" + [Guid]::NewGuid().ToString("N") + ".tmp")
    try {
        Write-NewSaveFile $temporary ([Text.Encoding]::UTF8.GetBytes('{"version":1,"backupLimit":' + $limitValue.ToString([Globalization.CultureInfo]::InvariantCulture) + '}'))
        if ([IO.File]::Exists($SettingsPath)) {
            if (-not [Apocalypter.BackupFiles]::Fingerprint($SettingsPath)) { throw "Backup settings cannot replace a link." }
            [IO.File]::Replace($temporary, $SettingsPath, [NullString]::Value)
        } else { [IO.File]::Move($temporary, $SettingsPath) }
    } finally { if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) } }
}

function ConvertTo-BulkTargets {
    param($Targets)
    if ($null -eq $Targets -or @($Targets.PSObject.Properties.Name).Count -ne 4 -or
        @($Targets.PSObject.Properties.Name | Where-Object { $_ -cnotin @("ammo", "consumables", "nuts", "liquids") }).Count) {
        throw "Bulk targets require exactly ammo, consumables, nuts and liquids."
    }
    $result = @{}
    foreach ($spec in @(@("ammo", 0, 2147483647), @("consumables", 1, 2147483647), @("nuts", 0, 1000000), @("liquids", 0, 100))) {
        $name, $min, $max = $spec
        $value = $Targets.$name
        if (($value -isnot [int] -and $value -isnot [long]) -or $value -lt $min -or $value -gt $max) {
            throw "$name target must be a whole number from $min to $max."
        }
        $result[$name] = [long]$value
    }
    return $result
}

function Read-BulkTargets {
    param([string]$Path)
    try { $file = Get-Item -LiteralPath $Path -Force -ErrorAction Stop }
    catch [System.Management.Automation.ItemNotFoundException] { return @{ ammo = 999; consumables = 999; nuts = 900000; liquids = 100 } }
    if ($file.Length -gt 4096 -or -not [Apocalypter.BackupFiles]::Fingerprint($file.FullName)) { throw "Bulk target settings must be a small regular file, not a directory or link." }
    $text = [IO.File]::ReadAllText($file.FullName)
    if ($text -cnotmatch '\A\{"ammo":(?:0|[1-9][0-9]*),"consumables":(?:0|[1-9][0-9]*),"nuts":(?:0|[1-9][0-9]*),"liquids":(?:0|[1-9][0-9]*)\}\z') {
        throw "Bulk target settings are malformed."
    }
    return ConvertTo-BulkTargets ($text | ConvertFrom-Json)
}

function Write-BulkTargets {
    param([string]$Path, $Targets)
    $values = ConvertTo-BulkTargets $Targets
    $directory = [IO.Path]::GetDirectoryName($Path)
    [void][IO.Directory]::CreateDirectory($directory)
    $temporary = Join-Path $directory (".apocalypter-targets-" + [Guid]::NewGuid().ToString("N") + ".tmp")
    $text = '{"ammo":' + $values.ammo + ',"consumables":' + $values.consumables + ',"nuts":' + $values.nuts + ',"liquids":' + $values.liquids + '}'
    try {
        Write-NewSaveFile $temporary ([Text.Encoding]::UTF8.GetBytes($text))
        if ([IO.File]::Exists($Path)) {
            if (-not [Apocalypter.BackupFiles]::Fingerprint($Path)) { throw "Bulk target settings cannot replace a link." }
            [IO.File]::Replace($temporary, $Path, [NullString]::Value)
        } else { [IO.File]::Move($temporary, $Path) }
    } finally { if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) } }
}

function Get-EditorBackups {
    param([string]$Path)
    $fullPath = [IO.Path]::GetFullPath($Path)
    $directory = [IO.Path]::GetDirectoryName($fullPath)
    $pattern = '^' + [Regex]::Escape([IO.Path]::GetFileName($fullPath)) + '\.([0-9]{8}T[0-9]{9}Z)\.([a-f0-9]{32})\.original\.bak$'
    foreach ($candidate in Get-ChildItem -LiteralPath $directory -Force) {
        if ($candidate.PSIsContainer -or $candidate.Name -cnotmatch $pattern -or
            [IO.Path]::GetDirectoryName($candidate.FullName) -cne $directory) { continue }
        $stamp = [DateTime]::MinValue
        if (-not [DateTime]::TryParseExact($Matches[1], "yyyyMMdd'T'HHmmssfff'Z'", [Globalization.CultureInfo]::InvariantCulture,
                [Globalization.DateTimeStyles]::AssumeUniversal, [ref]$stamp)) { continue }
        $identity = [Apocalypter.BackupFiles]::Fingerprint($candidate.FullName)
        if ($identity) { [PSCustomObject]@{ Path = $candidate.FullName; Stamp = $stamp; Identity = $identity; Length = $candidate.Length } }
    }
}

function Remove-EditorBackup {
    param($Backup)
    [Apocalypter.BackupFiles]::DeleteUnchanged($Backup.Path, $Backup.Identity)
}

function Invoke-BackupRetention {
    param([string]$Path, $Limit, [string]$ProtectedBackup, [long]$ProtectedLength, [string]$ProtectedHash)
    $limitValue = ConvertTo-BackupLimit $Limit
    $failures = [Collections.Generic.List[string]]::new()
    $recoveryLock = $null
    try {
        if ($limitValue -gt 0) {
            $recoveryLock = [IO.File]::Open($ProtectedBackup, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
            if (-not (Test-VerifiedBackup $ProtectedBackup $ProtectedLength $ProtectedHash)) { throw "The recovery point changed; no backups were pruned." }
        }
        $backups = @(Get-EditorBackups $Path | Sort-Object @{ Expression = { $_.Stamp }; Descending = $true }, Path)
        if ($limitValue -gt 0 -and -not ($backups | Where-Object { $_.Path -ceq $ProtectedBackup })) {
            throw "The verified recovery point is no longer an eligible editor backup; no pruning was attempted."
        }
        $remaining = $limitValue
        foreach ($backup in $backups) {
            if ($limitValue -gt 0 -and $backup.Path -ceq $ProtectedBackup) { continue }
            if ($remaining -gt $(if ($limitValue -gt 0) { 1 } else { 0 })) { $remaining--; continue }
            try { Remove-EditorBackup $backup }
            catch { $failures.Add("$($backup.Path): $($_.Exception.Message)") }
        }
    } catch { $failures.Add($_.Exception.Message) }
    finally { if ($recoveryLock) { $recoveryLock.Dispose() } }
    return ($failures -join " ")
}

function Get-SaveHash {
    param([byte[]]$Bytes)
    $hasher = [Security.Cryptography.SHA256]::Create()
    try {
        return [BitConverter]::ToString($hasher.ComputeHash($Bytes)).Replace("-", "").ToLowerInvariant()
    } finally { $hasher.Dispose() }
}

function Read-BoundedSave {
    param([string]$Path)
    $stream = [IO.File]::OpenRead($Path)
    try {
        if ($stream.Length -gt $saveByteLimit) { throw "Save exceeds the 20 MiB limit." }
        $buffer = New-Object byte[] ($saveByteLimit + 1)
        $count = 0
        while ($count -lt $buffer.Length) {
            $read = $stream.Read($buffer, $count, $buffer.Length - $count)
            if ($read -eq 0) { break }
            $count += $read
        }
        if ($count -gt $saveByteLimit) { throw "Save exceeds the 20 MiB limit." }
        $bytes = New-Object byte[] $count
        [Array]::Copy($buffer, $bytes, $count)
        return ,$bytes
    } finally { $stream.Dispose() }
}

function Get-ValidatedSaveEdit {
    param([byte[]]$Original, $Changes, [string]$NodePath, [switch]$InspectOnly)
    if (-not $NodePath) { throw "Save validation and destructive backup retention require Node.js 18 or newer. Native inspection/export remains available without pruning; install Node.js and relaunch run.bat to enable validated writes." }
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $NodePath
    $start.Arguments = '"' + $validatorPath + '"'
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $start
    try {
        [void]$process.Start()
        $payload = @{
            originalBase64 = [Convert]::ToBase64String($Original)
            changes = $Changes
            inspectOnly = [bool]$InspectOnly
        } | ConvertTo-Json -Compress -Depth 10
        $writer = [IO.StreamWriter]::new($process.StandardInput.BaseStream, [Text.UTF8Encoding]::new($false))
        try { $writer.Write($payload) } finally { $writer.Dispose() }
        $output = $process.StandardOutput.ReadToEnd()
        $errors = $process.StandardError.ReadToEnd()
        $process.WaitForExit()
        if (-not $output) { throw "Save validation failed: $errors" }
        $result = $output | ConvertFrom-Json
        if ($result.error -or $process.ExitCode -ne 0) { throw "Save validation failed: $($result.error)" }
        $bytes = [Convert]::FromBase64String($result.contentBase64)
        if ($bytes.Length -gt $saveByteLimit) { throw "Edited save exceeds the 20 MiB limit." }
        return ,$bytes
    } finally { $process.Dispose() }
}

function Write-NewSaveFile {
    param([string]$Path, [byte[]]$Bytes)
    $stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
        $stream.Write($Bytes, 0, $Bytes.Length)
        $stream.Flush($true)
    } finally { $stream.Dispose() }
}

function New-OriginalBackup {
    param([string]$Path, [byte[]]$Bytes)
    $stamp = [DateTime]::UtcNow.ToString("yyyyMMdd'T'HHmmssfff'Z'")
    $backupPath = "$Path.$stamp.$([Guid]::NewGuid().ToString('N')).original.bak"
    try { Write-NewSaveFile -Path $backupPath -Bytes $Bytes }
    catch { throw "Backup creation failed; the original was not replaced. Incomplete backup, if present: ${backupPath}. $($_.Exception.Message)" }
    return $backupPath
}

function Test-VerifiedBackup {
    param([string]$Path, [long]$Length, [string]$Hash)
    if (-not $Path) { return $false }
    try {
        $file = Get-Item -LiteralPath $Path -ErrorAction Stop
        if ($file.Length -ne $Length -or $file.PSIsContainer -or -not [Apocalypter.BackupFiles]::Fingerprint($file.FullName)) { return $false }
        return (Get-SaveHash (Read-BoundedSave $Path)) -ceq $Hash
    } catch [IO.IOException] { return $false }
    catch [ComponentModel.Win32Exception] { return $false }
    catch [UnauthorizedAccessException] { return $false }
    catch [System.Management.Automation.ItemNotFoundException] { return $false }
}

function Get-LoadBackup {
    param([string]$Path, [byte[]]$Bytes)
    $hash = Get-SaveHash $Bytes
    foreach ($candidate in Get-EditorBackups $Path | Sort-Object @{ Expression = { $_.Stamp }; Descending = $true }, Path) {
        if ($candidate.Length -eq $Bytes.Length -and (Test-VerifiedBackup $candidate.Path $Bytes.Length $hash)) {
            return $candidate.Path
        }
    }
    $backup = New-OriginalBackup -Path $Path -Bytes $Bytes
    if (-not (Test-VerifiedBackup $backup $Bytes.Length $hash)) { throw "The load-time backup could not be verified. Editing is unavailable." }
    return $backup
}

function Open-BackedUpSave {
    param([string]$Path, $BackupLimit = 3, [string]$NodePath = (Get-Command node.exe -ErrorAction SilentlyContinue).Source)
    $limit = ConvertTo-BackupLimit $BackupLimit
    $file = Get-Item -LiteralPath $Path
    if ($file.PSIsContainer -or $file.Extension -ine ".es3") { throw "Choose an .es3 save file." }
    $bytes = Read-BoundedSave $file.FullName
    $hash = Get-SaveHash $bytes
    if ($NodePath) { Get-ValidatedSaveEdit -Original $bytes -NodePath $NodePath -InspectOnly | Out-Null }
    $backup = if ($limit -gt 0) { Get-LoadBackup -Path $file.FullName -Bytes $bytes } else { $null }
    if ((Get-SaveHash (Read-BoundedSave $file.FullName)) -cne $hash) { throw "The save changed during opening. Reopen it; no edits were enabled." }
    $source = @{
        Path = $file.FullName
        Hash = $hash
        LoadHash = $hash
        LoadLength = $bytes.Length
        LoadBackup = $backup
        ModifiedUtc = $file.LastWriteTimeUtc.ToString("o")
        Bytes = $bytes
        BackupLimit = $limit
        PruningAllowed = [bool]$NodePath
    }
    $source.RetentionWarning = if ($NodePath) {
        Invoke-BackupRetention $source.Path $limit $backup $bytes.Length $hash
    } else { "Node.js 18+ is unavailable. Native inspection/export remains available, but validation and destructive backup pruning are deferred. The backup count has NOT been enforced; no existing backups were removed." }
    return $source
}

function Set-SourceBackupLimit {
    param($Source, $BackupLimit)
    $limit = ConvertTo-BackupLimit $BackupLimit
    $bytes = Read-BoundedSave $Source.Path
    if ((Get-SaveHash $bytes) -cne $Source.Hash) { throw "The original changed outside the editor. Backup retention was not applied; drafts remain staged." }
    $backup = if ($limit -gt 0) { Get-LoadBackup $Source.Path $bytes } else { $null }
    if ((Get-SaveHash (Read-BoundedSave $Source.Path)) -cne $Source.Hash) { throw "The original changed while preparing retention. No backups were pruned." }
    $Source.BackupLimit = $limit
    $Source.LoadBackup = $backup
    $Source.LoadHash = if ($limit -gt 0) { $Source.Hash } else { $null }
    $Source.LoadLength = if ($limit -gt 0) { $bytes.Length } else { 0 }
}

function Get-LatestGameSlot {
    param([string]$Folder)
    if (-not (Test-Path -LiteralPath $Folder -PathType Container)) { throw "The Apocalypter save folder does not exist: $Folder" }
    $slots = @(Get-ChildItem -LiteralPath $Folder -File |
        Where-Object { $_.Name -match '^SaveGame[0-9]+\.es3$' } |
        Sort-Object @{ Expression = { $_.LastWriteTimeUtc }; Descending = $true }, Name)
    if (-not $slots.Count) { throw "No SaveGameN.es3 slots were found in $Folder. Choose a file manually." }
    return $slots[0].FullName
}

function Install-EditedSave {
    param([string]$TemporaryPath, [string]$Destination)
    [IO.File]::Replace($TemporaryPath, $Destination, [NullString]::Value)
}

function Save-OpenedDocument {
    param($Source, $Changes, [bool]$Confirmed, [string]$NodePath, [bool]$Autosave = $false, $BackupLimit = 3)
    if (-not $Confirmed) { return @{ canceled = $true } }
    if (-not $Source -or -not $Source.Path -or -not $Source.Hash) { throw "This file is not bound to an opened native save. Reopen it with Choose File." }
    if ($Autosave -and $Source.RetentionWarning) { throw "Autosave paused: backup cleanup is incomplete. Resolve the problem and apply the backup limit again." }
    $original = Read-BoundedSave -Path $Source.Path
    if ((Get-SaveHash $original) -cne $Source.Hash) {
        throw "The original changed outside the editor. Nothing was written. Reopen it before saving."
    }
    $edited = Get-ValidatedSaveEdit -Original $original -Changes $Changes -NodePath $NodePath
    $limit = ConvertTo-BackupLimit $BackupLimit
    $loadBackupValid = $Source.LoadHash -and (Test-VerifiedBackup $Source.LoadBackup $Source.LoadLength $Source.LoadHash)
    if ($Autosave -and $limit -gt 0 -and $Source.BackupLimit -ne 0 -and -not $loadBackupValid) { throw "Autosave stopped: the verified load-time backup is missing or changed. Reopen the file to back it up again." }
    $backupPath = if ($limit -eq 0) { $null } elseif ($loadBackupValid -and ($Autosave -or $Source.Hash -ceq $Source.LoadHash)) {
        $Source.LoadBackup
    } else {
        Get-LoadBackup -Path $Source.Path -Bytes $original
    }
    if ($backupPath -and $backupPath -cne $Source.LoadBackup) {
        $Source.LoadBackup = $backupPath
        $Source.LoadHash = $Source.Hash
        $Source.LoadLength = $original.Length
    }
    $Source.BackupLimit = $limit
    if ($limit -eq 0) { $Source.LoadBackup = $null; $Source.LoadHash = $null; $Source.LoadLength = 0 }
    $temporaryPath = Join-Path ([IO.Path]::GetDirectoryName($Source.Path)) (".apocalypter-" + [Guid]::NewGuid().ToString("N") + ".tmp")
    $temporaryCreated = $false
    try {
        $temporary = [IO.File]::Open($temporaryPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        $temporaryCreated = $true
        try {
            $temporary.Write($edited, 0, $edited.Length)
            $temporary.Flush($true)
        } finally { $temporary.Dispose() }
        if ((Get-SaveHash (Read-BoundedSave -Path $Source.Path)) -cne $Source.Hash) {
            throw "The original changed while preparing the save. Replacement was canceled."
        }
        Install-EditedSave -TemporaryPath $temporaryPath -Destination $Source.Path
        $Source.Hash = Get-SaveHash $edited
    } catch {
        $recovery = if ($backupPath) { "Backup retained at ${backupPath}." } else { "Backups are disabled; no recovery copy was created." }
        throw "Could not replace the save. $recovery $($_.Exception.Message)"
    } finally {
        if ($temporaryCreated -and [IO.File]::Exists($temporaryPath)) {
            [IO.File]::Delete($temporaryPath)
        }
    }
    # Replacement has committed: cleanup errors must be returned as warnings, never as a failed save.
    $Source.RetentionWarning = Invoke-BackupRetention $Source.Path $limit $Source.LoadBackup $Source.LoadLength $Source.LoadHash
    return @{
        canceled = $false
        saved = $true
        backupLimit = $limit
        backupPath = $backupPath
        retentionWarning = $Source.RetentionWarning
        contentBase64 = [Convert]::ToBase64String($edited)
    }
}
