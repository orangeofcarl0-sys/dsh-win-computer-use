# S4 eval shared prelude. Dot-source at top of every setup/oracle/cleanup/simulate script:
#   . (Join-Path $PSScriptRoot '..\lib\common.ps1')
# Each script declares: param([string]$TaskId = '')
# ASCII-only: PowerShell 5.1 parses BOM-less scripts as ANSI (no CJK comments here).
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

if (-not $TaskId -or $TaskId -eq '') {
  # dot-sourced: $MyInvocation.ScriptName is the CALLER script path; derive <id> from <id>.ps1
  $caller = ''
  try { $caller = $MyInvocation.ScriptName } catch {}
  if ($caller) { $TaskId = [IO.Path]::GetFileNameWithoutExtension((Split-Path -Leaf $caller)) }
}
if (-not $TaskId -or $TaskId -eq '') { $TaskId = ($env:S4_TASK + '') }
$Script:S4TaskId = $TaskId

function Get-TaskDir {
  if (-not $Script:S4TaskId) { throw 'S4: no task id (pass as arg 0 or set S4_TASK)' }
  return (Join-Path $env:USERPROFILE (Join-Path '.dsh\s4-evals' $Script:S4TaskId))
}

function Add-Check {
  # returns an ordered check entry: Add-Check 'name' $true 'detail'
  param([string]$Name, [bool]$Ok, [string]$Detail = '')
  [ordered]@{ name = $Name; ok = $Ok; detail = $Detail }
}

function Out-Finish {
  # oracle semantics: exit 0 pass / 1 fail / 2 env error. setup/cleanup/simulate: 0 ok / 2 env error.
  # dirty=true means cleanup completed but left an unsafe window/tab that it refuses to close.
  param([bool]$Ok, [object[]]$Checks = @(), [string]$EnvError = '', [string]$Kind = 'oracle', [bool]$Dirty = $false)
  $payload = [ordered]@{ task = $Script:S4TaskId; kind = $Kind; ok = $Ok; dirty = $Dirty; envError = $EnvError; checks = $Checks }
  [Console]::Out.WriteLine((ConvertTo-Json $payload -Compress -Depth 6))
  try { [Console]::Out.Flush() } catch {}
  if ($EnvError -ne '') { exit 2 }
  if ($Ok) { exit 0 } else { exit 1 }
}

function New-TaskDir([string]$Sub = '') {
  $dir = Get-TaskDir
  if ($Sub) { $dir = Join-Path $dir $Sub }
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  return $dir
}

function Remove-TaskDir {
  $dir = Get-TaskDir
  if (Test-Path $dir) { Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue }
}

function New-Png {
  # solid-color PNG via System.Drawing (deterministic pixels)
  param([string]$Path, [int]$W, [int]$H, [int]$R, [int]$G, [int]$B)
  Add-Type -AssemblyName System.Drawing
  $bmp = New-Object System.Drawing.Bitmap $W, $H
  $gfx = [System.Drawing.Graphics]::FromImage($bmp)
  $gfx.Clear([System.Drawing.Color]::FromArgb(255, $R, $G, $B))
  $gfx.Dispose()
  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

function New-Docx {
  # minimal valid .docx (zip with forward-slash entries), no Office dependency
  param([string]$Path, [string]$Text)
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  if (Test-Path $Path) { Remove-Item $Path -Force }
  $fs = [System.IO.File]::Create($Path)
  $zip = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
  $ct = $zip.CreateEntry('[Content_Types].xml')
  Write-ZipEntry $ct '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  $rels = $zip.CreateEntry('_rels/.rels')
  Write-ZipEntry $rels '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
  $doc = $zip.CreateEntry('word/document.xml')
  Write-ZipEntry $doc ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>' + $Text + '</w:t></w:r></w:p></w:body></w:document>')
  $zip.Dispose(); $fs.Dispose()
}

function Write-ZipEntry {
  param($Entry, [string]$Content)
  $s = $Entry.Open()
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Content)
  $s.Write($bytes, 0, $bytes.Length)
  $s.Dispose()
}

# ---- Win32 window helpers (each script runs in its own powershell process,
# so a fixed type name is safe to Add-Type unconditionally) ----
if (-not ('S4W32' -as [type])) {
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class S4W32 {
  public delegate bool EnumProc(IntPtr h, IntPtr lp);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lp);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct WPL { public uint length, flags, showCmd; public POINT min; public POINT max; public RECT normal; }
  [DllImport("user32.dll")] public static extern bool GetWindowPlacement(IntPtr h, ref WPL p);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
"@
}

