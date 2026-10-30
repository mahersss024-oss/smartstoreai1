# Local PostgreSQL only. Never reads or changes .env.local.
[CmdletBinding()]
param(
    [ValidateSet('Init', 'Start', 'Stop', 'Status', 'Verify', 'Migrate', 'Test', 'Dev', 'Env')]
    [string]$Action = 'Status',
    [ValidateSet('dev', 'test')]
    [string]$Database = 'dev',
    [string]$PostgresBin = 'C:\Program Files\PostgreSQL\17\bin'
)

$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$stateRoot = Join-Path $repoRoot '.data\codex-dev-postgres'
$clusterPath = Join-Path $stateRoot 'data'
$settingsPath = Join-Path $stateRoot 'local.json'
$databaseNames = @{ dev = 'smartstore_codex_dev'; test = 'smartstore_codex_test' }

function Protect-StateDirectory {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $repoOwner = ([Security.Principal.NTAccount]::new((Get-Acl -LiteralPath $repoRoot).Owner)).Translate(
        [Security.Principal.SecurityIdentifier])
    # icacls changes only the DACL, without requiring SeSecurityPrivilege.
    $grants = @($identity.Value, $repoOwner.Value, 'S-1-5-18') | Select-Object -Unique |
        ForEach-Object { '*' + $_ + ':(OI)(CI)F' }
    & icacls.exe $stateRoot /inheritance:r /grant:r $grants | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not restrict access to local database credentials.' }
}

function Assert-Tools {
    foreach ($name in @('initdb.exe', 'pg_ctl.exe', 'psql.exe')) {
        if (-not (Test-Path -LiteralPath (Join-Path $PostgresBin $name))) {
            throw "PostgreSQL binary missing: $name. Pass -PostgresBin with your local bin directory."
        }
    }
}

function Get-LocalSettings {
    if (-not (Test-Path -LiteralPath $settingsPath)) {
        throw 'Local cluster is not initialized. Run this script with -Action Init first.'
    }
    $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
    # Deliberately refuse remote destinations, alternate users, and database names.
    if ($settings.host -ne '127.0.0.1' -or $settings.port -ne 55432 -or
        $settings.user -ne 'codex_local' -or -not $settings.password) {
        throw 'Unexpected local configuration. Refusing to connect.'
    }
    return $settings
}

function Test-ClusterRunning {
    if (-not (Test-Path -LiteralPath (Join-Path $clusterPath 'PG_VERSION'))) { return $false }
    & (Join-Path $PostgresBin 'pg_ctl.exe') status -D $clusterPath *> $null
    return $LASTEXITCODE -eq 0
}

function Start-Cluster {
    if (Test-ClusterRunning) { return }
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 55432)
    try { $listener.Start() }
    catch { throw '127.0.0.1:55432 is occupied. No existing server was changed.' }
    finally { $listener.Stop() }
    & (Join-Path $PostgresBin 'pg_ctl.exe') start -D $clusterPath `
        -l (Join-Path $stateRoot 'postgres.log') -w -t 30
    if ($LASTEXITCODE -ne 0) { throw 'Local PostgreSQL failed to start; see .data/codex-dev-postgres/postgres.log.' }
}

function Invoke-LocalSql([string]$DatabaseName, [string]$Sql) {
    $settings = Get-LocalSettings
    $previousPassword = [Environment]::GetEnvironmentVariable('PGPASSWORD', 'Process')
    $previousOptions = [Environment]::GetEnvironmentVariable('PGOPTIONS', 'Process')
    $previousHostAddress = [Environment]::GetEnvironmentVariable('PGHOSTADDR', 'Process')
    try {
        $env:PGPASSWORD = $settings.password
        $env:PGOPTIONS = ''
        $env:PGHOSTADDR = '127.0.0.1'
        $result = & (Join-Path $PostgresBin 'psql.exe') -X -w -h $settings.host `
            -p $settings.port -U $settings.user -d $DatabaseName -v ON_ERROR_STOP=1 -At -c $Sql
        if ($LASTEXITCODE -ne 0) { throw "Local SQL failed for $DatabaseName." }
        return $result
    }
    finally {
        [Environment]::SetEnvironmentVariable('PGPASSWORD', $previousPassword, 'Process')
        [Environment]::SetEnvironmentVariable('PGOPTIONS', $previousOptions, 'Process')
        [Environment]::SetEnvironmentVariable('PGHOSTADDR', $previousHostAddress, 'Process')
    }
}

