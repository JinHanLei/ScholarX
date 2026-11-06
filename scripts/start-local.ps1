param([int]$Port = 5000, [string]$DataDir = '', [switch]$SkipInstall)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectRoot
try {
    $pythonExe = Join-Path $projectRoot '.venv\Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $pythonExe)) {
        python -m venv .venv
        if ($LASTEXITCODE -ne 0) { throw 'Python environment creation failed' }
    }
    if (-not $SkipInstall) {
        & $pythonExe -m pip install -r backend/requirements-local.txt
        if ($LASTEXITCODE -ne 0) { throw 'Python dependency installation failed' }
        npm --prefix frontend ci
        if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed' }
    }
    npm --prefix frontend run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed' }
    $arguments = @('backend/run_local.py', '--port', "$Port")
    if ($DataDir) { $arguments += @('--data-dir', $DataDir) }
    & $pythonExe @arguments
} finally {
    Pop-Location
}
