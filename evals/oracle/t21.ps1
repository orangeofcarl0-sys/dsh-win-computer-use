param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $stateFile = Join-Path (Get-TaskDir) 'test-calculator-2.json'
  $state = Read-TestState $stateFile
  if (-not $state) {
    Out-Finish -Ok $false -Checks @((Add-Check 'calculator state exists' $false $stateFile)) -EnvError 'calculator state missing'
  }
  $owned = [bool]$state.owned
  $hwnd = [int]$state.hwnd
  $checks += (Add-Check 'calculator is task-owned' ($owned -and $hwnd -ne 0) ("owned=$owned hwnd=$hwnd"))
  if (-not $owned -or $hwnd -eq 0) {
    Out-Finish -Ok $false -Checks $checks
  }
  Add-Type -AssemblyName UIAutomationClient
  $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$hwnd)
  $idCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'CalculatorResults')
  $found = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $idCond)
  if ($found.Count -eq 0) {
    $checks += (Add-Check 'calculator results found' $false 'owned calculator HWND has no CalculatorResults')
    Out-Finish -Ok $false -Checks $checks
  }
  $name = [string]$found[0].Current.Name
  $digits = ($name -replace '[^0-9]', '')
  $expected = [string]$state.expected
  $checks += (Add-Check 'calculator results found' $true 'CalculatorResults located in owned HWND')
  $checks += (Add-Check 'display text read' ($name.Length -gt 0) $name)
  $checks += (Add-Check "value == $expected" ($digits -eq $expected) ('parsed=' + $digits))
  $ok = ($digits -eq $expected)
  Out-Finish -Ok $ok -Checks $checks
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError ('uia: ' + $_.Exception.Message)
}
