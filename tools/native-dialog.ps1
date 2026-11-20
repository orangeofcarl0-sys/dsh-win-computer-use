# Native Win32 standard-dialog scanner/clicker. No UIA, no file writes.
# ASCII-only on purpose: PowerShell 5.1 parses BOM-less scripts as ANSI.
# Usage:
#   powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File native-dialog.ps1 -Action scan -Pid <pid> -Hwnd <hwnd>
#   powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File native-dialog.ps1 -Action click -Pid <pid> -Hwnd <hwnd> -ControlId <id> -ClassName <class> -LabelB64 <base64>
# Output: one JSON line on stdout. Expected failures return ok=false with error.
param(
  [Parameter(Mandatory = $true)][ValidateSet('scan', 'click')][string]$Action,
  [Parameter(Mandatory = $true)][Alias('Pid')][int]$TargetPid,
  [Parameter(Mandatory = $true)][long]$Hwnd,
  [int]$ControlId = 0,
  [string]$ClassName = '',
  [string]$LabelB64 = ''
)

$ErrorActionPreference = 'Stop'
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8

  Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class S4DlgNative {
  public delegate bool EnumProc(IntPtr h, IntPtr lp);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextLengthW(IntPtr h);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] public static extern IntPtr GetLastActivePopup(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int index);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr h, uint msg, IntPtr w, IntPtr l);
}
"@

  function Get-WinText([IntPtr]$h) {
    $len = 0
    try { $len = [S4DlgNative]::GetWindowTextLengthW($h) } catch { $len = 0 }
    $cap = [Math]::Max(512, $len + 2)
    $sb = New-Object System.Text.StringBuilder $cap
    [void][S4DlgNative]::GetWindowTextW($h, $sb, $sb.Capacity)
    return $sb.ToString()
  }

  function Get-WinClass([IntPtr]$h) {
    $sb = New-Object System.Text.StringBuilder 256
    [void][S4DlgNative]::GetClassNameW($h, $sb, $sb.Capacity)
    return $sb.ToString()
  }

  function To-B64([string]$s) {
    if ($null -eq $s) { return '' }
    return [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($s))
  }

  function Normalize-Label([string]$s) {
    if ($null -eq $s) { return '' }
    return ($s -replace '&', '' -replace '\s+', ' ').Trim().ToLowerInvariant()
  }

  function Get-DialogInfo([IntPtr]$Dialog) {
    $cls = Get-WinClass $Dialog
    $title = Get-WinText $Dialog
    $isDialog = ($cls -eq '#32770')

    $owner = [S4DlgNative]::GetWindow($Dialog, 4)  # GW_OWNER
    $ownerPid = 0
    $ownerEnabled = $false
    $lastPopup = [IntPtr]::Zero
    if ($owner -ne [IntPtr]::Zero) {
      [uint32]$op = 0
      [void][S4DlgNative]::GetWindowThreadProcessId($owner, [ref]$op)
      $ownerPid = [int]$op
      try { $ownerEnabled = [S4DlgNative]::IsWindowEnabled($owner) } catch { $ownerEnabled = $false }
      try { $lastPopup = [S4DlgNative]::GetLastActivePopup($owner) } catch { $lastPopup = [IntPtr]::Zero }
    }
    $fg = [S4DlgNative]::GetForegroundWindow()

    $sameOwner = ($owner -ne [IntPtr]::Zero -and $ownerPid -eq $TargetPid)
    $modal = $false
    $modalProof = 'none'
    if ($isDialog) {
      if ($sameOwner -and (-not $ownerEnabled)) { $modal = $true; $modalProof = 'owner-disabled' }
      elseif ($sameOwner -and $fg -eq $Dialog) { $modal = $true; $modalProof = 'foreground' }
      elseif ($sameOwner -and $lastPopup -eq $Dialog) { $modal = $true; $modalProof = 'last-popup' }
    }

    $script:children = @()
    $cb = [S4DlgNative+EnumProc]{
      param($h, $lp)
      $c = Get-WinClass $h
      if ($c -like '*BUTTON*' -or $c -like '*STATIC*' -or $c -like '*EDIT*') {
        $r = New-Object S4DlgNative+RECT
        [void][S4DlgNative]::GetWindowRect($h, [ref]$r)
        $style = 0
        try { $style = [S4DlgNative]::GetWindowLong($h, -16) } catch { $style = 0 }
        $script:children += [PSCustomObject]@{
          H = $h
          Class = $c
          Text = (Get-WinText $h)
          Id = [S4DlgNative]::GetDlgCtrlID($h)
          Enabled = [S4DlgNative]::IsWindowEnabled($h)
          Visible = [S4DlgNative]::IsWindowVisible($h)
          Style = $style
          Left = $r.Left
          Top = $r.Top
          Width = ($r.Right - $r.Left)
          Height = ($r.Bottom - $r.Top)
        }
      }
      return $true
    }
    [void][S4DlgNative]::EnumChildWindows($Dialog, $cb, [IntPtr]::Zero)

    $buttons = @()
    $statics = @()
    $hasEdit = $false
    foreach ($c in @($script:children)) {
      if ($c.Class -like '*EDIT*') { $hasEdit = $true; continue }
      if ($c.Class -like '*STATIC*') {
        if ($c.Text) { $statics += [string]$c.Text }
        continue
      }
      if ($c.Class -like '*BUTTON*') {
        $buttons += [ordered]@{
          hwnd = $c.H.ToInt64()
          id = [int]$c.Id
          className = [string]$c.Class
          label = [string]$c.Text
          labelB64 = (To-B64 ([string]$c.Text))
          rect = [ordered]@{
            x = [int]$c.Left
            y = [int]$c.Top
            w = [int]$c.Width
            h = [int]$c.Height
          }
          enabled = [bool]$c.Enabled
          visible = [bool]$c.Visible
          default = ((([int]$c.Style) -band 0x1) -ne 0)
        }
      }
    }
    $staticText = ($statics -join "`n")
    $dr = New-Object S4DlgNative+RECT
    [void][S4DlgNative]::GetWindowRect($Dialog, [ref]$dr)
    return [ordered]@{
      ok = $true
      pid = $TargetPid
      hwnd = $Hwnd
      isDialog = $isDialog
      modal = $modal
      modalProof = $modalProof
      className = $cls
      title = $title
      rect = [ordered]@{
        x = [int]$dr.Left
        y = [int]$dr.Top
        w = [int]($dr.Right - $dr.Left)
        h = [int]($dr.Bottom - $dr.Top)
      }
      ownerHwnd = $owner.ToInt64()
      ownerPid = $ownerPid
      ownerEnabled = $ownerEnabled
      foreground = $fg.ToInt64()
      buttons = $buttons
      staticText = $staticText
      staticTextB64 = (To-B64 $staticText)
      hasEdit = $hasEdit
    }
  }

  $dialog = [IntPtr]$Hwnd
  if (-not [S4DlgNative]::IsWindow($dialog)) {
    $out = [ordered]@{ ok = $false; error = 'window_not_found' }
    [Console]::Out.WriteLine((ConvertTo-Json $out -Compress -Depth 6))
    exit 0
  }

  [uint32]$actualPid = 0
  [void][S4DlgNative]::GetWindowThreadProcessId($dialog, [ref]$actualPid)
  if ([int]$actualPid -ne $TargetPid) {
    $out = [ordered]@{ ok = $false; error = 'pid_mismatch' }
    [Console]::Out.WriteLine((ConvertTo-Json $out -Compress -Depth 6))
    exit 0
  }

  $info = Get-DialogInfo $dialog

  if ($Action -eq 'scan') {
    [Console]::Out.WriteLine((ConvertTo-Json $info -Compress -Depth 6))
    exit 0
  }

  if (-not $info.isDialog) {
    $out = [ordered]@{ ok = $false; error = 'not_dialog'; className = [string]$info.className }
    [Console]::Out.WriteLine((ConvertTo-Json $out -Compress -Depth 6))
    exit 0
  }
  if (-not $info.modal) {
    $out = [ordered]@{ ok = $false; error = 'not_modal'; modalProof = [string]$info.modalProof }
    [Console]::Out.WriteLine((ConvertTo-Json $out -Compress -Depth 6))
    exit 0
  }

  $wantLabel = ''
  if ($LabelB64) {
    try { $wantLabel = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($LabelB64)) } catch { $wantLabel = '' }
  }

  $match = $null
  foreach ($b in @($info.buttons)) {
    if ([int]$b.id -ne $ControlId) { continue }
    if ($ClassName -and ([string]$b.className -notlike "*$ClassName*")) { continue }
    if ($wantLabel -and ((Normalize-Label ([string]$b.label)) -ne (Normalize-Label $wantLabel))) { continue }
    if (-not [bool]$b.enabled -or -not [bool]$b.visible) { continue }
    $match = $b
    break
  }
  if ($null -eq $match) {
    $out = [ordered]@{ ok = $false; error = 'button_not_found'; controlId = $ControlId; label = $wantLabel }
    [Console]::Out.WriteLine((ConvertTo-Json $out -Compress -Depth 6))
    exit 0
  }

  $posted = [S4DlgNative]::PostMessageW([IntPtr]$match.hwnd, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)  # BM_CLICK
  if (-not $posted) {
    $out = [ordered]@{ ok = $false; error = 'post_message_failed'; controlId = $ControlId }
    [Console]::Out.WriteLine((ConvertTo-Json $out -Compress -Depth 6))
    exit 0
  }
  Start-Sleep -Milliseconds 350
  $alive = [S4DlgNative]::IsWindow($dialog)
  $out = [ordered]@{
    ok = $true
    method = 'BM_CLICK'
    controlId = $ControlId
    dialogAlive = [bool]$alive
    error = ''
  }
  [Console]::Out.WriteLine((ConvertTo-Json $out -Compress -Depth 6))
  exit 0
} catch {
  $out = [ordered]@{ ok = $false; error = [string]$_.Exception.Message }
  try { [Console]::Out.WriteLine((ConvertTo-Json $out -Compress -Depth 6)) } catch {}
  exit 0
}
