param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $appDir = New-TaskDir 'app'
  $out = New-TaskDir 'out'
  $resultFile = Join-Path $out 'result.json'
  if (Test-Path $resultFile) { Remove-Item $resultFile -Force }
  $appScript = Join-Path $appDir 'dialog-app.ps1'
  $app = @'
param([string]$ResultFile)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
function Write-State($state) {
  $json = $state | ConvertTo-Json -Compress
  [IO.File]::WriteAllText($ResultFile, $json, (New-Object System.Text.UTF8Encoding($false)))
}
$state = [ordered]@{ cancelled = 0; confirmed = 0; deleted = $false }
$form = New-Object System.Windows.Forms.Form
$form.Text = 'S4-T20-DIALOG'
$form.Width = 460
$form.Height = 220
$form.StartPosition = 'Manual'
$form.Left = 260
$form.Top = 220
$label = New-Object System.Windows.Forms.Label
$label.Text = 'Dialog chain test'
$label.AutoSize = $true
$label.Left = 24
$label.Top = 24
$form.Controls.Add($label)
$button = New-Object System.Windows.Forms.Button
$button.Text = 'Delete'
$button.Left = 24
$button.Top = 70
$button.Width = 120
$button.Height = 40
$button.Add_Click({
  $answer = [System.Windows.Forms.MessageBox]::Show('Delete this item?', 'Confirm', [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Warning)
  if ($answer -eq [System.Windows.Forms.DialogResult]::No) {
    $state.cancelled = [int]$state.cancelled + 1
  } else {
    $state.confirmed = [int]$state.confirmed + 1
    $state.deleted = $true
  }
  Write-State $state
})
$form.Controls.Add($button)
[System.Windows.Forms.Application]::Run($form)
'@
  [IO.File]::WriteAllText($appScript, $app, (New-Object System.Text.UTF8Encoding($false)))
  $startedAt = (Get-Date).ToUniversalTime()
  $psExe = (Get-Command powershell.exe -ErrorAction SilentlyContinue).Source
  if (-not $psExe) { Out-Finish -Ok $false -Checks $checks -Kind 'setup' -EnvError 'powershell.exe not found' }
  $stateFile = Join-Path $base 'dialog.json'
  $win = Open-TestAppWindow -Exe $psExe -Arguments @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $appScript, '-ResultFile', $resultFile) -ProcessName 'powershell' -TitleNeedle @('S4-T20-DIALOG') -StateFile $stateFile -TimeoutSec 20
  $checks += (Add-Check 'dialog app window' ([bool]$win.ok) ("hwnd=$($win.hwnd) title=$($win.title) reason=$($win.reason)"))
  [void](Write-TestState (Join-Path $base 'state.json') ([ordered]@{ startedAt = $startedAt.ToString('o'); result = $resultFile }))
  if (-not $win.ok) { Out-Finish -Ok $false -Checks $checks -Kind 'setup' -EnvError ("dialog app unavailable: " + $win.reason) }
  Out-Finish -Ok $true -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
