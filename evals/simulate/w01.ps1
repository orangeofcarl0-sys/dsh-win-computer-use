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
  $doc = Join-Path $outDir 'report.docx'
  New-Docx -Path $doc -Text 'S4 W01 original S4 W01 edited'
  (Get-Item $doc).LastWriteTimeUtc = (Get-Date).ToUniversalTime()
  $hash = Get-S4Sha256 $doc
  $checks += (Add-Check 'simulated edit differs from seed' ($hash -ne [string]$state.seedHash) ("seed=$($state.seedHash) out=$hash"))
  Out-Finish -Ok ($hash -ne [string]$state.seedHash) -Checks $checks -Kind 'simulate'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'simulate'
}
