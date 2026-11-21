# excel-geometry.ps1 - Excel COM helpers for probe-modifier-drop --excel.
# ASCII-only: Windows PowerShell 5.1 parses BOM-less files as ANSI.
# COM is used only to create the temp workbook and read cell screen geometry;
# the drag/click itself is still performed by the plugin.

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class S4ExcelDpi {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("oleacc.dll")]
  public static extern int AccessibleObjectFromWindow(IntPtr hwnd, uint dwId, ref Guid riid,
    [MarshalAs(UnmanagedType.IUnknown)] out object ppvObject);
}
'@ -ErrorAction SilentlyContinue

try { [void][S4ExcelDpi]::SetProcessDPIAware() } catch { }

function Get-S4ExcelApp {
  param([int]$Hwnd = 0)
  $app = $null
  try { $app = [Runtime.InteropServices.Marshal]::GetActiveObject('Excel.Application') } catch { $app = $null }
  if ($app) { return $app }
  if ($Hwnd -le 0) { return $null }
  try {
    $iid = [Guid]'00020400-0000-0000-C000-000000000046'  # IID_IDispatch
    $obj = $null
    $hr = [S4ExcelDpi]::AccessibleObjectFromWindow([IntPtr]$Hwnd, 0xFFFFFFF0, [ref]$iid, [ref]$obj)
    if ($hr -eq 0 -and $obj) { return $obj }
  } catch { }
  return $null
}

function Get-S4ExcelSelection {
  param([int]$Hwnd = 0)
  $app = Get-S4ExcelApp -Hwnd $Hwnd
  $address = ''
  $ready = $false
  $cut = ''
  $pv = -1
  $comOk = [bool]$app
  if ($app) {
    try {
      $sel = $app.Selection
      try { $address = [string]$sel.Address() } catch {
        try { $address = [string]$sel.Address($false, $false) } catch { $address = '' }
      }
      try { $ready = [bool]$app.Ready } catch { }
      try { $cut = [string]$app.CutCopyMode } catch { }
      try { $pv = [int]$app.ProtectedViewWindows.Count } catch { }
    } catch { }
    finally { try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app) } catch { } }
  }
  # UIA fallback works even when Excel is not in the ROT / COM is unavailable:
  # the focused DataItem name is usually `"A" 2` after a cell click.
  $focusedName = ''
  $selected = $false
  $cellName = ''
  $cellSelected = $false
  $rects = [ordered]@{}
  try {
    Add-Type -AssemblyName UIAutomationClient
    $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$Hwnd)
    $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
    if ($focused) {
      try { $focusedName = [string]$focused.Current.Name } catch { }
      try {
        $pattern = $focused.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
        $selected = [bool]$pattern.Current.IsSelected
      } catch { }
    }
    if ($root) {
      $wanted = [ordered]@{ A2 = @('"A" 2', 'A2', 'A 2'); B2 = @('"B" 2', 'B2', 'B 2'); E2 = @('"E" 2', 'E2', 'E 2') }
      foreach ($key in $wanted.Keys) {
        foreach ($name in @($wanted[$key])) {
          $cond = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::NameProperty, $name)
          $cell = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
          if (-not $cell) { continue }
          try {
            $r = $cell.Current.BoundingRectangle
            $rects[$key] = [ordered]@{
              left = [double]$r.Left; top = [double]$r.Top
              width = [double]$r.Width; height = [double]$r.Height
              right = [double]$r.Right; bottom = [double]$r.Bottom
            }
          } catch { }
          if ($key -eq 'A2') {
            $cellName = $name
            try {
              $p2 = $cell.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
              $cellSelected = [bool]$p2.Current.IsSelected
            } catch { }
          }
          break
        }
      }
    }
  } catch { }
  return [ordered]@{
    ok = $true; com = $comOk; address = $address; focusedName = $focusedName; selected = $selected
    cellName = $cellName; cellSelected = $cellSelected; rects = $rects
    ready = $ready; cutCopyMode = $cut; protectedView = $pv
  }
}

function Get-S4CursorState {
  $p = New-Object S4ExcelDpi+POINT
  $ok = [S4ExcelDpi]::GetCursorPos([ref]$p)
  $ctrl = ([S4ExcelDpi]::GetAsyncKeyState(0x11) -band 0x8000) -ne 0
  return [ordered]@{ ok = [bool]$ok; x = [int]$p.X; y = [int]$p.Y; ctrl = [bool]$ctrl }
}

function Find-S4ExcelExe {
  $keys = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\excel.exe',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\excel.exe'
  )
  foreach ($k in $keys) {
    try {
      $v = (Get-ItemProperty -Path $k -ErrorAction Stop).'(default)'
      if ($v -and (Test-Path -LiteralPath $v)) {
        return [ordered]@{ ok = $true; exe = [string]$v }
      }
    } catch { }
  }
  $cmd = Get-Command 'EXCEL.EXE' -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source) {
    return [ordered]@{ ok = $true; exe = [string]$cmd.Source }
  }
  return [ordered]@{ ok = $false; exe = ''; reason = 'EXCEL.EXE not found in App Paths or PATH' }
}

