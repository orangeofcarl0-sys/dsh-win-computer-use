param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  Add-Type -AssemblyName System.Windows.Forms
  $screens = @([System.Windows.Forms.Screen]::AllScreens)
  $checks += (Add-Check 'multiple monitors exposed' ($screens.Count -ge 2) ("count=$($screens.Count)"))
  if ($screens.Count -lt 2) {
    Out-Finish -Ok $false -Checks $checks -Kind 'setup' -EnvError 'secondary monitor unavailable'
  }
  $secondary = @($screens | Where-Object { -not $_.Primary })[0]
  $x = [int]$secondary.Bounds.X + 100
  $y = [int]$secondary.Bounds.Y + 100
  $base = Get-TaskDir
  $out = New-TaskDir 'out'
  $resultFile = Join-Path $out 'result.json'
  if (Test-Path $resultFile) { Remove-Item $resultFile -Force }
  $init = Initialize-SecurityTask -Mode 'click' -Title 'S4-DPI01-SECOND' -ResultFile $resultFile -StateFile (Join-Path $base 'fixture.json') -X $x -Y $y
  $checks += (Add-Check 'secondary monitor fixture' ([bool]$init.win.ok) ("hwnd=$($init.win.hwnd) title=$($init.win.title) reason=$($init.win.reason) at=$x,$y"))
  if (-not $init.ok) {
    Out-Finish -Ok $false -Checks $checks -Kind 'setup' -EnvError ("fixture unavailable: " + $init.reason)
  }
  Out-Finish -Ok $true -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
