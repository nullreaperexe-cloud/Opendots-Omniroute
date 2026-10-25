#Requires -Version 5.1
<#
ONE-CLICK, DOCKERLESS FreeLLMAPI connection for OpenDots on this Windows PC.
Requires: FreeLLMAPI desktop app running, Node.js, Tailscale signed in.
Never uploads, prints, or stores an API key. The unified key stays in Vercel.
Exposes ONLY a restricted chat-completions bridge, not the admin dashboard.
#>
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$expectedHost='kanish.tail7524cf.ts.net'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$bridge=Join-Path $PSScriptRoot 'freellmapi-bridge.mjs'

function Fail([string]$message){ throw $message }
if(!(Test-Path -LiteralPath $bridge)){Fail 'Bridge file missing. Run this file from the updated GitHub repository.'}
$node=Get-Command node.exe -ErrorAction SilentlyContinue
if(!$node){Fail 'Node.js not installed or not on PATH. Install Node.js first.'}
$t=Get-Command tailscale.exe -ErrorAction SilentlyContinue
if($t){$ts=$t.Source}
elseif(Test-Path 'C:\Program Files\Tailscale\tailscale.exe'){$ts='C:\Program Files\Tailscale\tailscale.exe'}
else{Fail 'Tailscale not installed. Install/sign in to Tailscale on this PC.'}
$status=& $ts status --json | Out-String
if($LASTEXITCODE -ne 0){Fail 'Tailscale not connected. Sign in first.'}
$data=$status|ConvertFrom-Json
if($data.BackendState -ne 'Running'){Fail 'Tailscale is not connected. Open its Windows tray menu.'}
$domain=[string]$data.Self.DNSName
$domain=$domain.TrimEnd('.')
if($domain -ne $expectedHost){
  Fail "This computer's Tailscale domain is $domain, not the previously configured $expectedHost. Set FREELLMAPI_BASE_URL to https://$domain/freellmapi/v1 in Vercel first."
}
try{
  $local=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:31415/v1/models' -TimeoutSec 4
}catch{
  $response=$_.Exception.Response
  if(!$response -or [int]$response.StatusCode -notin @(400,401,403,404,429)){
    Fail 'FreeLLMAPI desktop is not responding on localhost:31415. Open the FreeLLMAPI Windows app first.'
  }
}
$started=$false
try{
  $check=Invoke-RestMethod -Uri 'http://127.0.0.1:31416/health' -TimeoutSec 3
  if($check.service -eq 'OpenDots FreeLLMAPI restricted chat bridge'){$started=$true}
}catch{}
if(!$started){
  $out=Join-Path $env:TEMP 'opendots-freellmapi-bridge.log'
  $err=Join-Path $env:TEMP 'opendots-freellmapi-bridge-error.log'
  $argLine='"'+$bridge+'"'
  Start-Process -FilePath $node.Source -ArgumentList $argLine -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err | Out-Null
  $ok=$false
  for($i=0;$i -lt 16;$i++){
    Start-Sleep -Milliseconds 450
    try{
      $result=Invoke-RestMethod -Uri 'http://127.0.0.1:31416/health' -TimeoutSec 3
      if($result.service -eq 'OpenDots FreeLLMAPI restricted chat bridge'){$ok=$true;break}
    }catch{}
  }
  if(!$ok){Fail "Local bridge did not start. Check $err"}
}
Write-Host '[OK] Restricted chat-only bridge runs on localhost:31416.'
# Mount ONLY a separate path, preserving existing Funnel root for old OpenDots.
& $ts funnel --bg --https=443 --set-path=/freellmapi http://127.0.0.1:31416
if($LASTEXITCODE -ne 0){Fail 'Could not enable Tailscale Funnel path. Check Tailscale Funnel permissions/status.'}
Write-Host ''
Write-Host '[OK] Your FreeLLMAPI chat route is configured:'
Write-Host "https://$expectedHost/freellmapi/v1"
Write-Host 'In Vercel project Environment Variables set:'
Write-Host '  FREELLMAPI_BASE_URL  = the HTTPS URL above'
Write-Host '  FREELLMAPI_API_KEY   = your private Unified API Key (do NOT share)'
Write-Host 'Save Production and Redeploy to activate.'
Write-Host ''
Write-Host 'Keep Windows, FreeLLMAPI desktop and Tailscale ON while using the website.'
Write-Host 'The FreeLLMAPI admin dashboard was NOT exposed by this bridge.'
