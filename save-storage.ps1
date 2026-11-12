$saveByteLimit = 20 * 1024 * 1024
$validatorPath = Join-Path $PSScriptRoot "save-edit-validator.js"

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
    param([byte[]]$Original, $Changes, [string]$NodePath)
    if (-not $NodePath) { throw "Save changes requires Node.js 18 or newer. Export a copy instead, or install Node.js and relaunch run.bat." }
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
        if ($file.Length -ne $Length -or $file.PSIsContainer) { return $false }
        return (Get-SaveHash (Read-BoundedSave $Path)) -ceq $Hash
    } catch [IO.IOException] { return $false }
    catch [UnauthorizedAccessException] { return $false }
    catch [System.Management.Automation.ItemNotFoundException] { return $false }
}

function Get-LoadBackup {
    param([string]$Path, [byte[]]$Bytes)
    $hash = Get-SaveHash $Bytes
    $prefix = [IO.Path]::GetFileName($Path) + "."
    foreach ($candidate in Get-ChildItem -LiteralPath ([IO.Path]::GetDirectoryName($Path)) -File) {
        if ($candidate.Name.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -and
            $candidate.Name.EndsWith(".original.bak", [StringComparison]::OrdinalIgnoreCase) -and
            (Test-VerifiedBackup $candidate.FullName $Bytes.Length $hash)) {
            return $candidate.FullName
        }
    }
    $backup = New-OriginalBackup -Path $Path -Bytes $Bytes
    if (-not (Test-VerifiedBackup $backup $Bytes.Length $hash)) { throw "The load-time backup could not be verified. Editing is unavailable." }
    return $backup
}

function Open-BackedUpSave {
    param([string]$Path)
    $file = Get-Item -LiteralPath $Path
    if ($file.PSIsContainer -or $file.Extension -ine ".es3") { throw "Choose an .es3 save file." }
    $bytes = Read-BoundedSave $file.FullName
    $hash = Get-SaveHash $bytes
    $backup = Get-LoadBackup -Path $file.FullName -Bytes $bytes
    if ((Get-SaveHash (Read-BoundedSave $file.FullName)) -cne $hash) { throw "The save changed during opening. Reopen it; no edits were enabled." }
    return @{
        Path = $file.FullName
        Hash = $hash
        LoadHash = $hash
        LoadLength = $bytes.Length
        LoadBackup = $backup
        ModifiedUtc = $file.LastWriteTimeUtc.ToString("o")
        Bytes = $bytes
    }
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
    param($Source, $Changes, [bool]$Confirmed, [string]$NodePath, [bool]$Autosave = $false)
    if (-not $Confirmed) { return @{ canceled = $true } }
    if (-not $Source -or -not $Source.Path -or -not $Source.Hash) { throw "This file is not bound to an opened native save. Reopen it with Choose File." }
    $original = Read-BoundedSave -Path $Source.Path
    if ((Get-SaveHash $original) -cne $Source.Hash) {
        throw "The original changed outside the editor. Nothing was written. Reopen it before saving."
    }
    $edited = Get-ValidatedSaveEdit -Original $original -Changes $Changes -NodePath $NodePath
    $loadBackupValid = $Source.LoadHash -and (Test-VerifiedBackup $Source.LoadBackup $Source.LoadLength $Source.LoadHash)
    if ($Autosave -and -not $loadBackupValid) { throw "Autosave stopped: the verified load-time backup is missing or changed. Reopen the file to back it up again." }
    $backupPath = if ($loadBackupValid -and ($Autosave -or $Source.Hash -ceq $Source.LoadHash)) {
        $Source.LoadBackup
    } else {
        New-OriginalBackup -Path $Source.Path -Bytes $original
    }
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
        return @{
            canceled = $false
            backupPath = $backupPath
            contentBase64 = [Convert]::ToBase64String($edited)
        }
    } catch {
        throw "Could not replace the save. Backup retained at ${backupPath}. $($_.Exception.Message)"
    } finally {
        if ($temporaryCreated -and [IO.File]::Exists($temporaryPath)) {
            [IO.File]::Delete($temporaryPath)
        }
    }
}
