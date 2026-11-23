# UIA pattern probe (read-only).
# ASCII-only on purpose: Windows PowerShell 5.1 parses BOM-less files as ANSI.
# Usage:
#   powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File uia-pattern-probe.ps1 -Hwnd <hwnd> [-Pid <pid>] [-Max 200]
# Output: one JSON line on stdout. No input injection, no screenshot, no file writes.
param(
  [Parameter(Mandatory = $true)][long]$Hwnd,
  [int]$TargetPid = 0,
  [int]$Max = 200,
  [switch]$HasPoint,
  [int]$ScreenX = 0,
  [int]$ScreenY = 0
)
$ErrorActionPreference = 'Stop'
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  Add-Type -AssemblyName UIAutomationClient

  $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$Hwnd)
  if (-not $root) { throw "no automation element for hwnd $Hwnd" }

  function SafeInt([double]$v) {
    if ([double]::IsNaN($v) -or [double]::IsInfinity($v)) { return 0 }
    if ($v -gt [int]::MaxValue) { return [int]::MaxValue }
    if ($v -lt [int]::MinValue) { return [int]::MinValue }
    return [int]$v
  }

  $patterns = [ordered]@{
    Scroll = [System.Windows.Automation.ScrollPattern]::Pattern
    Text = [System.Windows.Automation.TextPattern]::Pattern
    Invoke = [System.Windows.Automation.InvokePattern]::Pattern
    ExpandCollapse = [System.Windows.Automation.ExpandCollapsePattern]::Pattern
    SelectionItem = [System.Windows.Automation.SelectionItemPattern]::Pattern
    Toggle = [System.Windows.Automation.TogglePattern]::Pattern
    Value = [System.Windows.Automation.ValuePattern]::Pattern
  }
  $counts = [ordered]@{}
  foreach ($k in $patterns.Keys) { $counts[$k] = 0 }

  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition)

  $samples = @()
  $visited = 0
  foreach ($el in $all) {
    if ($visited -ge $Max) { break }
    $visited++
    $names = @()
    $scrollObj = $null
    foreach ($k in $patterns.Keys) {
      $obj = $null
      try {
        if ($el.TryGetCurrentPattern($patterns[$k], [ref]$obj)) {
          $names += $k
          $counts[$k] = [int]$counts[$k] + 1
          if ($k -eq 'Scroll') { $scrollObj = $obj }
        }
      } catch { }
    }
    if ($names.Count -eq 0) { continue }
    $r = $el.Current.BoundingRectangle
    $scrollInfo = $null
    if ($scrollObj) {
      $scrollInfo = [ordered]@{
        verticallyScrollable = [bool]$scrollObj.Current.VerticallyScrollable
        horizontallyScrollable = [bool]$scrollObj.Current.HorizontallyScrollable
        verticalScrollPercent = [double]$scrollObj.Current.VerticalScrollPercent
        horizontalScrollPercent = [double]$scrollObj.Current.HorizontalScrollPercent
        verticalViewSize = [double]$scrollObj.Current.VerticalViewSize
        horizontalViewSize = [double]$scrollObj.Current.HorizontalViewSize
      }
    }
    $containsPoint = $false
    if ($HasPoint) {
      $containsPoint = ($ScreenX -ge $r.X) -and ($ScreenX -lt ($r.X + $r.Width)) -and ($ScreenY -ge $r.Y) -and ($ScreenY -lt ($r.Y + $r.Height))
    }
    $samples += ,([ordered]@{
      role = [string]$el.Current.ControlType.ProgrammaticName
      name = ([string]$el.Current.Name) -replace '\s+', ' '
      automationId = [string]$el.Current.AutomationId
      className = [string]$el.Current.ClassName
      patterns = $names
      offscreen = [bool]$el.Current.IsOffscreen
      bounds = [ordered]@{ x = (SafeInt $r.X); y = (SafeInt $r.Y); width = (SafeInt $r.Width); height = (SafeInt $r.Height) }
      scroll = $scrollInfo
      containsPoint = $containsPoint
    })
  }

  $wr = $root.Current.BoundingRectangle
  $payload = [ordered]@{
    pid = $TargetPid
    hwnd = $Hwnd
    window = [ordered]@{
      role = [string]$root.Current.ControlType.ProgrammaticName
      name = ([string]$root.Current.Name) -replace '\s+', ' '
      bounds = [ordered]@{ x = (SafeInt $wr.X); y = (SafeInt $wr.Y); width = (SafeInt $wr.Width); height = (SafeInt $wr.Height) }
    }
    total = $visited
    patternCounts = $counts
    point = if ($HasPoint) { [ordered]@{ x = $ScreenX; y = $ScreenY } } else { $null }
    samples = $samples
  }
  [Console]::Out.WriteLine((ConvertTo-Json $payload -Compress -Depth 8))
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
