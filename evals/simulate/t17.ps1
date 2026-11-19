param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $state = Read-TestState (Join-Path $base 'state.json')
  if (-not $state) { Out-Finish -Ok $false -Checks $checks -EnvError 'state file missing' -Kind 'simulate' }
  $fixture = Join-Path $PSScriptRoot '..\fixtures\t17-excerpt.xlsx'
  if (-not (Test-Path $fixture)) { Out-Finish -Ok $false -Checks $checks -EnvError 't17 fixture missing' -Kind 'simulate' }
  $outDir = New-TaskDir 'out'
  $out = Join-Path $outDir 'excerpt.xlsx'
  Copy-Item $fixture $out -Force
  (Get-Item $out).LastWriteTimeUtc = (Get-Date).ToUniversalTime()
  $m = Read-XlsxManifest $out
  $a1 = ''
  if ($m.cells.Contains('A1')) { $a1 = [string]$m.cells['A1'] }
  $checks += (Add-Check 'fixture A1 matches sentence' ($a1 -eq [string]$state.sentence) ("actual=[$a1]"))
  $checks += (Add-Check 'simulated excerpt' (Test-Path $out) $out)
  Out-Finish -Ok ($a1 -eq [string]$state.sentence) -Checks $checks -Kind 'simulate'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'simulate'
}
