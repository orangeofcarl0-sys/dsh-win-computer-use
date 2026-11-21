param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $state = Read-TestState (Join-Path $base 'state.json')
  if (-not $state) { Out-Finish -Ok $false -Checks @((Add-Check 'state file' $false 'missing')) -EnvError 'state file missing' }
  $final = Join-Path $base 'final.txt'
  if (-not (Test-Path $final)) { Out-Finish -Ok $false -Checks @((Add-Check 'final file exists' $false $final)) }
  $text = [IO.File]::ReadAllText($final)
  $norm = ($text -replace "`r`n", "`n").Trim()
  $checks += (Add-Check 'draft text retained' ($norm.IndexOf('S4 REC01 DRAFT', [System.StringComparison]::Ordinal) -ge 0) $norm)
  $checks += (Add-Check 'recovered text present' ($norm.IndexOf('S4 REC01 RECOVERED', [System.StringComparison]::Ordinal) -ge 0) $norm)
  $ok = -not ($checks | Where-Object { -not $_.ok })
  Out-Finish -Ok $ok -Checks $checks
} catch {
  Out-Finish -Ok $false -Checks $checks
}
