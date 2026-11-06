[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('literature', 'idea', 'experiment', 'paper', 'review', 'profile')]
    [string]$Component,
    [ValidateSet('App', 'Frontend')]
    [string]$Service = 'App',
    [switch]$SkipInstall
)
$ErrorActionPreference = 'Stop'
$target = & (Join-Path $PSScriptRoot 'setup-worktrees.ps1') -Component $Component -List
if (-not $target.Exists) { throw "Run scripts/setup-worktrees.ps1 -Component $Component first" }
$actualBranch = & git -C $target.Path branch --show-current
if ($LASTEXITCODE -ne 0 -or $actualBranch -ne $target.Branch) { throw 'Component worktree branch mismatch' }
$port = if ($Service -eq 'App') { $target.BackendPort } else { $target.FrontendPort }
$listeners = [Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
if ($listeners | Where-Object { $_.Port -eq $port }) { throw "Port $port is already in use; existing services were left running." }
$settings = @{
    EASYREF_STORAGE = 'local'
    EASYREF_DATA_DIR = $target.DataDir
    EASYREF_API_BASE = "http://127.0.0.1:$($target.BackendPort)/api"
    EASYREF_BACKEND_URL = "http://127.0.0.1:$($target.BackendPort)"
    VITE_API_URL = '/api'
    VITE_EASYREF_LEGACY = 'false'
}
$previous = @{}
foreach ($name in $settings.Keys) {
    $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    [Environment]::SetEnvironmentVariable($name, $settings[$name], 'Process')
}
Push-Location -LiteralPath $target.Path
try {
    Write-Host "Component: $Component | Branch: $actualBranch | Directory: $($target.Path)"
    Write-Host "Data: $($target.DataDir) | URL: http://127.0.0.1:$port"
    if ($Service -eq 'App') {
        & (Join-Path $target.Path 'scripts/start-local.ps1') -Port $target.BackendPort -DataDir $target.DataDir -SkipInstall:$SkipInstall
    } else {
        if (-not $SkipInstall) {
            npm --prefix frontend ci
            if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed' }
        }
        npm --prefix frontend run dev -- --port $target.FrontendPort --strictPort
        if ($LASTEXITCODE -ne 0) { throw 'Frontend server failed' }
    }
} finally {
    Pop-Location
    foreach ($name in $settings.Keys) {
        [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process')
    }
}
