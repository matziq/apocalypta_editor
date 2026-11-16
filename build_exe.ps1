[CmdletBinding()]
param(
    [string]$WorkPath = (Join-Path $env:TEMP "ApocalypterSaveEditor-build")
)

$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    & py -3.12 -c "import PyInstaller"
    if ($LASTEXITCODE -ne 0) {
        throw 'Python 3.12 and PyInstaller are required. Install requirements-build.txt and retry.'
    }
    & py -3.12 -m PyInstaller --noconfirm --workpath $WorkPath --distpath (Join-Path $PSScriptRoot 'dist') ApocalypterSaveEditor.spec
    if ($LASTEXITCODE -ne 0) { throw 'PyInstaller failed.' }
    $exe = Join-Path $PSScriptRoot 'dist\ApocalypterSaveEditor.exe'
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw "Executable not found: $exe" }
    Write-Host "Built $exe"
}
finally {
    Pop-Location
}