function Find-WindowsByTitle([string]$Needle, [switch]$VisibleOnly) {
  # UIA root-children window enumeration. Emits PSCustomObject per hit:
  # no output when none -> caller uses @(Find-WindowsByTitle ...) (empty array).
  # (Never return nested arrays from a PS function: pipeline unwrap makes the
  # shape unstable - empty case used to yield count=1 with an empty element.)
  Add-Type -AssemblyName UIAutomationClient
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Window)
  $wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
  foreach ($w in $wins) {
    $name = ''
    $h = 0
    try { $name = [string]$w.Current.Name } catch {}
    try { $h = [int]$w.Current.NativeWindowHandle } catch {}
    if ($VisibleOnly -and $h -ne 0) {
      try { if (-not [S4W32]::IsWindowVisible([IntPtr]$h)) { continue } } catch {}
    }
    if ($name -and $h -ne 0 -and $name.IndexOf($Needle, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
      [PSCustomObject]@{ hwnd = $h; title = $name }
    }
  }
}

function Find-WindowByHwnd([long]$Hwnd) {
  # HWND-only identity lookup: independent of the (localized/changing) window title.
  Add-Type -AssemblyName UIAutomationClient
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Window)
  $wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
  foreach ($w in $wins) {
    $h = 0
    try { $h = [int]$w.Current.NativeWindowHandle } catch {}
    if ($h -eq [int]$Hwnd) {
      $name = ''
      try { $name = [string]$w.Current.Name } catch {}
      return [PSCustomObject]@{ hwnd = $h; title = $name }
    }
  }
  return $null
}

function ConvertFrom-NotepadTabName([string]$Name) {
  # TabItem.Name is "<label>. <unmodified>" / "<label>. <modified>" on this locale.
  # Unknown suffixes are deliberately kept as unknown -> caller fails closed.
  $unmod = -join @([char]0x672A, [char]0x4FEE, [char]0x6539)
  $mod = -join @([char]0x5DF2, [char]0x4FEE, [char]0x6539)
  $dot = [char]0x3002
  $m = [regex]::Match([string]$Name, "^(.*?)\s*\.\s*($unmod|$mod)$dot\s*$")
  if ($m.Success) {
    return [ordered]@{
      raw = [string]$Name
      label = $m.Groups[1].Value.Trim()
      modified = ($m.Groups[2].Value -eq $mod)
      known = $true
    }
  }
  return [ordered]@{ raw = [string]$Name; label = ([string]$Name).Trim(); modified = $null; known = $false }
}

function Get-NotepadTabs([int]$Hwnd) {
  # Enumerate tabs of ONE window. Empty/unknown is unsafe by contract; never use
  # a global ".txt" scan, because another window's tabs can satisfy the check.
  Add-Type -AssemblyName UIAutomationClient
  $out = @()
  try {
    $win = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$Hwnd)
    if (-not $win) { return @() }
    $cond = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::TabItem)
    $items = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
    foreach ($it in $items) {
      $n = ''
      try { $n = [string]$it.Current.Name } catch {}
      if ($n) { $out += (ConvertFrom-NotepadTabName $n) }
    }
  } catch {}
  return @($out)
}

function Test-NotepadTabLabels([string[]]$TabNames, [string[]]$ExpectedTabs) {
  # Pure classifier: no UIA/window access, so it can be unit-tested with samples.
  $tabs = @($TabNames | ForEach-Object { ConvertFrom-NotepadTabName $_ })
  $expected = @($ExpectedTabs | ForEach-Object { ([string]$_).Trim().ToLowerInvariant() } | Sort-Object)
  $labels = @($tabs | ForEach-Object { ([string]$_.label).Trim().ToLowerInvariant() } | Sort-Object)
  $reason = ''
  if ($tabs.Count -eq 0) { $reason = 'no tabs exposed' }
  elseif ($tabs.Count -ne $expected.Count) { $reason = "tab count $($tabs.Count) != expected $($expected.Count)" }
  elseif (@($tabs | Where-Object { -not $_.known }).Count -gt 0) { $reason = 'unknown tab state suffix' }
  elseif (@($tabs | Where-Object { $_.modified -eq $true }).Count -gt 0) { $reason = 'modified tab present' }
  elseif (($labels -join "`n") -ne ($expected -join "`n")) { $reason = 'tab labels do not match expected set' }
  return [ordered]@{
    ok = ($reason -eq '')
    reason = $reason
    tabs = @($tabs)
    labels = @($tabs | ForEach-Object { $_.label })
  }
}

function Test-NotepadTabSet([int]$Hwnd, [string[]]$ExpectedTabs) {
  # Success requires exact count, exact labels, all known suffixes, and no modified tab.
  $names = @(Get-NotepadTabs $Hwnd | ForEach-Object { $_.raw })
  return (Test-NotepadTabLabels -TabNames $names -ExpectedTabs $ExpectedTabs)
}

