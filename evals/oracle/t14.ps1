param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $state = Read-TestState (Join-Path $base 'state.json')
  $out = Join-Path $base 'out\sales.xlsx'
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
  $expected = [ordered]@{
    A1 = 'Month'; B1 = 'Sales'; C1 = 'Cost'; D1 = 'Profit'
    A2 = 'Jan'; B2 = '12000'; C2 = '7000'; D2 = '5000'
    A3 = 'Feb'; B3 = '15000'; C3 = '8000'; D3 = '7000'
    A4 = 'Mar'; B4 = '9000'; C4 = '6000'; D4 = '3000'
    A5 = 'Apr'; B5 = '18000'; C5 = '10000'; D5 = '8000'
    A6 = 'May'; B6 = '21000'; C6 = '12000'; D6 = '9000'
  }
  foreach ($k in $expected.Keys) {
    $actual = ''
    if ($m.cells.Contains($k)) { $actual = [string]$m.cells[$k] }
    $checks += (Add-Check "cell $k" ($actual -eq [string]$expected[$k]) ("actual=$actual"))
  }
  $bar = @($m.charts | Where-Object { $_.kind -eq 'barChart' })
  $checks += (Add-Check 'native bar chart part' ($bar.Count -ge 1) ("charts=$($m.charts.Count)"))
  $seriesOk = $false
  $titleOk = $false
  $axisOk = $false
  $catDetail = ''
  $months = @('Jan', 'Feb', 'Mar', 'Apr', 'May')
  foreach ($c in $bar) {
    if (([string]$c.title).IndexOf('S4 Sales', [System.StringComparison]::Ordinal) -ge 0) { $titleOk = $true }
    foreach ($s in @($c.series)) {
      if (([string]$s.name).IndexOf('Sales', [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { $seriesOk = $true }
      if (([string]$s.valFormula).IndexOf('B2', [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { $seriesOk = $true }
      if (([string]$s.catFormula).IndexOf('A2', [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { $axisOk = $true }
      $labels = @($s.cats)
      $hasMonths = ($months | Where-Object { $labels -notcontains $_ }).Count -eq 0
      if ($hasMonths) { $axisOk = $true }
      $catDetail = "cat=$($s.catFormula) labels=$($labels -join ',')"
    }
  }
  $checks += (Add-Check 'chart title S4 Sales' $titleOk '')
  $checks += (Add-Check 'Sales series values' $seriesOk '')
  $checks += (Add-Check 'Month categories' $axisOk $catDetail)
  $sent = Test-TestSentinel -StateFile (Join-Path (Get-TaskDir) 'sentinel.json')
  $checks += (Add-Check 'sentinel window alive' ([bool]$sent.alive) ('hwnd=' + $sent.hwnd))
  $checks += (Add-Check 'sentinel identity' ([bool]$sent.identity) $sent.reason)
  $checks += (Add-Check 'sentinel file unchanged' ([bool]$sent.hashOk) $sent.file)
  $ok = -not ($checks | Where-Object { -not $_.ok })
  Out-Finish -Ok $ok -Checks $checks
} catch {
  Out-Finish -Ok $false -Checks $checks
}
