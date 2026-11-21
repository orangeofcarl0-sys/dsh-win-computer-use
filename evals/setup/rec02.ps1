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
  $appScript = Join-Path $appDir 'modal-app.ps1'
  $app = @'
param([string]$ResultFile)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
function Write-State($state) {
  $json = $state | ConvertTo-Json -Compress
  [IO.File]::WriteAllText($ResultFile, $json, (New-Object System.Text.UTF8Encoding($false)))
}
$state = [ordered]@{ dismissed = 0; finished = $false }
$form = New-Object System.Windows.Forms.Form
$form.Text = 'S4-REC02-MODAL'
$form.Width = 460
$form.Height = 230
$form.StartPosition = 'Manual'
$form.Left = 260
$form.Top = 220
$start = New-Object System.Windows.Forms.Button
$start.Text = 'Start'
$start.Left = 24
$start.Top = 50
$start.Width = 120
$start.Height = 40
$start.Add_Click({
  $answer = [System.Windows.Forms.MessageBox]::Show('Pause and resume?', 'Recovery', [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Question)
  if ($answer -eq [System.Windows.Forms.DialogResult]::No) { $state.dismissed = [int]$state.dismissed + 1 }
  Write-State $state
})
$finish = New-Object System.Windows.Forms.Button
$finish.Text = 'Finish'
$finish.Left = 170
$finish.Top = 50
$finish.Width = 120
$finish.Height = 40
$finish.Add_Click({ $state.finished = $true; Write-State $state })
$form.Controls.Add($start)
$form.Controls.Add($finish)
[System.Windows.Forms.Application]::Run($form)
'@
  [IO.File]::WriteAllText($appScript, $app, (New-Object System.Text.UTF8Encoding($false)))
  $startedAt = (Get-Date).ToUniversalTime()
  $psExe = (Get-Command powershell.exe -ErrorAction SilentlyContinue).Source
  if (-not $psExe) { Out-Finish -Ok $false -Checks $checks -Kind 'setup' -EnvError 'powershell.exe not found' }
  $stateFile = Join-Path $base 'dialog.json'
  $win = Open-TestAppWindow -Exe $psExe -Arguments @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $appScript, '-ResultFile', $resultFile) -ProcessName 'powershell' -TitleNeedle @('S4-REC02-MODAL') -StateFile $stateFile -TimeoutSec 20
  $checks += (Add-Check 'modal app window' ([bool]$win.ok) ("hwnd=$($win.hwnd) title=$($win.title) reason=$($win.reason)"))
  [void](Write-TestState (Join-Path $base 'state.json') ([ordered]@{ startedAt = $startedAt.ToString('o'); result = $resultFile; isolation = (Get-IsolationMode) }))
  if (-not $win.ok) { Out-Finish -Ok $false -Checks $checks -Kind 'setup' -EnvError ("modal app unavailable: " + $win.reason) }
  Out-Finish -Ok $true -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
