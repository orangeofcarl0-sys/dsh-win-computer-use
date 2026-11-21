param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $v = Get-S4VariantData -TaskId $TaskId
  $appDir = New-TaskDir 'app'
  $out = New-TaskDir 'out'
  $resultFile = Join-Path $out 'result.json'
  if (Test-Path $resultFile) { Remove-Item $resultFile -Force }
  $appScript = Join-Path $appDir 'a11y-app.ps1'
  $app = @'
param([string]$ResultFile)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
function Write-State($state) {
  [IO.File]::WriteAllText($ResultFile, ($state | ConvertTo-Json -Compress), (New-Object System.Text.UTF8Encoding($false)))
}
$state = [ordered]@{ text = ''; submitted = $false }
Write-State $state
$form = New-Object System.Windows.Forms.Form
$form.Text = 'S4-A11Y01-KEYBOARD'
$form.Width = 460
$form.Height = 220
$form.StartPosition = 'Manual'
$form.Left = 260
$form.Top = 220
$input = New-Object System.Windows.Forms.TextBox
$input.Name = 'Input'
$input.Left = 24
$input.Top = 40
$input.Width = 380
$input.TabIndex = 0
$input.AccessibleName = 'Input'
$form.Controls.Add($input)
$button = New-Object System.Windows.Forms.Button
$button.Text = 'Submit'
$button.Left = 24
$button.Top = 90
$button.Width = 120
$button.Height = 40
$button.TabIndex = 1
$button.AccessibleName = 'Submit'
$button.Add_Click({ $state.text = $input.Text; $state.submitted = $true; Write-State $state })
$form.Controls.Add($button)
$form.AcceptButton = $button
$form.Add_Shown({ $input.Focus() })
[System.Windows.Forms.Application]::Run($form)
'@
  [IO.File]::WriteAllText($appScript, $app, (New-Object System.Text.UTF8Encoding($false)))
  $startedAt = (Get-Date).ToUniversalTime()
  $psExe = (Get-Command powershell.exe -ErrorAction SilentlyContinue).Source
  if (-not $psExe) { Out-Finish -Ok $false -Checks $checks -Kind 'setup' -EnvError 'powershell.exe not found' }
  $stateFile = Join-Path $base 'app.json'
  $win = Open-TestAppWindow -Exe $psExe -Arguments @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $appScript, '-ResultFile', $resultFile) -ProcessName 'powershell' -TitleNeedle @('S4-A11Y01-KEYBOARD') -StateFile $stateFile -TimeoutSec 20
  $checks += (Add-Check 'accessibility fixture window' ([bool]$win.ok) ("hwnd=$($win.hwnd) title=$($win.title) reason=$($win.reason)"))
  [void](Write-TestState (Join-Path $base 'state.json') ([ordered]@{ startedAt = $startedAt.ToString('o'); result = $resultFile; text = [string]$v.text; variant = [int]$v.variant }))
  if (-not $win.ok) { Out-Finish -Ok $false -Checks $checks -Kind 'setup' -EnvError ("fixture unavailable: " + $win.reason) }
  Out-Finish -Ok $true -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
