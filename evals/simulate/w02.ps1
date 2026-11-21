param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $state = Read-TestState (Join-Path $base 'state.json')
  if (-not $state) { Out-Finish -Ok $false -Checks $checks -EnvError 'state file missing' -Kind 'simulate' }
  $closed = Close-TestAppWindow -StateFile (Join-Path $base 'word.json')
  $checks += (Add-Check 'setup Word closed for simulate' ([bool]$closed.closed) $closed.reason)
  if (-not $closed.closed) { Out-Finish -Ok $false -Checks $checks -EnvError ('cannot close setup Word: ' + $closed.reason) -Kind 'simulate' }
  $outDir = New-TaskDir 'out'
  $out = Join-Path $outDir 'report.docx'
  New-Docx -Path $out -Text 'S4 W02 seed S4 W02 saved'
  (Get-Item $out).LastWriteTimeUtc = (Get-Date).ToUniversalTime()
  $checks += (Add-Check 'simulated output created' (Test-Path $out) $out)
  $checks += (Add-Check 'source seed still unchanged' ((Get-S4Sha256Shared ([string]$state.seed)) -eq [string]$state.seedHash) '')
  Out-Finish -Ok (Test-Path $out) -Checks $checks -Kind 'simulate'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'simulate'
}
