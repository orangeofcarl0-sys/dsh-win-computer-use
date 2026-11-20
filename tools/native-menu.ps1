param(
  [string]$Action,
  [Alias('Pid')][int]$TargetPid,
  [long]$Hwnd,
  [string]$PathB64,
  [int]$CommandId
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;

public static class DshNativeMenu
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct MENUITEMINFO
    {
        public uint cbSize;
        public uint fMask;
        public uint fType;
        public uint fState;
        public uint wID;
        public IntPtr hSubMenu;
        public IntPtr hbmpChecked;
        public IntPtr hbmpUnchecked;
        public IntPtr dwItemData;
        public IntPtr dwTypeData;
        public uint cch;
        public IntPtr hbmpItem;
    }

    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
    delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] static extern IntPtr GetMenu(IntPtr hwnd);
    [DllImport("user32.dll")] static extern int GetMenuItemCount(IntPtr menu);
    [DllImport("user32.dll")] static extern IntPtr GetSubMenu(IntPtr menu, int pos);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetMenuItemInfoW(IntPtr menu, uint item, bool byPosition, ref MENUITEMINFO info);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetMenuStringW(IntPtr menu, uint item, StringBuilder text, int max, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool PostMessageW(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);

    const uint MIIM_STATE = 0x00000001;
    const uint MIIM_ID = 0x00000002;
    const uint MIIM_SUBMENU = 0x00000004;
    const uint MIIM_FTYPE = 0x00000100;
    const uint MFT_BITMAP = 0x00000004;
    const uint MFT_OWNERDRAW = 0x00000100;
    const uint MFT_SEPARATOR = 0x00000800;
    const uint MFS_GRAYED = 0x00000003;
    const uint MF_BYPOSITION = 0x00000400;
    const uint WM_COMMAND = 0x0111;

    static Dictionary<string, object> D() { return new Dictionary<string, object>(); }

    static Dictionary<string, object> Ok()
    {
        Dictionary<string, object> d = D();
        d["ok"] = true;
        return d;
    }

    static Dictionary<string, object> Fail(string code, string error)
    {
        Dictionary<string, object> d = D();
        d["ok"] = false;
        d["code"] = code;
        d["error"] = String.IsNullOrEmpty(error) ? code : error;
        return d;
    }

    static string Norm(string text)
    {
        if (text == null) return "";
        string s = text.Replace("&", "");
        s = Regex.Replace(s, "\\s+", " ").Trim();
        return s;
    }

    static string CheckWindow(IntPtr hwnd, int expectedPid)
    {
        if (hwnd == IntPtr.Zero || !IsWindow(hwnd)) return "window_not_found";
        uint pid;
        GetWindowThreadProcessId(hwnd, out pid);
        if (expectedPid > 0 && (int)pid != expectedPid) return "pid_mismatch";
        return "";
    }

    // The driver window_id is not guaranteed to be a HWND; auto-resolve only a unique visible top-level menu window of the same pid.
    static int FindMenuWindow(int pid, out IntPtr found)
    {
        List<IntPtr> windows = new List<IntPtr>();
        EnumWindows(delegate(IntPtr h, IntPtr l)
        {
            uint p;
            GetWindowThreadProcessId(h, out p);
            if ((int)p == pid && IsWindowVisible(h) && GetMenu(h) != IntPtr.Zero) windows.Add(h);
            return true;
        }, IntPtr.Zero);
        found = windows.Count == 1 ? windows[0] : IntPtr.Zero;
        return windows.Count;
    }

    static string ResolveHwnd(ref IntPtr hwnd, int expectedPid)
    {
        if (hwnd != IntPtr.Zero && IsWindow(hwnd))
        {
            if (GetMenu(hwnd) != IntPtr.Zero) return "";
            // Driver window ids may point at a child/owner; try the top-level root.
            IntPtr root = GetAncestor(hwnd, 2);
            if (root != IntPtr.Zero && root != hwnd && GetMenu(root) != IntPtr.Zero) { hwnd = root; return ""; }
        }
        IntPtr found;
        int count = FindMenuWindow(expectedPid, out found);
        if (count == 1) { hwnd = found; return ""; }
        if (count > 1) return "ambiguous_window";
        return "window_not_found";
    }

    static Dictionary<string, object> ResolvePath(IntPtr hwnd, int expectedPid, string[] parts)
    {
        string bad = ResolveHwnd(ref hwnd, expectedPid);
        if (bad.Length > 0) return Fail(bad, bad);
        IntPtr menu = GetMenu(hwnd);
        if (menu == IntPtr.Zero) return Fail("no_hmenu", "target has no standard HMENU (WinForms MenuStrip/WPF/WinUI are not supported)");
        IntPtr current = menu;
        for (int level = 0; level < parts.Length; level++)
        {
            string want = Norm(parts[level]);
            int count = GetMenuItemCount(current);
            if (count <= 0) return Fail("path_not_found", "menu has no items");
            int matches = 0;
            int foundIndex = -1;
            uint foundId = 0;
            uint foundState = 0;
            IntPtr foundSub = IntPtr.Zero;
            for (int i = 0; i < count; i++)
            {
                MENUITEMINFO mii = new MENUITEMINFO();
                mii.cbSize = (uint)Marshal.SizeOf(typeof(MENUITEMINFO));
                mii.fMask = MIIM_STATE | MIIM_ID | MIIM_SUBMENU | MIIM_FTYPE;
                if (!GetMenuItemInfoW(current, (uint)i, true, ref mii)) continue;
                if ((mii.fType & MFT_SEPARATOR) != 0) continue;
                if ((mii.fType & (MFT_OWNERDRAW | MFT_BITMAP)) != 0) continue;
                StringBuilder sb = new StringBuilder(512);
                int len = GetMenuStringW(current, (uint)i, sb, sb.Capacity, MF_BYPOSITION);
                if (len <= 0) continue;
                if (Norm(sb.ToString()) != want) continue;
                matches++;
                foundIndex = i;
                foundId = mii.wID;
                foundState = mii.fState;
                foundSub = mii.hSubMenu;
            }
            if (matches == 0) return Fail("path_not_found", "segment not found: " + parts[level]);
            if (matches > 1) return Fail("ambiguous", "multiple menu items match: " + parts[level]);
            bool last = level == parts.Length - 1;
            if (!last)
            {
                if (foundSub == IntPtr.Zero) return Fail("path_not_found", "item has no submenu: " + parts[level]);
                current = foundSub;
                continue;
            }
            if (foundSub != IntPtr.Zero) return Fail("item_not_command", "final item opens a submenu; this backend only invokes leaf commands");
            if ((foundState & MFS_GRAYED) != 0) return Fail("disabled", "menu item is disabled: " + parts[level]);
            if (foundId == 0 || foundId > 0xFFFF) return Fail("bad_command_id", "menu command id out of range");
            Dictionary<string, object> d = Ok();
            d["commandId"] = (int)foundId;
            d["index"] = foundIndex;
            d["path"] = parts;
            return d;
        }
        return Fail("path_not_found", "empty path");
    }

    public static Dictionary<string, object> Resolve(long hwndL, int expectedPid, string[] parts)
    {
        return ResolvePath(new IntPtr(hwndL), expectedPid, parts);
    }

    public static Dictionary<string, object> Invoke(long hwndL, int expectedPid, string[] parts, int commandId)
    {
        IntPtr hwnd = new IntPtr(hwndL);
        string bad = CheckWindow(hwnd, expectedPid);
        if (bad.Length > 0) return Fail(bad, bad);
        Dictionary<string, object> resolved = ResolvePath(hwnd, expectedPid, parts);
        if (!(bool)resolved["ok"]) return resolved;
        int currentId = (int)resolved["commandId"];
        if (currentId != commandId) return Fail("stale_command", "menu changed between resolve and invoke");
        if (!PostMessageW(hwnd, WM_COMMAND, new IntPtr(commandId), IntPtr.Zero))
            return Fail("post_message_failed", "PostMessage(WM_COMMAND) failed");
        Dictionary<string, object> d = Ok();
        d["method"] = "WM_COMMAND";
        d["commandId"] = commandId;
        d["path"] = parts;
        return d;
    }
}
'@

function Write-Result($value) {
    $json = $value | ConvertTo-Json -Compress -Depth 8
    [Console]::Out.WriteLine($json)
    [Console]::Out.Flush()
}

try {
    if ([string]::IsNullOrWhiteSpace($PathB64)) { throw "PathB64 is required" }
    $bytes = [Convert]::FromBase64String($PathB64)
    $jsonText = [System.Text.Encoding]::UTF8.GetString($bytes)
    $parsed = $jsonText | ConvertFrom-Json
    $path = @()
    foreach ($p in @($parsed)) { $path += [string]$p }
    if ($path.Length -eq 0) { throw "menu path is empty" }
    if ($Action -eq 'resolve') {
        Write-Result ([DshNativeMenu]::Resolve([long]$Hwnd, [int]$TargetPid, [string[]]$path))
    }
    elseif ($Action -eq 'invoke') {
        Write-Result ([DshNativeMenu]::Invoke([long]$Hwnd, [int]$TargetPid, [string[]]$path, [int]$CommandId))
    }
    else {
        Write-Result @{ ok = $false; code = 'bad_action'; error = "unknown action: $Action" }
    }
}
catch {
    Write-Result @{ ok = $false; code = 'exception'; error = $_.Exception.Message }
}
