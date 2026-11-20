param(
  [string]$Action,
  [Alias('Pid')][int]$TargetPid,
  [long]$Hwnd,
  [string]$TitleB64,
  [string]$LabelB64,
  [int]$ScreenX,
  [int]$ScreenY
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;

public static class DshNativeButton
{
    [StructLayout(LayoutKind.Sequential)]
    struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
    delegate bool EnumChildProc(IntPtr hwnd, IntPtr lParam);

    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr hwnd);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr hwnd, StringBuilder text, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr hwnd, StringBuilder text, int max);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hwnd, int index);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumChildProc cb, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool PostMessageW(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);

    const uint BM_CLICK = 0x00F5;
    const int GWL_STYLE = -16;
    const int BS_TYPEMASK = 0x0000000F;
    const int BS_PUSHBUTTON = 0x00000000;
    const int BS_DEFPUSHBUTTON = 0x00000001;
    const int BS_OWNERDRAW = 0x0000000B;

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

    static Dictionary<string, object> RectOf(IntPtr hwnd)
    {
        RECT r;
        GetWindowRect(hwnd, out r);
        Dictionary<string, object> d = D();
        d["left"] = r.Left;
        d["top"] = r.Top;
        d["right"] = r.Right;
        d["bottom"] = r.Bottom;
        d["width"] = r.Right - r.Left;
        d["height"] = r.Bottom - r.Top;
        return d;
    }

    static bool IsStandardButtonClass(string cls)
    {
        if (cls == "Button") return true;
        return cls.StartsWith("WindowsForms10.BUTTON", StringComparison.OrdinalIgnoreCase);
    }

    static int ResolveRoot(ref IntPtr root, int expectedPid, string title, out string code)
    {
        code = "";
        List<IntPtr> candidates = new List<IntPtr>();
        if (root != IntPtr.Zero && IsWindow(root))
        {
            uint pid;
            GetWindowThreadProcessId(root, out pid);
            if (expectedPid > 0 && (int)pid != expectedPid) { code = "pid_mismatch"; return 0; }
            IntPtr top = GetAncestor(root, 2);
            if (top != IntPtr.Zero && top != root)
            {
                uint tpid;
                GetWindowThreadProcessId(top, out tpid);
                if (expectedPid <= 0 || (int)tpid == expectedPid) root = top;
            }
            if (!String.IsNullOrEmpty(title) && Norm(title) != Norm(TitleOf(root))) { code = "window_not_found"; return 0; }
            if (!IsWindowEnabled(root)) { code = "owner_disabled"; return 0; }
            return 1;
        }
        EnumWindows(delegate(IntPtr h, IntPtr l)
        {
            uint pid;
            GetWindowThreadProcessId(h, out pid);
            if ((int)pid != expectedPid || !IsWindowVisible(h)) return true;
            if (!String.IsNullOrEmpty(title) && Norm(title) != Norm(TitleOf(h))) return true;
            candidates.Add(h);
            return true;
        }, IntPtr.Zero);
        if (candidates.Count == 0) { code = "window_not_found"; return 0; }
        if (candidates.Count > 1) { code = "ambiguous_window"; return candidates.Count; }
        root = candidates[0];
        if (!IsWindowEnabled(root)) { code = "owner_disabled"; return 0; }
        return 1;
    }

    public static Dictionary<string, object> Trigger(long hwndL, int expectedPid, string title, string label, int sx, int sy)
    {
        try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { try { SetProcessDPIAware(); } catch { } }
        IntPtr input = new IntPtr(hwndL);
        IntPtr root = input;
        string code;
        int rootCount = ResolveRoot(ref root, expectedPid, title, out code);
        if (rootCount == 0)
        {
            Dictionary<string, object> f = Fail(code, code);
            f["hwndInput"] = input.ToInt64();
            f["root"] = root.ToInt64();
            return f;
        }
        if (rootCount > 1)
        {
            Dictionary<string, object> f = Fail(code, code);
            f["hwndInput"] = input.ToInt64();
            return f;
        }
        List<IntPtr> matches = new List<IntPtr>();
        List<Dictionary<string, object>> candidates = new List<Dictionary<string, object>>();
        List<Dictionary<string, object>> children = new List<Dictionary<string, object>>();
        string want = Norm(label);
        EnumChildWindows(root, delegate(IntPtr h, IntPtr l)
        {
            string cls = ClassOf(h);
            Dictionary<string, object> child = D();
            child["hwnd"] = h.ToInt64();
            child["class"] = cls;
            child["label"] = TitleOf(h);
            child["style"] = GetWindowLong(h, GWL_STYLE);
            child["visible"] = IsWindowVisible(h);
            child["enabled"] = IsWindowEnabled(h);
            child["rect"] = RectOf(h);
            children.Add(child);
            if (!IsStandardButtonClass(cls)) return true;
            int style = GetWindowLong(h, GWL_STYLE);
            int type = style & BS_TYPEMASK;
            // Plain Win32 Button uses PUSHBUTTON/DEFPUSHBUTTON; WinForms Button is owner-drawn by design.
            bool winforms = cls.StartsWith("WindowsForms10.BUTTON", StringComparison.OrdinalIgnoreCase);
            if (type != BS_PUSHBUTTON && type != BS_DEFPUSHBUTTON && !(winforms && type == BS_OWNERDRAW)) return true;
            if (!IsWindowVisible(h) || !IsWindowEnabled(h)) return true;
            string text = TitleOf(h);
            if (Norm(text) != want) return true;
            RECT r;
            GetWindowRect(h, out r);
            Dictionary<string, object> info = D();
            info["hwnd"] = h.ToInt64();
            info["class"] = cls;
            info["label"] = text;
            info["rect"] = RectOf(h);
            info["containsPoint"] = sx >= r.Left && sx <= r.Right && sy >= r.Top && sy <= r.Bottom;
            info["style"] = style;
            candidates.Add(info);
            if ((bool)info["containsPoint"]) matches.Add(h);
            return true;
        }, IntPtr.Zero);
        Dictionary<string, object> d;
        if (matches.Count == 0)
        {
            d = Fail("no_match", "no unique standard push button matched label and screen point");
        }
        else if (matches.Count > 1)
        {
            d = Fail("ambiguous", "multiple standard push buttons matched label and screen point");
        }
        else
        {
            IntPtr button = matches[0];
            if (!PostMessageW(button, BM_CLICK, IntPtr.Zero, IntPtr.Zero))
            {
                d = Fail("post_message_failed", "PostMessage(BM_CLICK) failed");
            }
            else
            {
                d = Ok();
                d["method"] = "BM_CLICK";
                d["buttonHwnd"] = button.ToInt64();
                d["rootHwnd"] = root.ToInt64();
                d["className"] = ClassOf(button);
                d["label"] = TitleOf(button);
            }
        }
        d["hwndInput"] = input.ToInt64();
        d["root"] = root.ToInt64();
        d["labelWanted"] = label;
        d["point"] = new Dictionary<string, object> { { "x", sx }, { "y", sy } };
        d["candidates"] = candidates;
        d["children"] = children;
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
        $title = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($TitleB64))
    }
    $label = ''
    if (-not [string]::IsNullOrWhiteSpace($LabelB64)) {
        $label = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($LabelB64))
    }
    if ($Action -ne 'trigger') {
        Write-Result @{ ok = $false; code = 'bad_action'; error = "unknown action: $Action" }
    }
    elseif ([string]::IsNullOrWhiteSpace($label)) {
        Write-Result @{ ok = $false; code = 'bad_label'; error = 'label is required' }
    }
    else {
        Write-Result ([DshNativeButton]::Trigger([long]$Hwnd, [int]$TargetPid, $title, $label, [int]$ScreenX, [int]$ScreenY))
    }
}
catch {
    Write-Result @{ ok = $false; code = 'exception'; error = $_.Exception.Message }
}
