Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "common.ps1")

Import-RootEnv -OverrideExisting

$rootDir = Get-RootDir
$backendDir = Join-Path $rootDir "backend"
$pythonCommand = Get-ProjectPythonCommand
$pythonArgs = @()

if ($pythonCommand.Length -gt 1) {
    $pythonArgs += $pythonCommand[1..($pythonCommand.Length - 1)]
}

$pythonArgs += @("-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8090", "--reload")

Push-Location $backendDir
try {
    & $pythonCommand[0] @pythonArgs
}
finally {
    Pop-Location
}