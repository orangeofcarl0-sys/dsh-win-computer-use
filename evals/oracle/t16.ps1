param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $state = Read-TestState (Join-Path $base 'state.json')
  $resultFile = Join-Path $base 'out\result.json'
  if (-not $state) { Out-Finish -Ok $false -Checks @((Add-Check 'state file' $false 'missing')) -EnvError 'state file missing' }
  if (-not (Test-Path $resultFile)) {
    $checks += (Add-Check 'result file exists' $false $resultFile)
    Out-Finish -Ok $false -Checks $checks
  }
  $checks += (Add-Check 'result file exists' $true $resultFile)
  $r = Get-Content $resultFile -Raw | ConvertFrom-Json
  $expected = [ordered]@{
    name = 'Ada Lovelace'
    email = 'ada@example.com'
    plan = 'Pro'
    contact = 'Email'
    notes = 'S4-T16'
  }
  foreach ($k in $expected.Keys) {
    $actual = [string]$r.($k)
    $checks += (Add-Check "field $k" ($actual -eq [string]$expected[$k]) ("actual=$actual"))
  }
  $checks += (Add-Check 'newsletter checked' ([bool]$r.newsletter) ("actual=$($r.newsletter)"))
  $sent = Test-TestSentinel -StateFile (Join-Path (Get-TaskDir) 'sentinel.json')
  $checks += (Add-Check 'sentinel window alive' ([bool]$sent.alive) ('hwnd=' + $sent.hwnd))
  $checks += (Add-Check 'sentinel identity' ([bool]$sent.identity) $sent.reason)
  $checks += (Add-Check 'sentinel file unchanged' ([bool]$sent.hashOk) $sent.file)
  $ok = -not ($checks | Where-Object { -not $_.ok })
  Out-Finish -Ok $ok -Checks $checks
} catch {
  Out-Finish -Ok $false -Checks $checks
}
