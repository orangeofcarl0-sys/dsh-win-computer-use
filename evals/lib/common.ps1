# S4 eval shared prelude. Dot-source at top of every setup/oracle/cleanup/simulate script:
#   . (Join-Path $PSScriptRoot '..\lib\common.ps1')
# Each script declares: param([string]$TaskId = '')
# ASCII-only: PowerShell 5.1 parses BOM-less scripts as ANSI (no CJK comments here).
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
# Evals root captured at load time; functions below may run from setup/oracle scripts.
$Script:S4EvalsRoot = Split-Path $PSScriptRoot -Parent

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

function Get-S4VariantNumber {
  # S4_VARIANT is set by the runner per run; default 1 keeps old scripts unchanged.
  $raw = ([string]$env:S4_VARIANT).Trim()
  if ($raw -match '^[0-9]+$') {
    $n = [int]$raw
    if ($n -ge 1) { return $n }
  }
  return 1
}

function Get-S4VariantData {
  # Single source of truth for variant values: evals/variants/<id>.json.
  # Setup, oracle and simulate must read the same entry so expected values cannot drift.
  param([string]$TaskId = '', [int]$Variant = 0)
  if (-not $TaskId) { $TaskId = $Script:S4TaskId }
  if (-not $TaskId) { throw 'Get-S4VariantData: no task id' }
  if ($Variant -le 0) { $Variant = Get-S4VariantNumber }
  $path = Join-Path (Join-Path $Script:S4EvalsRoot 'variants') ($TaskId + '.json')
  if (-not (Test-Path -LiteralPath $path)) { throw "variant data missing: $path" }
  $all = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
  $prop = @($all.PSObject.Properties | Where-Object { $_.Name -eq ([string]$Variant) })
  if ($prop.Count -eq 0) { throw "variant $Variant missing: $path" }
  $out = [ordered]@{}
  foreach ($p in $prop[0].Value.PSObject.Properties) { $out[$p.Name] = $p.Value }
  $out['variant'] = $Variant
  return [pscustomobject]$out
}

function Get-IsolationMode {
  # clean | dirty; legacy "notepad" is normalized to clean by the runner.
  $m = ([string]$env:S4_ISOLATION).Trim().ToLowerInvariant()
  if ($m -eq 'dirty') { return 'dirty' }
  return 'clean'
}

function Test-IsolationDirty {
  return ((Get-IsolationMode) -eq 'dirty')
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
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetLastActivePopup(IntPtr h);
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

function Test-WindowAlive([int]$Hwnd) {
  # UIA root-children lookup can miss an existing HWND (Calculator/ApplicationFrameHost,
  # elevated windows). Win32 IsWindow is the authoritative liveness check.
  if ($Hwnd -le 0) { return $false }
  try { if ([S4W32]::IsWindow([IntPtr]$Hwnd)) { return $true } } catch {}
  return [bool](Find-WindowByHwnd $Hwnd)
}

function Get-OwnedWindows([int]$Hwnd) {
  # Top-level windows whose GW_OWNER is the given HWND (Save As / confirm dialogs).
  # UIA root children avoid a managed callback closure over script state.
  Add-Type -AssemblyName UIAutomationClient
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Window)
  $wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
  $out = @()
  foreach ($w in $wins) {
    $h = 0
    try { $h = [int]$w.Current.NativeWindowHandle } catch {}
    if ($h -eq 0) { continue }
    $owner = [IntPtr]::Zero
    try { $owner = [S4W32]::GetWindow([IntPtr]$h, 4) } catch {}
    if ([int]$owner -eq [int]$Hwnd) {
      $name = ''
      try { $name = [string]$w.Current.Name } catch {}
      $out += [PSCustomObject]@{ hwnd = $h; title = $name }
    }
  }
  return @($out)
}

function Get-ModalTestWindows([int]$Hwnd, [int]$TargetPid) {
  # Modal dialogs that can be proven to belong to the test window. Win11 Notepad's
  # WinUI file dialog is a same-pid top-level window whose GW_OWNER may be 0; direct
  # Get-OwnedWindows therefore misses it (2026-11-15 t05). Accept only:
  #   1) direct/indirect owner chain reaches the test HWND; or
  #   2) the test main window is disabled and GetLastActivePopup points at the candidate.
  # Never select by title alone; title is for reporting only.
  $out = @()
  foreach ($d in @(Get-OwnedWindows $Hwnd)) { $out += $d }
  $enabled = $true
  try { $enabled = [bool][S4W32]::IsWindowEnabled([IntPtr]$Hwnd) } catch {}
  $popup = 0
  try { $popup = [int][S4W32]::GetLastActivePopup([IntPtr]$Hwnd) } catch {}
  foreach ($w in @(Get-TopLevelWindows)) {
    $h = [int]$w.hwnd
    if ($h -le 0 -or $h -eq $Hwnd) { continue }
    $p = 0
    try { [void][S4W32]::GetWindowThreadProcessId([IntPtr]$h, [ref]$p) } catch {}
    if ($TargetPid -gt 0 -and [int]$p -ne $TargetPid) { continue }
    try { if (-not [S4W32]::IsWindowVisible([IntPtr]$h)) { continue } } catch {}
    $proof = $false
    $owner = [int][S4W32]::GetWindow([IntPtr]$h, 4)
    for ($i = 0; $i -lt 8 -and $owner -ne 0; $i++) {
      if ($owner -eq $Hwnd) { $proof = $true; break }
      $owner = [int][S4W32]::GetWindow([IntPtr]$owner, 4)
    }
    if (-not $proof -and -not $enabled -and $popup -eq $h) { $proof = $true }
    if ($proof) {
      $out += [pscustomobject]@{ hwnd = $h; title = [string]$w.title }
    }
  }
  return @($out | Sort-Object hwnd -Unique)
}

function Close-WindowUia([int]$Hwnd) {
  # Win11 Notepad ignores WM_CLOSE from a non-elevated client (UIPI), but the UIA
  # WindowPattern.Close path works through the automation broker. Prefer it;
  # callers fall back to PostMessage(WM_CLOSE) if UIA is unavailable.
  try {
    Add-Type -AssemblyName UIAutomationClient
    $win = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$Hwnd)
    if (-not $win) { return $false }
    $wp = $win.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)
    $wp.Close()
    return $true
  } catch { return $false }
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

function Test-NotepadTabAllowed {
  # Cleanup variant: the tab may have been renamed by Save As (seed -> note.txt),
  # so require the original count and a label from the allowed set, not one exact name.
  # -AllowModified is used by cleanup: every label is already proven to be in the
  # task's allowed test set, so discarding test-only edits is safe; a user tab still
  # fails the label check and leaves the window open.
  param([string[]]$TabNames, [string[]]$AllowedTabs, [int]$ExpectedCount, [switch]$AllowModified)
  $tabs = @($TabNames | ForEach-Object { ConvertFrom-NotepadTabName $_ })
  $allowed = @($AllowedTabs | ForEach-Object { ([string]$_).Trim().ToLowerInvariant() } | Sort-Object -Unique)
  $labels = @($tabs | ForEach-Object { ([string]$_.label).Trim().ToLowerInvariant() })
  $reason = ''
  if ($tabs.Count -eq 0) { $reason = 'no tabs exposed' }
  elseif ($ExpectedCount -ge 0 -and $tabs.Count -ne $ExpectedCount) { $reason = "tab count $($tabs.Count) != expected $ExpectedCount" }
  elseif (@($tabs | Where-Object { -not $_.known }).Count -gt 0) { $reason = 'unknown tab state suffix' }
  elseif (@($tabs | Where-Object { $_.modified -eq $true }).Count -gt 0 -and -not $AllowModified) { $reason = 'modified tab present' }
  elseif (@($labels | Where-Object { $allowed -notcontains $_ }).Count -gt 0) { $reason = 'tab label not in allowed final set' }
  return [ordered]@{
    ok = ($reason -eq '')
    reason = $reason
    tabs = @($tabs)
    labels = @($tabs | ForEach-Object { $_.label })
  }
}

