#Requires -Version 5.1
<#
Start the optional, private FreeLLMAPI gateway on the existing Windows PC.
This does not change OpenDots providers until Connect-FreeLLMAPI-Key.ps1 runs.
Secrets are stored only in the local, gitignored root .env.
#>
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$envFile = Join-Path $root '.env'
if (!(Test-Path -LiteralPath $envFile -PathType Leaf)) {
  throw 'Private root .env is missing. Set up OpenDots on this PC first.'
}
if (!(Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker Desktop is not installed or not available on PATH.'
}

$keyLines = @(Get-Content -LiteralPath $envFile |
  Where-Object { $_.StartsWith('FREELLMAPI_ENCRYPTION_KEY=') })
if ($keyLines.Count -gt 1) {
  throw 'Duplicate FREELLMAPI_ENCRYPTION_KEY entries in private .env.'
}
$existing = if ($keyLines.Count -eq 1) {
  $keyLines[0].Substring('FREELLMAPI_ENCRYPTION_KEY='.Length).Trim()
} else {
  ''
}
if ($existing -and $existing -notmatch '^[a-fA-F0-9]{64}\z') {
  throw 'Existing encryption key is invalid. Refusing to rotate or replace it.'
}

if (!$existing) {
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  $hex = -join ($bytes | ForEach-Object { $_.ToString('x2') })
  if ($keyLines.Count -eq 1) {
    $lines = @(Get-Content -LiteralPath $envFile)
    $lines = @($lines | ForEach-Object {
      if ($_.StartsWith('FREELLMAPI_ENCRYPTION_KEY=')) {
        'FREELLMAPI_ENCRYPTION_KEY=' + $hex
      } else {
        $_
      }
    })
    [IO.File]::WriteAllLines($envFile, $lines, ([System.Text.UTF8Encoding]::new($false)))
  } else {
    $append = [Environment]::NewLine + 'FREELLMAPI_ENCRYPTION_KEY=' + $hex + [Environment]::NewLine
    [IO.File]::AppendAllText($envFile, $append, ([System.Text.UTF8Encoding]::new($false)))
  }
  Write-Host '[OK] Persistent private encryption key initialized.'
} else {
  Write-Host '[OK] Existing private FreeLLMAPI encryption key preserved.'
}

Push-Location $root
try {
  & docker compose -f docker-compose.yml -f deploy/compose-home.yml --profile freellmapi config --quiet
  if ($LASTEXITCODE -ne 0) {
    throw 'Docker Compose configuration validation failed.'
  }
  & docker compose -f docker-compose.yml -f deploy/compose-home.yml --profile freellmapi pull freellmapi
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not pull official FreeLLMAPI image. Check Docker connectivity.'
  }
  & docker compose -f docker-compose.yml -f deploy/compose-home.yml --profile freellmapi up -d --no-build --no-deps freellmapi
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not start FreeLLMAPI container. Check docker compose logs.'
  }
} finally {
  Pop-Location
}

$ready = $false
for ($attempt = 1; $attempt -le 12; $attempt++) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3001/api/ping' -TimeoutSec 5
    if ([int]$response.StatusCode -eq 200) {
      $ready = $true
      break
    }
  } catch {
    # The first boot may initialize its SQLite database and dashboard.
  }
  Start-Sleep -Seconds 2
}
if ($ready) {
  Write-Host '[OK] FreeLLMAPI is listening on http://127.0.0.1:3001'
} else {
  Write-Warning 'FreeLLMAPI is not ready. Run docker compose -f docker-compose.yml -f deploy/compose-home.yml logs --tail 60 freellmapi'
}
Write-Host 'Open http://127.0.0.1:3001 on THIS PC.'
Write-Host 'In the dashboard, add eligible upstream keys under Keys.'
Write-Host 'Copy your separate unified freellmapi-... key from the Keys page.'
Write-Host 'Then run deploy/Connect-FreeLLMAPI-Key.ps1 to connect OpenDots privately.'
Write-Host 'Do not expose port 3001 or commit any key to GitHub.'
