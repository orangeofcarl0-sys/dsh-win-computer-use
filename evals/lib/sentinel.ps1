# S4 dirty-desktop sentinel helpers.
# ASCII only: Windows PowerShell 5.1 parses BOM-less scripts as ANSI.
# A sentinel is a test-owned, minimized WinForms window plus a sentinel file.
# It is never a user window; cleanup closes only the recorded HWND/PID/start.

function New-TestSentinelScript {
  $path = Join-Path $env:TEMP ('s4-sentinel-' + [guid]::NewGuid().ToString('N') + '.ps1')
  $script = @'
param([string]$Title)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$form = New-Object System.Windows.Forms.Form
$form.Text = $Title
$form.Width = 420
$form.Height = 180
$form.StartPosition = 'Manual'
$form.Left = 40
$form.Top = 40
$form.ShowInTaskbar = $true
$form.WindowState = 'Minimized'
$label = New-Object System.Windows.Forms.Label
$label.Text = 'S4 sentinel window - do not close'
$label.AutoSize = $true
$label.Left = 20
$label.Top = 20
$form.Controls.Add($label)
$form.Add_Shown({ $form.WindowState = 'Minimized' })
[System.Windows.Forms.Application]::Run($form)
'@
  [IO.File]::WriteAllText($path, $script, (New-Object System.Text.UTF8Encoding($false)))
  return $path
}

function Open-TestSentinel {
  # Create a sentinel file and a minimized test-owned window. Returns a state
  # object; writes StateFile when provided. Never touches user windows.
  param([string]$TaskId = '', [string]$StateFile = '', [int]$TimeoutSec = 15)
  $id = $TaskId
  if (-not $id) { $id = $Script:S4TaskId }
  if (-not $id) { return [ordered]@{ ok = $false; reason = 'no task id' } }
  $dir = Join-Path $env:USERPROFILE (Join-Path '.dsh\s4-evals' $id)
  $sentinelDir = Join-Path $dir 'sentinel'
  if (-not (Test-Path $sentinelDir)) { New-Item -ItemType Directory -Path $sentinelDir -Force | Out-Null }
  $file = Join-Path $sentinelDir 'user-data.txt'
  $token = 'SENTINEL-' + $id + '-' + [guid]::NewGuid().ToString('N')
  [IO.File]::WriteAllText($file, $token, (New-Object System.Text.UTF8Encoding($false)))
  $hash = Get-S4Sha256 $file
  $title = 'S4-SENTINEL-' + $id
  $script = New-TestSentinelScript
  $proc = $null
  try {
    $proc = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $script, '-Title', $title) -PassThru -WindowStyle Hidden
  } catch {
    Remove-Item $script -Force -ErrorAction SilentlyContinue
    return [ordered]@{ ok = $false; reason = $_.Exception.Message; file = $file; hash = $hash }
  }
  $start = ''
  try { $start = (Get-Process -Id $proc.Id -ErrorAction Stop).StartTime.ToString('o') } catch {}
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  $hit = $null
  while ((Get-Date) -lt $deadline) {
    $hit = @(Find-WindowsByTitle $title) | Select-Object -First 1
    if ($hit) { break }
    Start-Sleep -Milliseconds 300
  }
  if (-not $hit) {
    if ($proc -and (Test-ProcessIdentity ([int]$proc.Id) $start)) {
      Stop-Process -Id ([int]$proc.Id) -Force -ErrorAction SilentlyContinue
    }
    Remove-Item $script -Force -ErrorAction SilentlyContinue
    return [ordered]@{ ok = $false; reason = 'sentinel window not found'; file = $file; hash = $hash; pid = if ($proc) { [int]$proc.Id } else { 0 }; processStart = $start }
  }
  $state = [ordered]@{
    ok = $true
    hwnd = [int]$hit.hwnd
    title = [string]$hit.title
    pid = [int]$proc.Id
    processStart = $start
    file = $file
    hash = $hash
    at = (Get-Date).ToString('o')
  }
  if ($StateFile) { [void](Write-TestState $StateFile $state) }
  Remove-Item $script -Force -ErrorAction SilentlyContinue
  return $state
}

function Test-TestSentinel {
  # Verify the sentinel window is alive, identity is intact, and the file hash
  # is unchanged. Returns {ok, alive, identity, hashOk, reason, ...}.
  param([string]$StateFile)
  $res = [ordered]@{ ok = $false; alive = $false; identity = $false; hashOk = $false; reason = ''; hwnd = 0; file = '' }
  if (-not $StateFile -or -not (Test-Path $StateFile)) { $res.reason = 'state file missing'; return $res }
  $s = Read-TestState $StateFile
  if (-not $s) { $res.reason = 'state unreadable'; return $res }
  $res.hwnd = [int]$s.hwnd
  $res.file = [string]$s.file
  $res.alive = Test-WindowAlive ([int]$s.hwnd)
  $res.identity = Test-ProcessIdentity ([int]$s.pid) ([string]$s.processStart)
  $res.hashOk = (Test-Path ([string]$s.file)) -and ((Get-S4Sha256 ([string]$s.file)) -eq [string]$s.hash)
  $res.ok = [bool]($res.alive -and $res.identity -and $res.hashOk)
  if (-not $res.alive) { $res.reason = 'window not alive' }
  elseif (-not $res.identity) { $res.reason = 'pid/start mismatch' }
  elseif (-not $res.hashOk) { $res.reason = 'sentinel file changed' }
  return $res
}

function Close-TestSentinel {
  # Close only the recorded sentinel window. If UIA close does not finish, stop
  # only the exact test-created PowerShell PID after verifying its StartTime.
  param([string]$StateFile)
  $res = [ordered]@{ closed = $false; reason = ''; title = '' }
  if (-not $StateFile -or -not (Test-Path $StateFile)) { $res.closed = $true; $res.reason = 'no state file'; return $res }
  $s = Read-TestState $StateFile
  if (-not $s) { $res.reason = 'state unreadable'; return $res }
  if (-not (Test-WindowAlive ([int]$s.hwnd))) { $res.closed = $true; $res.reason = 'window already gone'; return $res }
  $w = Find-WindowByHwnd ([int]$s.hwnd)
  if ($w) { $res.title = [string]$w.title }
  if (-not (Close-WindowUia ([int]$s.hwnd))) {
    try { [void][S4W32]::PostMessage([IntPtr]$s.hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) } catch {}
  }
  Start-Sleep -Milliseconds 700
  if (Test-WindowAlive ([int]$s.hwnd)) {
    if (Test-ProcessIdentity ([int]$s.pid) ([string]$s.processStart)) {
      try { Stop-Process -Id ([int]$s.pid) -Force -ErrorAction Stop } catch {}
      Start-Sleep -Milliseconds 500
    }
  }
  if (Test-WindowAlive ([int]$s.hwnd)) { $res.reason = 'close not confirmed' } else { $res.closed = $true }
  return $res
}