function Clear-TestNotepadTabState([string]$StateDir = '') {
  # TabState is opaque, but the stored path is UTF-16LE. Delete only bins whose
  # path is under .dsh\s4-evals\ (test sandbox); never touch user document bins.
  if (-not $StateDir) {
    $StateDir = Join-Path $env:LOCALAPPDATA 'Packages\Microsoft.WindowsNotepad_8wekyb3d8bbwe\LocalState\TabState'
  }
  if (-not (Test-Path $StateDir)) { return 0 }
  $needle = '.dsh\s4-evals\'
  $removed = 0
  foreach ($f in @(Get-ChildItem -Path $StateDir -Filter '*.bin' -File -ErrorAction SilentlyContinue)) {
    try {
      $bytes = [IO.File]::ReadAllBytes($f.FullName)
      $text = [Text.Encoding]::Unicode.GetString($bytes)
      if ($text.IndexOf($needle, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
        Remove-Item -LiteralPath $f.FullName -Force -ErrorAction Stop
        $removed++
      }
    } catch {}
  }
  return $removed
}

function Clear-TestTabStateForLaunch {
  # When evals/lib/tabstate.ps1 has backed up the user's TabState (marker exists),
  # delete ALL bins left by the previous eval task. Without this, task N's test tabs
  # are restored into task N+1's window (draft/workfile/a.txt cascade, 2026-11-15).
  # Without the marker, only test-path bins are touched (never a user session).
  $stateDir = Join-Path $env:LOCALAPPDATA 'Packages\Microsoft.WindowsNotepad_8wekyb3d8bbwe\LocalState\TabState'
  $marker = Join-Path $env:USERPROFILE '.dsh\s4-evals\_tabstate-active.json'
  if (-not (Test-Path $stateDir)) { return 0 }
  if (Test-Path $marker) {
    $removed = 0
    foreach ($f in @(Get-ChildItem $stateDir -Filter '*.bin' -File -ErrorAction SilentlyContinue)) {
      try { Remove-Item -LiteralPath $f.FullName -Force -ErrorAction Stop; $removed++ } catch {}
    }
    return $removed
  }
  return (Clear-TestNotepadTabState $stateDir)
}

function Test-ClipboardRoundTrip {
  # Clipboard can be locked/redirected for a whole session. Retry longer than the
  # old 4x600ms, capture the last error, and let the caller classify it as ENV
  # before opening Notepad (t06 otherwise leaves side effects).
  param([string]$Text, [int]$Retries = 8)
  $last = ''
  for ($i = 0; $i -lt $Retries; $i++) {
    try { Set-Clipboard -Value $Text } catch { $last = $_.Exception.Message }
    Start-Sleep -Milliseconds 600
    try {
      $got = Get-Clipboard -Raw
      if ($null -ne $got) { $got = ([string]$got).TrimEnd("`r", "`n") }
      if ($got -eq $Text) { return [ordered]@{ ok = $true; text = [string]$got; error = '' } }
      $last = "got=[$got]"
    } catch { $last = $_.Exception.Message }
  }
  return [ordered]@{ ok = $false; text = ''; error = $last }
}

function Write-TestState([string]$Path, $State) {
  # Explicit UTF-8 (no BOM), one line, no silent partial files.
  try {
    $json = $State | ConvertTo-Json -Compress -Depth 8
    [IO.File]::WriteAllText($Path, $json, (New-Object System.Text.UTF8Encoding($false)))
    return $true
  } catch { return $false }
}

function Read-TestState([string]$Path) {
  # Explicit UTF-8: Get-Content -Raw defaults to ANSI in PS 5.1 and can mangle
  # localized tab labels. Caller treats null as unsafe (leave window open).
  try {
    $raw = [IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8)
    if (-not $raw) { return $null }
    return ($raw | ConvertFrom-Json)
  } catch { return $null }
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

function Wait-NotepadTabSet {
  # Poll the exact tab set for up to TimeoutMs. Win11 Notepad tab restore/animation
  # can exceed the old 3x300ms window, especially right after a launch/merge.
  param([int]$Hwnd, [string[]]$ExpectedTabs = @(), [int]$TimeoutMs = 3000)
  $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
  $last = $null
  while ((Get-Date) -lt $deadline) {
    $last = Test-NotepadTabSet -Hwnd $Hwnd -ExpectedTabs $ExpectedTabs
    if ($last.ok) { return $last }
    Start-Sleep -Milliseconds 300
  }
  if (-not $last) { $last = Test-NotepadTabSet -Hwnd $Hwnd -ExpectedTabs $ExpectedTabs }
  return $last
}

function Open-TestNotepad {
  # Open a uniquely named test document WITHOUT touching existing Notepad windows.
  # A new HWND is NOT enough: Win11 Notepad restores the previous session's tabs
  # into the new window. Require the exact expected tab set, all unmodified and
  # all with a known state suffix; otherwise fail closed and record why.
  param([string]$Path, [string]$TitleNeedle, [string]$StateFile, [string[]]$ExpectedTabs = @(), [string[]]$FinalTabs = @(), [int[]]$AllowExistingHwnd = @())
  # Recover from a previous run's test-only windows before preflight. This is what
  # stops the "failed t01 leaves a modified seed tab, next setup restores it" cascade.
  $orphan = Close-OrphanTestNotepads -ProtectHwnd $AllowExistingHwnd
  if ($orphan.closed -gt 0) { Start-Sleep -Milliseconds 500 }
  # Remove prior test tabs from TabState; otherwise a new window restores
  # note.txt/draft.txt/etc. and the exact tab-set check (correctly) fails.
  # In eval mode (backup marker present) this clears all eval-created bins.
  [void](Clear-TestTabStateForLaunch)
  $beforeWins = @(Find-WindowsByTitle 'Notepad')
  $before = @($beforeWins | ForEach-Object { [int]$_.hwnd })
  # Preflight: launching notepad.exe while another Notepad window exists can add the
  # test document as a tab to that window (possibly a user document). Fail closed
  # BEFORE launching; t10 may explicitly allow its own first HWND.
  $foreign = @($beforeWins | Where-Object { $AllowExistingHwnd -notcontains [int]$_.hwnd })
  if ($foreign.Count -gt 0) {
    $titles = (@($foreign | ForEach-Object { $_.title }) -join ' | ')
    return [ordered]@{
      ok = $false; hwnd = 0; title = ''; owned = $false; safeToClose = $false
      reason = "existing Notepad window(s); refusing to add a test tab (close them first): $titles"
    }
  }
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
  $tabCheck = Wait-NotepadTabSet -Hwnd $hwnd -ExpectedTabs $ExpectedTabs -TimeoutMs 3000
  $script:TestNotepadProtected[[int]$hwnd] = $true
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
    allowedTabs = @(@($ExpectedTabs) + @($FinalTabs))
    tabCount = @($ExpectedTabs).Count
    tabs = @($tabCheck.tabs | ForEach-Object { $_.raw })
    reason = $reason
    at = (Get-Date).ToString('o')
  }
  $stateWritten = $true
  if ($StateFile) { $stateWritten = Write-TestState $StateFile $state }
  if (-not $stateWritten) {
    $state.ok = $false
    $state.safeToClose = $false
    $state.reason = 'state file write failed'
  }
  return $state
}

function Dismiss-TestSavePrompt([int]$Hwnd, [int]$TargetPid = 0) {
  # Click "Don't Save" (localized via code points) on a proven modal dialog of the
  # test window. Get-ModalTestWindows only returns windows whose ownership/modal
  # relation to the test HWND is proven; title alone is never used for selection.
  $noSave = -join @([char]0x4E0D, [char]0x4FDD, [char]0x5B58)
  $roots = @()
  foreach ($d in @(Get-ModalTestWindows $Hwnd $TargetPid)) {
    try { $roots += [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$d.hwnd) } catch {}
  }
  # Paint 11 (WinUI) renders its "是否要保存?" ContentDialog inside the main
  # window tree instead of a separate top-level HWND; callers have already proved
  # the main HWND is test-owned, so scanning it is safe.
  if ($Hwnd) {
    try { $roots += [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$Hwnd) } catch {}
  }
  foreach ($root in $roots) {
    try {
      $cond = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Button)
      foreach ($b in $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)) {
        $n = ''
        try { $n = [string]$b.Current.Name } catch {}
        if ($n.IndexOf($noSave) -ge 0 -or $n -match "Don.t Save") {
          try {
            $p = $b.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
            $p.Invoke()
            return $true
          } catch {}
        }
      }
    } catch {}
  }
  return $false
}

