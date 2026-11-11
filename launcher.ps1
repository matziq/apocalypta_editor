param([switch]$SelfTest, [switch]$NoLaunch)

$ErrorActionPreference = "Stop"
$maxBytes = 20 * 1024 * 1024

function Get-SaveFolder {
    param([string]$ProfilePath = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile))
    Join-Path $ProfilePath "AppData\LocalLow\SawyerK Games\Apocalypter"
}

function New-SaveDialog {
    param([string]$Folder)
    $dialog = [System.Windows.Forms.OpenFileDialog]::new()
    # The classic dialog honors InitialDirectory instead of shell dialog history.
    $dialog.AutoUpgradeEnabled = $false
    $dialog.InitialDirectory = [IO.Path]::GetFullPath($Folder)
    $dialog.FileName = ""
    $dialog.Filter = "Apocalypter save files (*.es3)|*.es3"
    $dialog.Title = "Choose an Apocalypter save"
    $dialog.CheckFileExists = $true
    $dialog.Multiselect = $false
    $dialog.RestoreDirectory = $true
    return $dialog
}

function Test-PickerRequest {
    param(
        [string]$Method,
        [string]$Path,
        [string]$HostHeader,
        [string]$Origin,
        [string]$Token,
        [string]$ExpectedHost,
        [string]$ExpectedOrigin,
        [string]$ExpectedToken,
        [long]$ContentLength,
        [string]$RequestedMethod,
        [string]$RequestedHeaders
    )
    if ($HostHeader -cne $ExpectedHost -or $Origin -cne $ExpectedOrigin -or $Path -cne "/api/pick") { return $false }
    if ($Method -ceq "POST") {
        return $Token -ceq $ExpectedToken -and $ContentLength -eq 0
    }
    if ($Method -ceq "OPTIONS") {
        $headers = ([string]$RequestedHeaders).Trim().ToLowerInvariant()
        return $RequestedMethod -ceq "POST" -and $headers -ceq "x-editor-token"
    }
    return $false
}

