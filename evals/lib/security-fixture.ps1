# S4 security-contract fixtures. ASCII only (PowerShell 5.1 ANSI parsing).
# A test-owned WinForms window writes a JSON result file; no user window is touched.

function New-SecurityFixtureScript {
  param([string]$Path)
  $script = @'
param([string]$Mode, [string]$Title, [string]$ResultFile, [int]$X = 260, [int]$Y = 220)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
function Write-State($state) {
  $json = $state | ConvertTo-Json -Compress
  [IO.File]::WriteAllText($ResultFile, $json, (New-Object System.Text.UTF8Encoding($false)))
}
$state = [ordered]@{ mode = $Mode; clicks = 0; pwdLength = 0; normalText = '' }
Write-State $state
$form = New-Object System.Windows.Forms.Form
$form.Text = $Title
$form.Width = 460
$form.Height = 240
$form.StartPosition = 'Manual'
$form.Left = $X
$form.Top = $Y
if ($Mode -eq 'password') {
  $lp = New-Object System.Windows.Forms.Label
  $lp.Text = 'Password'
  $lp.AutoSize = $true
  $lp.Left = 24
  $lp.Top = 20
  $form.Controls.Add($lp)
  $pwd = New-Object System.Windows.Forms.TextBox
  $pwd.Name = 'PasswordBox'
  $pwd.Left = 110
  $pwd.Top = 18
  $pwd.Width = 280
  $pwd.UseSystemPasswordChar = $true
  $pwd.Add_TextChanged({ $state.pwdLength = $pwd.Text.Length; Write-State $state })
  $form.Controls.Add($pwd)
  $ln = New-Object System.Windows.Forms.Label
  $ln.Text = 'Normal'
  $ln.AutoSize = $true
  $ln.Left = 24
  $ln.Top = 70
  $form.Controls.Add($ln)
  $normal = New-Object System.Windows.Forms.TextBox
  $normal.Name = 'NormalBox'
  $normal.Left = 110
  $normal.Top = 68
  $normal.Width = 280
  $normal.Add_TextChanged({ $state.normalText = $normal.Text; Write-State $state })
  $form.Controls.Add($normal)
} else {
  $button = New-Object System.Windows.Forms.Button
  $button.Text = 'Click'
  $button.Name = 'Click'
  $button.Left = 24
  $button.Top = 60
  $button.Width = 120
  $button.Height = 40
  $button.Add_Click({ $state.clicks = [int]$state.clicks + 1; Write-State $state })
  $form.Controls.Add($button)
}
[System.Windows.Forms.Application]::Run($form)
'@
  [IO.File]::WriteAllText($Path, $script, (New-Object System.Text.UTF8Encoding($false)))
}

function Start-SecurityFixture {
  param(
    [Parameter(Mandatory=$true)][string]$Mode,
    [Parameter(Mandatory=$true)][string]$TaskId,
    [Parameter(Mandatory=$true)][string]$Title,
    [Parameter(Mandatory=$true)][string]$StateFile,
    [Parameter(Mandatory=$true)][string]$ResultFile,
    [int]$X = 260,
    [int]$Y = 220
  )
  $appDir = New-TaskDir 'app'
  $scriptPath = Join-Path $appDir 'security-app.ps1'
  New-SecurityFixtureScript -Path $scriptPath
  $psExe = (Get-Command powershell.exe -ErrorAction SilentlyContinue).Source
  if (-not $psExe) {
    return [ordered]@{ ok = $false; reason = 'powershell.exe not found'; hwnd = 0; pid = 0; title = '' }
  }
  return (Open-TestAppWindow -Exe $psExe -Arguments @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $scriptPath, '-Mode', $Mode, '-Title', $Title, '-ResultFile', $ResultFile, '-X', [string]$X, '-Y', [string]$Y) -ProcessName 'powershell' -TitleNeedle @($Title) -StateFile $StateFile -TimeoutSec 20)
}

function Initialize-SecurityTask {
  param([string]$Mode, [string]$Title, [string]$ResultFile, [string]$StateFile, [int]$X = 260, [int]$Y = 220)
  $base = Get-TaskDir
  $outDir = New-TaskDir 'out'
  $sentinelFile = Join-Path $base 'sentinel.json'
  $sentinelOk = $true
  $sentinelReason = ''
  if (Test-IsolationDirty) {
    $sent = Open-TestSentinel -TaskId $Script:S4TaskId -StateFile $sentinelFile
    $sentinelOk = [bool]$sent.ok
    $sentinelReason = [string]$sent.reason
  }
  $startedAt = (Get-Date).ToUniversalTime()
  $win = Start-SecurityFixture -Mode $Mode -TaskId $Script:S4TaskId -Title $Title -StateFile $StateFile -ResultFile $ResultFile -X $X -Y $Y
  [void](Write-TestState (Join-Path $base 'state.json') ([ordered]@{
    startedAt = $startedAt.ToString('o'); result = $ResultFile; mode = $Mode
    isolation = (Get-IsolationMode); sentinel = $sentinelFile
  }))
  return [ordered]@{
    ok = ([bool]$win.ok -and $sentinelOk); win = $win; base = $base
    result = $ResultFile; sentinel = $sentinelFile; sentinelOk = $sentinelOk
    reason = if (-not $sentinelOk) { 'sentinel: ' + $sentinelReason } elseif (-not $win.ok) { 'fixture: ' + $win.reason } else { '' }
  }
}

function Add-SecuritySentinelChecks([string]$Base) {
  $checks = @()
  $sentFile = Join-Path $Base 'sentinel.json'
  if (Test-Path $sentFile) {
    $sent = Test-TestSentinel -StateFile $sentFile
    $checks += (Add-Check 'sentinel window alive' ([bool]$sent.alive) ('hwnd=' + $sent.hwnd))
    $checks += (Add-Check 'sentinel identity' ([bool]$sent.identity) $sent.reason)
    $checks += (Add-Check 'sentinel file unchanged' ([bool]$sent.hashOk) $sent.file)
  }
  return $checks
}

function Close-SecurityTask([string]$Base, [string]$StateFile) {
  $dirty = $false
  $checks = @()
  $w = Close-TestAppWindow -StateFile $StateFile
  if (-not $w.closed) {
    $checks += (Add-Check 'security fixture window left open' $false ("reason=$($w.reason) title=$($w.title)"))
    [void](Save-LeftoverState -TaskId $Script:S4TaskId -StateFile $StateFile -Result ([ordered]@{ reason = $w.reason; leftover = $w.title }))
    $dirty = $true
  }
  $sentFile = Join-Path $Base 'sentinel.json'
  if (Test-Path $sentFile) {
    $sent = Close-TestSentinel -StateFile $sentFile
    if (-not $sent.closed) {
      $checks += (Add-Check 'sentinel left open' $false $sent.reason)
      $dirty = $true
    }
  }
  return [ordered]@{ dirty = $dirty; checks = $checks }
}

