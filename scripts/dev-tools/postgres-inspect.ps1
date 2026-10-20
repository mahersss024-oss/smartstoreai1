# Inspect only the existing isolated local cluster. No user-supplied SQL,
# application rows, database changes, startup, migrations, or role changes.
[CmdletBinding()]
param(
    [ValidateSet('all', 'dev', 'test')]
    [string]$Database = 'all'
)

$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$stateRoot = Join-Path $repoRoot '.data\codex-dev-postgres'
$settingsPath = Join-Path $stateRoot 'local.json'
$expectedClusterPath = [IO.Path]::GetFullPath((Join-Path $stateRoot 'data'))
$psqlPath = 'C:\Program Files\PostgreSQL\17\bin\psql.exe'
$databaseNames = @{ dev = 'smartstore_codex_dev'; test = 'smartstore_codex_test' }

if (-not (Test-Path -LiteralPath $psqlPath -PathType Leaf)) {
    throw 'The existing PostgreSQL 17 psql executable was not found. Nothing was installed.'
}
if (-not (Test-Path -LiteralPath $settingsPath -PathType Leaf)) {
    throw 'Existing isolated local database settings were not found. Nothing was initialized.'
}

$settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
if ($settings.host -ne '127.0.0.1' -or $settings.port -ne 55432 -or
    $settings.user -ne 'codex_local' -or -not ($settings.password -is [string]) -or
    [string]::IsNullOrWhiteSpace($settings.password)) {
    throw 'Unexpected local settings. Refusing to connect.'
}

# Fixed catalog-only query. dataDirectory is checked privately before output.
$inspectionSql = @'
BEGIN READ ONLY;
SELECT json_build_object(
    'database', current_database(),
    'serverVersion', current_setting('server_version'),
    'dataDirectory', current_setting('data_directory'),
    'transactionReadOnly', current_setting('transaction_read_only'),
    'defaultTransactionReadOnly', current_setting('default_transaction_read_only'),
    'statementTimeout', current_setting('statement_timeout'),
    'lockTimeout', current_setting('lock_timeout'),
    'roleSuperuser', rolsuper,
    'roleCreateDatabase', rolcreatedb,
    'roleCreateRole', rolcreaterole,
    'roleBypassRls', rolbypassrls,
    'publicSchemaCreate', has_schema_privilege('public', 'CREATE'),
    'databaseCreate', has_database_privilege(current_database(), 'CREATE'),
    'publicTables', (SELECT count(*) FROM pg_tables WHERE schemaname = 'public'),
    'publicColumns', (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'),
    'publicIndexes', (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public'),
    'publicForeignKeys', (
        SELECT count(*) FROM pg_constraint
        WHERE contype = 'f' AND connamespace = 'public'::regnamespace
    ),
    'publicWritableTables', (
        SELECT count(*) FROM pg_class
        WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
            AND has_table_privilege(oid, 'INSERT, UPDATE, DELETE, TRUNCATE')
    )
)
FROM pg_roles WHERE rolname = current_user;
ROLLBACK;
'@

$inspectionEnv = @{
    PGPASSWORD = $settings.password
    PGOPTIONS = '-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000'
    PGHOSTADDR = '127.0.0.1'
    PGCONNECT_TIMEOUT = '5'
    PGAPPNAME = 'smartstore-local-readonly-inspection'
}
$previousEnv = @{}
foreach ($key in $inspectionEnv.Keys) {
    $previousEnv[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
}

try {
    foreach ($key in $inspectionEnv.Keys) {
        [Environment]::SetEnvironmentVariable($key, $inspectionEnv[$key], 'Process')
    }
    $databaseKeys = if ($Database -eq 'all') { @('dev', 'test') } else { @($Database) }
    foreach ($databaseKey in $databaseKeys) {
        $databaseName = $databaseNames[$databaseKey]
        # -X ignores psql startup files; -w prevents a password prompt. The
        # password is never included in arguments, SQL, diagnostics, or output.
        $psqlOutput = @(& $psqlPath -X -w -q -h '127.0.0.1' -p 55432 `
            -U 'codex_local' -d $databaseName -v ON_ERROR_STOP=1 -A -t -c $inspectionSql 2>&1)
        if ($LASTEXITCODE -ne 0) {
            throw "Local read-only inspection failed for $databaseName. Native diagnostics were withheld; no database changes were attempted."
        }
        try {
            $result = ($psqlOutput -join "`n") | ConvertFrom-Json
        }
        catch {
            throw 'The local inspection returned an unexpected response. Raw output was not printed.'
        }
        if (-not $result.dataDirectory -or
            [IO.Path]::GetFullPath($result.dataDirectory) -ne $expectedClusterPath -or
            $result.database -ne $databaseName) {
            throw 'The server does not match the expected isolated local cluster. Refusing to report it.'
        }
        if ($result.transactionReadOnly -ne 'on' -or
            $result.defaultTransactionReadOnly -ne 'on' -or
            $result.statementTimeout -ne '5s' -or $result.lockTimeout -ne '1s') {
            throw 'The required read-only and timeout settings were not confirmed.'
        }
        $result.PSObject.Properties.Remove('dataDirectory')
        $result | Add-Member -NotePropertyName dataDirectoryMatches -NotePropertyValue $true
        $result | ConvertTo-Json -Compress
        if ($result.roleSuperuser -or $result.roleCreateDatabase -or
            $result.roleCreateRole -or $result.roleBypassRls -or
            $result.publicSchemaCreate -or $result.databaseCreate -or
            $result.publicWritableTables -gt 0) {
            Write-Warning "$databaseName : this inspection used a read-only transaction, but the local login has broader underlying permissions. It is not a restricted read-only account."
        }
    }
}
finally {
    foreach ($key in $previousEnv.Keys) {
        [Environment]::SetEnvironmentVariable($key, $previousEnv[$key], 'Process')
    }
    $inspectionEnv.PGPASSWORD = $null
    $settings = $null
    $psqlOutput = $null
}
