param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $state = Read-TestState (Join-Path $base 'state.json')
  if (-not $state) { Out-Finish -Ok $false -Checks @((Add-Check 'state file' $false 'missing')) -EnvError 'state file missing' }
  $started = [datetime]::Parse([string]$state.startedAt).ToUniversalTime()
  $dl = Get-S4DownloadsDir
  $found = Wait-S4DownloadMatchAny -Dir $dl -StartedAt $started -ExpectedHash ([string]$state.csvHash) -Filter '*.csv' -TimeoutSec 5
  $checks += (Add-Check 'downloaded CSV hash' ($null -ne $found) $dl)

  $xlsx = Join-Path $base 'out\sales.xlsx'
  if (-not (Test-Path $xlsx)) {
    $checks += (Add-Check 'Excel output exists' $false $xlsx)
  } else {
    $checks += (Add-Check 'Excel output exists' $true $xlsx)
    $checks += (Add-Check 'Excel changed from seed' ((Get-S4Sha256 $xlsx) -ne [string]$state.seedHash) '')
    $m = Read-XlsxManifest $xlsx
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
      $checks += (Add-Check "cell $k" ($actual -ceq [string]$expected[$k]) ("actual=$actual"))
    }
    $bar = @($m.charts | Where-Object { $_.kind -eq 'barChart' })
    $checks += (Add-Check 'native bar chart part' ($bar.Count -ge 1) ("charts=$($m.charts.Count)"))
    $titleOk = $false
    foreach ($c in $bar) { if (([string]$c.title).IndexOf('S4 Sales', [System.StringComparison]::Ordinal) -ge 0) { $titleOk = $true } }
    $checks += (Add-Check 'chart title S4 Sales' $titleOk '')
  }
  $sent = Test-TestSentinel -StateFile (Join-Path $base 'sentinel.json')
  $checks += (Add-Check 'sentinel window alive' ([bool]$sent.alive) ('hwnd=' + $sent.hwnd))
  $checks += (Add-Check 'sentinel identity' ([bool]$sent.identity) $sent.reason)
  $checks += (Add-Check 'sentinel file unchanged' ([bool]$sent.hashOk) $sent.file)
  $ok = -not ($checks | Where-Object { -not $_.ok })
  Out-Finish -Ok $ok -Checks $checks
} catch {
  Out-Finish -Ok $false -Checks $checks
}
