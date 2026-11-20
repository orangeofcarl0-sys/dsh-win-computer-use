param(
  [string]$Action,
  [Alias('Pid')][int]$TargetPid,
  [long]$Hwnd,
  [string]$PathB64,
  [int]$CommandId,
  [string]$TitleB64
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
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr hwnd, StringBuilder text, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr hwnd, StringBuilder text, int max);
    [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr hwnd);
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

    static string ClassOf(IntPtr hwnd)
    {
        StringBuilder sb = new StringBuilder(256);
        GetClassNameW(hwnd, sb, sb.Capacity);
        return sb.ToString();
    }

    static string TitleOf(IntPtr hwnd)
    {
        StringBuilder sb = new StringBuilder(512);
        GetWindowTextW(hwnd, sb, sb.Capacity);
        return sb.ToString();
    }

    static int MenuCount(IntPtr hwnd)
    {
        IntPtr menu = GetMenu(hwnd);
        return menu == IntPtr.Zero ? 0 : GetMenuItemCount(menu);
    }

    static Dictionary<string, object> WindowInfo(IntPtr hwnd, int pid)
    {
        Dictionary<string, object> d = D();
        d["hwnd"] = hwnd.ToInt64();
        d["pid"] = pid;
        d["visible"] = IsWindowVisible(hwnd);
        d["enabled"] = IsWindowEnabled(hwnd);
        d["class"] = ClassOf(hwnd);
        d["title"] = TitleOf(hwnd);
        d["menu"] = GetMenu(hwnd).ToInt64();
        d["menuCount"] = MenuCount(hwnd);
        return d;
    }

    static List<Dictionary<string, object>> CollectCandidates(int pid, string titleFilter)
    {
        List<Dictionary<string, object>> list = new List<Dictionary<string, object>>();
        EnumWindows(delegate(IntPtr h, IntPtr l)
        {
            uint p;
            GetWindowThreadProcessId(h, out p);
            if ((int)p != pid) return true;
            bool menu = GetMenu(h) != IntPtr.Zero;
            bool titleMatch = String.IsNullOrEmpty(titleFilter) || Norm(TitleOf(h)) == Norm(titleFilter);
            if (IsWindowVisible(h) && (menu || titleMatch)) list.Add(WindowInfo(h, pid));
            return true;
        }, IntPtr.Zero);
        return list;
    }

    static string CheckWindow(IntPtr hwnd, int expectedPid)
    {
        if (hwnd == IntPtr.Zero || !IsWindow(hwnd)) return "window_not_found";
        uint pid;
        GetWindowThreadProcessId(hwnd, out pid);
        if (expectedPid > 0 && (int)pid != expectedPid) return "pid_mismatch";
        return "";
    }

    // The driver window_id is normally the HWND on Windows, but may be stale or point at a child/owner.
    // Auto-resolve only a unique visible top-level menu window of the same pid (optionally title-matched).
    static string ResolveHwnd(ref IntPtr hwnd, int expectedPid, string titleFilter)
    {
        if (hwnd != IntPtr.Zero && IsWindow(hwnd))
        {
            uint pid;
            GetWindowThreadProcessId(hwnd, out pid);
            if (expectedPid > 0 && (int)pid != expectedPid) return "pid_mismatch";
            if (GetMenu(hwnd) != IntPtr.Zero) return "";
            // Driver window ids may point at a child/owner; try the top-level root.
            IntPtr root = GetAncestor(hwnd, 2);
            if (root != IntPtr.Zero && root != hwnd)
            {
                uint rpid;
                GetWindowThreadProcessId(root, out rpid);
                if ((expectedPid <= 0 || (int)rpid == expectedPid) && GetMenu(root) != IntPtr.Zero)
                {
                    hwnd = root;
                    return "";
                }
            }
        }
        List<Dictionary<string, object>> candidates = CollectCandidates(expectedPid, titleFilter);
        List<Dictionary<string, object>> menuCandidates = new List<Dictionary<string, object>>();
        foreach (Dictionary<string, object> c in candidates)
        {
            if ((long)c["menu"] != 0) menuCandidates.Add(c);
        }
        if (menuCandidates.Count == 1)
        {
            hwnd = new IntPtr((long)menuCandidates[0]["hwnd"]);
            return "";
        }
        if (menuCandidates.Count > 1) return "ambiguous_window";
        if (hwnd != IntPtr.Zero && IsWindow(hwnd)) return "no_hmenu";
        return "window_not_found";
    }

    static Dictionary<string, object> WithDiag(Dictionary<string, object> d, IntPtr input, IntPtr resolved, int pid)
    {
        d["hwndInput"] = input.ToInt64();
        d["hwndResolved"] = resolved.ToInt64();
        d["pidInput"] = pid;
        uint actual = 0;
        if (input != IntPtr.Zero && IsWindow(input)) GetWindowThreadProcessId(input, out actual);
        d["pidActual"] = (int)actual;
        d["isWindow"] = input != IntPtr.Zero && IsWindow(input);
        d["candidates"] = CollectCandidates(pid, "");
        return d;
    }

    static Dictionary<string, object> ResolvePath(IntPtr hwnd, int expectedPid, string[] parts, string titleFilter)
    {
        IntPtr input = hwnd;
        string bad = ResolveHwnd(ref hwnd, expectedPid, titleFilter);
        if (bad.Length > 0)
        {
            Dictionary<string, object> f = Fail(bad, bad);
            return WithDiag(f, input, hwnd, expectedPid);
        }
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
            d["hwnd"] = hwnd.ToInt64();
            d["commandId"] = (int)foundId;
            d["index"] = foundIndex;
            d["path"] = parts;
            return d;
        }
        return Fail("path_not_found", "empty path");
    }

    public static Dictionary<string, object> Resolve(long hwndL, int expectedPid, string[] parts, string titleFilter)
    {
        return ResolvePath(new IntPtr(hwndL), expectedPid, parts, titleFilter);
    }

    public static Dictionary<string, object> Invoke(long hwndL, int expectedPid, string[] parts, int commandId, string titleFilter)
    {
        IntPtr input = new IntPtr(hwndL);
        IntPtr hwnd = input;
        Dictionary<string, object> resolved = ResolvePath(hwnd, expectedPid, parts, titleFilter);
        if (!(bool)resolved["ok"]) return resolved;
        hwnd = new IntPtr((long)resolved["hwnd"]);
        string bad = CheckWindow(hwnd, expectedPid);
        if (bad.Length > 0) return WithDiag(Fail(bad, bad), input, hwnd, expectedPid);
        int currentId = (int)resolved["commandId"];
        if (currentId != commandId) return WithDiag(Fail("stale_command", "menu changed between resolve and invoke"), input, hwnd, expectedPid);
        if (!PostMessageW(hwnd, WM_COMMAND, new IntPtr(commandId), IntPtr.Zero))
            return WithDiag(Fail("post_message_failed", "PostMessage(WM_COMMAND) failed"), input, hwnd, expectedPid);
        Dictionary<string, object> d = Ok();
        d["method"] = "WM_COMMAND";
        d["hwnd"] = hwnd.ToInt64();
        d["commandId"] = commandId;
        d["path"] = parts;
        return d;
    }

    public static Dictionary<string, object> Inspect(long hwndL, int expectedPid, string titleFilter)
    {
        IntPtr input = new IntPtr(hwndL);
        IntPtr resolved = input;
        string code = ResolveHwnd(ref resolved, expectedPid, titleFilter);
        Dictionary<string, object> d = Ok();
        d["code"] = code;
        d["resolvedOk"] = code.Length == 0;
        d["autoResolved"] = resolved != input;
        d["hwndInput"] = input.ToInt64();
        d["hwndResolved"] = resolved.ToInt64();
        d["pidInput"] = expectedPid;
        uint actual = 0;
        if (input != IntPtr.Zero && IsWindow(input)) GetWindowThreadProcessId(input, out actual);
        d["pidActual"] = (int)actual;
        d["isWindow"] = input != IntPtr.Zero && IsWindow(input);
        d["visible"] = input != IntPtr.Zero && IsWindowVisible(input);
        d["enabled"] = input != IntPtr.Zero && IsWindowEnabled(input);
        d["class"] = input != IntPtr.Zero && IsWindow(input) ? ClassOf(input) : "";
        d["title"] = input != IntPtr.Zero && IsWindow(input) ? TitleOf(input) : "";
        d["menu"] = input != IntPtr.Zero && IsWindow(input) ? GetMenu(input).ToInt64() : 0;
        d["menuCount"] = input != IntPtr.Zero && IsWindow(input) ? MenuCount(input) : 0;
        IntPtr root = input != IntPtr.Zero && IsWindow(input) ? GetAncestor(input, 2) : IntPtr.Zero;
        d["root"] = root.ToInt64();
        d["rootMenu"] = root != IntPtr.Zero ? GetMenu(root).ToInt64() : 0;
        d["candidates"] = CollectCandidates(expectedPid, "");
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
    $title = ''
    if (-not [string]::IsNullOrWhiteSpace($TitleB64)) {
        $titleBytes = [Convert]::FromBase64String($TitleB64)
        $title = [System.Text.Encoding]::UTF8.GetString($titleBytes)
    }
    if ($Action -eq 'inspect') {
        Write-Result ([DshNativeMenu]::Inspect([long]$Hwnd, [int]$TargetPid, $title))
    }
    else {
        if ([string]::IsNullOrWhiteSpace($PathB64)) { throw "PathB64 is required" }
        $bytes = [Convert]::FromBase64String($PathB64)
        $jsonText = [System.Text.Encoding]::UTF8.GetString($bytes)
        $parsed = $jsonText | ConvertFrom-Json
        $path = @()
        foreach ($p in @($parsed)) { $path += [string]$p }
        if ($path.Length -eq 0) { throw "menu path is empty" }
        if ($Action -eq 'resolve') {
            Write-Result ([DshNativeMenu]::Resolve([long]$Hwnd, [int]$TargetPid, [string[]]$path, $title))
        }
        elseif ($Action -eq 'invoke') {
            Write-Result ([DshNativeMenu]::Invoke([long]$Hwnd, [int]$TargetPid, [string[]]$path, [int]$CommandId, $title))
        }
        else {
            Write-Result @{ ok = $false; code = 'bad_action'; error = "unknown action: $Action" }
        }
    }
}
catch {
    Write-Result @{ ok = $false; code = 'exception'; error = $_.Exception.Message }
}
