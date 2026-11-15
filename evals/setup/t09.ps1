param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $dir = New-TaskDir 'out'
  $f = Join-Path $dir 'paint.png'
  if (Test-Path $f) { Remove-Item $f -Force }
  # State-scoped Paint: fail closed if a user Paint is already open; never kill by name.
  $stateFile = Join-Path (Get-TaskDir) 'test-paint.json'
  $s = Open-TestPaint -StateFile $stateFile
  $checks += (Add-Check 'paint opened' ([bool]$s.ok) ("hwnd=$($s.hwnd) title=$($s.title) reason=$($s.reason)"))
  $checks += (Add-Check 'no stale paint.png' (-not (Test-Path $f)) $f)
  Out-Finish -Ok ([bool]$s.ok -and (-not (Test-Path $f))) -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
