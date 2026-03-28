Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "common.ps1")

$rootDir = Get-RootDir
$backendScript = Join-Path $PSScriptRoot "dev_backend.ps1"
$frontendScript = Join-Path $PSScriptRoot "dev_frontend.ps1"

$backendProcess = Start-Process -FilePath "powershell" -ArgumentList @(
    "-NoExit",
    "-ExecutionPolicy", "Bypass",
    "-File", $backendScript
) -WorkingDirectory $rootDir -PassThru

$frontendProcess = Start-Process -FilePath "powershell" -ArgumentList @(
    "-NoExit",
    "-ExecutionPolicy", "Bypass",
    "-File", $frontendScript
) -WorkingDirectory $rootDir -PassThru

Write-Host "Started backend in process $($backendProcess.Id) on http://127.0.0.1:8090"
Write-Host "Started frontend in process $($frontendProcess.Id) on http://127.0.0.1:3090"
Write-Host "Use scripts/check_local_stack.ps1 to verify the stack once both windows finish booting."