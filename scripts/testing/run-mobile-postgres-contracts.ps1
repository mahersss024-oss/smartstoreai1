# Run a reviewed mobile contract plan only against the dedicated disposable local database.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PlanPath,
    [string]$PostgresBin = 'C:\Program Files\PostgreSQL\17\bin'
)

$mobilePreviousErrorPreference = $ErrorActionPreference
$ErrorActionPreference = 'Stop'
$mobileRepo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$mobileRepoPrefix = $mobileRepo.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
$mobileEnvironment = @{}
foreach ($mobileEntry in [Environment]::GetEnvironmentVariables('Process').GetEnumerator()) {
    $mobileEnvironment[$mobileEntry.Key] = $mobileEntry.Value
}
$mobilePushed = $false
$mobileWasRunning = $false
$mobileStarted = $false
$mobileMutexHeld = $false
$mobileMutex = $null
$mobileExitCode = 1

try {
    $mobileResolvedPlan = if ([IO.Path]::IsPathRooted($PlanPath)) {
        [IO.Path]::GetFullPath($PlanPath)
    } else { [IO.Path]::GetFullPath((Join-Path $mobileRepo $PlanPath)) }
    if (-not $mobileResolvedPlan.StartsWith($mobileRepoPrefix, [StringComparison]::OrdinalIgnoreCase) -or
        -not (Test-Path -LiteralPath $mobileResolvedPlan -PathType Leaf)) {
        throw 'The contract plan must be an existing file inside this repository.'
    }
    $mobilePlan = Get-Content -LiteralPath $mobileResolvedPlan -Raw | ConvertFrom-Json
    if ($mobilePlan.serverContextHash -notmatch '^[a-f0-9]{64}$') {
        throw 'The contract plan must contain a valid server source-context SHA-256 hash.'
    }
    $mobileFiles = @($mobilePlan.postgresFiles | Select-Object -Unique)
    if ($mobileFiles.Count -eq 0) { throw 'The contract plan has no PostgreSQL test files.' }
    foreach ($mobileFile in $mobileFiles) {
        if ($mobileFile -notmatch '^tests/[A-Za-z0-9._-]+\.test\.ts$' -or
            ($mobileFile -notmatch '\.db-integration\.test\.ts$' -and
                $mobileFile -notin @('tests/db-integration.test.ts', 'tests/evidence-db-integration.test.ts'))) {
            throw 'The contract plan contains a path outside the allowed PostgreSQL integration test files.'
        }
        $mobileTarget = [IO.Path]::GetFullPath((Join-Path $mobileRepo $mobileFile))
        if (-not $mobileTarget.StartsWith($mobileRepoPrefix, [StringComparison]::OrdinalIgnoreCase) -or
            -not (Test-Path -LiteralPath $mobileTarget -PathType Leaf)) {
            throw 'A planned PostgreSQL integration test file is missing or outside this repository.'
        }
    }
    $mobilePgCtl = Join-Path $PostgresBin 'pg_ctl.exe'
    if (-not (Test-Path -LiteralPath $mobilePgCtl -PathType Leaf)) {
        throw 'The dedicated local PostgreSQL tools are unavailable.'
    }
    $mobileCluster = Join-Path $mobileRepo '.data\codex-dev-postgres\data'
    if (-not (Test-Path -LiteralPath (Join-Path $mobileCluster 'PG_VERSION') -PathType Leaf)) {
        throw 'The dedicated local PostgreSQL cluster has not been initialized.'
    }
    $mobileMutex = [Threading.Mutex]::new($false, 'Local\SouqHamadMobilePostgresContracts')
    try { $mobileMutexHeld = $mobileMutex.WaitOne(0) }
    catch [Threading.AbandonedMutexException] { $mobileMutexHeld = $true }
    if (-not $mobileMutexHeld) { throw 'Another local mobile PostgreSQL contract run is already active.' }

    Push-Location -LiteralPath $mobileRepo
    $mobilePushed = $true
    & $mobilePgCtl status -D $mobileCluster *> $null
    $mobileWasRunning = $LASTEXITCODE -eq 0

    # This helper validates its own loopback-only settings and never reads .env.local.
    . (Join-Path $mobileRepo 'scripts\dev-tools\postgres.ps1') -Action Env -Database test -PostgresBin $PostgresBin
    $mobileDatabase = [Uri]$env:DATABASE_URL
    if ($mobileDatabase.Scheme -notin @('postgresql', 'postgres') -or
        $mobileDatabase.Host -ne '127.0.0.1' -or $mobileDatabase.Port -ne 55432 -or
        $mobileDatabase.AbsolutePath -ne '/smartstore_codex_test') {
        throw 'Refusing a database outside 127.0.0.1:55432/smartstore_codex_test.'
    }
    if (-not $mobileWasRunning) {
        & (Join-Path $mobileRepo 'scripts\dev-tools\postgres.ps1') -Action Start -PostgresBin $PostgresBin
        $mobileStarted = $true
    }

    # Tests run directly through tsx; the application .env loader is never invoked.
    foreach ($mobileKey in @([Environment]::GetEnvironmentVariables('Process').Keys)) {
        if ($mobileKey -match '^(SMARTSTORE_(OBJECT_STORAGE|EVIDENCE_STORAGE|IMAGE_RECOVERY|VAPID|IMAGE_WORKER|DIRECT_IMAGE|IMAGE_INTAKE|RUN_DB_MIGRATIONS|RATE_LIMIT|PUSH|NATIVE_PUSH)|CLOUDFLARE_|UPSTASH_|FIREBASE_|APNS_|GOOGLE_|APPLE_|AWS_|S3_|R2_|PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGSERVICE|PGOPTIONS|NODE_OPTIONS$)') {
            [Environment]::SetEnvironmentVariable($mobileKey, $null, 'Process')
        }
    }
    $env:CI = '1'
    $env:NODE_ENV = 'test'
    $env:DEEPSEEK_API_KEY = 'test-model-placeholder'
    $env:AUTH_SECRET = 'isolated-mobile-postgres-contract-tests-only'
    $env:npm_lifecycle_event = 'test'
    $env:SMARTSTORE_MARKETPLACE_STORE = 'database'
    $env:SMARTSTORE_DB_INTEGRATION = '1'
    $env:SMARTSTORE_OWNER_RESET_INTEGRATION = '1'
    $env:SMARTSTORE_IMAGE_STORAGE = 'inline'
    $env:SMARTSTORE_RATE_LIMIT_BACKEND = 'memory'
    $env:SMARTSTORE_CONTRACT_CONTEXT_HASH = $mobilePlan.serverContextHash
    $env:TSX_TSCONFIG_PATH = Join-Path $mobileRepo 'tsconfig.json'
    $env:SMARTSTORE_DATA_DIR = Join-Path $mobileRepo ('.data\codex-dev-postgres\test-files\' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $env:SMARTSTORE_DATA_DIR -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $mobileRepo 'coverage') -Force | Out-Null
    $mobilePreload = [Uri]::new((Join-Path $mobileRepo 'scripts\testing\isolated-model-provider.mjs')).AbsoluteUri
    Write-Output "Running $($mobileFiles.Count) PostgreSQL contract test files against the dedicated local test database."
    # Standard Node test events produce source-bound receipts; a source index is not a result.
    & node --import $mobilePreload 'node_modules/tsx/dist/cli.mjs' --test --test-concurrency=1 `
        --test-reporter=spec --test-reporter-destination=coverage/mobile-contracts-postgres.log `
        --test-reporter=./scripts/testing/mobile-test-reporter.mjs `
        --test-reporter-destination=coverage/mobile-contract-results-postgres.json @mobileFiles
    $mobileExitCode = $LASTEXITCODE
    Write-Output "PostgreSQL contract test exit code: $mobileExitCode"
}
finally {
    try {
        if ($mobileStarted -and -not $mobileWasRunning) {
            & (Join-Path $mobileRepo 'scripts\dev-tools\postgres.ps1') -Action Stop -PostgresBin $PostgresBin
        }
    }
    finally {
        if ($mobilePushed) { Pop-Location }
        foreach ($mobileKey in @([Environment]::GetEnvironmentVariables('Process').Keys)) {
            if (-not $mobileEnvironment.ContainsKey($mobileKey)) {
                [Environment]::SetEnvironmentVariable($mobileKey, $null, 'Process')
            }
        }
        foreach ($mobileKey in $mobileEnvironment.Keys) {
            [Environment]::SetEnvironmentVariable($mobileKey, $mobileEnvironment[$mobileKey], 'Process')
        }
        if ($mobileMutexHeld) { $mobileMutex.ReleaseMutex() }
        if ($mobileMutex) { $mobileMutex.Dispose() }
        $ErrorActionPreference = $mobilePreviousErrorPreference
    }
}

$global:LASTEXITCODE = $mobileExitCode
if ($MyInvocation.InvocationName -ne '.') { exit $mobileExitCode }