# Known test document labels. Orphan cleanup only closes a window when EVERY tab
# is in this set AND at least one tab is a unique test seed; a user tab or a bare
# generic name (note.txt/a.txt) is never auto-closed.
$script:TestNotepadLabels = @(
  's4-t01-seed.txt', 'note.txt', 'draft.txt', 'out-ansi.txt',
  's4-t06-seed.txt', 'pasted.txt', 'workfile.txt', 'a.txt', 'b.txt', 'deleg.txt'
)
$script:TestNotepadSeeds = @('s4-t01-seed.txt', 's4-t06-seed.txt', 'workfile.txt')

function Close-OrphanTestNotepads {
  # Recover from a previous run's test-only windows (e.g. a failed save left a
  # modified seed plus restored test tabs). Strict allowlist + at least one unique
  # seed; user tabs are left alone and reported. Returns {closed,leftover,details}.
  # -ProtectHwnd: windows opened earlier in the CURRENT setup (t10 a.txt) must not
  # be closed by the next Open-TestNotepad call.
  param([int[]]$ProtectHwnd = @(), [string[]]$ExtraAllowedTabs = @(), [string[]]$ExtraSeeds = @())
  if (-not $script:TestNotepadProtected) { $script:TestNotepadProtected = @{} }
  $allowedLabels = @($script:TestNotepadLabels) + @($ExtraAllowedTabs | ForEach-Object { ([string]$_).Trim().ToLowerInvariant() })
  $seeds = @($script:TestNotepadSeeds) + @($ExtraSeeds | ForEach-Object { ([string]$_).Trim().ToLowerInvariant() })
  $protected = @{}
  foreach ($h in @($ProtectHwnd)) { $protected[[int]$h] = $true }
  foreach ($h in @($script:TestNotepadProtected.Keys)) { $protected[[int]$h] = $true }
  $closed = 0
  $leftover = @()
  $details = @()
  # In eval mode (tabstate.ps1 backup active), a Notepad process started after the
  # backup is eval-owned; this also covers windows whose only tab is draft.txt/a.txt.
  $evalStart = $null
  $marker = Join-Path $env:USERPROFILE '.dsh\s4-evals\_tabstate-active.json'
  if (Test-Path $marker) {
    try { $m = Get-Content $marker -Raw | ConvertFrom-Json; $evalStart = [datetime]$m.at } catch {}
  }
  foreach ($w in @(Find-WindowsByTitle 'Notepad')) {
    if ($protected.ContainsKey([int]$w.hwnd)) { continue }
    $wpid = 0
    try { [void][S4W32]::GetWindowThreadProcessId([IntPtr]$w.hwnd, [ref]$wpid) } catch {}
    $start = ''
    try { $start = (Get-Process -Id $wpid -ErrorAction Stop).StartTime.ToString('o') } catch {}
    $evalOwned = $false
    if ($evalStart -and $start) {
      try { $evalOwned = ([datetime]$start -ge $evalStart) } catch {}
    }
    $tabs = @(Get-NotepadTabs ([int]$w.hwnd))
    if ($tabs.Count -eq 0) {
      # An empty, untitled window created during the eval run (e.g. app_launch
      # fallback) has no document to lose; close it via UIA. A pre-existing empty
      # window may belong to the user, so leave it.
      if ($evalOwned) {
        if (Close-WindowUia ([int]$w.hwnd)) {
          Start-Sleep -Milliseconds 500
          if (-not (Find-WindowByHwnd ([int]$w.hwnd))) {
            $closed++
            $details += ("hwnd={0} closed empty eval window" -f $w.hwnd)
            continue
          }
        }
      }
      $leftover += ("hwnd={0} title={1} tabs=none" -f $w.hwnd, $w.title)
      continue
    }
    $labels = @($tabs | ForEach-Object { ([string]$_.label).Trim().ToLowerInvariant() })
    $unknown = @($tabs | Where-Object { -not $_.known })
    $modified = @($tabs | Where-Object { $_.modified -eq $true })
    $allowUntitled = $false
    if ($evalOwned -and $modified.Count -eq 0 -and $labels.Count -gt 0) {
      $allowUntitled = $true
      foreach ($l in $labels) {
        if ($l -notmatch '^(无标题|untitled)\.?$') { $allowUntitled = $false; break }
      }
    }
    $allowed = $true
    foreach ($l in $labels) {
      if ($allowedLabels -notcontains $l) { $allowed = $false; break }
    }
    $hasSeed = $false
    foreach ($l in $labels) {
      if ($seeds -contains $l) { $hasSeed = $true; break }
    }
    if ($allowUntitled) { $allowed = $true; $hasSeed = $true; $unknown = @() }

    # Safety: evalOwned alone is NOT enough for tabbed windows with generic names
    # (a.txt/note.txt/draft.txt). Require a unique test seed; t10's a+b window is
    # protected by -ProtectHwnd / its cleanup state instead.
    if (-not $allowed -or $unknown.Count -gt 0 -or -not $hasSeed) {
      $leftover += ("hwnd={0} title={1} tabs={2}" -f $w.hwnd, $w.title, (($tabs | ForEach-Object { $_.raw }) -join ' | '))
      continue
    }
    $tmp = Join-Path $env:TEMP ('s4-orphan-' + [guid]::NewGuid().ToString('N') + '.json')
    $state = [ordered]@{
      ok = $true; hwnd = [int]$w.hwnd; title = [string]$w.title; owned = $true; safeToClose = $true
      pid = [int]$wpid; processStart = $start
      expectedTabs = @(); allowedTabs = @($labels); tabCount = $labels.Count
      tabs = @($tabs | ForEach-Object { $_.raw }); reason = 'orphan test-only window'
    }
    if (-not (Write-TestState $tmp $state)) { $leftover += ("hwnd={0} state write failed" -f $w.hwnd); continue }
    $r = Close-TestNotepad -StateFile $tmp -AllowDiscardTestOnlyModified
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    if ($r.closed) {
      $closed++
      $details += ("hwnd={0} closed discarded={1} tabs={2}" -f $w.hwnd, $r.discarded, (($tabs | ForEach-Object { $_.raw }) -join ' | '))
    } else {
      $leftover += ("hwnd={0} close failed: {1}" -f $w.hwnd, $r.reason)
    }
  }
  return [ordered]@{ closed = $closed; leftover = @($leftover); details = @($details) }
}

