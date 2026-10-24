#Requires -Version 5.1
<#
Securely select FreeLLMAPI as OpenDots's model gateway. No key is printed,
uploaded, committed, or passed as a command-line argument. The private .env
is retained and all existing Docker volumes (chat memory, browser) survive.
#>
[CmdletBinding()]
param(
  [ValidateSet('auto:smart', 'auto:fast', 'auto:balanced', 'auto:reliable', 'auto')]
  [string]$Model = 'auto:smart'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$envFile = Join-Path $root '.env'
if (!(Test-Path -LiteralPath $envFile -PathType Leaf)) {
  throw 'Private root .env not found. Do not place API keys in GitHub or Vercel.'
}
if (!(Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Start Docker Desktop first.' }
try {
  $ping = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3001/api/ping' -TimeoutSec 10
  if ([int]$ping.StatusCode -ne 200) { throw 'Not ready' }
} catch {
  throw 'FreeLLMAPI is not online. Run deploy/Setup-FreeLLMAPI.ps1 and finish Keys dashboard first.'
}
$secure = Read-Host 'Paste the unified FreeLLMAPI key (hidden input; not a provider key)' -AsSecureString
$ptr = [IntPtr]::Zero
$secret = $null
try {
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $secret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
} finally {
  if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
if (!$secret -or $secret -notmatch '^freellmapi-[a-zA-Z0-9_-]{8,}$') {
  throw 'Invalid unified-key format. Copy the freellmapi-... key from the Keys page header.'
}
try {
  $verify = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3001/v1/models?available=true' -Method GET -Headers @{
    Authorization = "Bearer $secret"
  } -TimeoutSec 25
  $data = ConvertFrom-Json -InputObject $verify.Content
  if ([int]$verify.StatusCode -ne 200 -or $null -eq $data.data) {
    throw 'Unexpected models API response.'
  }
  if (@($data.data).Count -eq 0) {
    Write-Warning 'No available models yet. Add eligible upstream provider keys in the FreeLLMAPI Keys page before sending chat.'
  } else {
    Write-Host '[OK] Unified key accepted by the private FreeLLMAPI models endpoint.'
  }
} catch {
  $secret = $null
  throw 'FreeLLMAPI unified-key verification failed; the private .env has NOT been modified. Check the dashboard and provider setup.'
}
$lines = @(Get-Content -LiteralPath $envFile)
function Set-PrivateEnvValue([string]$name, [string]$value) {
  $matches = @($lines | Where-Object { $_.StartsWith($name + '=') })
  if ($matches.Count -gt 1) { throw "Duplicate $name in private .env; refusing to overwrite." }
  $found = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i].StartsWith($name + '=')) {
      $lines[$i] = $name + '=' + $value
      $found = $true
    }
  }
  if (!$found) { $script:lines += ($name + '=' + $value) }
}
Set-PrivateEnvValue 'FREELLMAPI_API_KEY' $secret
Set-PrivateEnvValue 'FREELLMAPI_MODEL' $Model
# The Docker service name works inside the OpenDots container; localhost:3001
# is the Windows-side dashboard and does NOT resolve to FreeLLMAPI in Docker.
Set-PrivateEnvValue 'FREELLMAPI_BASE_URL' 'http://freellmapi:3001/v1'
[IO.File]::WriteAllLines($envFile, $lines, (New-Object Text.UTF8Encoding($false)))
$secret = $null
Write-Host '[OK] FreeLLMAPI key saved to private .env; existing owner credentials preserved.'
Push-Location $root
try {
  # Rebuild only OpenDots (never the large OmniRoute source).
  & docker compose -f docker-compose.yml -f deploy/compose-home.yml build opendots
  if ($LASTEXITCODE -ne 0) { throw 'OpenDots build failed; local .env is safe. Check Docker build logs.' }
  & docker compose -f docker-compose.yml -f deploy/compose-home.yml --profile freellmapi up -d --no-build --no-deps freellmapi opendots
  if ($LASTEXITCODE -ne 0) { throw 'OpenDots/FreeLLMAPI restart failed; no volumes were deleted.' }
} finally { Pop-Location }
Write-Host ('[OK] OpenDots now prefers FreeLLMAPI, model = ' + $Model)
Write-Host 'Test at https://opendots-omniroute.vercel.app while this PC and Docker are running.'
Write-Host 'FreeLLMAPI is local-first; this does not provide an always-on cloud server or unlimited provider tokens.'
