param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $target = Join-Path $base 'nav\target.txt'
  $exists = Test-Path $target
  $checks += (Add-Check 'target file exists' $exists $target)
  if ($exists) {
    $text = ([IO.File]::ReadAllText($target)) -replace "`r`n", "`n"
    $checks += (Add-Check 'content exact' ($text.Trim() -ceq 'NAV-OK') ('read=' + $text.Trim()))
  }
  $ok = -not ($checks | Where-Object { -not $_.ok })
  Out-Finish -Ok $ok -Checks $checks
} catch {
  Out-Finish -Ok $false -Checks $checks
}