function Close-TestNotepad {
  # Close only the exact HWND recorded by Open-TestNotepad, and only when the
  # window is still the same process and its tabs are exactly the expected set.
  # -AllowDiscardTestOnlyModified: cleanup may discard edits when every tab label is
  # in the task's allowed test set; a user tab still fails the label check and stays
  # open. Never Stop-Process. Returns {closed,leftover,reason,tabs,dialogsClosed}.
  param([string]$StateFile, [switch]$AllowDiscardTestOnlyModified)
  $res = [ordered]@{ closed = $false; leftover = ''; reason = ''; tabs = @(); dialogsClosed = 0; discarded = $false }
  if (-not $StateFile -or -not (Test-Path $StateFile)) {
    # Nothing was opened by this task (or the state was already removed): there is
    # no HWND to close. Treat as clean, not dirty; a late/untracked window is handled
    # by Close-OrphanTestNotepads on the next setup.
    $res.closed = $true
    $res.reason = 'no state file (nothing to close)'
    return $res
  }
  $s = Read-TestState $StateFile
  if (-not $s) {
    $len = 0
    try { $len = ([IO.File]::ReadAllText($StateFile, [Text.Encoding]::UTF8)).Length } catch {}
    $res.reason = "bad state file (len=$len)"; return $res
  }
  if (-not $s.owned) { $res.reason = 'window not task-owned; left open'; return $res }
  if (-not (Test-WindowAlive ([int]$s.hwnd))) { $res.closed = $true; $res.reason = 'window already gone'; return $res }
  $hit = Find-WindowByHwnd ([int]$s.hwnd)
  if (-not $hit) { $hit = [pscustomobject]@{ hwnd = [int]$s.hwnd; title = '' } }

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

  if ($s.allowedTabs) {
    $names = @(Get-NotepadTabs ([int]$s.hwnd) | ForEach-Object { $_.raw })
    $expectedCount = if ($null -ne $s.tabCount) { [int]$s.tabCount } else { @($s.expectedTabs).Count }
    $tabCheck = Test-NotepadTabAllowed -TabNames $names -AllowedTabs @($s.allowedTabs) -ExpectedCount $expectedCount -AllowModified:$AllowDiscardTestOnlyModified
  } else {
    # Old state files have no allowedTabs: preserve the strict exact-set behavior.
    $tabCheck = Test-NotepadTabSet -Hwnd ([int]$s.hwnd) -ExpectedTabs @($s.expectedTabs)
  }
  $res.tabs = @($tabCheck.tabs)
  if (-not $tabCheck.ok) {
    $res.reason = 'unsafe tab set: ' + [string]$tabCheck.reason
    $res.leftover = (@($tabCheck.labels) -join ' | ')
    return $res
  }
  $modifiedTabs = @($tabCheck.tabs | Where-Object { $_.modified -eq $true }).Count -gt 0
  if ((([string]$hit.title).TrimStart().StartsWith('*') -or $modifiedTabs) -and -not $AllowDiscardTestOnlyModified) {
    $res.reason = 'modified document; left open'; $res.leftover = [string]$hit.title; return $res
  }
  # Close task-owned modal dialogs first. The tab check above already proved this
  # window contains only unmodified test tabs, so a modal proven to belong to the
  # test window cannot be holding user data. Same-pid WinUI dialogs (Save As) may
  # have GW_OWNER=0; Get-ModalTestWindows adds the disabled-main/GetLastActivePopup
  # proof. Without this, WM_CLOSE to the main window is ignored and the dialog
  # survives (2026-11-15 t05).
  for ($pass = 0; $pass -lt 3; $pass++) {
    $owned = @(Get-ModalTestWindows ([int]$s.hwnd) ([int]$s.pid))
    if ($owned.Count -eq 0) { break }
    foreach ($d in $owned) {
      if (-not (Close-WindowUia ([int]$d.hwnd))) {
        [void][S4W32]::PostMessage([IntPtr]$d.hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
      }
    }
    $res.dialogsClosed = [int]$res.dialogsClosed + $owned.Count
    Start-Sleep -Milliseconds 500
  }
  $stillOwned = @(Get-ModalTestWindows ([int]$s.hwnd) ([int]$s.pid))
  if ($stillOwned.Count -gt 0) {
    $res.reason = 'owned dialog did not close; left open'
    $res.leftover = (@($stillOwned | ForEach-Object { $_.title }) -join ' | ')
    return $res
  }
  if (-not (Close-WindowUia ([int]$s.hwnd))) {
    [void][S4W32]::PostMessage([IntPtr]$s.hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
  }
  Start-Sleep -Milliseconds 800
  for ($i = 0; $i -lt 3; $i++) {
    if (-not (Test-WindowAlive ([int]$s.hwnd))) { break }
    if (-not $AllowDiscardTestOnlyModified) { break }
    if (-not (Dismiss-TestSavePrompt ([int]$s.hwnd) ([int]$s.pid))) { break }
    Start-Sleep -Milliseconds 800
  }
  $still = Test-WindowAlive ([int]$s.hwnd)
  if ($still) {
    $res.reason = 'close not confirmed; left open'
    $st = Find-WindowByHwnd ([int]$s.hwnd)
    $res.leftover = if ($st) { [string]$st.title } else { '(UIA title unavailable)' }
  } else {
    $res.closed = $true
    $res.discarded = [bool]$modifiedTabs
  }
  return $res
}

function Get-Placement([int]$Hwnd) {
  $p = New-Object S4W32+WPL
  $p.length = [System.Runtime.InteropServices.Marshal]::SizeOf($p)
  [void][S4W32]::GetWindowPlacement([IntPtr]$Hwnd, [ref]$p)
  return $p
}

function Get-CalculatorWindow {
  # Win11 Calculator is WinUI3 and its top-level class varies (ApplicationFrameWindow
  # vs WinUIDesktopWin32WindowClass). Scan ALL top-level Window controls for the
  # CalculatorResults automation id instead of hard-coding one class.
  try {
    Add-Type -AssemblyName UIAutomationClient
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $cond = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Window)
    $wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
    $idCond = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'CalculatorResults')
    foreach ($w in $wins) {
      $f = $w.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $idCond)
      if (-not $f) { continue }
      $h = 0
      try { $h = [int]$w.Current.NativeWindowHandle } catch {}
      $n = ''
      try { $n = [string]$w.Current.Name } catch {}
      $p = 0
      if ($h -ne 0) { try { [void][S4W32]::GetWindowThreadProcessId([IntPtr]$h, [ref]$p) } catch {} }
      return [pscustomobject]@{ hwnd = $h; title = $n; pid = $p; element = $f }
    }
  } catch {}
  return $null
}

function Test-CalculatorVisible {
  return [bool](Get-CalculatorWindow)
}

function Start-Calculator {
  # Prefer an already-visible Calculator (do not kill it); otherwise try to clear a
  # stale CalculatorApp once and launch calc.exe. Returns the visible pid, else $null.
  $existing = Get-CalculatorWindow
  if ($existing) { return [int]$existing.pid }
  $p = @(Get-Process -Name 'CalculatorApp' -ErrorAction SilentlyContinue)
  if ($p.Count -gt 0) {
    $p | Stop-Process -Force -ErrorAction SilentlyContinue
    $deadline = (Get-Date).AddSeconds(5)
    while ((Get-Date) -lt $deadline) {
      if (-not (Get-Process -Name 'CalculatorApp' -ErrorAction SilentlyContinue)) { break }
      Start-Sleep -Milliseconds 300
    }
  }
  Start-Sleep -Milliseconds 500
  try { Start-Process -FilePath 'calc.exe' } catch {}
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline) {
    $w = Get-CalculatorWindow
    if ($w) { return [int]$w.pid }
    Start-Sleep -Milliseconds 600
  }
  return $null
}

function Get-TopLevelWindows {
  # All top-level UIA Window controls with a native HWND (used by state-scoped
  # Explorer/Paint lifecycle helpers; never used for broad closes).
  Add-Type -AssemblyName UIAutomationClient
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Window)
  $wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
  $out = @()
  foreach ($w in $wins) {
    $h = 0
    try { $h = [int]$w.Current.NativeWindowHandle } catch {}
    if ($h -eq 0) { continue }
    $n = ''
    try { $n = [string]$w.Current.Name } catch {}
    $out += [pscustomobject]@{ hwnd = $h; title = $n }
  }
  return @($out)
}

