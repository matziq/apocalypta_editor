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

function Install-EditedSave {
    param([string]$TemporaryPath, [string]$Destination)
    [IO.File]::Replace($TemporaryPath, $Destination, [NullString]::Value)
}

function Save-OpenedDocument {
    param($Source, $Changes, [bool]$Confirmed, [string]$NodePath)
    if (-not $Confirmed) { return @{ canceled = $true } }
    if (-not $Source -or -not $Source.Path -or -not $Source.Hash) { throw "This file is not bound to an opened native save. Reopen it with Choose File." }
    $original = Read-BoundedSave -Path $Source.Path
    if ((Get-SaveHash $original) -cne $Source.Hash) {
        throw "The original changed outside the editor. Nothing was written. Reopen it before saving."
    }
    $edited = Get-ValidatedSaveEdit -Original $original -Changes $Changes -NodePath $NodePath
    $backupPath = New-OriginalBackup -Path $Source.Path -Bytes $original
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