function New-S4DragWorkbook {
  param([string]$Path, [string]$Payload)
  $app = $null
  $wb = $null
  try {
    if (Test-Path -LiteralPath $Path) { [void](Remove-Item -LiteralPath $Path -Force) }
    $app = New-Object -ComObject Excel.Application
    $app.Visible = $false
    $app.DisplayAlerts = $false
    $wb = $app.Workbooks.Add()
    $ws = $wb.Worksheets.Item(1)
    $ws.Range('A2').Value2 = $Payload
    [void]$ws.Range('E2').ClearContents()
    # 51 = xlOpenXMLWorkbook; SaveAs returns a value on some builds, suppress it
    # so the function emits exactly one object for the JSON runner.
    [void]$wb.SaveAs($Path, 51)
    [void]$wb.Close($false)
    $wb = $null
    [void]$app.Quit()
    return [ordered]@{ ok = $true; path = $Path }
  } catch {
    return [ordered]@{ ok = $false; reason = $_.Exception.Message }
  } finally {
    if ($wb) { try { [void]$wb.Close($false) } catch { } }
    if ($app) {
      try { [void]$app.Quit() } catch { }
      try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app) } catch { }
    }
  }
}

function Get-S4ExcelCellPoints {
  param([string]$Path, [int]$Hwnd, [string[]]$Cells = @('A2', 'E2'))
  $app = Get-S4ExcelApp -Hwnd $Hwnd
  if (-not $app) {
    return [ordered]@{ ok = $false; reason = 'Excel COM unavailable (GetActiveObject + AccessibleObjectFromWindow failed)' }
  }
  try {
    $full = [IO.Path]::GetFullPath($Path)
    $wb = $null
    foreach ($b in @($app.Workbooks)) {
      $bf = ''
      try { $bf = [IO.Path]::GetFullPath([string]$b.FullName) } catch { }
      if ($bf -and ($bf -ieq $full)) { $wb = $b; break }
    }
    if (-not $wb) {
      return [ordered]@{ ok = $false; reason = 'test workbook not found in the active Excel instance (user Excel was not touched)' }
    }
    [void]$wb.Activate()
    Start-Sleep -Milliseconds 300
    $win = $app.ActiveWindow
    $ws = $wb.Worksheets.Item(1)
    $rect = $null
    $rectOk = $false
    try {
      $rect = New-Object 'S4W32+RECT'
      $rectOk = [S4W32]::GetWindowRect([IntPtr]$Hwnd, [ref]$rect)
    } catch { $rectOk = $false }
    $points = [ordered]@{}
    foreach ($c in @($Cells)) {
      $r = $ws.Range($c)
      $px = [double]$win.PointsToScreenPixelsX([double]$r.Left + ([double]$r.Width / 2.0))
      $py = [double]$win.PointsToScreenPixelsY([double]$r.Top + ([double]$r.Height / 2.0))
      $bx = [double]$win.PointsToScreenPixelsX([double]$r.Left + [double]$r.Width)
      $by = [double]$win.PointsToScreenPixelsY([double]$r.Top + [double]$r.Height)
      # Some Office builds return client-relative pixels. If the value is outside
      # the screen window rect but inside its size, add the window origin.
      if ($rectOk) {
        $w = [int]$rect.R - [int]$rect.L
        $h = [int]$rect.B - [int]$rect.T
        if ($px -ge 0 -and $px -le $w -and ($px -lt $rect.L -or $px -gt $rect.R)) { $px = $px + $rect.L }
        if ($py -ge 0 -and $py -le $h -and ($py -lt $rect.T -or $py -gt $rect.B)) { $py = $py + $rect.T }
        if ($bx -ge 0 -and $bx -le $w -and ($bx -lt $rect.L -or $bx -gt $rect.R)) { $bx = $bx + $rect.L }
        if ($by -ge 0 -and $by -le $h -and ($by -lt $rect.T -or $by -gt $rect.B)) { $by = $by + $rect.T }
      }
      $points[$c] = [ordered]@{
        x = [int][Math]::Round($px)
        y = [int][Math]::Round($py)
        borderX = [int][Math]::Round($bx)
        borderY = [int][Math]::Round($by)
        left = [double]$r.Left
        top = [double]$r.Top
        width = [double]$r.Width
        height = [double]$r.Height
      }
    }
    $window = $null
    if ($rectOk) {
      $window = [ordered]@{ left = [int]$rect.L; top = [int]$rect.T; right = [int]$rect.R; bottom = [int]$rect.B }
    }
    return [ordered]@{
      ok = $true
      activeWorkbook = [string]$wb.FullName
      points = $points
      window = $window
    }
  } catch {
    return [ordered]@{ ok = $false; reason = $_.Exception.Message }
  } finally {
    if ($app) { try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app) } catch { } }
  }
}

function Get-S4XlsxCells {
  param([string]$Path)
  try {
    $m = Read-XlsxManifest $Path
    return [ordered]@{ ok = $true; cells = $m.cells }
  } catch {
    return [ordered]@{ ok = $false; reason = $_.Exception.Message }
  }
}
