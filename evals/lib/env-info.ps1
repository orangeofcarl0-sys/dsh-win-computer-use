param()
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
try {
  $screens = @([System.Windows.Forms.Screen]::AllScreens)
  $list = @()
  foreach ($s in $screens) {
    $list += [ordered]@{
      device = [string]$s.DeviceName
      primary = [bool]$s.Primary
      x = [int]$s.Bounds.X
      y = [int]$s.Bounds.Y
      width = [int]$s.Bounds.Width
      height = [int]$s.Bounds.Height
      workingX = [int]$s.WorkingArea.X
      workingY = [int]$s.WorkingArea.Y
      workingWidth = [int]$s.WorkingArea.Width
      workingHeight = [int]$s.WorkingArea.Height
    }
  }
  $dpiX = 96
  $dpiY = 96
  try {
    $g = [System.Drawing.Graphics]::FromHwnd([IntPtr]::Zero)
    $dpiX = [int][math]::Round($g.DpiX)
    $dpiY = [int][math]::Round($g.DpiY)
    $g.Dispose()
  } catch {}
  $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
  [ordered]@{
    ok = $true
    monitorCount = $list.Count
    screens = $list
    dpiX = $dpiX
    dpiY = $dpiY
    virtualScreen = [ordered]@{ x = [int]$vs.X; y = [int]$vs.Y; width = [int]$vs.Width; height = [int]$vs.Height }
  } | ConvertTo-Json -Compress -Depth 6
} catch {
  [ordered]@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
  exit 1
}