function Open-TestExplorer {
  # Launch Explorer at Path (or select SelectFile) and require a NEW HWND whose
  # title contains one of TitleNeedle. Never closes or reuses an existing window.
  param([string]$Path, [string[]]$TitleNeedle = @(), [string]$StateFile, [string]$SelectFile = '')
  $before = @(Get-TopLevelWindows | ForEach-Object { [int]$_.hwnd })
  try {
    if ($SelectFile) {
      Start-Process -FilePath 'explorer.exe' -ArgumentList @(('/select,"' + $SelectFile + '"')) | Out-Null
    } else {
      Start-Process -FilePath 'explorer.exe' -ArgumentList @($Path) | Out-Null
    }
  } catch {
    return [ordered]@{ ok = $false; hwnd = 0; pid = 0; title = ''; owned = $false; reason = $_.Exception.Message }
  }
  $deadline = (Get-Date).AddSeconds(15)
  $hit = $null
  while ((Get-Date) -lt $deadline) {
    foreach ($w in @(Get-TopLevelWindows)) {
      if ($before -contains [int]$w.hwnd) { continue }
      $candPid = 0
      try { [void][S4W32]::GetWindowThreadProcessId([IntPtr]$w.hwnd, [ref]$candPid) } catch {}
      $candProc = ''
      try { $candProc = (Get-Process -Id $candPid -ErrorAction Stop).ProcessName } catch {}
      if ($candProc -and $candProc -ne 'explorer') { continue }
      foreach ($n in @($TitleNeedle)) {
        if ([string]$w.title -and ([string]$w.title).IndexOf([string]$n, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
          $hit = $w
          break
        }
      }
      if ($hit) { break }
    }
    if ($hit) { break }
    Start-Sleep -Milliseconds 400
  }
  if (-not $hit) {
    return [ordered]@{ ok = $false; hwnd = 0; pid = 0; title = ''; owned = $false; reason = 'new explorer window not found' }
  }
  $hwnd = [int]$hit.hwnd
  $wpid = 0
  try { [void][S4W32]::GetWindowThreadProcessId([IntPtr]$hwnd, [ref]$wpid) } catch {}
  $start = ''
  try { $start = (Get-Process -Id $wpid -ErrorAction Stop).StartTime.ToString('o') } catch {}
  $state = [ordered]@{
    ok = $true; hwnd = $hwnd; title = [string]$hit.title; owned = $true
    pid = [int]$wpid; processStart = $start; path = $Path; selectFile = $SelectFile
    at = (Get-Date).ToString('o')
  }
  if ($StateFile) { [void](Write-TestState $StateFile $state) }
  return $state
}

function Close-TestExplorer {
  param([string]$StateFile)
  $res = [ordered]@{ closed = $false; reason = ''; title = '' }
  if (-not $StateFile -or -not (Test-Path $StateFile)) { $res.closed = $true; $res.reason = 'no state file (nothing to close)'; return $res }
  $s = Read-TestState $StateFile
  if (-not $s -or -not $s.owned) { $res.reason = 'not task-owned'; return $res }
  if (-not (Test-WindowAlive ([int]$s.hwnd))) { $res.closed = $true; $res.reason = 'window already gone'; return $res }
  $w = Find-WindowByHwnd ([int]$s.hwnd)
  $wpid = 0
  try { [void][S4W32]::GetWindowThreadProcessId([IntPtr]$s.hwnd, [ref]$wpid) } catch {}
  if ($s.pid -and $wpid -and ([int]$s.pid -ne [int]$wpid)) { $res.reason = "pid changed ($($s.pid) -> $wpid)"; return $res }
  # Explorer can take >800ms to finish its close animation; retry the state-scoped
  # HWND a few times instead of reporting dirty on the first slow close (t03 flake).
  for ($i = 0; $i -lt 4; $i++) {
    if (-not (Test-WindowAlive ([int]$s.hwnd))) { $res.closed = $true; return $res }
    if (-not (Close-WindowUia ([int]$s.hwnd))) {
      [void][S4W32]::PostMessage([IntPtr]$s.hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
    }
    Start-Sleep -Milliseconds 800
  }
  if (Test-WindowAlive ([int]$s.hwnd)) {
    $res.reason = 'close not confirmed'; $res.title = if ($w) { [string]$w.title } else { '' }
  } else { $res.closed = $true }
  return $res
}

function Open-TestPaint {
  # State-scoped Paint lifecycle. If any mspaint process already exists, fail closed;
  # never Stop-Process by name. Only a process started here may be stopped by PID.
  param([string]$StateFile)
  $existing = @(Get-Process -Name 'mspaint' -ErrorAction SilentlyContinue)
  if ($existing.Count -gt 0) {
    return [ordered]@{ ok = $false; hwnd = 0; pid = 0; title = ''; owned = $false; reason = 'existing mspaint process; close Paint first (never killed automatically)' }
  }
  $before = @(Get-TopLevelWindows | ForEach-Object { [int]$_.hwnd })
  try { Start-Process -FilePath 'mspaint.exe' | Out-Null } catch {
    return [ordered]@{ ok = $false; hwnd = 0; pid = 0; title = ''; owned = $false; reason = $_.Exception.Message }
  }
  $deadline = (Get-Date).AddSeconds(20)
  $hit = $null
  $launchedPids = @()
  while ((Get-Date) -lt $deadline) {
    $paintPids = @(Get-Process -Name 'mspaint' -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.Id })
    if ($paintPids.Count -gt 0) {
      $launchedPids = @(@($launchedPids) + @($paintPids) | Sort-Object -Unique)
      foreach ($w in @(Get-TopLevelWindows)) {
        if ($before -contains [int]$w.hwnd) { continue }
        $wpid = 0
        try { [void][S4W32]::GetWindowThreadProcessId([IntPtr]$w.hwnd, [ref]$wpid) } catch {}
        if ($paintPids -contains [int]$wpid) { $hit = $w; break }
      }
    }
    if ($hit) { break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $hit) {
    # Preflight guaranteed no mspaint existed; these PIDs were launched here.
    foreach ($id in @($launchedPids)) {
      try { Stop-Process -Id ([int]$id) -Force -ErrorAction SilentlyContinue } catch {}
    }
    return [ordered]@{ ok = $false; hwnd = 0; pid = 0; title = ''; owned = $false; reason = 'new paint window not found' }
  }
  $hwnd = [int]$hit.hwnd
  $wpid = 0
  try { [void][S4W32]::GetWindowThreadProcessId([IntPtr]$hwnd, [ref]$wpid) } catch {}
  $start = ''
  try { $start = (Get-Process -Id $wpid -ErrorAction Stop).StartTime.ToString('o') } catch {}
  $state = [ordered]@{
    ok = $true; hwnd = $hwnd; title = [string]$hit.title; owned = $true
    pid = [int]$wpid; processStart = $start; at = (Get-Date).ToString('o')
  }
  if ($StateFile) { [void](Write-TestState $StateFile $state) }
  return $state
}

function Close-TestPaint {
  param([string]$StateFile)
  $res = [ordered]@{ closed = $false; reason = ''; title = '' }
  if (-not $StateFile -or -not (Test-Path $StateFile)) { $res.closed = $true; $res.reason = 'no state file (nothing to close)'; return $res }
  $s = Read-TestState $StateFile
  if (-not $s -or -not $s.owned) { $res.reason = 'not task-owned'; return $res }
  if (-not (Test-WindowAlive ([int]$s.hwnd))) { $res.closed = $true; $res.reason = 'window already gone'; return $res }
  $w = Find-WindowByHwnd ([int]$s.hwnd)
  if (-not (Close-WindowUia ([int]$s.hwnd))) {
    [void][S4W32]::PostMessage([IntPtr]$s.hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
  }
  Start-Sleep -Milliseconds 800
  for ($i = 0; $i -lt 3; $i++) {
    if (-not (Test-WindowAlive ([int]$s.hwnd))) { break }
    if (-not (Dismiss-TestSavePrompt ([int]$s.hwnd) ([int]$s.pid))) { break }
    Start-Sleep -Milliseconds 800
  }
  $still = Test-WindowAlive ([int]$s.hwnd)
  if ($still) {
    $res.reason = 'close not confirmed'; $res.title = if ($w) { [string]$w.title } else { '' }
  } else {
    $res.closed = $true
    if ($s.pid) { try { Stop-Process -Id ([int]$s.pid) -Force -ErrorAction SilentlyContinue } catch {} }
  }
  return $res
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
    # Win11 Notepad ignores WM_CLOSE from a non-elevated client; UIA WindowPattern.Close works.
    if (-not (Close-WindowUia ([int]$e[0]))) {
      [void][S4W32]::PostMessage([IntPtr]$e[0], 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
    }
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

function Get-WindowPid([int]$Hwnd) {
  $wpid = 0
  try { [void][S4W32]::GetWindowThreadProcessId([IntPtr]$Hwnd, [ref]$wpid) } catch {}
  return [int]$wpid
}

function Get-ProcessStartIso([int]$TargetPid) {
  try { return (Get-Process -Id $TargetPid -ErrorAction Stop).StartTime.ToString('o') } catch { return '' }
}

function Test-ProcessIdentity([int]$TargetPid, [string]$StartIso) {
  if (-not $TargetPid) { return $false }
  try {
    $p = Get-Process -Id $TargetPid -ErrorAction Stop
    if (-not $StartIso) { return $true }
    return ($p.StartTime.ToString('o') -eq [string]$StartIso)
  } catch { return $false }
}

function Maximize-TestWindow {
  # State-scoped test window only. Paint 11 clips off-screen ribbon groups when
  # the window is narrow, which removes the color palette from the AX tree.
  param([int]$Hwnd)
  if (-not $Hwnd) { return }
  try { [void][S4W32]::ShowWindow([IntPtr]$Hwnd, 3) } catch {}
  Start-Sleep -Milliseconds 700
}

function Open-TestAppWindow {
  # Generic state-scoped app window opener for dirty-desktop tasks.
  # Requires a NEW top-level HWND whose process name matches and whose title
  # contains one of TitleNeedle. Never reuses/closes an existing user window.
  param(
    [string]$Exe,
    [string[]]$Arguments = @(),
    [string]$ProcessName,
    [string[]]$TitleNeedle = @(),
    [string]$StateFile,
    [int]$TimeoutSec = 20
  )
  if (-not (Test-Path $Exe)) {
    return [ordered]@{ ok = $false; hwnd = 0; pid = 0; title = ''; owned = $false; reason = "exe not found: $Exe" }
  }
  $before = @(Get-TopLevelWindows | ForEach-Object { [int]$_.hwnd })
  try {
    if ($Arguments.Count -gt 0) {
      Start-Process -FilePath $Exe -ArgumentList $Arguments | Out-Null
    } else {
      Start-Process -FilePath $Exe | Out-Null
    }
  } catch {
    return [ordered]@{ ok = $false; hwnd = 0; pid = 0; title = ''; owned = $false; reason = $_.Exception.Message }
  }
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  $hit = $null
  while ((Get-Date) -lt $deadline) {
    foreach ($w in @(Get-TopLevelWindows)) {
      if ($before -contains [int]$w.hwnd) { continue }
      $wpid = Get-WindowPid ([int]$w.hwnd)
      if (-not $wpid) { continue }
      $proc = ''
      try { $proc = (Get-Process -Id $wpid -ErrorAction Stop).ProcessName } catch {}
      if ($ProcessName -and $proc -and $proc -ine $ProcessName) { continue }
      $titleOk = $true
      if ($TitleNeedle.Count -gt 0) {
        $titleOk = $false
        foreach ($n in @($TitleNeedle)) {
          if ([string]$w.title -and ([string]$w.title).IndexOf([string]$n, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
            $titleOk = $true
            break
          }
        }
      }
      if ($titleOk) { $hit = $w; break }
    }
    if ($hit) { break }
    Start-Sleep -Milliseconds 400
  }
  if (-not $hit) {
    return [ordered]@{ ok = $false; hwnd = 0; pid = 0; title = ''; owned = $false; reason = 'new app window not found (existing window was not touched)' }
  }
  # Office often shows a transient "Opening..." splash window before the real
  # document window. Prefer a later new window whose title is not the loading
  # title, so cleanup closes the document window rather than the splash.
  # TitleNeedle must still match: otherwise a second Chrome/Office window of the
  # same process (session restore, extra splash) could be recorded as the test
  # window while the actual document window is left untracked.
  Start-Sleep -Milliseconds 1800
  $loading = -join @([char]0x6B63, [char]0x5728, [char]0x6253, [char]0x5F00)
  $better = $null
  foreach ($w in @(Get-TopLevelWindows)) {
    if ($before -contains [int]$w.hwnd) { continue }
    $cpid = Get-WindowPid ([int]$w.hwnd)
    if (-not $cpid) { continue }
    $cproc = ''
    try { $cproc = (Get-Process -Id $cpid -ErrorAction Stop).ProcessName } catch {}
    if ($ProcessName -and $cproc -and $cproc -ine $ProcessName) { continue }
    $t = [string]$w.title
    if (-not $t) { continue }
    if ($t.IndexOf($loading, [System.StringComparison]::Ordinal) -ge 0) { continue }
    if ($TitleNeedle.Count -gt 0) {
      $needleOk = $false
      foreach ($n in @($TitleNeedle)) {
        if ($t.IndexOf([string]$n, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
          $needleOk = $true
          break
        }
      }
      if (-not $needleOk) { continue }
    }
    $better = $w
  }
  if ($better) { $hit = $better }
  $hwnd = [int]$hit.hwnd
  $wpid = Get-WindowPid $hwnd
  $state = [ordered]@{
    ok = $true; hwnd = $hwnd; title = [string]$hit.title; owned = $true
    pid = $wpid; processStart = (Get-ProcessStartIso $wpid)
    processName = $ProcessName; exe = $Exe; at = (Get-Date).ToString('o')
  }
  if ($StateFile) { [void](Write-TestState $StateFile $state) }
  return $state
}

function Close-TestAppWindow {
  # Close only the exact HWND recorded by Open-TestAppWindow. Verifies PID and
  # process start time, dismisses only proven-modal save prompts, and never kills
  # the process by name (or by PID).
  param([string]$StateFile)
  $res = [ordered]@{ closed = $false; reason = ''; title = '' }
  if (-not $StateFile -or -not (Test-Path $StateFile)) {
    $res.closed = $true; $res.reason = 'no state file (nothing to close)'; return $res
  }
  $s = Read-TestState $StateFile
  if (-not $s -or -not $s.owned) { $res.reason = 'not task-owned'; return $res }
  if (-not (Test-WindowAlive ([int]$s.hwnd))) {
    $res.closed = $true; $res.reason = 'window already gone'; return $res
  }
  if ($s.pid -and -not (Test-ProcessIdentity ([int]$s.pid) ([string]$s.processStart))) {
    $res.reason = 'pid/start-time mismatch (refusing to close)'; return $res
  }
  $w = Find-WindowByHwnd ([int]$s.hwnd)
  if (-not (Close-WindowUia ([int]$s.hwnd))) {
    [void][S4W32]::PostMessage([IntPtr]$s.hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
  }
  Start-Sleep -Milliseconds 800
  for ($i = 0; $i -lt 4; $i++) {
    if (-not (Test-WindowAlive ([int]$s.hwnd))) { break }
    if (-not (Dismiss-TestSavePrompt ([int]$s.hwnd) ([int]$s.pid))) { break }
    Start-Sleep -Milliseconds 800
  }
  if (Test-WindowAlive ([int]$s.hwnd)) {
    $res.reason = 'close not confirmed'; $res.title = if ($w) { [string]$w.title } else { '' }
  } else {
    $res.closed = $true
  }
  return $res
}

function Open-TestPaintDoc {
  # Paint 11 may be a tabbed app. We require a NEW top-level HWND with a unique
  # seed title; if Paint merges into an existing user window we fail closed rather
  # than closing a user tab/window. Preflight any existing mspaint process: once
  # Paint 11 has merged the seed as a tab there is no new HWND to prove ownership,
  # and cleanup cannot distinguish the test tab from the user's document. ENV is
  # safer than silently touching the user's Paint window.
  param([string]$SeedPath, [string]$TitleNeedle, [string]$StateFile)
  $existing = @(Get-Process -Name 'mspaint' -ErrorAction SilentlyContinue)
  if ($existing.Count -gt 0) {
    return [ordered]@{
      ok = $false; hwnd = 0; pid = 0; title = ''; owned = $false
      reason = 'existing mspaint process; close Paint manually before running t11 (never closed automatically)'
    }
  }
  $exe = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\mspaint.exe'
  if (-not (Test-Path $exe)) { $exe = 'mspaint.exe' }
  return Open-TestAppWindow -Exe $exe -Arguments @($SeedPath) -ProcessName 'mspaint' -TitleNeedle @($TitleNeedle) -StateFile $StateFile
}

function Invoke-TestUiaButton {
  # Invoke a UIA button/toggle by exact accessible name. ASCII-only script:
  # callers pass names built from [char] code points for Chinese labels.
  param([int]$Hwnd, [string]$Name)
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  try {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$Hwnd)
    $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    $lastReason = ''
    foreach ($e in $all) {
      if ([string]$e.Current.Name -ne $Name) { continue }
      # Same name often appears on both a ListItem (virtualization only) and the
      # real Button/ToggleButton. Try every match instead of failing on the first.
      try {
        $e.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
        return [ordered]@{ ok = $true; control = $e.Current.ControlType.ProgrammaticName }
      } catch { $lastReason = $_.Exception.Message }
      try {
        $e.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern).Toggle()
        return [ordered]@{ ok = $true; control = $e.Current.ControlType.ProgrammaticName }
      } catch { $lastReason = $_.Exception.Message }
      try {
        $e.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
        return [ordered]@{ ok = $true; control = $e.Current.ControlType.ProgrammaticName }
      } catch { $lastReason = $_.Exception.Message }
      try {
        $e.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern).DoDefaultAction()
        return [ordered]@{ ok = $true; control = $e.Current.ControlType.ProgrammaticName }
      } catch { $lastReason = $_.Exception.Message }
    }
    return [ordered]@{ ok = $false; reason = "UIA action failed for $Name : $lastReason" }
  } catch {
    return [ordered]@{ ok = $false; reason = $_.Exception.Message }
  }
}

function Set-TestPaintBrushWidth {
  # Open Paint's AX size menu and choose one of 3/5/8 px.
  # SizeIndex: 0=3px, 1=5px, 2=8px. The menu items are in the desktop root.
  param([int]$Hwnd, [int]$SizeIndex = 2)
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  $sizeName = -join ([char[]](0x5927, 0x5C0F))
  $r = Invoke-TestUiaButton -Hwnd $Hwnd -Name $sizeName
  if (-not $r.ok) { return $r }
  Start-Sleep -Milliseconds 700
  $cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::MenuItem)
  $items = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants, $cond)
  $candidates = @()
  foreach ($i in $items) {
    $b = $i.Current.BoundingRectangle
    if ($b.X -ge 850 -and $b.X -le 1000 -and $b.Y -ge 200 -and $b.Y -le 520) {
      $candidates += $i
    }
  }
  $candidates = @($candidates | Sort-Object { $_.Current.BoundingRectangle.Y })
  if ($candidates.Count -lt ($SizeIndex + 2)) {
    try { [void](Invoke-TestUiaButton -Hwnd $Hwnd -Name $sizeName) } catch { }
    return [ordered]@{ ok = $false; reason = "size menu items missing (found $($candidates.Count))" }
  }
  $pick = $candidates[$SizeIndex + 1]
  $label = [string]$pick.Current.Name
  $pickY = -1
  try { $pickY = [int]$pick.Current.BoundingRectangle.Y } catch { $pickY = -1 }
  try {
    $pick.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
    Start-Sleep -Milliseconds 400
    return [ordered]@{ ok = $true; label = $label; y = $pickY }
  } catch {
    return [ordered]@{ ok = $false; reason = $_.Exception.Message; label = $label }
  }
}

function Set-TestPaintShapeWidths {
  # Select each of Paint's rectangle/ellipse/line tools and set the same width.
  # Leaves the rectangle tool selected so the task starts from a known state.
  param([int]$Hwnd, [int]$SizeIndex = 2)
  $shapes = @(
    (-join ([char[]](0x77E9, 0x5F62))),
    (-join ([char[]](0x692D, 0x5706))),
    (-join ([char[]](0x76F4, 0x7EBF)))
  )
  $results = @()
  foreach ($name in $shapes) {
    $sel = Invoke-TestUiaButton -Hwnd $Hwnd -Name $name
    if (-not $sel.ok) {
      $results += [ordered]@{ shape = $name; ok = $false; reason = $sel.reason }
      continue
    }
    Start-Sleep -Milliseconds 250
    $w = Set-TestPaintBrushWidth -Hwnd $Hwnd -SizeIndex $SizeIndex
    $results += [ordered]@{ shape = $name; ok = [bool]$w.ok; label = $w.label; reason = $w.reason }
  }
  [void](Invoke-TestUiaButton -Hwnd $Hwnd -Name $shapes[0])
  $ok = -not ($results | Where-Object { -not $_.ok })
  return [ordered]@{ ok = $ok; results = $results }
}

function Close-TestPaintDoc {
  param([string]$StateFile)
  return Close-TestAppWindow -StateFile $StateFile
}

function Open-TestBrowserWindow {
  # Reuse the user's browser profile, but require a NEW window/HWND from --new-window.
  # Never creates a dedicated profile and never closes an existing user window.
  param([string]$Url, [string]$TitleNeedle, [string]$StateFile)
  $candidates = @(
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
  )
  $exe = ''
  foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { $exe = $c; break } }
  if (-not $exe) {
    return [ordered]@{ ok = $false; hwnd = 0; pid = 0; title = ''; owned = $false; reason = 'no supported browser exe found' }
  }
  $procName = 'chrome'
  if ($exe -match 'msedge') { $procName = 'msedge' }
  return Open-TestAppWindow -Exe $exe -Arguments @('--new-window', $Url) -ProcessName $procName -TitleNeedle @($TitleNeedle) -StateFile $StateFile
}

function Close-TestBrowserWindow {
  param([string]$StateFile)
  return Close-TestAppWindow -StateFile $StateFile
}

# Image/office/sentinel helpers are optional but small; dot-source after core definitions.
try { . (Join-Path $PSScriptRoot 'image.ps1') } catch { }
try { . (Join-Path $PSScriptRoot 'office.ps1') } catch { }
try { . (Join-Path $PSScriptRoot 'sentinel.ps1') } catch { }
try { . (Join-Path $PSScriptRoot 'security-fixture.ps1') } catch { }

function Get-S4Sha256([string]$Path) {
  if (-not (Test-Path $Path)) { return '' }
  return (Get-FileHash -Algorithm SHA256 -Path $Path).Hash.ToLowerInvariant()
}

function Get-S4Sha256Shared([string]$Path) {
  # Excel keeps seed.xlsx open while the oracle runs; Get-FileHash opens without
  # FileShare.ReadWrite and fails. Hash through a shared read stream instead.
  if (-not (Test-Path $Path)) { return '' }
  try {
    $fs = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    try {
      $sha = [Security.Cryptography.SHA256]::Create()
      try { $hash = $sha.ComputeHash($fs) } finally { $sha.Dispose() }
      return ([BitConverter]::ToString($hash) -replace '-', '').ToLowerInvariant()
    } finally { $fs.Dispose() }
  } catch { return '' }
}

function Get-S4DownloadsDir {
  return (Join-Path $env:USERPROFILE 'Downloads')
}

function Test-S4PdfFile([string]$Path, [int]$MinBytes = 50000) {
  if (-not (Test-Path $Path)) { return $false }
  $fi = Get-Item $Path
  if ($fi.Length -lt $MinBytes) { return $false }
  $fs = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
  try {
    $head = New-Object byte[] ([Math]::Min(1024, $fs.Length))
    [void]$fs.Read($head, 0, $head.Length)
    $headText = [Text.Encoding]::ASCII.GetString($head)
    if ($headText.IndexOf('%PDF-') -lt 0) { return $false }
    $tailLen = [Math]::Min(4096, $fs.Length)
    $fs.Seek(-$tailLen, [IO.SeekOrigin]::End) | Out-Null
    $tail = New-Object byte[] $tailLen
    [void]$fs.Read($tail, 0, $tail.Length)
    $tailText = [Text.Encoding]::ASCII.GetString($tail)
    return ($tailText.IndexOf('%%EOF') -ge 0)
  } finally { $fs.Dispose() }
}

function Wait-TestPdfPageReady {
  # Poll the browser PDF viewer's UIA text until the target sentence is exposed.
  # Chrome's PDF viewer can report its window title before the page text is ready;
  # a title-only check would let a blank viewer pass setup (2026-11-17 t17 r1).
  param([int]$Hwnd, [string]$Needle, [int]$TimeoutSec = 20)
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  $last = 'not checked'
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  while ((Get-Date) -lt $deadline) {
    try {
      $win = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$Hwnd)
      if (-not $win) { $last = 'window not found'; Start-Sleep -Milliseconds 700; continue }
      $chunks = @()
      foreach ($ct in @([System.Windows.Automation.ControlType]::Text, [System.Windows.Automation.ControlType]::Document)) {
        try {
          $cond = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty, $ct)
          $items = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
          foreach ($it in $items) {
            try { $n = [string]$it.Current.Name; if ($n) { $chunks += $n } } catch {}
            try {
              $tp = $it.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
              if ($tp) { $t = $tp.DocumentRange.GetText(-1); if ($t) { $chunks += $t } }
            } catch {}
          }
        } catch {}
      }
      $blob = ($chunks -join "`n")
      if ($blob.IndexOf($Needle, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
        return [ordered]@{ ok = $true; reason = ''; sample = $Needle }
      }
      if ($blob.Length -gt 0) { $last = 'text present but needle not found' } else { $last = 'no text exposed' }
    } catch { $last = $_.Exception.Message }
    Start-Sleep -Milliseconds 700
  }
  return [ordered]@{ ok = $false; reason = $last; sample = '' }
}

function Get-S4NewFileCandidates([string]$Dir, [datetime]$StartedAt, [string]$Filter = '*') {
  if (-not (Test-Path $Dir)) { return @() }
  return @(Get-ChildItem -Path $Dir -Filter $Filter -File -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTimeUtc -ge $StartedAt.ToUniversalTime() } | Sort-Object LastWriteTimeUtc -Descending)
}

