param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $state = Read-TestState (Join-Path $base 'state.json')
  if (-not $state) { Out-Finish -Ok $false -Checks @((Add-Check 'state file' $false 'missing')) -EnvError 'state file missing' }
  $started = [datetime]::Parse([string]$state.startedAt).ToUniversalTime()
  $found = Wait-S4DownloadMatch -Dir (Get-S4DownloadsDir) -StartedAt $started -ExpectedHash ([string]$state.expectedHash) -TimeoutSec 5
  $checks += (Add-Check 'retried PDF hash matches' ($null -ne $found) (Get-S4DownloadsDir))
  $sent = Test-TestSentinel -StateFile (Join-Path $base 'sentinel.json')
  $checks += (Add-Check 'sentinel window alive' ([bool]$sent.alive) ('hwnd=' + $sent.hwnd))
  $checks += (Add-Check 'sentinel identity' ([bool]$sent.identity) $sent.reason)
  $checks += (Add-Check 'sentinel file unchanged' ([bool]$sent.hashOk) $sent.file)
  $ok = -not ($checks | Where-Object { -not $_.ok })
  Out-Finish -Ok $ok -Checks $checks
} catch {
  Out-Finish -Ok $false -Checks $checks
}
