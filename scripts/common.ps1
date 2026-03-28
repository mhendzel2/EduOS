Set-StrictMode -Version Latest

$Script:ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Script:RootDir = Split-Path -Parent $Script:ScriptDir

function Get-RootDir {
    return $Script:RootDir
}

function Import-RootEnv {
    param(
        [switch]$OverrideExisting
    )

    $envFile = Join-Path $Script:RootDir ".env"
    if (-not (Test-Path $envFile)) {
        return
    }

    foreach ($line in Get-Content -Path $envFile) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#")) {
            continue
        }

        $separatorIndex = $trimmed.IndexOf("=")
        if ($separatorIndex -lt 1) {
            continue
        }

        $name = $trimmed.Substring(0, $separatorIndex).Trim()
        if (-not $name) {
            continue
        }

        if ((Test-Path Env:$name) -and -not $OverrideExisting) {
            continue
        }

        $value = $trimmed.Substring($separatorIndex + 1)
        if ($value.Length -ge 2 -and $value.StartsWith('"') -and $value.EndsWith('"')) {
            $value = $value.Substring(1, $value.Length - 2)
        }

        Set-Item -Path Env:$name -Value $value
    }
}

function Require-Command {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Missing required command: $Name"
    }
}

function Get-ProjectPythonCommand {
    $candidates = @(
        (Join-Path $Script:RootDir ".venv\Scripts\python.exe"),
        (Join-Path $Script:RootDir ".venv\bin\python.exe"),
        (Join-Path $Script:RootDir ".venv\bin\python")
    )

    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return @($candidate)
        }
    }

    if (Get-Command py -ErrorAction SilentlyContinue) {
        return @("py", "-3")
    }

    if (Get-Command python -ErrorAction SilentlyContinue) {
        return @("python")
    }

    throw "Missing required command: python"
}