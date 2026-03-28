Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "common.ps1")

Import-RootEnv -OverrideExisting

$backendUrl = if ($env:NEXT_PUBLIC_API_URL) { $env:NEXT_PUBLIC_API_URL.TrimEnd('/') } else { "http://127.0.0.1:8090" }
$frontendUrl = if ($env:FRONTEND_URL) { $env:FRONTEND_URL.TrimEnd('/') } else { "http://127.0.0.1:3090" }

Write-Host "Checking backend health at $backendUrl/api/v1/health"
$backendStatus = (Invoke-WebRequest -UseBasicParsing "$backendUrl/api/v1/health").StatusCode
if ($backendStatus -ne 200) {
    throw "Backend health probe failed with status $backendStatus"
}

Write-Host "Checking frontend at $frontendUrl"
$frontendStatus = (Invoke-WebRequest -UseBasicParsing $frontendUrl).StatusCode
if ($frontendStatus -ne 200) {
    throw "Frontend probe failed with status $frontendStatus"
}

Write-Host "Local EduOS stack checks passed."