function Wait-S4DownloadMatchAny([string]$Dir, [datetime]$StartedAt, [string]$ExpectedHash, [string]$Filter = '*', [int]$TimeoutSec = 60) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    foreach ($f in @(Get-S4NewFileCandidates $Dir $StartedAt $Filter)) {
      if ((Get-S4Sha256 $f.FullName) -eq $ExpectedHash) { return $f }
    }
    Start-Sleep -Milliseconds 800
  }
  return $null
}

function Remove-S4MatchedDownloadsAny([string]$Dir, [datetime]$StartedAt, [string]$ExpectedHash, [string]$Filter = '*') {
  $removed = @()
  foreach ($f in @(Get-S4NewFileCandidates $Dir $StartedAt $Filter)) {
    if ((Get-S4Sha256 $f.FullName) -eq $ExpectedHash) {
      try { Remove-Item $f.FullName -Force -ErrorAction Stop; $removed += $f.FullName } catch {}
    }
  }
  return @($removed)
}

function Get-S4NewPdfCandidates([string]$Dir, [datetime]$StartedAt) {
  if (-not (Test-Path $Dir)) { return @() }
  return @(Get-ChildItem -Path $Dir -Filter '*.pdf' -File -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTimeUtc -ge $StartedAt.ToUniversalTime() } | Sort-Object LastWriteTimeUtc -Descending)
}

