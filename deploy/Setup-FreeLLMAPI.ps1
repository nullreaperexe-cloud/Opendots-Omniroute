#Requires -Version 5.1
<#
Start the optional, private FreeLLMAPI router on the existing Windows Docker host.
This does NOT change which gateway OpenDots uses. A separate secure key-connect
step selects it after the dashboard has at least one upstream provider key.
#>
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$envFile = Join-Path $root '.env'
if (!(Test-Path -LiteralPath $envFile -PathType Leaf)) {
  throw 'Missing private root .env. Run your existing OpenDots home bootstrap first.'
}
if (!(Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker Desktop is not available. Start Docker Desktop first.'
}
$keyLines = @(Get-Content -LiteralPath $envFile |
  Where-Object { $_ -match '^FREELLMAPI_ENCRYPTION_KEY=' })
if ($keyLines.Count -gt 1) { throw 'Duplicate FREELLMAPI_ENCRYPTION_KEY in private .env.' }
if ($keyLines.Count -eq 1) {
  $existing = $keyLines[0].Substring('FREELLMAPI_ENCRYPTION_KEY='.Length)
  if ($existing -notmatch '^[a-fA-F0-9]{64}$') {
    throw 'Existing FreeLLMAPI encryption key is invalid; refusing to overwrite it.'
  }
} else {
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $hex = -join ($bytes | ForEach-Object { $_.ToString('x2') })
  $append = [Environment]::NewLine + 'FREELLMAPI_ENCRYPTION_KEY=' + $hex + [Environment]::NewLine
  [IO.File]::AppendAllText($envFile, $append, (New-Object Text.UTF8Encoding($false)))
  Write-Host '[OK] Generated a private persistent FreeLLMAPI encryption key.'
}
Push-Location $root
try {
  & docker compose -f docker-compose.yml -f deploy/compose-home.yml --profile freellmapi config --quiet
  if ($LASTEXITCODE -ne 0) { throw 'Docker Compose config validation failed.' }
  & docker compose -f docker-compose.yml -f deploy/compose-home.yml --profile freellmapi pull freellmapi
  if ($LASTEXITCODE -ne 0) { throw 'Could not pull the FreeLLMAPI container image.' }
  & docker compose -f docker-compose.yml -f deploy/compose-home.yml --profile freellmapi up -d --no-build --no-deps freellmapi
  if ($LASTEXITCODE -ne 0) { throw 'Could not start FreeLLMAPI.' }
} finally { Pop-Location }
$ready = $false
for ($attempt = 1; $attempt -le 12; $attempt++) {
  try {
    $result = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3001/api/ping' -TimeoutSec 5
    if ([int]$result.StatusCode -eq 200) { $ready = $true; break }
  } catch {}
  Start-Sleep -Seconds 2
}
if ($ready) {
  Write-Host '[OK] FreeLLMAPI local gateway is responding at http://127.0.0.1:3001'
} else {
  Write-Warning 'FreeLLMAPI is not responding yet. Inspect: docker compose -f docker-compose.yml -f deploy/compose-home.yml logs --tail 60 freellmapi'
}
Write-Host 'Open http://127.0.0.1:3001 on this PC; complete dashboard setup.'
Write-Host 'Add eligible provider API keys in FreeLLMAPI > Keys; copy its separate unified freellmapi-... key.'
Write-Host 'Then run deploy/Connect-FreeLLMAPI-Key.ps1 to enter it privately.'
Write-Host 'DO NOT expose port 3001 using Tailscale Funnel, or publish the key in GitHub/Vercel.'
