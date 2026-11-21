param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
$dirty = $false
try {
  $base = Get-TaskDir
  $stateFile = Join-Path $base 'dialog.json'
  $state = Read-TestState $stateFile
  if ($state -and $state.owned -and (Test-WindowAlive ([int]$state.hwnd))) {
    for ($i = 0; $i -lt 3; $i++) {
      $modals = @(Get-ModalTestWindows ([int]$state.hwnd) ([int]$state.pid))
      if ($modals.Count -eq 0) { break }
      foreach ($d in $modals) {
        if (-not (Close-WindowUia ([int]$d.hwnd))) {
          [void][S4W32]::PostMessage([IntPtr]$d.hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
        }
      }
      Start-Sleep -Milliseconds 500
    }
  }
  $w = Close-TestAppWindow -StateFile $stateFile
  $closedOk = [bool]$w.closed
  if (-not $closedOk -and $state -and $state.owned -and $state.pid -and $state.processStart) {
    if (Test-ProcessIdentity ([int]$state.pid) ([string]$state.processStart)) {
      $proc = Get-Process -Id ([int]$state.pid) -ErrorAction SilentlyContinue
      if ($proc -and $proc.ProcessName -eq 'powershell') {
        try {
          Stop-Process -Id ([int]$state.pid) -Force -ErrorAction Stop
          $checks += (Add-Check 'test dialog process stopped after close refused' $true ("pid=$($state.pid)"))
          $closedOk = $true
        } catch {
          $checks += (Add-Check 'test dialog process stop failed' $false $_.Exception.Message)
        }
      }
    }
  }
  if (-not $closedOk) {
    $checks += (Add-Check 'dialog app window left open' $false ("reason=$($w.reason) title=$($w.title)"))
    [void](Save-LeftoverState -TaskId $TaskId -StateFile $stateFile -Result ([ordered]@{ reason = $w.reason; leftover = $w.title }))
    $dirty = $true
  }
  $sentFile = Join-Path $base 'sentinel.json'
  if (Test-Path $sentFile) {
    $sent = Close-TestSentinel -StateFile $sentFile
    if (-not $sent.closed) {
      $checks += (Add-Check 'sentinel left open' $false $sent.reason)
      $dirty = $true
    }
  }
  $orphan = Close-OrphanTestNotepads -ExtraAllowedTabs @('target.txt', 'NAV-OK') -ExtraSeeds @('target.txt')
  $left = @($orphan.leftover)
  $checks += (Add-Check 'orphan test notepad cleaned' ($left.Count -eq 0) ("closed=$($orphan.closed) leftover=$($left -join ' | ')"))
  if ($left.Count -gt 0) { $dirty = $true }
  Remove-TaskDir
  Out-Finish -Ok $true -Checks $checks -Kind 'cleanup' -Dirty $dirty
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'cleanup'
}