function Wait-S4DownloadMatch([string]$Dir, [datetime]$StartedAt, [string]$ExpectedHash, [int]$TimeoutSec = 60) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    foreach ($f in @(Get-S4NewPdfCandidates $Dir $StartedAt)) {
      if (-not (Test-S4PdfFile $f.FullName)) { continue }
      $h = Get-S4Sha256 $f.FullName
      if ($h -eq $ExpectedHash) { return $f }
    }
    Start-Sleep -Milliseconds 800
  }
  return $null
}

function Remove-S4MatchedDownloads([string]$Dir, [datetime]$StartedAt, [string]$ExpectedHash) {
  $removed = @()
  foreach ($f in @(Get-S4NewPdfCandidates $Dir $StartedAt)) {
    if (-not (Test-S4PdfFile $f.FullName)) { continue }
    if ((Get-S4Sha256 $f.FullName) -eq $ExpectedHash) {
      try { Remove-Item $f.FullName -Force -ErrorAction Stop; $removed += $f.FullName } catch {}
    }
  }
  return @($removed)
}

function Start-TestFormServer {
  param([string]$Root, [string]$ResultFile, [string]$StateFile, [string]$Mode = 'form', [string]$Fixture = '', [switch]$FailFirst)
  $node = 'node.exe'
  $c = Get-Command node -ErrorAction SilentlyContinue
  if ($c) { $node = $c.Source }
  if (-not $node -or -not (Test-Path $node)) {
    return [ordered]@{ ok = $false; reason = 'node.exe not found' }
  }
  if (Test-Path $StateFile) { Remove-Item $StateFile -Force -ErrorAction SilentlyContinue }
  $script = Join-Path $PSScriptRoot 'form-server.mjs'
  $proc = $null
  try {
    $q = { param($v) if (($v + '') -match 's') { return ('"' + $v + '"') } return ($v + '') }
    $argList = @((& $q $script), '--root', (& $q $Root), '--result', (& $q $ResultFile), '--state', (& $q $StateFile), '--mode', (& $q $Mode))
    if ($Fixture) { $argList += @('--fixture', (& $q $Fixture)) }
    if ($FailFirst) { $argList += @('--fail-first') }
    $proc = Start-Process -FilePath $node -ArgumentList $argList -PassThru -WindowStyle Hidden
  } catch {
    return [ordered]@{ ok = $false; reason = $_.Exception.Message }
  }
  $deadline = (Get-Date).AddSeconds(15)
  $json = $null
  while ((Get-Date) -lt $deadline) {
    if (Test-Path $StateFile) {
      try { $json = Get-Content $StateFile -Raw | ConvertFrom-Json } catch {}
      if ($json -and $json.port) { break }
    }
    Start-Sleep -Milliseconds 300
  }
  if (-not $json -or -not $json.port) {
    if ($proc) { try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch {} }
    return [ordered]@{ ok = $false; reason = 'form server did not become ready' }
  }
  $start = ''
  try { $start = (Get-Process -Id $proc.Id -ErrorAction Stop).StartTime.ToString('o') } catch {}
  $state = [ordered]@{
    ok = $true; pid = [int]$proc.Id; processStart = $start; port = [int]$json.port
    mode = $Mode; fixture = $Fixture
    root = $Root; result = $ResultFile; at = (Get-Date).ToString('o')
  }
  [void](Write-TestState $StateFile $state)
  return $state
}

