# Run only native-mobile backend contracts with the standard isolated harness.
# The temporary cwd has no .env.local; junctions provide source and dependencies.
$nativePreviousErrorPreference = $ErrorActionPreference
$nativeRepo = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$nativeEnvironment = @{
  TSX_TSCONFIG_PATH = (Join-Path $nativeRepo 'tsconfig.json')
  SMARTSTORE_MARKETPLACE_STORE = 'file'
  DATABASE_URL = ''
  AUTH_SECRET = 'isolated-native-backend-test-auth-secret'
  SMARTSTORE_RATE_LIMIT_BACKEND = 'memory'
  UPSTASH_REDIS_REST_URL = ''
  UPSTASH_REDIS_REST_TOKEN = ''
}
$nativePreviousEnvironment = @{}
foreach ($key in $nativeEnvironment.Keys) {
  $nativePreviousEnvironment[$key] = [System.Environment]::GetEnvironmentVariable($key, 'Process')
}
$nativeLocationChanged = $false
$nativeExitCode = 1

try {
  $ErrorActionPreference = 'Stop'
  $nativeTestDir = Join-Path ([System.IO.Path]::GetTempPath()) ('smartstore-backend-tests-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $nativeTestDir | Out-Null
  foreach ($name in @('node_modules','scripts','app','lib','agent','components','hooks','prisma','tests')) {
    $target = Join-Path $nativeRepo $name
    if (-not (Test-Path -LiteralPath $target -PathType Container)) {
      throw "Missing required project directory: $name"
    }
    New-Item -ItemType Junction -Path (Join-Path $nativeTestDir $name) -Target $target | Out-Null
  }
  $nativeLogDir = Join-Path $nativeRepo '.data/native-mobile'
  New-Item -ItemType Directory -Force -Path $nativeLogDir | Out-Null
  $nativeLogPath = Join-Path $nativeLogDir 'backend-tests.log'
  foreach ($key in $nativeEnvironment.Keys) {
    [System.Environment]::SetEnvironmentVariable($key, $nativeEnvironment[$key], 'Process')
  }
  $nativeTargets = @(
    'tests/native-mobile-api.test.ts',
    'tests/apple-native-auth.test.ts',
    'tests/auth-session.test.ts',
    'tests/apple-auth.test.ts',
    'tests/route-access-contracts.test.ts',
    'tests/public-seller-profile-route.test.ts',
    'tests/apns-http2.test.ts',
    'tests/native-push.test.ts',
    'tests/web-push.test.ts'
  )
  Push-Location -LiteralPath $nativeTestDir
  $nativeLocationChanged = $true
  # Fixture diagnostics may use stderr. Node's exit code determines the result.
  $ErrorActionPreference = 'Continue'
  node (Join-Path $nativeRepo 'scripts/test.mjs') @nativeTargets 2>&1 | Tee-Object -FilePath $nativeLogPath
  $nativeExitCode = $LASTEXITCODE
} finally {
  if ($nativeLocationChanged) { Pop-Location }
  foreach ($key in $nativePreviousEnvironment.Keys) {
    [System.Environment]::SetEnvironmentVariable($key, $nativePreviousEnvironment[$key], 'Process')
  }
  $ErrorActionPreference = $nativePreviousErrorPreference
}

Write-Output ('BACKEND_TEST_EXIT_CODE=' + $nativeExitCode)
$global:LASTEXITCODE = $nativeExitCode
# Dot-sourcing must not terminate the caller's interactive session.
if ($MyInvocation.InvocationName -ne '.') { exit $nativeExitCode }
