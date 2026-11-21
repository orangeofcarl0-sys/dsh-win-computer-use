param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $sent = Open-TestSentinel -TaskId $TaskId -StateFile (Join-Path $base 'sentinel.json')
  $checks += (Add-Check 'sentinel opened' ([bool]$sent.ok) ("hwnd=$($sent.hwnd) reason=$($sent.reason)"))
  if (-not $sent.ok) { Out-Finish -Ok $false -Checks $checks -Kind 'setup' -EnvError ('sentinel unavailable: ' + $sent.reason) }
  $web = New-TaskDir 'web'
  $out = New-TaskDir 'out'
  $result = Join-Path $out 'result.json'
  $serverState = Join-Path $base 'server.json'
  $csv = Join-Path $PSScriptRoot '..\fixtures\combo02-sales.csv'
  if (-not (Test-Path $csv)) { Out-Finish -Ok $false -Checks $checks -Kind 'setup' -EnvError 'combo02 CSV fixture missing' }
  $csvHash = Get-S4Sha256 $csv
  $srv = Start-TestFormServer -Root $web -ResultFile $result -StateFile $serverState -Mode 'download-csv' -Fixture $csv
  $checks += (Add-Check 'local CSV server' ([bool]$srv.ok) ("port=$($srv.port) reason=$($srv.reason)"))
  if (-not $srv.ok) { Out-Finish -Ok $false -Checks $checks -Kind 'setup' -EnvError ('CSV server unavailable: ' + $srv.reason) }
  $url = "http://127.0.0.1:$($srv.port)/"
  $viewer = Open-TestBrowserWindow -Url $url -TitleNeedle 'S4-COMBO02-DOWNLOAD' -StateFile (Join-Path $base 'viewer.json')
  $checks += (Add-Check 'browser download page' ([bool]$viewer.ok) ("hwnd=$($viewer.hwnd) title=$($viewer.title) reason=$($viewer.reason)"))
  $blank = 'C:\Program Files\Microsoft Office\root\vfs\Windows\SHELLNEW\EXCEL12.XLSX'
  $xlsx = Join-Path $out 'sales.xlsx'
  if (-not (Test-Path $blank)) { Out-Finish -Ok $false -Checks $checks -Kind 'setup' -EnvError 'EXCEL12.XLSX shell seed missing' }
  Copy-Item $blank $xlsx -Force
  $seedHash = Get-S4Sha256 $xlsx
  $excelExe = Join-Path $env:ProgramFiles 'Microsoft Office\root\Office16\EXCEL.EXE'
  $excel = [ordered]@{ ok = $false; hwnd = 0; title = ''; reason = "not found: $excelExe" }
  if (Test-Path $excelExe) {
    $excel = Open-TestAppWindow -Exe $excelExe -Arguments @($xlsx) -ProcessName 'EXCEL' -TitleNeedle @('sales.xlsx', 'sales') -StateFile (Join-Path $base 'excel.json') -TimeoutSec 30
  }
  $checks += (Add-Check 'Excel test window' ([bool]$excel.ok) ("hwnd=$($excel.hwnd) title=$($excel.title) reason=$($excel.reason)"))
  [void](Write-TestState (Join-Path $base 'state.json') ([ordered]@{
    startedAt = (Get-Date).ToUniversalTime().ToString('o'); csv = $csv; csvHash = $csvHash
    xlsx = $xlsx; seedHash = $seedHash; server = $serverState
  }))
  $ok = [bool]$srv.ok -and [bool]$viewer.ok -and [bool]$excel.ok
  $envErr = ''
  if (-not $ok) { $envErr = "browser/Excel/server unavailable: $($viewer.reason) $($excel.reason) $($srv.reason)" }
  Out-Finish -Ok $ok -Checks $checks -Kind 'setup' -EnvError $envErr
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
