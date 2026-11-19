param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
$calc = $null
try {
  $stateFile = Join-Path (Get-TaskDir) 'test-calculator.json'
  $state = Read-TestState $stateFile
  if (-not $state) {
    $checks += (Add-Check 'calculator state exists' $false $stateFile)
    Out-Finish -Ok $false -Checks $checks
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
  if ($found.Count -gt 0) { $calc = $found[0] }
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError ('uia: ' + $_.Exception.Message)
}
if (-not $calc) {
  $checks += (Add-Check 'calculator results found' $false 'owned calculator HWND has no CalculatorResults (closed? wrong app?)')
  Out-Finish -Ok $false -Checks $checks
}
$name = ''
try { $name = [string]$calc.Current.Name } catch {}
$digits = ($name -replace '[^0-9]', '')
$checks += (Add-Check 'calculator results found' $true 'CalculatorResults located in owned HWND')
$checks += (Add-Check 'display text read' ($name.Length -gt 0) $name)
$ok = ($digits -eq '7006652')
$checks += (Add-Check 'value == 7006652' $ok ('parsed=' + $digits))
Out-Finish -Ok $ok -Checks $checks