function Save-LeftoverState([string]$TaskId, [string]$StateFile, $Result) {
  # Preserve an unsafe window's identity outside the task dir, because cleanup
  # deletes the task sandbox/state after this call.
  $dir = Join-Path $env:USERPROFILE '.dsh\s4-evals\_leftovers'
  try { if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null } } catch { return '' }
  $obj = [ordered]@{
    task = $TaskId
    at = (Get-Date).ToString('o')
    stateFile = $StateFile
    reason = [string]$Result.reason
    leftover = [string]$Result.leftover
    tabs = @($Result.tabs)
  }
  $p = Join-Path $dir ($TaskId + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')
  try {
    [IO.File]::WriteAllText($p, ($obj | ConvertTo-Json -Compress -Depth 5), (New-Object System.Text.UTF8Encoding($false)))
    return $p
  } catch { return '' }
}

function Open-TestNotepad {
  # Open a uniquely named test document WITHOUT touching existing Notepad windows.
  # A new HWND is NOT enough: Win11 Notepad restores the previous session's tabs
  # into the new window. Require the exact expected tab set, all unmodified and
  # all with a known state suffix; otherwise fail closed and record why.
  param([string]$Path, [string]$TitleNeedle, [string]$StateFile, [string[]]$ExpectedTabs = @())
  $before = @(Find-WindowsByTitle 'Notepad' | ForEach-Object { [int]$_.hwnd })
  Start-Process -FilePath 'notepad.exe' -ArgumentList @($Path) | Out-Null
  $deadline = (Get-Date).AddSeconds(15)
  $hit = $null
  while ((Get-Date) -lt $deadline) {
    $hit = @(Find-WindowsByTitle $TitleNeedle -VisibleOnly) | Select-Object -First 1
    if ($hit) { break }
    Start-Sleep -Milliseconds 400
  }
  if (-not $hit) {
    return [ordered]@{ ok = $false; hwnd = 0; title = ''; owned = $false; safeToClose = $false; reason = "window not found for $TitleNeedle" }
  }
  $hwnd = [int]$hit.hwnd
  $owned = -not ($before -contains $hwnd)

  # Give the restore/add-tab path a moment to settle, then require the exact set.
  $tabCheck = $null
  for ($i = 0; $i -lt 3; $i++) {
    $tabCheck = Test-NotepadTabSet -Hwnd $hwnd -ExpectedTabs $ExpectedTabs
    if ($tabCheck.ok) { break }
    Start-Sleep -Milliseconds 300
  }
  $wpid = 0
  try { [void][S4W32]::GetWindowThreadProcessId([IntPtr]$hwnd, [ref]$wpid) } catch {}
  $procStart = ''
  try { $procStart = (Get-Process -Id $wpid -ErrorAction Stop).StartTime.ToString('o') } catch {}
  $safe = $owned -and $tabCheck.ok
  $reason = ''
  if (-not $owned) { $reason = 'window was not newly created' }
  elseif (-not $tabCheck.ok) { $reason = 'unsafe tab set: ' + [string]$tabCheck.reason }

  $state = [ordered]@{
    ok = [bool]$safe
    hwnd = $hwnd
    title = [string]$hit.title
    owned = [bool]$owned
    safeToClose = [bool]$safe
    pid = [int]$wpid
    processStart = $procStart
    path = $Path
    expectedTabs = @($ExpectedTabs)
    tabs = @($tabCheck.tabs | ForEach-Object { $_.raw })
    reason = $reason
    at = (Get-Date).ToString('o')
  }
  if ($StateFile) {
    try { [IO.File]::WriteAllText($StateFile, ($state | ConvertTo-Json -Compress -Depth 5), (New-Object System.Text.UTF8Encoding($false))) } catch {}
  }
  return $state
}

