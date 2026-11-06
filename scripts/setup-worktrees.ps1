[CmdletBinding()]
param(
    [ValidateSet('literature', 'idea', 'experiment', 'paper', 'review', 'profile')]
    [string[]]$Component = @('literature', 'idea', 'experiment', 'paper', 'review', 'profile'),
    [string]$BaseRef = 'main',
    [switch]$List
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
function Invoke-RepoGit {
    param([string[]]$GitArgs)
    $result = & git -C $repoRoot @GitArgs
    if ($LASTEXITCODE -ne 0) { throw "git $($GitArgs -join ' ') failed" }
    return $result
}
$entries = @()
$entry = $null
foreach ($line in (Invoke-RepoGit -GitArgs @('-c', 'core.quotepath=false', 'worktree', 'list', '--porcelain'))) {
    if ($line.StartsWith('worktree ')) {
        $entry = [pscustomobject]@{ Path = $line.Substring(9); Branch = '' }
        $entries += $entry
    } elseif ($line.StartsWith('branch refs/heads/')) {
        $entry.Branch = $line.Substring(18)
    }
}
if (-not $entries.Count) { throw 'No primary Git worktree found' }
$primary = $entries[0].Path
$worktreeRoot = Join-Path (Split-Path -Parent $primary) ((Split-Path -Leaf $primary) + '-worktrees')
$config = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'components.json') -Raw | ConvertFrom-Json
if (-not $List) {
    $dirty = & git -C $primary status --porcelain
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect primary worktree' }
    if ($dirty) { throw 'Commit the primary worktree first; uncommitted changes are not copied into new worktrees.' }
    $null = Invoke-RepoGit -GitArgs @('rev-parse', '--verify', "$BaseRef^{commit}")
}
$branches = @(Invoke-RepoGit -GitArgs @('for-each-ref', '--format=%(refname:short)', 'refs/heads/'))
foreach ($spec in $config.components) {
    if ($spec.name -notin $Component) { continue }
    $path = [IO.Path]::GetFullPath((Join-Path $worktreeRoot $spec.name))
    $existing = @($entries | Where-Object { $_.Branch -eq $spec.branch })
    if ($existing.Count -and [IO.Path]::GetFullPath($existing[0].Path) -ne $path) {
        throw "Branch $($spec.branch) is already checked out at $($existing[0].Path)"
    }
    if (-not $List -and -not $existing.Count) {
        if (Test-Path -LiteralPath $path) { throw "Target exists but is not the expected worktree: $path" }
        $null = New-Item -ItemType Directory -Path $worktreeRoot -Force
        if ($spec.branch -in $branches) {
            Invoke-RepoGit -GitArgs @('worktree', 'add', $path, $spec.branch) | Out-Host
        } else {
            Invoke-RepoGit -GitArgs @('worktree', 'add', '--no-track', '-b', $spec.branch, $path, $BaseRef) | Out-Host
        }
    }
    [pscustomobject]@{
        Component = $spec.name
        Branch = $spec.branch
        Path = $path
        Exists = [bool]($existing.Count -or (-not $List))
        BackendPort = $spec.backendPort
        FrontendPort = $spec.frontendPort
        DataDir = Join-Path $path '.easyref'
    }
}
