param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  [void](New-TaskDir)
  $v = Get-S4VariantData -TaskId $TaskId
  $before = Get-CalculatorWindow
  $pid2 = Start-Calculator
  $after = Get-CalculatorWindow
  $owned = [bool]($after -and (-not $before -or [int]$before.hwnd -ne [int]$after.hwnd))
  $start = ''
  if ($after -and $after.pid) {
    try { $start = (Get-Process -Id ([int]$after.pid) -ErrorAction Stop).StartTime.ToString('o') } catch {}
  }
  $stateFile = Join-Path (Get-TaskDir) 'test-calculator-2.json'
  $state = [ordered]@{
    owned = $owned
    hwnd = if ($after) { [int]$after.hwnd } else { 0 }
    pid = if ($after) { [int]$after.pid } else { 0 }
    processStart = $start
    title = if ($after) { [string]$after.title } else { '' }
    expression = [string]$v.expression
    expected = [string]$v.expected
    variant = [int]$v.variant
    at = (Get-Date).ToString('o')
  }
  [void](Write-TestState $stateFile $state)
  $checks += (Add-Check 'calculator opened' ($null -ne $pid2) ('pid=' + $pid2))
  $checks += (Add-Check 'calculator window identity recorded' ([bool]$after) ("hwnd=$($state.hwnd) owned=$owned"))
  if ($null -eq $pid2) {
    Out-Finish -Ok $false -Checks $checks -EnvError 'calculator launch failed' -Kind 'setup'
  }
  if (-not $owned) {
    Out-Finish -Ok $false -Checks $checks -EnvError 'calculator window already existed; close it and rerun to create an owned test window' -Kind 'setup'
  }
  Out-Finish -Ok $true -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
