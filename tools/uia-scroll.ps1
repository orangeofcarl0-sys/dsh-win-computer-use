# UIA point scroll for PTC (read/write accessibility action; no synthetic input).
# ASCII-only on purpose: Windows PowerShell 5.1 parses BOM-less files as ANSI.
# Usage:
#   powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File uia-scroll.ps1 `
#     -Hwnd <hwnd> -TargetPid <pid> -ScreenX <x> -ScreenY <y> -DeltaX <n> -DeltaY <n>
# Output: one JSON line on stdout. No screenshot, no file writes.
param(
  [Parameter(Mandatory = $true)][long]$Hwnd,
  [Parameter(Mandatory = $true)][int]$TargetPid,
  [Parameter(Mandatory = $true)][int]$ScreenX,
  [Parameter(Mandatory = $true)][int]$ScreenY,
  [int]$DeltaX = 0,
  [int]$DeltaY = 0
)
$ErrorActionPreference = 'Stop'
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName WindowsBase
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class DshScrollNative {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@

  try { [void][DshScrollNative]::SetProcessDpiAwarenessContext([IntPtr](-4)) } catch {
    try { [void][DshScrollNative]::SetProcessDPIAware() } catch { }
  }

  $script:sawScrollPattern = $false
  $script:sawSubtreePattern = $false
  $script:axisBlocked = 0
  $script:scanVisited = 0
  $script:scanTruncated = $false

  function SafeInt([double]$v) {
    if ([double]::IsNaN($v) -or [double]::IsInfinity($v)) { return 0 }
    if ($v -gt [int]::MaxValue) { return [int]::MaxValue }
    if ($v -lt [int]::MinValue) { return [int]::MinValue }
    return [int]$v
  }

  function RectJson($r) {
    if ($null -eq $r) { return $null }
    try {
      if ($r.IsEmpty) { return $null }
      return [ordered]@{
        x = (SafeInt $r.X); y = (SafeInt $r.Y)
        width = (SafeInt $r.Width); height = (SafeInt $r.Height)
      }
    } catch { return $null }
  }

  function RectContains($r, [int]$x, [int]$y) {
    if ($null -eq $r) { return $false }
    try {
      if ($r.IsEmpty) { return $false }
      return ($x -ge $r.X) -and ($x -lt ($r.X + $r.Width)) -and ($y -ge $r.Y) -and ($y -lt ($r.Y + $r.Height))
    } catch { return $false }
  }

  function ElInfo($el) {
    if (-not $el) { return $null }
    try {
      $r = $el.Current.BoundingRectangle
      return [ordered]@{
        role = [string]$el.Current.ControlType.ProgrammaticName
        name = (([string]$el.Current.Name) -replace '\s+', ' ')
        automationId = [string]$el.Current.AutomationId
        className = [string]$el.Current.ClassName
        processId = [int]$el.Current.ProcessId
        offscreen = [bool]$el.Current.IsOffscreen
        nativeWindowHandle = [long]$el.Current.NativeWindowHandle
        bounds = RectJson $r
      }
    } catch { return $null }
  }

  function Test-ScrollElement($el, [string]$source) {
    if (-not $el) { return $null }
    $obj = $null
    try {
      if (-not $el.TryGetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern, [ref]$obj)) { return $null }
    } catch { return $null }
    try {
      $sp = [System.Windows.Automation.ScrollPattern]$obj
      if ($source -eq 'subtree') { $script:sawSubtreePattern = $true } else { $script:sawScrollPattern = $true }
      $r = $el.Current.BoundingRectangle
      if (-not (RectContains $r $ScreenX $ScreenY)) { return $null }
      if ($DeltaY -ne 0 -and -not $sp.Current.VerticallyScrollable) { $script:axisBlocked++; return $null }
      if ($DeltaX -ne 0 -and -not $sp.Current.HorizontallyScrollable) { $script:axisBlocked++; return $null }
      $area = 0.0
      try { $area = [double]$r.Width * [double]$r.Height } catch { }
      return [pscustomobject]@{
        el = $el
        sp = $sp
        source = $source
        bounds = $r
        area = $area
        info = (ElInfo $el)
      }
    } catch { return $null }
  }

  function New-Failure([string]$code, [string]$message, $diag) {
    $payload = [ordered]@{
      ok = $false
      code = $code
      error = $message
      point = [ordered]@{ x = $ScreenX; y = $ScreenY }
      diagnostics = $diag
    }
    [Console]::Out.WriteLine((ConvertTo-Json $payload -Compress -Depth 10))
    exit 0
  }

  $target = [IntPtr]$Hwnd
  if (-not [DshScrollNative]::IsWindow($target)) {
    New-Failure 'window_not_found' 'window not found' $null
  }
  $actualPid = 0
  [void][DshScrollNative]::GetWindowThreadProcessId($target, [ref]$actualPid)
  if ([int]$actualPid -ne [int]$TargetPid) {
    New-Failure 'pid_mismatch' 'target hwnd belongs to another pid' $null
  }

  $p = New-Object DshScrollNative+POINT
  $p.X = $ScreenX
  $p.Y = $ScreenY
  $hit = [DshScrollNative]::WindowFromPoint($p)
  if ($hit -eq [IntPtr]::Zero) {
    New-Failure 'point_not_in_target' 'no window at point' $null
  }
  $targetRoot = [DshScrollNative]::GetAncestor($target, 2)
  if ($targetRoot -eq [IntPtr]::Zero) { $targetRoot = $target }
  $hitRoot = [DshScrollNative]::GetAncestor($hit, 2)
  if ($hitRoot -eq [IntPtr]::Zero) { $hitRoot = $hit }
  if ($hitRoot -ne $targetRoot) {
    New-Failure 'point_not_in_target' 'point belongs to another top-level window' ([ordered]@{
      targetRoot = $targetRoot.ToInt64(); hitRoot = $hitRoot.ToInt64()
    })
  }

  $wr = New-Object DshScrollNative+RECT
  $windowRect = $null
  try {
    if ([DshScrollNative]::GetWindowRect($target, [ref]$wr)) {
      $windowRect = [ordered]@{ x = $wr.Left; y = $wr.Top; width = ($wr.Right - $wr.Left); height = ($wr.Bottom - $wr.Top) }
    }
  } catch { }

  $rootEl = $null
  try { $rootEl = [System.Windows.Automation.AutomationElement]::FromHandle($target) } catch { }
  if (-not $rootEl) {
    New-Failure 'no_element' 'no automation element for target hwnd' ([ordered]@{ windowRect = $windowRect })
  }
  $rootProcess = 0
  try { $rootProcess = [int]$rootEl.Current.ProcessId } catch { }
  if ($rootProcess -ne 0 -and $rootProcess -ne $TargetPid) {
    New-Failure 'pid_mismatch' 'UIA root process does not match target pid' ([ordered]@{
      rootProcess = $rootProcess; windowRect = $windowRect
    })
  }

  $point = New-Object System.Windows.Point([double]$ScreenX, [double]$ScreenY)
  $fromPoint = $null
  try { $fromPoint = [System.Windows.Automation.AutomationElement]::FromPoint($point) } catch { }
  $fromPointInfo = ElInfo $fromPoint

  $ancestors = New-Object System.Collections.ArrayList
  $candidates = New-Object System.Collections.ArrayList
  $seen = @{}

  if ($fromPoint) {
    foreach ($walker in @([System.Windows.Automation.TreeWalker]::ControlViewWalker, [System.Windows.Automation.TreeWalker]::RawViewWalker)) {
      $cur = $fromPoint
      for ($i = 0; $i -lt 24 -and $cur; $i++) {
        $rid = "i$i"
        try { $rid = (($cur.GetRuntimeId() -join ',')) } catch { }
        if (-not $seen.ContainsKey($rid)) {
          $seen[$rid] = $true
          $info = ElInfo $cur
          if ($info) { [void]$ancestors.Add($info) }
          $c = Test-ScrollElement $cur 'ancestor'
          if ($c) {
            [void]$candidates.Add($c)
          }
        }
        try { $cur = $walker.GetParent($cur) } catch { $cur = $null }
      }
    }
  }

  if ($rootEl) {
    $scanLimit = 5000
    $deadline = [DateTime]::UtcNow.AddSeconds(5)
    try {
      $all = $rootEl.FindAll([System.Windows.Automation.TreeScope]::Subtree, [System.Windows.Automation.Condition]::TrueCondition)
    } catch { $all = $null }
    if ($all) {
      foreach ($el in $all) {
        if ($script:scanVisited -ge $scanLimit -or [DateTime]::UtcNow -gt $deadline) {
          $script:scanTruncated = $true
          break
        }
        $script:scanVisited++
        try {
          $obj = $null
          if ($el.TryGetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern, [ref]$obj)) {
            $script:sawSubtreePattern = $true
            $c = Test-ScrollElement $el 'subtree'
            if ($c) { [void]$candidates.Add($c) }
          }
        } catch { }
      }
    }
  }

  $ordered = @($candidates.ToArray() | Sort-Object area)
  $chosen = $null
  if ($ordered.Count -gt 0) { $chosen = $ordered[0] }

  $candidateInfo = @()
  foreach ($c in ($ordered | Select-Object -First 8)) {
    $info = $c.info
    $role = ''
    $name = ''
    $automationId = ''
    $className = ''
    if ($info) {
      $role = $info.role
      $name = $info.name
      $automationId = $info.automationId
      $className = $info.className
    }
    $candidateInfo += ,([ordered]@{
      role = $role
      name = $name
      automationId = $automationId
      className = $className
      source = $c.source
      bounds = RectJson $c.bounds
      area = [Math]::Round($c.area)
    })
  }

  $rootBounds = $null
  if ($rootEl) {
    try { $rootBounds = RectJson $rootEl.Current.BoundingRectangle } catch { $rootBounds = $null }
  }
  $diag = [ordered]@{
    point = [ordered]@{ x = $ScreenX; y = $ScreenY }
    windowRect = $windowRect
    rootBounds = $rootBounds
    fromPoint = $fromPointInfo
    ancestors = @($ancestors | Select-Object -First 12)
    candidates = $candidateInfo
    scan = [ordered]@{
      visited = $script:scanVisited
      truncated = $script:scanTruncated
      sawScrollPattern = $script:sawScrollPattern
      sawSubtreePattern = $script:sawSubtreePattern
      axisBlocked = $script:axisBlocked
    }
  }

  if (-not $chosen) {
    if ($script:axisBlocked -gt 0) {
      New-Failure 'not_scrollable' 'the scroll candidate is not scrollable on the requested axis' $diag
    }
    if ($script:sawSubtreePattern) {
      New-Failure 'no_scroll_pattern_in_subtree' 'no scroll pattern candidate contains the point and supports the requested axis' $diag
    }
    if ($script:sawScrollPattern) {
      New-Failure 'no_scroll_pattern' 'no scroll pattern at the point/ancestors' $diag
    }
    if (-not $fromPoint) {
      New-Failure 'no_element' 'no automation element at point' $diag
    }
    New-Failure 'no_scroll_pattern' 'no UIA ScrollPattern at point or in window subtree' $diag
  }

  $sp = $null
  try {
    $obj = $null
    if (-not $chosen.el.TryGetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern, [ref]$obj)) {
      New-Failure 'no_scroll_pattern' 'ScrollPattern disappeared before scrolling' $diag
    }
    $sp = [System.Windows.Automation.ScrollPattern]$obj
  } catch {
    New-Failure 'no_scroll_pattern' 'failed to acquire ScrollPattern before scrolling' $diag
  }

  $vBefore = -1.0
  $hBefore = -1.0
  $vViewBefore = -1.0
  $hViewBefore = -1.0
  try {
    $vBefore = [double]$sp.Current.VerticalScrollPercent
    $hBefore = [double]$sp.Current.HorizontalScrollPercent
    $vViewBefore = [double]$sp.Current.VerticalViewSize
    $hViewBefore = [double]$sp.Current.HorizontalViewSize
  } catch { }

  $hAmount = [System.Windows.Automation.ScrollAmount]::NoAmount
  $vAmount = [System.Windows.Automation.ScrollAmount]::NoAmount
  if ($DeltaX -gt 0) { $hAmount = [System.Windows.Automation.ScrollAmount]::SmallDecrement }
  elseif ($DeltaX -lt 0) { $hAmount = [System.Windows.Automation.ScrollAmount]::SmallIncrement }
  if ($DeltaY -gt 0) { $vAmount = [System.Windows.Automation.ScrollAmount]::SmallDecrement }
  elseif ($DeltaY -lt 0) { $vAmount = [System.Windows.Automation.ScrollAmount]::SmallIncrement }

  $attempted = 0
  try {
    for ($i = 0; $i -lt [Math]::Abs($DeltaX); $i++) {
      $sp.Scroll($hAmount, [System.Windows.Automation.ScrollAmount]::NoAmount)
      $attempted++
    }
    for ($i = 0; $i -lt [Math]::Abs($DeltaY); $i++) {
      $sp.Scroll([System.Windows.Automation.ScrollAmount]::NoAmount, $vAmount)
      $attempted++
    }
  } catch {
    $msg = $_.Exception.Message -replace '"', "'"
    $code = if ($attempted -gt 0) { 'scroll_partial' } else { 'scroll_failed' }
    $payload = [ordered]@{
      ok = $false
      code = $code
      error = $msg
      moved = $null
      attempted = $attempted
      point = [ordered]@{ x = $ScreenX; y = $ScreenY }
      diagnostics = $diag
    }
    [Console]::Out.WriteLine((ConvertTo-Json $payload -Compress -Depth 10))
    exit 0
  }

  $vAfter = $vBefore
  $hAfter = $hBefore
  for ($i = 0; $i -lt 12; $i++) {
    Start-Sleep -Milliseconds 50
    try {
      $vAfter = [double]$sp.Current.VerticalScrollPercent
      $hAfter = [double]$sp.Current.HorizontalScrollPercent
    } catch { }
    $vChanged = ($DeltaY -eq 0) -or ($vBefore -ge 0 -and $vAfter -ge 0 -and [Math]::Abs($vAfter - $vBefore) -gt 0.01)
    $hChanged = ($DeltaX -eq 0) -or ($hBefore -ge 0 -and $hAfter -ge 0 -and [Math]::Abs($hAfter - $hBefore) -gt 0.01)
    if ($vChanged -and $hChanged) { break }
  }

  $vSupported = ($vBefore -ge 0) -and ($vAfter -ge 0)
  $hSupported = ($hBefore -ge 0) -and ($hAfter -ge 0)
  $vMoved = $null
  $hMoved = $null
  if ($DeltaY -ne 0 -and $vSupported) {
    $vMoved = [Math]::Abs($vAfter - $vBefore) -gt 0.01
  }
  if ($DeltaX -ne 0 -and $hSupported) {
    $hMoved = [Math]::Abs($hAfter - $hBefore) -gt 0.01
  }
  $requested = @()
  if ($DeltaY -ne 0) { $requested += $vMoved }
  if ($DeltaX -ne 0) { $requested += $hMoved }
  $moved = $null
  $partialAxes = $false
  if ($requested.Count -gt 0 -and -not ($requested -contains $null)) {
    $trueCount = @($requested | Where-Object { $_ -eq $true }).Count
    if ($trueCount -eq $requested.Count) {
      $moved = $true
    } elseif ($trueCount -eq 0) {
      $moved = $false
    } else {
      $moved = $false
      $partialAxes = $true
    }
  }

  $info = $chosen.info
  $role = ''
  $name = ''
  $automationId = ''
  $className = ''
  if ($info) {
    $role = $info.role
    $name = $info.name
    $automationId = $info.automationId
    $className = $info.className
  }
  $hScrollable = $false
  $vScrollable = $false
  try {
    $hScrollable = [bool]$sp.Current.HorizontallyScrollable
    $vScrollable = [bool]$sp.Current.VerticallyScrollable
  } catch { }
  $base = [ordered]@{
    ok = $true
    moved = $moved
    role = $role
    name = $name
    automationId = $automationId
    className = $className
    source = $chosen.source
    horizontalScrollable = $hScrollable
    verticalScrollable = $vScrollable
    deltaX = $DeltaX
    deltaY = $DeltaY
    attempted = $attempted
    scrolled = $attempted
    axisMoved = [ordered]@{ h = $hMoved; v = $vMoved }
    percentBefore = [ordered]@{ h = $hBefore; v = $vBefore }
    percentAfter = [ordered]@{ h = $hAfter; v = $vAfter }
    viewSizeBefore = [ordered]@{ h = $hViewBefore; v = $vViewBefore }
    point = [ordered]@{ x = $ScreenX; y = $ScreenY }
    diagnostics = $diag
  }

  if ($partialAxes) {
    $base.ok = $false
    $base.code = 'scroll_partial'
    $base.error = 'one requested axis moved but another did not'
  } elseif ($moved -eq $false) {
    $base.ok = $false
    $base.code = 'scroll_no_effect'
    $base.error = 'scroll pattern accepted the request but the scroll percentage did not change'
  } elseif ($moved -eq $null) {
    $base.code = 'scroll_unverified'
    $base.error = 'scroll percentage is not supported; actual movement is unverified'
  } else {
    $base.code = 'ok'
  }
  [Console]::Out.WriteLine((ConvertTo-Json $base -Compress -Depth 10))
  exit 0
} catch {
  $msg = $_.Exception.Message -replace '"', "'"
  "{`"ok`":false,`"code`":`"scroll_failed`",`"error`":`"$msg`"}"
  exit 0
}
