# Install pinned diagnostics into ignored project storage, not app dependencies.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$auditRoot = Join-Path $repoRoot '.data\environment-audit'
$toolRoot = Join-Path $auditRoot 'tools'
$manifestPath = Join-Path $toolRoot 'package.json'
$versions = [ordered]@{
    'chrome-devtools-mcp' = '1.11.0'
    'knip' = '6.42.1'
    'lighthouse' = '13.5.0'
}

if (-not (Get-Command pnpm.cmd -ErrorAction SilentlyContinue)) {
    throw 'The project requires pnpm.cmd 10.32.1; no package manager was installed.'
}
$pnpmVersion = (& pnpm.cmd --version).Trim()
if ($LASTEXITCODE -ne 0 -or $pnpmVersion -ne '10.32.1') {
    throw 'Use the project-pinned pnpm 10.32.1. No files were installed.'
}
$nodeVersion = (& node --version).Trim().TrimStart('v')
if ($LASTEXITCODE -ne 0 -or [version]$nodeVersion -lt [version]'22.19.0' -or
    [version]$nodeVersion -ge [version]'25.0.0') {
    throw 'These pinned tools require Node >=22.19 and the project requires Node <25.'
}

if (Test-Path -LiteralPath $manifestPath) {
    $existing = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    foreach ($name in $versions.Keys) {
        if ($existing.dependencies.$name -ne $versions[$name]) {
            throw "The isolated tooling manifest differs for $name. Review it before installing; it was not overwritten."
        }
    }
}
else {
    New-Item -ItemType Directory -Path $toolRoot -Force | Out-Null
    $manifest = [ordered]@{
        name = 'smartstore-local-audit-tools'; private = $true; version = '1.0.0'
        type = 'module'; dependencies = $versions
    }
    [IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 4),
        [Text.UTF8Encoding]::new($false))
}

$complete = $true
New-Item -ItemType Directory -Path (Join-Path $auditRoot 'browser-temp') -Force | Out-Null
foreach ($name in $versions.Keys) {
    $packagePath = Join-Path $toolRoot "node_modules\$name\package.json"
    if (-not (Test-Path -LiteralPath $packagePath)) { $complete = $false; continue }
    $installed = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
    if ($installed.version -ne $versions[$name]) { $complete = $false }
}
if ($complete) {
    Write-Host 'Pinned audit tools already exist; no duplicate installation was performed.'
    return
}

$installArgs = @('--dir', $toolRoot, 'install', '--ignore-scripts', '--store-dir',
    (Join-Path $auditRoot 'pnpm-store'),
    ('--config.cache-dir=' + (Join-Path $auditRoot 'pnpm-cache')))
if (Test-Path -LiteralPath (Join-Path $toolRoot 'pnpm-lock.yaml')) {
    $installArgs += '--frozen-lockfile'
}
& pnpm.cmd @installArgs
if ($LASTEXITCODE -ne 0) { throw 'Audit tool installation failed; application dependencies were not changed.' }
Write-Host 'Audit packages installed. Connection and functional tests are separate; see the environment report.'
