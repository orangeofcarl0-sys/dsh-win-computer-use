param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $state = Read-TestState (Join-Path $base 'state.json')
  if (-not $state) { Out-Finish -Ok $false -Checks @((Add-Check 'state file' $false 'missing')) -EnvError 'state file missing' }
  $doc = Join-Path $base 'out\report.docx'
  if (-not (Test-Path $doc)) { Out-Finish -Ok $false -Checks @((Add-Check 'file exists' $false $doc)) }
  $checks += (Add-Check 'file exists' $true $doc)
  $outHash = Get-S4Sha256 $doc
  $checks += (Add-Check 'document changed from seed' ($outHash -ne [string]$state.seedHash) ("seed=$($state.seedHash) out=$outHash"))
  $m = Read-DocxManifest $doc
  $text = (([string]$m.text) -replace "`r`n", "`n").Trim()
  $checks += (Add-Check 'original text retained' ($text.IndexOf('S4 W01 original', [System.StringComparison]::Ordinal) -ge 0) $text)
  $checks += (Add-Check 'edited text present' ($text.IndexOf('S4 W01 edited', [System.StringComparison]::Ordinal) -ge 0) $text)
  $ok = -not ($checks | Where-Object { -not $_.ok })
  Out-Finish -Ok $ok -Checks $checks
} catch {
  Out-Finish -Ok $false -Checks $checks
}