function Stop-TestFormServer {
  param([string]$StateFile)
  $res = [ordered]@{ stopped = $false; reason = '' }
  if (-not $StateFile -or -not (Test-Path $StateFile)) { $res.stopped = $true; $res.reason = 'no state file'; return $res }
  $s = Read-TestState $StateFile
  if (-not $s -or -not $s.pid) { $res.reason = 'invalid state'; return $res }
  if (-not (Test-ProcessIdentity ([int]$s.pid) ([string]$s.processStart))) {
    $proc = Get-Process -Id ([int]$s.pid) -ErrorAction SilentlyContinue
    if (-not $proc) {
      $res.stopped = $true
      $res.reason = 'already stopped'
      return $res
    }
    $res.reason = 'pid/start-time mismatch (refusing to stop)'; return $res
  }
  try { Stop-Process -Id ([int]$s.pid) -Force -ErrorAction Stop; $res.stopped = $true } catch { $res.reason = $_.Exception.Message }
  return $res
}

function New-TestPdfFromFile {
  # Render a local HTML file to PDF with Edge/Chrome headless. Only the
  # helper-started browser process is stopped by PID.
  param([string]$HtmlPath, [string]$PdfPath)
  if (Test-Path $PdfPath) { Remove-Item $PdfPath -Force }
  $candidates = @(
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
  )
  $exe = ''
  foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { $exe = $c; break } }
  if (-not $exe) { return [ordered]@{ ok = $false; reason = 'no browser exe for PDF generation' } }
  $url = [System.Uri]::new($HtmlPath).AbsoluteUri
  $args = @('--headless=new', '--disable-gpu', '--no-pdf-header-footer', ('--print-to-pdf=' + $PdfPath), $url)
  $p = $null
  try { $p = Start-Process -FilePath $exe -ArgumentList $args -PassThru -WindowStyle Hidden } catch {
    return [ordered]@{ ok = $false; reason = $_.Exception.Message }
  }
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline) {
    if ((Test-Path $PdfPath) -and ((Get-Item $PdfPath).Length -gt 1000)) { break }
    Start-Sleep -Milliseconds 400
  }
  if ($p) { try { if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } } catch {} }
  if ((Test-Path $PdfPath) -and ((Get-Item $PdfPath).Length -gt 1000)) {
    return [ordered]@{ ok = $true; path = $PdfPath; size = (Get-Item $PdfPath).Length }
  }
  return [ordered]@{ ok = $false; reason = 'PDF not produced' }
}

function Close-OrphanTestExplorer {
  # Close ONLY Explorer windows whose title contains a task-unique needle AND
  # whose UIA list contains at least one expected test file. Used to recover from
  # a setup that failed before it could write a state file.
  param([string]$TitleNeedle, [string[]]$Files = @())
  Add-Type -AssemblyName UIAutomationClient
  $closed = 0
  foreach ($w in @(Find-WindowsByTitle $TitleNeedle)) {
    $root = $null
    try { $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$w.hwnd) } catch {}
    if (-not $root) { continue }
    $names = @()
    try {
      $cond = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::ListItem)
      foreach ($e in $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)) {
        try { $names += [string]$e.Current.Name } catch {}
      }
    } catch {}
    $proof = $false
    foreach ($f in @($Files)) { if ($names -contains [string]$f) { $proof = $true; break } }
    if (-not $proof) { continue }
    if (-not (Close-WindowUia ([int]$w.hwnd))) {
      [void][S4W32]::PostMessage([IntPtr]$w.hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
    }
    Start-Sleep -Milliseconds 500
    if (-not (Test-WindowAlive ([int]$w.hwnd))) { $closed++ }
  }
  return $closed
}