function New-SessionToken {
    $bytes = New-Object byte[] 32
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $random.GetBytes($bytes) } finally { $random.Dispose() }
    [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function Get-PickerSelection {
    param([string]$SelectedPath, [long]$MaxBytes)
    if ([string]::IsNullOrWhiteSpace($SelectedPath)) { return @{ canceled = $true } }
    $selected = Get-Item -LiteralPath $SelectedPath
    if ($selected.Extension -ine ".es3") {
        return @{ status = 415; error = "Choose an .es3 save file." }
    }
    if ($selected.Length -gt $MaxBytes) {
        return @{ status = 413; error = "Save exceeds the 20 MiB limit." }
    }
    $stream = [IO.File]::OpenRead($selected.FullName)
    try {
        $buffer = New-Object byte[] ($MaxBytes + 1)
        $count = 0
        while ($count -lt $buffer.Length) {
            $read = $stream.Read($buffer, $count, $buffer.Length - $count)
            if ($read -eq 0) { break }
            $count += $read
        }
        if ($count -gt $MaxBytes) {
            return @{ status = 413; error = "Save exceeds the 20 MiB limit." }
        }
        $content = [Convert]::ToBase64String($buffer, 0, $count)
    } finally {
        $stream.Dispose()
    }
    return @{
        status = 200
        canceled = $false
        name = $selected.Name
        contentBase64 = $content
    }
}

function Write-Response {
    param($Context, [int]$Status, [string]$ContentType, [byte[]]$Bytes, [string]$Origin)
    $response = $Context.Response
    $response.StatusCode = $Status
    $response.ContentType = $ContentType
    $response.ContentLength64 = $Bytes.Length
    $response.Headers["X-Content-Type-Options"] = "nosniff"
    $response.Headers["Referrer-Policy"] = "no-referrer"
    $response.Headers["Cache-Control"] = "no-store"
    if ($Origin) {
        $response.Headers["Access-Control-Allow-Origin"] = $Origin
        $response.Headers["Vary"] = "Origin"
    }
    $response.OutputStream.Write($Bytes, 0, $Bytes.Length)
    $response.Close()
}

function Write-Json {
    param($Context, [int]$Status, $Value, [string]$Origin)
    $json = ConvertTo-Json -InputObject $Value -Compress -Depth 4
    Write-Response $Context $Status "application/json; charset=utf-8" ([Text.Encoding]::UTF8.GetBytes($json)) $Origin
}

if ($SelfTest) {
    $folder = Get-SaveFolder "C:\Users\Editor Test"
    if ($folder -cne "C:\Users\Editor Test\AppData\LocalLow\SawyerK Games\Apocalypter") {
        throw "Save-folder path test failed: $folder"
    }
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-SaveDialog -Folder $PSScriptRoot
    try {
        if ($dialog.AutoUpgradeEnabled -or $dialog.InitialDirectory -cne [IO.Path]::GetFullPath($PSScriptRoot) -or $dialog.FileName -ne "") {
            throw "Picker must explicitly start at its requested directory without remembered shell selection."
        }
    } finally { $dialog.Dispose() }
    $hostName = "127.0.0.1:43129"
    $origin = "http://127.0.0.1:43129"
    $token = "unpredictable-test-token"
    $valid = @{
        Method = "POST"; Path = "/api/pick"; HostHeader = $hostName; Origin = $origin
        Token = $token; ExpectedHost = $hostName; ExpectedOrigin = $origin
        ExpectedToken = $token; ContentLength = 0
    }
    if (-not (Test-PickerRequest @valid)) { throw "Authorized picker request was rejected." }
    $invalid = $valid.Clone(); $invalid.Token = "wrong"
    if (Test-PickerRequest @invalid) { throw "Invalid token was accepted." }
    $invalid = $valid.Clone(); $invalid.HostHeader = "localhost:43129"
    if (Test-PickerRequest @invalid) { throw "Unexpected Host was accepted." }
    $invalid = $valid.Clone(); $invalid.Origin = "http://127.0.0.1.evil:43129"
    if (Test-PickerRequest @invalid) { throw "Unexpected Origin was accepted." }
    $invalid = $valid.Clone(); $invalid.Path = "/api/read?path=C:\secret"
    if (Test-PickerRequest @invalid) { throw "An arbitrary read route was accepted." }
    $invalid = $valid.Clone(); $invalid.ContentLength = 1
    if (Test-PickerRequest @invalid) { throw "A request body was accepted." }
    $preflight = @{
        Method = "OPTIONS"; Path = "/api/pick"; HostHeader = $hostName; Origin = $origin
        ExpectedHost = $hostName; ExpectedOrigin = $origin; RequestedMethod = "POST"
        RequestedHeaders = "x-editor-token"; ContentLength = 0
    }
    if (-not (Test-PickerRequest @preflight)) { throw "Valid same-origin preflight was rejected." }
    $invalid = $preflight.Clone(); $invalid.Origin = "http://localhost:43129"
    if (Test-PickerRequest @invalid) { throw "Unexpected preflight Origin was accepted." }
    if (-not (Get-PickerSelection -SelectedPath "" -MaxBytes $maxBytes).canceled) {
        throw "Picker cancellation was not reported as a normal result."
    }
    $badExtension = Get-PickerSelection -SelectedPath $MyInvocation.MyCommand.Path -MaxBytes $maxBytes
    if ($badExtension.status -ne 415) { throw "Non-save selection was accepted." }
    $missingFailed = $false
    try { Get-PickerSelection -SelectedPath (Join-Path $PSScriptRoot "missing-save-for-test.es3") -MaxBytes $maxBytes | Out-Null }
    catch [System.Management.Automation.ItemNotFoundException] { $missingFailed = $true }
    if (-not $missingFailed) { throw "A missing selected file did not produce an explicit error." }
    Write-Output "Launcher self-test passed: current-user path, exact Host/Origin/token, fixed route, empty request body, and preflight checks."
    exit 0
}

if (-not $IsWindows -and $PSVersionTable.PSVersion.Major -ge 6) {
    throw "The native save picker requires Windows PowerShell or Windows."
}

Add-Type -AssemblyName System.Windows.Forms
$saveFolder = Get-SaveFolder
$token = New-SessionToken
$listener = [Net.HttpListener]::new()
$port = 0
for ($attempt = 0; $attempt -lt 12; $attempt++) {
    $candidate = if ($attempt -eq 0) { 58643 } else { Get-Random -Minimum 49152 -Maximum 65536 }
    $prefix = "http://127.0.0.1:$candidate/"
    $listener.Prefixes.Clear()
    $listener.Prefixes.Add($prefix)
    try {
        $listener.Start()
        $port = $candidate
        break
    } catch {
        if ($attempt -eq 11) { throw "Could not start the local picker bridge: $($_.Exception.Message)" }
    }
}
$expectedHost = "127.0.0.1:$port"
$expectedOrigin = "http://$expectedHost"
$contentTypes = @{
    ".html" = "text/html; charset=utf-8"
    ".js" = "text/javascript; charset=utf-8"
    ".css" = "text/css; charset=utf-8"
}
$editorRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$assetPaths = @{
    "/" = (Join-Path $editorRoot "index.html")
    "/index.html" = (Join-Path $editorRoot "index.html")
    "/app.js" = (Join-Path $editorRoot "app.js")
    "/save-format.js" = (Join-Path $editorRoot "save-format.js")
    "/ui-preferences.js" = (Join-Path $editorRoot "ui-preferences.js")
    "/vehicle-actions.js" = (Join-Path $editorRoot "vehicle-actions.js")
    "/style.css" = (Join-Path $editorRoot "style.css")
}
$url = "$expectedOrigin/"
$idleSeconds = 0
Write-Output "Apocalypter Save Editor picker bridge is listening on 127.0.0.1:$port."
Write-Output "Keep this window open while using the native picker; close it when finished."
Write-Output "Picker folder for the current Windows user: $saveFolder"
if (-not $NoLaunch) { Start-Process $url }

try {
    $pending = $listener.BeginGetContext($null, $null)
    while ($idleSeconds -lt 3600) {
        if (-not $pending.AsyncWaitHandle.WaitOne(60000)) {
            $idleSeconds += 60
            continue
        }
        $context = $listener.EndGetContext($pending)
        $pending.AsyncWaitHandle.Close()
        $pending = $listener.BeginGetContext($null, $null)
        $idleSeconds = 0
        $request = $context.Request
        $hostHeader = $request.Headers["Host"]
        $path = $request.Url.AbsolutePath
        $origin = $request.Headers["Origin"]
        if ($hostHeader -cne $expectedHost) {
            Write-Json $context 403 @{ error = "Unexpected Host header." } $null
            continue
        }

        if ($request.HttpMethod -ceq "OPTIONS" -and $path -ceq "/api/pick") {
            $allowed = Test-PickerRequest -Method $request.HttpMethod -Path $path -HostHeader $hostHeader `
                -Origin $origin -ExpectedHost $expectedHost -ExpectedOrigin $expectedOrigin `
                -RequestedMethod $request.Headers["Access-Control-Request-Method"] `
                -RequestedHeaders $request.Headers["Access-Control-Request-Headers"] `
                -ContentLength $request.ContentLength64
            if (-not $allowed) {
                Write-Json $context 403 @{ error = "Picker request origin or headers were rejected." } $null
                continue
            }
            $context.Response.Headers["Access-Control-Allow-Origin"] = $expectedOrigin
            $context.Response.Headers["Access-Control-Allow-Methods"] = "POST"
            $context.Response.Headers["Access-Control-Allow-Headers"] = "X-Editor-Token"
            $context.Response.Headers["Access-Control-Max-Age"] = "60"
            $context.Response.Headers["Vary"] = "Origin"
            Write-Response $context 204 "text/plain; charset=utf-8" ([byte[]]@()) $expectedOrigin
            continue
        }

        if ($request.HttpMethod -ceq "POST" -and $path -ceq "/api/pick") {
            $allowed = Test-PickerRequest -Method $request.HttpMethod -Path $path -HostHeader $hostHeader `
                -Origin $origin -Token $request.Headers["X-Editor-Token"] -ExpectedHost $expectedHost `
                -ExpectedOrigin $expectedOrigin -ExpectedToken $token -ContentLength $request.ContentLength64
            if (-not $allowed) {
                Write-Json $context 403 @{ error = "Picker request origin, token, or body was rejected." } $expectedOrigin
                continue
            }
            if (-not (Test-Path -LiteralPath $saveFolder -PathType Container)) {
                Write-Json $context 404 @{ error = "The current user's Apocalypter save folder does not exist: $saveFolder" } $expectedOrigin
                continue
            }
            $dialog = New-SaveDialog -Folder $saveFolder
            try {
                if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
                    Write-Json $context 200 @{ canceled = $true } $expectedOrigin
                    continue
                }
                $payload = Get-PickerSelection -SelectedPath $dialog.FileName -MaxBytes $maxBytes
                if ($payload.status -ne 200) {
                    $status = $payload.status
                    $payload.Remove("status")
                    Write-Json $context $status $payload $expectedOrigin
                    continue
                }
                $payload.Remove("status")
                Write-Json $context 200 $payload $expectedOrigin
            } catch {
                Write-Json $context 500 @{ error = "Could not read the selected save: $($_.Exception.Message)" } $expectedOrigin
            } finally {
                $dialog.Dispose()
            }
            continue
        }

        if ($request.HttpMethod -ceq "GET" -and $assetPaths.ContainsKey($path)) {
            try {
                $asset = $assetPaths[$path]
                $bytes = [IO.File]::ReadAllBytes($asset)
                $extension = [IO.Path]::GetExtension($asset).ToLowerInvariant()
                if ($path -eq "/" -or $path -eq "/index.html") {
                    $html = [Text.Encoding]::UTF8.GetString($bytes)
                    $meta = "<meta name=`"save-picker-token`" content=`"$token`">"
                    $html = $html.Replace("</head>", "$meta`r`n</head>")
                    $bytes = [Text.Encoding]::UTF8.GetBytes($html)
                }
                $context.Response.Headers["Content-Security-Policy"] = "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
                Write-Response $context 200 $contentTypes[$extension] $bytes $null
            } catch {
                Write-Json $context 500 @{ error = "Could not serve the editor asset: $($_.Exception.Message)" } $null
            }
            continue
        }

        Write-Json $context 404 @{ error = "This local bridge route is not available." } $null
    }
} finally {
    $listener.Stop()
    $listener.Close()
    Write-Output "Apocalypter Save Editor bridge stopped after one hour without requests."
}
