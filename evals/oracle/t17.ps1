param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $state = Read-TestState (Join-Path $base 'state.json')
  $out = Join-Path $base 'out\excerpt.xlsx'
  if (-not $state) { Out-Finish -Ok $false -Checks @((Add-Check 'state file' $false 'missing')) -EnvError 'state file missing' }
  $seed = Join-Path $base 'seed.xlsx'
  $seedActual = Get-S4Sha256Shared $seed
  $checks += (Add-Check 'seed unchanged' ([string]$state.seedHash -ne '' -and $seedActual -eq [string]$state.seedHash) ("expected=$($state.seedHash) actual=$seedActual"))
  if (-not (Test-Path $out)) {
    $checks += (Add-Check 'file exists' $false $out)
    Out-Finish -Ok $false -Checks $checks
  }
  $checks += (Add-Check 'file exists' $true $out)
  $started = [datetime]::Parse([string]$state.startedAt).ToUniversalTime()
  $checks += (Add-Check 'file is newer than setup' ((Get-Item $out).LastWriteTimeUtc -ge $started) 'mtime')
  $m = Read-XlsxManifest $out
  $actual = ''
  if ($m.cells.Contains('A1')) { $actual = [string]$m.cells['A1'] }
  $expected = [string]$state.sentence
  $checks += (Add-Check 'A1 excerpt exact' ($actual -eq $expected) ("actual=[$actual] len=$($actual.Length) expectedLen=$($expected.Length)"))
  $sent = Test-TestSentinel -StateFile (Join-Path (Get-TaskDir) 'sentinel.json')
  $checks += (Add-Check 'sentinel window alive' ([bool]$sent.alive) ('hwnd=' + $sent.hwnd))
  $checks += (Add-Check 'sentinel identity' ([bool]$sent.identity) $sent.reason)
  $checks += (Add-Check 'sentinel file unchanged' ([bool]$sent.hashOk) $sent.file)
  $ok = -not ($checks | Where-Object { -not $_.ok })
  Out-Finish -Ok $ok -Checks $checks
} catch {
  Out-Finish -Ok $false -Checks $checks
}
