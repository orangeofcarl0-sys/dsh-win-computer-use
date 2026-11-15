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
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
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

function Dismiss-TestSavePrompt([int]$Hwnd) {
  # Click "Don't Save" (localized via code points) on a save-changes dialog owned by
  # the test HWND. Only called after the tab allowlist has proven every tab is a
  # test file; user tabs never reach this path.
  $noSave = -join @([char]0x4E0D, [char]0x4FDD, [char]0x5B58)
  foreach ($d in @(Get-OwnedWindows $Hwnd)) {
    try {
      $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$d.hwnd)
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
  param([int[]]$ProtectHwnd = @())
  if (-not $script:TestNotepadProtected) { $script:TestNotepadProtected = @{} }
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
    $allowed = $true
    foreach ($l in $labels) {
      if ($script:TestNotepadLabels -notcontains $l) { $allowed = $false; break }
    }
    $hasSeed = $false
    foreach ($l in $labels) {
      if ($script:TestNotepadSeeds -contains $l) { $hasSeed = $true; break }
    }

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
  # window contains only unmodified test tabs, so an owned dialog cannot be holding
  # user data. Without this, WM_CLOSE to the main window is ignored and the dialog
  # survives the run (2026-11-15 t01 timeout left a Save As dialog on screen).
  for ($pass = 0; $pass -lt 3; $pass++) {
    $owned = @(Get-OwnedWindows ([int]$s.hwnd))
    if ($owned.Count -eq 0) { break }
    foreach ($d in $owned) {
      if (-not (Close-WindowUia ([int]$d.hwnd))) {
        [void][S4W32]::PostMessage([IntPtr]$d.hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
      }
    }
    $res.dialogsClosed = [int]$res.dialogsClosed + $owned.Count
    Start-Sleep -Milliseconds 500
  }
  $stillOwned = @(Get-OwnedWindows ([int]$s.hwnd))
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
    if (-not (Dismiss-TestSavePrompt ([int]$s.hwnd))) { break }
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
  if (-not (Close-WindowUia ([int]$s.hwnd))) {
    [void][S4W32]::PostMessage([IntPtr]$s.hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
  }
  Start-Sleep -Milliseconds 800
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
    if (-not (Dismiss-TestSavePrompt ([int]$s.hwnd))) { break }
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
