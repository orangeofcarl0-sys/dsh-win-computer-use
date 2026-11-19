param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $sentinelState = Join-Path (Get-TaskDir) 'sentinel.json'
  $sent = Open-TestSentinel -TaskId $TaskId -StateFile $sentinelState
  $checks += (Add-Check 'sentinel opened' ([bool]$sent.ok) ("hwnd=$($sent.hwnd) pid=$($sent.pid) reason=$($sent.reason)"))
  if (-not $sent.ok) {
    Out-Finish -Ok $false -Checks $checks -EnvError ('sentinel unavailable: ' + $sent.reason) -Kind 'setup'
  }
  $base = Get-TaskDir
  [void](New-TaskDir 'out')
  $seed = Join-Path $base 'seed.xlsx'
  if (Test-Path $seed) { Remove-Item $seed -Force }
  $blank = 'C:\Program Files\Microsoft Office\root\vfs\Windows\SHELLNEW\EXCEL12.XLSX'
  if (-not (Test-Path $blank)) {
    Out-Finish -Ok $false -Checks @((Add-Check 'Excel shellnew seed' $false $blank)) -Kind 'setup' -EnvError 'Excel shellnew seed missing'
  }
  Copy-Item $blank $seed -Force
  $seedHash = Get-S4Sha256 $seed
  $startedAt = (Get-Date).ToUniversalTime()
  $excelExe = Join-Path $env:ProgramFiles 'Microsoft Office\root\Office16\EXCEL.EXE'
  $stateFile = Join-Path $base 'excel.json'
  $x = [ordered]@{ ok = $false; hwnd = 0; title = ''; reason = "not found: $excelExe" }
  if (Test-Path $excelExe) {
    $x = Open-TestAppWindow -Exe $excelExe -Arguments @($seed) -ProcessName 'EXCEL' -TitleNeedle @('seed.xlsx', 'seed') -StateFile $stateFile -TimeoutSec 30
  }
  $checks += (Add-Check 'Excel test window' ([bool]$x.ok) ("hwnd=$($x.hwnd) title=$($x.title) reason=$($x.reason)"))
  $checks += (Add-Check 'seed unchanged before run' ((Get-S4Sha256Shared $seed) -eq $seedHash) $seed)
  [void](Write-TestState (Join-Path $base 'state.json') ([ordered]@{ startedAt = $startedAt.ToString('o'); seed = $seed; seedHash = $seedHash }))
  if (-not $x.ok) { Out-Finish -Ok $false -Checks $checks -Kind 'setup' -EnvError ("Excel unavailable: " + $x.reason) }
  Out-Finish -Ok $true -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
