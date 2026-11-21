param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  if (Test-IsolationDirty) {
    $sent = Open-TestSentinel -TaskId $TaskId -StateFile (Join-Path $base 'sentinel.json')
    $checks += (Add-Check 'sentinel opened' ([bool]$sent.ok) ("hwnd=$($sent.hwnd) reason=$($sent.reason)"))
    if (-not $sent.ok) { Out-Finish -Ok $false -Checks $checks -EnvError ('sentinel unavailable: ' + $sent.reason) -Kind 'setup' }
  }
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
$state = [ordered]@{ cancelled = 0; confirmed = 0; nestedCancelled = 0; archived = $false }
$form = New-Object System.Windows.Forms.Form
$form.Text = 'S4-T23-DIALOG'
$form.Width = 460
$form.Height = 220
$form.StartPosition = 'Manual'
$form.Left = 260
$form.Top = 220
$label = New-Object System.Windows.Forms.Label
$label.Text = 'Nested dialog test'
$label.AutoSize = $true
$label.Left = 24
$label.Top = 24
$form.Controls.Add($label)
$button = New-Object System.Windows.Forms.Button
$button.Text = 'Archive'
$button.Left = 24
$button.Top = 70
$button.Width = 120
$button.Height = 40
$button.Add_Click({
  $answer = [System.Windows.Forms.MessageBox]::Show('Archive this item?', 'Confirm', [System.Windows.Forms.MessageBoxButtons]::YesNoCancel, [System.Windows.Forms.MessageBoxIcon]::Question)
  if ($answer -ne [System.Windows.Forms.DialogResult]::Yes) {
    $state.cancelled = [int]$state.cancelled + 1
  } else {
    $state.confirmed = [int]$state.confirmed + 1
    $again = [System.Windows.Forms.MessageBox]::Show('Really archive it?', 'Confirm again', [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Warning)
    if ($again -eq [System.Windows.Forms.DialogResult]::Yes) {
      $state.archived = $true
    } else {
      $state.nestedCancelled = [int]$state.nestedCancelled + 1
    }
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
  $win = Open-TestAppWindow -Exe $psExe -Arguments @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $appScript, '-ResultFile', $resultFile) -ProcessName 'powershell' -TitleNeedle @('S4-T23-DIALOG') -StateFile $stateFile -TimeoutSec 20
  $checks += (Add-Check 'dialog app window' ([bool]$win.ok) ("hwnd=$($win.hwnd) title=$($win.title) reason=$($win.reason)"))
  [void](Write-TestState (Join-Path $base 'state.json') ([ordered]@{ startedAt = $startedAt.ToString('o'); result = $resultFile; isolation = (Get-IsolationMode) }))
  if (-not $win.ok) { Out-Finish -Ok $false -Checks $checks -Kind 'setup' -EnvError ("dialog app unavailable: " + $win.reason) }
  Out-Finish -Ok $true -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
