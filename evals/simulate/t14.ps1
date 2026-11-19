param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $state = Read-TestState (Join-Path $base 'state.json')
  if (-not $state) { Out-Finish -Ok $false -Checks $checks -EnvError 'state file missing' -Kind 'simulate' }
  $fixture = Join-Path $PSScriptRoot '..\fixtures\t14-sales.xlsx'
  if (-not (Test-Path $fixture)) { Out-Finish -Ok $false -Checks $checks -EnvError 't14 fixture missing' -Kind 'simulate' }
  $outDir = New-TaskDir 'out'
  $out = Join-Path $outDir 'sales.xlsx'
  Copy-Item $fixture $out -Force
  (Get-Item $out).LastWriteTimeUtc = (Get-Date).ToUniversalTime()
  $m = Read-XlsxManifest $out
  $checks += (Add-Check 'fixture has A1:D6' ($m.cells.Contains('A1') -and $m.cells.Contains('D6')) '')
  $checks += (Add-Check 'fixture has bar chart' (@($m.charts | Where-Object { $_.kind -eq 'barChart' }).Count -ge 1) ("charts=$($m.charts.Count)"))
  $checks += (Add-Check 'simulated workbook' (Test-Path $out) $out)
  Out-Finish -Ok $true -Checks $checks -Kind 'simulate'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'simulate'
}
