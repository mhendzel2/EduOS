Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "common.ps1")

Require-Command -Name npm
Import-RootEnv -OverrideExisting

$rootDir = Get-RootDir
$frontendDir = Join-Path $rootDir "frontend"

Push-Location $frontendDir
try {
    npm run dev -- --hostname 0.0.0.0 --port 3090
}
finally {
    Pop-Location
}