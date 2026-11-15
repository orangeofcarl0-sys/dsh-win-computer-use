param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
$dirty = $false
try {
  $stateFile = Join-Path (Get-TaskDir) 'test-calculator.json'
  if (Test-Path $stateFile) {
    $s = Read-TestState $stateFile
    if ($s -and $s.owned -and [int]$s.hwnd -ne 0) {
      $w = Find-WindowByHwnd ([int]$s.hwnd)
      if ($w -or (Test-WindowAlive ([int]$s.hwnd))) {
        if (-not (Close-WindowUia ([int]$s.hwnd))) {
          [void][S4W32]::PostMessage([IntPtr]$s.hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
        }
        Start-Sleep -Milliseconds 800
        if (Test-WindowAlive ([int]$s.hwnd)) {
          $checks += (Add-Check 'test calculator window left open' $false $(if ($w) { [string]$w.title } else { '(UIA title unavailable)' }))
          $dirty = $true
        }
      }
    }
  }
  Remove-TaskDir
  Out-Finish -Ok $true -Checks $checks -Kind 'cleanup' -Dirty $dirty
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'cleanup'
}
