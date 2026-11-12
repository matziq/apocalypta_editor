param([string]$Root)
$ErrorActionPreference = "Stop"
. (Join-Path (Split-Path -Parent $PSScriptRoot) "save-storage.ps1")
$nodePath = (Get-Command node.exe).Source
$bytes = [Text.Encoding]::UTF8.GetBytes('{"peacefulMode":{"__type":"bool","value":false}}')
function Assert($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Assert-Fails([scriptblock]$Action, [string]$Pattern) {
    try { & $Action | Out-Null } catch { Assert ($_.Exception.Message -match $Pattern) $_.Exception.Message; return }
    throw "Expected error: $Pattern"
}
function Fixture([string]$Name) {
    $path = Join-Path $Root "$Name.es3"
    [IO.File]::WriteAllBytes($path, $bytes)
    return $path
}
function LegacyBackup([string]$Path, [int]$Index) {
    $content = [Text.Encoding]::UTF8.GetBytes([Text.Encoding]::UTF8.GetString($bytes) + (" " * $Index))
    $created = New-OriginalBackup $Path $content
    $stamp = [DateTime]::new(2020, 1, 1).AddMinutes($Index).ToString("yyyyMMdd'T'HHmmssfff'Z'")
    $renamed = "$Path.$stamp.$([Guid]::NewGuid().ToString('N')).original.bak"
    Move-Item -LiteralPath $created -Destination $renamed
    return $renamed
}
function Count([string]$Path) { return @(Get-EditorBackups $Path).Count }
function Prune($Source, $Limit) {
    return Invoke-BackupRetention $Source.Path $Limit $Source.LoadBackup $Source.LoadLength $Source.LoadHash
}

$settings = Join-Path $Root "settings.json"
Assert ((Read-BackupLimit $settings) -eq 3) "Missing preferences must default to 3."
foreach ($limit in @(0, 1, 2, 8, 9007199254740991)) {
    Write-BackupLimit $settings $limit
    Assert ((Read-BackupLimit $settings) -eq $limit) "Native limit was not persisted."
}
foreach ($bad in @(-1, 1.5, "3", $null, $true, 9007199254740992)) {
    Assert-Fails { Write-BackupLimit $settings $bad } "whole number"
}
foreach ($badJson in @('{bad', '{"version":1,"backupLimit":-1}', '{"version":1,"backupLimit":"3"}', '{"version":1}', '{"version":true,"backupLimit":3}', '{"version":1,"backupLimit":8,"backupLimit":3}')) {
    [IO.File]::WriteAllText($settings, $badJson)
    Assert-Fails { Read-BackupLimit $settings } "."
}
Write-BackupLimit $settings 7
$locked = [IO.File]::Open($settings, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
try {
    Assert-Fails { Read-BackupLimit $settings } "."
    Assert-Fails { Write-BackupLimit $settings 0 } "."
} finally { $locked.Dispose() }
Assert ((Read-BackupLimit $settings) -eq 7) "A settings write failure changed the existing preference."

$path = Fixture "default"
$old = LegacyBackup $path 0
$others = @(1..6 | ForEach-Object { LegacyBackup $path $_ })
[IO.File]::SetLastWriteTimeUtc($old, [DateTime]::UtcNow.AddDays(2))
$source = Open-BackedUpSave $path
Assert ((Count $path) -eq 3 -and $source.LoadBackup -ceq $old) "Default retention did not protect reused baseline plus two newest backups."
foreach ($expected in $others[-2..-1]) { Assert ([IO.File]::Exists($expected)) "Newest eligible backup was not retained." }
Assert (-not $source.RetentionWarning) $source.RetentionWarning

$invalidPath = Fixture "invalid"
0..4 | ForEach-Object { LegacyBackup $invalidPath $_ | Out-Null }
[IO.File]::WriteAllText($invalidPath, "unsupported save data")
foreach ($limit in @(0, 1, 3)) {
    Assert-Fails { Open-BackedUpSave $invalidPath -BackupLimit $limit } "validation failed"
    Assert ((Count $invalidPath) -eq 5) "A rejected save pruned its healthy historical backups."
    Assert ([IO.File]::ReadAllText($invalidPath) -ceq "unsupported save data") "Rejected original changed."
}
foreach ($limit in @(0, 1, 3)) {
    $withoutNode = Open-BackedUpSave $path -BackupLimit $limit -NodePath ""
    Assert ($withoutNode.Bytes.Length -eq $bytes.Length -and $withoutNode.RetentionWarning -match "pruning are deferred") "No-Node native inspection/export was not preserved."
    Assert ((Count $path) -eq 3) "Unavailable validation pruned backups."
    Assert (($limit -eq 0 -and -not $withoutNode.LoadBackup) -or ($limit -gt 0 -and $withoutNode.LoadBackup)) "No-Node recovery mode was misrepresented."
}

foreach ($limit in @(1, 2, 5, 0, 4)) {
    $path = Fixture "limit-$limit"
    0..7 | ForEach-Object { LegacyBackup $path $_ | Out-Null }
    $source = Open-BackedUpSave $path -BackupLimit $limit
    Assert ((Count $path) -eq $limit) "Wrong backup count for limit $limit."
    Assert ((Get-SaveHash ([IO.File]::ReadAllBytes($path))) -ceq (Get-SaveHash $bytes)) "Opening/pruning altered the save."
    if ($limit -eq 0) {
        Assert (-not $source.LoadBackup) "Zero mode claimed a backup."
        Save-OpenedDocument $source @{ peacefulMode = $true } $true $nodePath -BackupLimit 0 | Out-Null
        $result = Save-OpenedDocument $source @{ peacefulMode = $false } $true $nodePath -Autosave $true -BackupLimit 0
        Assert ($result.saved -and -not $result.backupPath -and (Count $path) -eq 0) "Zero mode silently created a backup."
    }
}

$path = Fixture "single"
$source = Open-BackedUpSave $path -BackupLimit 1
$first = $source.LoadBackup
Save-OpenedDocument $source @{ peacefulMode = $true } $true $nodePath -BackupLimit 1 | Out-Null
$result = Save-OpenedDocument $source @{ peacefulMode = $false } $true $nodePath -BackupLimit 1
Assert ((Count $path) -eq 1 -and $result.backupPath -cne $first -and -not [IO.File]::Exists($first)) "Manual save did not rotate the protected point at limit 1."
$protected = $source.LoadBackup
$result = Save-OpenedDocument $source @{ peacefulMode = $true } $true $nodePath -Autosave $true -BackupLimit 1
Assert ((Count $path) -eq 1 -and $source.LoadBackup -ceq $protected -and -not $result.retentionWarning) "Autosave lost its protected recovery point."
Set-SourceBackupLimit $source 0
Assert (-not (Prune $source 0) -and (Count $path) -eq 0 -and -not $source.LoadBackup) "Changing to zero did not remove eligible backups."
Set-SourceBackupLimit $source 2
Assert (-not (Prune $source 2) -and (Count $path) -eq 1 -and $source.LoadBackup) "Changing from zero did not establish a verified current recovery point."
$result = Save-OpenedDocument $source @{ peacefulMode = $false } $true $nodePath -Autosave $true -BackupLimit 2
Assert ($result.saved -and -not $result.retentionWarning) "Autosave could not resume after leaving zero mode."
$count = Count $path
[IO.File]::AppendAllText($path, " ")
Assert-Fails { Set-SourceBackupLimit $source 0 } "changed outside"
Assert ((Count $path) -eq $count -and $source.BackupLimit -eq 2) "Stale-file refusal pruned backups or changed source policy."

$path = Fixture "ownership"
$other = Fixture "ownership-other"
$otherBackup = LegacyBackup $other 1
LegacyBackup $path 0 | Out-Null
$unrelated = @("$path.original.bak", "$path.20200101T000000000Z.not-a-guid.original.bak",
    "$path.20209999T000000000Z.$([Guid]::NewGuid().ToString('N')).original.bak", "$path.edited.es3.original.bak")
foreach ($entry in $unrelated) { [IO.File]::WriteAllBytes($entry, $bytes) }
$directory = "$path.20200101T000000000Z.$([Guid]::NewGuid().ToString('N')).original.bak"
[void][IO.Directory]::CreateDirectory($directory)
$hardlink = "$path.20200101T000000000Z.$([Guid]::NewGuid().ToString('N')).original.bak"
New-Item -ItemType HardLink -Path $hardlink -Target $other | Out-Null
$junction = "$path.20200101T000000000Z.$([Guid]::NewGuid().ToString('N')).original.bak"
New-Item -ItemType Junction -Path $junction -Target $directory | Out-Null
$source = Open-BackedUpSave $path -BackupLimit 0
Assert ((Count $path) -eq 0) "Eligible backups were not removed."
foreach ($entry in @($unrelated) + @($directory, $hardlink, $junction, $other, $otherBackup, $path)) { Assert (Test-Path -LiteralPath $entry) "Removed unrelated entry: $entry" }
[IO.Directory]::Delete($junction)
[IO.Directory]::Delete($directory)

$path = Fixture "failure"
$source = Open-BackedUpSave $path -BackupLimit 1
$extra = LegacyBackup $path 1
$realRemove = ${function:Remove-EditorBackup}
try {
    function Remove-EditorBackup { param($Backup) throw "Simulated cleanup failure" }
    $result = Save-OpenedDocument $source @{ peacefulMode = $true } $true $nodePath -BackupLimit 1
    Assert ($result.saved -and $result.retentionWarning -match "Simulated cleanup failure") "Cleanup failure concealed a successful save."
    Assert ((Get-SaveHash ([IO.File]::ReadAllBytes($path))) -ceq $source.Hash) "Successful replacement did not update baseline."
    Assert ([Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($path)).Contains('"value":true')) "Save did not actually commit."
    Assert ([IO.File]::Exists($source.LoadBackup) -and [IO.File]::Exists($extra)) "Cleanup failure discarded the recovery point."
    Assert-Fails { Save-OpenedDocument $source @{ peacefulMode = $false } $true $nodePath -Autosave $true -BackupLimit 1 } "cleanup is incomplete"
} finally { ${function:Remove-EditorBackup} = $realRemove }
$source.RetentionWarning = Prune $source 1
Assert (-not $source.RetentionWarning -and (Count $path) -eq 1) "Cleanup retry did not recover."
$extra = LegacyBackup $path 1
$snapshot = @(Get-EditorBackups $path | Where-Object Path -CEQ $extra)[0]
[IO.File]::AppendAllText($extra, " ")
Assert-Fails { Remove-EditorBackup $snapshot } "changed"
Assert ([IO.File]::Exists($extra)) "An externally changed backup was deleted."

$path = Fixture "locked"
$source = Open-BackedUpSave $path
$extra = LegacyBackup $path 1
$readLock = [IO.File]::Open($extra, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
try {
    $warning = Prune $source 1
    Assert ($warning -and [IO.File]::Exists($extra) -and [IO.File]::Exists($source.LoadBackup)) "A locked backup was not retained with a visible cleanup error."
} finally { $readLock.Dispose() }
Assert (-not (Prune $source 1) -and (Count $path) -eq 1) "Unlocked backup cleanup could not recover."

$path = Fixture "partial"
$source = Open-BackedUpSave $path
$extras = @(1..4 | ForEach-Object { LegacyBackup $path $_ })
try {
    function Remove-EditorBackup {
        param($Backup)
        if ($Backup.Path -ceq $extras[1]) { throw "One locked backup" }
        & $realRemove $Backup
    }
    $warning = Prune $source 1
    Assert ($warning -match "One locked backup" -and (Count $path) -eq 2) "Partial cleanup was not truthfully reported or did not continue safely."
    Assert ([IO.File]::Exists($source.LoadBackup) -and [IO.File]::Exists($extras[1])) "Partial cleanup removed a protected/locked point."
} finally { ${function:Remove-EditorBackup} = $realRemove }

# Exercise exactly the registration used after a successful Windows picker selection without displaying a desktop dialog.
$launcher = Join-Path (Split-Path -Parent $PSScriptRoot) "launcher.ps1"
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($launcher, [ref]$tokens, [ref]$errors)
foreach ($name in @("Register-OpenedSave", "New-SessionToken")) {
    $definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name }, $true)
    . ([ScriptBlock]::Create($definition.Extent.Text))
}
$openedFiles = @{}
$path = Fixture "picker"
0..4 | ForEach-Object { LegacyBackup $path $_ | Out-Null }
$picked = Register-OpenedSave $path $openedFiles $nodePath 2
Assert ($picked.source.backupLimit -eq 2 -and $picked.source.canSave -and (Count $path) -eq 2) "Picker registration ignored the configured limit."
$pickedWithoutNode = Register-OpenedSave $path $openedFiles "" 0
Assert (-not $pickedWithoutNode.source.canSave -and $pickedWithoutNode.source.retentionWarning -and -not $pickedWithoutNode.source.backupPath -and (Count $path) -eq 2) "No-Node picker registration did not preserve inspection/deferred cleanup."
[IO.File]::WriteAllText($path, "invalid")
Assert-Fails { Register-OpenedSave $path $openedFiles $nodePath 0 } "validation failed"
Assert ((Count $path) -eq 2) "Invalid picked file removed historical backups."

Write-Output "Retention tests passed: persistent settings, default/selected/zero counts, protected newest/reused points, limit-1 manual/autosave, policy changes, stale refusal, strict names, links, cleanup failures, and committed-save warnings."