function Set-DatabaseEnvironment([string]$DatabaseKey) {
    $settings = Get-LocalSettings
    $password = [Uri]::EscapeDataString($settings.password)
    $env:DATABASE_URL = "postgresql://$($settings.user):$password@127.0.0.1:55432/$($databaseNames[$DatabaseKey])?schema=public"
    $env:SMARTSTORE_MARKETPLACE_STORE = 'database'
}

function Invoke-WithLocalEnvironment([string]$DatabaseKey, [scriptblock]$Body) {
    $previous = @{}
    foreach ($entry in [Environment]::GetEnvironmentVariables('Process').GetEnumerator()) {
        $previous[$entry.Key] = $entry.Value
    }
    Push-Location $repoRoot
    try {
        Set-DatabaseEnvironment $DatabaseKey
        & $Body
    }
    finally {
        foreach ($key in @([Environment]::GetEnvironmentVariables('Process').Keys)) {
            if (-not $previous.ContainsKey($key)) {
                [Environment]::SetEnvironmentVariable($key, $null, 'Process')
            }
        }
        foreach ($key in $previous.Keys) {
            [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process')
        }
        Pop-Location
    }
}

function Invoke-LocalMigrations {
    foreach ($key in @('dev', 'test')) {
        Invoke-WithLocalEnvironment $key {
            & node 'node_modules/prisma/build/index.js' migrate deploy --schema prisma/schema.prisma
            if ($LASTEXITCODE -ne 0) { throw 'Local migration deployment failed.' }
        }
    }
}

Assert-Tools

if ($Action -eq 'Init') {
    if (-not (Test-Path -LiteralPath $stateRoot)) {
        New-Item -ItemType Directory -Path $stateRoot | Out-Null
    }
    if (-not (Test-Path -LiteralPath $settingsPath)) {
        if (Test-Path -LiteralPath $clusterPath) {
            throw 'An unrecognized data directory exists; it was left untouched.'
        }
        Protect-StateDirectory
        $bytes = New-Object byte[] 32
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
        $settings = [ordered]@{
            host = '127.0.0.1'; port = 55432; user = 'codex_local'
            password = [Convert]::ToBase64String($bytes)
        }
        $settings | ConvertTo-Json | Set-Content -LiteralPath $settingsPath -Encoding UTF8
    }
    $settings = Get-LocalSettings
    if (-not (Test-Path -LiteralPath (Join-Path $clusterPath 'PG_VERSION'))) {
        $passwordFile = Join-Path $stateRoot 'init-password.tmp'
        try {
            [IO.File]::WriteAllText($passwordFile, $settings.password, [Text.UTF8Encoding]::new($false))
            & (Join-Path $PostgresBin 'initdb.exe') -D $clusterPath -U $settings.user `
                -A scram-sha-256 --pwfile=$passwordFile --encoding=UTF8 --locale=C --data-checksums
            if ($LASTEXITCODE -ne 0) { throw 'Local PostgreSQL initialization failed.' }
        }
        finally {
            if (Test-Path -LiteralPath $passwordFile) { Remove-Item -LiteralPath $passwordFile }
        }
        @"

# SmartStoreAI isolated development cluster
listen_addresses = '127.0.0.1'
port = 55432
password_encryption = 'scram-sha-256'
"@ | Add-Content -LiteralPath (Join-Path $clusterPath 'postgresql.conf') -Encoding ASCII
        'host all all 127.0.0.1/32 scram-sha-256' | Set-Content `
            -LiteralPath (Join-Path $clusterPath 'pg_hba.conf') -Encoding ASCII
    }
    Start-Cluster
    foreach ($name in $databaseNames.Values) {
        $exists = Invoke-LocalSql 'postgres' "SELECT 1 FROM pg_database WHERE datname = '$name';"
        if ($exists -ne '1') { Invoke-LocalSql 'postgres' "CREATE DATABASE $name;" | Out-Null }
    }
    Invoke-LocalMigrations
    Write-Host 'Isolated development and test databases initialized on 127.0.0.1:55432.'
    return
}

$null = Get-LocalSettings
switch ($Action) {
    'Start' { Start-Cluster }
    'Stop' {
        if (Test-ClusterRunning) {
            & (Join-Path $PostgresBin 'pg_ctl.exe') stop -D $clusterPath -m fast -w -t 30
            if ($LASTEXITCODE -ne 0) { throw 'Local PostgreSQL failed to stop.' }
        }
    }
    'Status' {
        $running = Test-ClusterRunning
        Write-Host "Local cluster running: $running; address: 127.0.0.1:55432"
    }
    'Verify' {
        foreach ($name in $databaseNames.Values) {
            $result = Invoke-LocalSql $name 'SELECT 1;'
            $count = Invoke-LocalSql $name 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;'
            $listen = Invoke-LocalSql $name 'SHOW listen_addresses;'
            Write-Host "$name : SELECT 1 = $result; applied migrations = $count; listen_addresses = $listen"
        }
    }
    'Migrate' { Start-Cluster; Invoke-LocalMigrations }
    'Env' {
        Set-DatabaseEnvironment $Database
        Write-Host "Current PowerShell process now uses local $Database database. Credentials were not printed."
        Write-Host 'For development use pnpm.cmd exec next dev; scripts/dev.mjs reloads .env.local over inherited settings.'
    }
    'Dev' {
        Start-Cluster
        Invoke-WithLocalEnvironment 'dev' {
            # Next preserves inherited variables; scripts/dev.mjs would replace them.
            & node 'node_modules/next/dist/bin/next' dev
            if ($LASTEXITCODE -ne 0) { throw 'Local development server exited with an error.' }
        }
    }
    'Test' {
        Start-Cluster
        Invoke-WithLocalEnvironment 'test' {
            # Bypass scripts/test.mjs so .env.local is never loaded by this command.
            foreach ($key in @([Environment]::GetEnvironmentVariables('Process').Keys)) {
                if ($key -match '^(SMARTSTORE_(OBJECT_STORAGE|EVIDENCE_STORAGE|VAPID)|CLOUDFLARE_|UPSTASH_|FIREBASE_|APNS_|GOOGLE_|APPLE_)') {
                    [Environment]::SetEnvironmentVariable($key, $null, 'Process')
                }
            }
            $env:CI = '1'
            $env:NODE_ENV = 'test'
            $env:DEEPSEEK_API_KEY = 'test-model-placeholder'
            $env:AUTH_SECRET = 'isolated-local-database-tests-only'
            $env:npm_lifecycle_event = 'test'
            $env:SMARTSTORE_DB_INTEGRATION = '1'
            $env:SMARTSTORE_IMAGE_STORAGE = 'inline'
            $env:SMARTSTORE_DATA_DIR = Join-Path $stateRoot ('test-files\' + [Guid]::NewGuid().ToString('N'))
            New-Item -ItemType Directory -Path $env:SMARTSTORE_DATA_DIR -Force | Out-Null
            $preload = [Uri]::new((Join-Path $repoRoot 'scripts\testing\isolated-model-provider.mjs')).AbsoluteUri
            # Files share this disposable database and read global moderation queues.
            & node --import $preload 'node_modules/tsx/dist/cli.mjs' --test --test-concurrency=1 `
                'tests/db-integration.test.ts' 'tests/evidence-db-integration.test.ts' `
                'tests/repository-profile-preservation.db-integration.test.ts' `
                'tests/account-integrity.db-integration.test.ts' `
                'tests/listing-partial-edits.db-integration.test.ts' `
                'tests/direct-image-uploads.db-integration.test.ts' `
                'tests/notification-delivery.db-integration.test.ts'
            if ($LASTEXITCODE -ne 0) { throw 'Database integration tests failed; see the test output.' }
        }
    }
}
