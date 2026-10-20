# Isolated local PostgreSQL

`scripts/dev-tools/postgres.ps1` uses the installed PostgreSQL **17.11** binaries
at `C:\Program Files\PostgreSQL\17\bin`. The existing Docker Compose file uses
PostgreSQL **16**; this local setup does not replace that deployment definition.
Run version-specific checks against PostgreSQL 16 when deployment parity matters.

The dedicated cluster lives under ignored `.data/codex-dev-postgres/data` and
listens only on **127.0.0.1:55432**, using SCRAM password authentication. It has
separate `smartstore_codex_dev` and `smartstore_codex_test` databases. Credentials
are generated randomly and stored in `.data/codex-dev-postgres/local.json` under
a private Windows directory ACL. Do not commit, print or share that file.

The scripts never read or edit `.env.local`, never connect to a configured hosted
database, and do not register or change a Windows service. The existing installed
PostgreSQL service remains separate. Start this cluster after reboot when needed.

From the repository root, use process-scoped PowerShell execution-policy bypass
(this does not change the machine/user policy):

```powershell
# First setup, or apply committed migrations to both dedicated local databases.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\dev-tools\postgres.ps1 -Action Init

# Start, inspect, verify SELECT 1 and migration counts, and stop.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\dev-tools\postgres.ps1 -Action Start
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\dev-tools\postgres.ps1 -Action Status
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\dev-tools\postgres.ps1 -Action Verify
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\dev-tools\postgres.ps1 -Action Stop

# Run the application against the dedicated development database.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\dev-tools\postgres.ps1 -Action Dev

# Run the two existing integration files against the dedicated test database.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\dev-tools\postgres.ps1 -Action Test
```

`Dev` starts Next directly, setting the database URL without printing it.
The existing `pnpm dev` wrapper reloads `.env.local` over inherited settings, so
use this dedicated `Dev` action to retain the isolated database. Next can still
load other application settings from `.env.local`; configure test accounts and
external services appropriately before exercising those integrations.

`Test` bypasses the `.env.local` loader, sets the dedicated test database and
temporary file directory, disables live model requests through the existing test
provider, and removes inherited cloud-storage/push/OAuth settings for its child.
It restores the calling process environment afterward. Test files run
sequentially because they read shared moderation queues; their internal
concurrency assertions remain enabled.

`Migrate` applies committed migrations to both databases. `Env -Database dev`
or `Env -Database test` sets the current PowerShell process environment without
printing credentials; invoking it from a separate `powershell.exe` process will
not change the parent terminal environment. Prefer `Dev` and `Test` for routine
use. Supply `-PostgresBin` if the local binary directory moves.

The script deliberately has no reset/delete operation. Existing data is retained.

## Read-only diagnostics

For metadata-only inspection, use the separate fixed-query helper:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\dev-tools\postgres-inspect.ps1 -Database all
```

It accepts only `all`, `dev` or `test`; it checks the expected loopback cluster,
uses `psql -X -w`, sets read-only session defaults and bounded timeouts, and runs
catalog queries inside `BEGIN READ ONLY` / `ROLLBACK`. It neither starts the
server nor applies migrations, creates fixtures, reads customer rows or accepts
arbitrary SQL. The matching VS Code task is `SmartStore: Inspect PostgreSQL
metadata (read only)`.

The 2026-10-20 inspection passed against both databases: 26 public tables, 237
columns, 97 indexes and 33 foreign keys each. The existing local login is a
superuser with broad write privileges. This helper protects its diagnostic
transaction; it does not create a permanently restricted reader account.
Changing roles/grants requires separate authorization. `Init`, `Migrate` and
`Test` above write to the database and must not be used in an inspection-only
task. Current evidence and limits are recorded in
[the environment report](environment-tools-verification-2026-10-20.ar.md).
