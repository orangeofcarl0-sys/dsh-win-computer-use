param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $sentinelState = Join-Path (Get-TaskDir) 'sentinel.json'
  $sent = Open-TestSentinel -TaskId $TaskId -StateFile $sentinelState
  $checks += (Add-Check 'sentinel opened' ([bool]$sent.ok) ("hwnd=$($sent.hwnd) pid=$($sent.pid) reason=$($sent.reason)"))
  if (-not $sent.ok) {
    Out-Finish -Ok $false -Checks $checks -EnvError ('sentinel unavailable: ' + $sent.reason) -Kind 'setup'
  }
  $base = Get-TaskDir
  [void](New-TaskDir 'state')
  $startedAt = (Get-Date).ToUniversalTime()
  $url = 'https://papers.nips.cc/paper_files/paper/2017/file/3f5ee243547dee91fbd053c1c4a845aa-Paper.pdf'
  $tmp = Join-Path $base 'reference.pdf'
  if (Test-Path $tmp) { Remove-Item $tmp -Force }
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $url -OutFile $tmp -TimeoutSec 45 -UseBasicParsing | Out-Null
  } catch {
    Out-Finish -Ok $false -Checks @((Add-Check 'network preflight' $false $_.Exception.Message)) -Kind 'setup' -EnvError $_.Exception.Message
  }
  if (-not (Test-Path $tmp) -or (Get-Item $tmp).Length -lt 50000) {
    Out-Finish -Ok $false -Checks @((Add-Check 'reference download' $false 'missing or too small')) -Kind 'setup' -EnvError 'paper reference download failed'
  }
  $hash = Get-S4Sha256 $tmp
  $size = (Get-Item $tmp).Length
  $checks += (Add-Check 'reference download' ($hash.Length -eq 64) ("size=$size sha256=$hash"))
  Remove-Item $tmp -Force

  $state = [ordered]@{
    startedAt = $startedAt.ToString('o')
    expectedHash = $hash
    expectedSize = $size
    url = $url
  }
  [void](Write-TestState (Join-Path $base 'state.json') $state)

  $browserState = Join-Path $base 'browser.json'
  $b = Open-TestBrowserWindow -Url 'https://papers.nips.cc/paper_files/paper/2017/hash/3f5ee243547dee91fbd053c1c4a845aa-Abstract.html' -TitleNeedle 'Attention' -StateFile $browserState
  $checks += (Add-Check 'browser test window' ([bool]$b.ok) ("hwnd=$($b.hwnd) title=$($b.title) reason=$($b.reason)"))
  if (-not $b.ok) {
    Out-Finish -Ok $false -Checks $checks -Kind 'setup' -EnvError ("browser unavailable: " + $b.reason)
  }
  Out-Finish -Ok $true -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
