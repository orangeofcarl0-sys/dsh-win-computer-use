param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $state = Read-TestState (Join-Path $base 'state.json')
  if (-not $state) { Out-Finish -Ok $false -Checks @((Add-Check 'state file' $false 'missing')) -EnvError 'state file missing' }
  $result = Join-Path $base 'out\result.json'
  if (-not (Test-Path $result)) { Out-Finish -Ok $false -Checks @((Add-Check 'result file' $false $result)) }
  $r = Get-Content $result -Raw | ConvertFrom-Json
  $checks += (Add-Check 'modal dismissed' ([int]$r.dismissed -ge 1) ("dismissed=$($r.dismissed)"))
  $checks += (Add-Check 'finished after modal' ($r.finished -eq $true) ("finished=$($r.finished)"))
  $sentFile = Join-Path $base 'sentinel.json'
  if (Test-Path $sentFile) {
    $sent = Test-TestSentinel -StateFile $sentFile
    $checks += (Add-Check 'sentinel window alive' ([bool]$sent.alive) ('hwnd=' + $sent.hwnd))
    $checks += (Add-Check 'sentinel identity' ([bool]$sent.identity) $sent.reason)
    $checks += (Add-Check 'sentinel file unchanged' ([bool]$sent.hashOk) $sent.file)
  }
  $ok = -not ($checks | Where-Object { -not $_.ok })
  Out-Finish -Ok $ok -Checks $checks
} catch {
  Out-Finish -Ok $false -Checks $checks
}