function Close-TestNotepad {
  # Close only the exact HWND recorded by Open-TestNotepad, and only when the
  # window is still the same process and its tabs are exactly the expected set,
  # all unmodified. Never Stop-Process, never close user tabs, never confirm a
  # save prompt. Returns {closed,leftover,reason,tabs}.
  param([string]$StateFile)
  $res = [ordered]@{ closed = $false; leftover = ''; reason = ''; tabs = @() }
  if (-not $StateFile -or -not (Test-Path $StateFile)) { $res.reason = 'no state file'; return $res }
  try { $s = Get-Content -Raw $StateFile | ConvertFrom-Json } catch { $res.reason = 'bad state file'; return $res }
  if (-not $s.owned) { $res.reason = 'window not task-owned; left open'; return $res }
  $hit = Find-WindowByHwnd ([int]$s.hwnd)
  if (-not $hit) { $res.reason = 'window already gone'; return $res }

  # Revalidate process identity (HWND can be reused).
  $wpid = 0
  try { [void][S4W32]::GetWindowThreadProcessId([IntPtr]$s.hwnd, [ref]$wpid) } catch {}
  if ($s.pid -and $wpid -and ([int]$s.pid -ne [int]$wpid)) {
    $res.reason = "pid changed ($($s.pid) -> $wpid); left open"; return $res
  }
  $procStart = ''
  try { $procStart = (Get-Process -Id $wpid -ErrorAction Stop).StartTime.ToString('o') } catch {}
  if ($s.processStart -and $procStart -and ([string]$s.processStart -ne $procStart)) {
    $res.reason = 'process start time changed; left open'; return $res
  }

  $tabCheck = Test-NotepadTabSet -Hwnd ([int]$s.hwnd) -ExpectedTabs @($s.expectedTabs)
  $res.tabs = @($tabCheck.tabs)
  if (-not $tabCheck.ok) {
    $res.reason = 'unsafe tab set: ' + [string]$tabCheck.reason
    $res.leftover = (@($tabCheck.labels) -join ' | ')
    return $res
  }
  if (([string]$hit.title).TrimStart().StartsWith('*')) {
    $res.reason = 'modified document; left open'; $res.leftover = [string]$hit.title; return $res
  }
  [void][S4W32]::PostMessage([IntPtr]$s.hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 800
  $still = Find-WindowByHwnd ([int]$s.hwnd)
  if ($still) { $res.reason = 'close not confirmed; left open'; $res.leftover = [string]$still.title }
  else { $res.closed = $true }
  return $res
}

function Get-Placement([int]$Hwnd) {
  $p = New-Object S4W32+WPL
  $p.length = [System.Runtime.InteropServices.Marshal]::SizeOf($p)
  [void][S4W32]::GetWindowPlacement([IntPtr]$Hwnd, [ref]$p)
  return $p
}

function Test-CalculatorVisible {
  # Win11 Calculator is WinUI3: Process.MainWindowHandle stays 0 - probe UIA instead
  try {
    Add-Type -AssemblyName UIAutomationClient
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, 'ApplicationFrameWindow')
    $wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
    $idCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'CalculatorResults')
    foreach ($w in $wins) {
      $f = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, $idCond)
      if ($f.Count -gt 0) { return $true }
    }
  } catch {}
  return $false
}

function Start-Calculator {
  # kill any instance, wait until really gone, then launch with retries until UIA sees the window.
  # Returns the CalculatorApp pid when visible, else $null.
  Get-Process -Name 'CalculatorApp' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  $deadline = (Get-Date).AddSeconds(8)
  while ((Get-Date) -lt $deadline) {
    if (-not (Get-Process -Name 'CalculatorApp' -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 300
  }
  Start-Sleep -Milliseconds 800
  $launched = $false
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline) {
    if (-not (Get-Process -Name 'CalculatorApp' -ErrorAction SilentlyContinue)) {
      Start-Process -FilePath 'calc.exe'
      $launched = $true
    }
    if (Test-CalculatorVisible) {
      $p = Get-Process -Name 'CalculatorApp' -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($p) { return $p.Id }
      return 0
    }
    Start-Sleep -Milliseconds 600
  }
  return $null
}

function Close-TaskWindows {
  # Close ONLY windows whose titles match explicit, task-specific patterns.
  #
  # SAFETY (2026-11-14 t01): the box is shared and Win11 Notepad is multi-tab.
  # There are deliberately NO default needles: 'Notepad' matches every Notepad
  # window (including user documents), and WM_CLOSE on a modified document pops
  # a save dialog. If no patterns are passed, this function closes nothing and
  # reports that. For Notepad tasks prefer Open-TestNotepad/Close-TestNotepad,
  # which are HWND- and ownership-scoped.
  param([string[]]$Patterns = @())
  if (-not $Patterns -or $Patterns.Count -eq 0) {
    Write-Verbose 'Close-TaskWindows: no explicit patterns; refusing to close anything'
    return 0
  }
  $found = @()
  foreach ($needle in $Patterns) {
    foreach ($w in @(Find-WindowsByTitle $needle)) { $found += ,@($w.hwnd, $w.title) }
  }
  $closed = 0
  $seen = @{}
  foreach ($e in $found) {
    if ($seen.ContainsKey($e[0])) { continue }
    $seen[$e[0]] = $true
    [void][S4W32]::PostMessage([IntPtr]$e[0], 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
    $closed++
  }
  if ($closed -gt 0) { Start-Sleep -Milliseconds 800 }
  # Report leftovers honestly (only the explicit patterns).
  $left = @()
  foreach ($needle in $Patterns) {
    foreach ($w in @(Find-WindowsByTitle $needle)) { $left += ,@($w.hwnd, $w.title) }
  }
  $seen2 = @{}
  foreach ($e in $left) {
    if ($seen2.ContainsKey($e[0])) { continue }
    $seen2[$e[0]] = $true
    Write-Verbose ("leftover window: " + $e[1])
  }
  return $closed
}
