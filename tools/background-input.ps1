# background-input.ps1 - experimental Windows background input helper (B0/B1/B2/B3).
# ASCII-only on purpose: Windows PowerShell 5.1 parses BOM-less files as ANSI.
# Protocol: stdin one JSON request per line, stdout one JSON response per line.
# Emits {"ready":true} after Add-Type succeeds.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$src = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class DshInput
{
    // ---- constants ----
    const uint WM_ACTIVATE = 0x0006;
    const uint WM_KEYDOWN = 0x0100;
    const uint WM_KEYUP = 0x0101;
    const uint WM_CHAR = 0x0102;
    const uint WM_MOUSEMOVE = 0x0200;
    const uint WM_LBUTTONDOWN = 0x0201;
    const uint WM_LBUTTONUP = 0x0202;
    const uint WM_LBUTTONDBLCLK = 0x0203;
    const uint WM_RBUTTONDOWN = 0x0204;
    const uint WM_RBUTTONUP = 0x0205;
    const uint BM_CLICK = 0x00F5;
    // Standard values: WM_TOUCH=0x0240; WM_POINTERENTER=0x0249, LEAVE=0x024A, CAPTURECHANGED=0x024C.
    const uint WM_TOUCH = 0x0240;
    const uint WM_POINTERUPDATE = 0x0245;
    const uint WM_POINTERDOWN = 0x0246;
    const uint WM_POINTERUP = 0x0247;
    const uint WM_POINTERENTER = 0x0249;
    const uint WM_POINTERLEAVE = 0x024A;
    const uint WM_POINTERCAPTURECHANGED = 0x024C;

    const int GWL_STYLE = -16;
    const int GWL_EXSTYLE = -20;
    const int GCL_STYLE = -26;
    const int ES_PASSWORD = 0x20;
    const uint CS_DBLCLKS = 0x0008;
    const uint WS_POPUP = 0x80000000u;
    const uint WS_CAPTION = 0x00C00000u;

    const int SM_XVIRTUALSCREEN = 76;
    const int SM_YVIRTUALSCREEN = 77;
    const int SM_CXVIRTUALSCREEN = 78;
    const int SM_CYVIRTUALSCREEN = 79;

    const uint SWP_NOSIZE = 0x0001;
    const uint SWP_NOZORDER = 0x0004;
    const uint SWP_NOACTIVATE = 0x0010;
    const uint SWP_NOOWNERZORDER = 0x0200;
    const uint SWP_ASYNCWINDOWPOS = 0x4000;

    const uint LWA_ALPHA = 0x0002;
    const int SW_SHOWNOACTIVATE = 4;
    const uint GA_ROOT = 2;
    const uint GA_ROOTOWNER = 3;
    const uint MONITOR_DEFAULTTONULL = 0;
    const uint DESKTOP_SWITCHDESKTOP = 0x0100;
    const int UOI_NAME = 2;
    const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    const uint TOKEN_QUERY = 0x0008;
    const int TokenIntegrityLevel = 25;
    const uint SMTO_BLOCK = 0x0001;
    const uint SMTO_ABORTIFHUNG = 0x0002;

    const uint POINTER_FLAG_INRANGE = 0x00000002;
    const uint POINTER_FLAG_INCONTACT = 0x00000004;
    const uint POINTER_FLAG_CONFIDENCE = 0x00004000;
    const uint POINTER_FLAG_DOWN = 0x00010000;
    const uint POINTER_FLAG_UPDATE = 0x00020000;
    const uint POINTER_FLAG_UP = 0x00040000;
    const int PT_TOUCH = 2;
    const int POINTER_FEEDBACK_NONE = 3;
    const uint TOUCH_MASK_CONTACTAREA = 0x1;
    const uint TOUCH_MASK_ORIENTATION = 0x2;
    const uint TOUCH_MASK_PRESSURE = 0x4;

    const int MK_LBUTTON = 0x0001;
    const int MK_RBUTTON = 0x0002;

    // ---- interop structs ----
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    public struct GUITHREADINFO
    {
        public int cbSize;
        public int flags;
        public IntPtr hwndActive;
        public IntPtr hwndFocus;
        public IntPtr hwndCapture;
        public IntPtr hwndMenuOwner;
        public IntPtr hwndMoveSize;
        public IntPtr hwndCaret;
        public RECT rcCaret;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct POINTER_INFO
    {
        public int pointerType;
        public uint pointerId;
        public uint frameId;
        public uint pointerFlags;
        public IntPtr sourceDevice;
        public IntPtr hwndTarget;
        public POINT ptPixelLocation;
        public POINT ptHimetricLocation;
        public POINT ptPixelLocationRaw;
        public POINT ptHimetricLocationRaw;
        public uint dwTime;
        public uint historyCount;
        public int InputState;
        public uint dwKeyStates;
        public ulong PerformanceCount;
        public int ButtonChangeType;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct POINTER_TOUCH_INFO
    {
        public POINTER_INFO pointerInfo;
        public uint touchFlags;
        public uint touchMask;
        public RECT rcContact;
        public RECT rcContactRaw;
        public uint orientation;
        public uint pressure;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct POINTER_TYPE_INFO
    {
        public int type;
        public POINTER_TOUCH_INFO touchInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public POINT pt;
    }

    public delegate IntPtr WndProc(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct WNDCLASSEX
    {
        public uint cbSize;
        public uint style;
        public WndProc lpfnWndProc;
        public int cbClsExtra;
        public int cbWndExtra;
        public IntPtr hInstance;
        public IntPtr hIcon;
        public IntPtr hCursor;
        public IntPtr hbrBackground;
        public string lpszMenuName;
        public string lpszClassName;
        public IntPtr hIconSm;
    }

    // ---- user32 ----
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool IsChild(IntPtr parent, IntPtr child);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint tid, ref GUITHREADINFO info);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hWnd, int index);
    [DllImport("user32.dll")] static extern uint GetClassLong(IntPtr hWnd, int index);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr hWnd, ref POINT pt);
    [DllImport("user32.dll")] static extern bool ScreenToClient(IntPtr hWnd, ref POINT pt);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT pt);
    [DllImport("user32.dll")] static extern bool PtInRect(ref RECT rect, POINT pt);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll")] static extern bool CloseTouchInputHandle(IntPtr handle);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT pt);
    [DllImport("user32.dll")] static extern bool GetClipCursor(out RECT rect);
    [DllImport("user32.dll")] static extern bool BlockInput(bool block);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
    [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr hDesktop);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetUserObjectInformation(IntPtr hObj, int index, StringBuilder info, int len, out int needed);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(POINT pt, uint flags);
    [DllImport("user32.dll")] static extern bool IsTouchWindow(IntPtr hWnd, out uint flags);
    [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint mapType);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern ushort RegisterClassEx(ref WNDCLASSEX wc);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateWindowEx(uint exStyle, string className, string windowName, uint style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr inst, IntPtr param);
    [DllImport("user32.dll")] static extern bool DestroyWindow(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool UnregisterClass(string className, IntPtr inst);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int cmd);
    [DllImport("user32.dll")] static extern bool SetLayeredWindowAttributes(IntPtr hWnd, uint colorKey, byte alpha, uint flags);
    [DllImport("user32.dll")] static extern bool PeekMessage(out MSG msg, IntPtr hWnd, uint min, uint max, uint remove);
    [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG msg);
    [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG msg);
    [DllImport("user32.dll")] static extern IntPtr DefWindowProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    // ---- synthetic pointer ----
    [DllImport("user32.dll")] static extern IntPtr CreateSyntheticPointerDevice(int pointerType, uint maxCount, int mode);
    [DllImport("user32.dll")] static extern bool InjectSyntheticPointerInput(IntPtr device, POINTER_TYPE_INFO[] pointerInfo, uint count);
    [DllImport("user32.dll")] static extern void DestroySyntheticPointerDevice(IntPtr device);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);

    // ---- kernel32 / advapi32 ----
    [DllImport("kernel32.dll")] static extern uint GetCurrentProcessId();
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder name, ref int size);
    [DllImport("kernel32.dll")] static extern bool ProcessIdToSessionId(uint pid, out uint session);
    [DllImport("kernel32.dll")] static extern void SetLastError(uint code);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetTokenInformation(IntPtr token, int cls, IntPtr info, int len, out int needed);
    [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthority(IntPtr sid, uint index);
    [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);

    // ---- worker state ----
    static readonly object workerSync = new object();
    static Thread worker;
    static ManualResetEventSlim readyEvent;
    static ManualResetEventSlim doneEvent;
    static AutoResetEvent cmdEvent;
    static ManualResetEvent stopEvent;
    static string workerError;
    static IntPtr anchor = IntPtr.Zero;
    static IntPtr device = IntPtr.Zero;
    static string anchorClass;
    static RECT anchorRect;
    static POINT anchorCenter;
    static bool anchorDown;
    static IntPtr pendingHwnd;
    static POINT pendingPoint;
    static int pendingPid;
    static Dictionary<string, object> pendingResult;
    static bool workerUnhealthy;
    static WndProc anchorProc = AnchorProc;

    // Set when the helper must exit after replying (e.g. BlockInput release failed).
    public static bool Fatal = false;

    // ---- response helpers ----
    static Dictionary<string, object> D()
    {
        return new Dictionary<string, object>();
    }

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
        d["delivered"] = false;
        return d;
    }

    static Dictionary<string, object> RectDict(RECT r)
    {
        Dictionary<string, object> d = D();
        d["left"] = r.Left;
        d["top"] = r.Top;
        d["right"] = r.Right;
        d["bottom"] = r.Bottom;
        d["width"] = r.Right - r.Left;
        d["height"] = r.Bottom - r.Top;
        return d;
    }

    static Dictionary<string, object> PointDict(POINT p)
    {
        Dictionary<string, object> d = D();
        d["x"] = p.X;
        d["y"] = p.Y;
        return d;
    }

    static void AddSideEffects(Dictionary<string, object> d, bool cursorMoved, bool windowMoved, bool zOrderChanged, bool? foregroundChanged = null)
    {
        Dictionary<string, object> se = D();
        se["cursorMoved"] = cursorMoved;
        se["foregroundChanged"] = foregroundChanged.HasValue ? foregroundChanged.Value : false;
        se["windowMoved"] = windowMoved;
        se["zOrderChanged"] = zOrderChanged;
        d["side_effects"] = se;
    }

    // ---- validation ----
    static string CheckWindow(IntPtr hwnd, int expectedPid)
    {
        if (hwnd == IntPtr.Zero || !IsWindow(hwnd)) return "window_not_found";
        uint pid;
        GetWindowThreadProcessId(hwnd, out pid);
        if (expectedPid > 0 && (int)pid != expectedPid) return "pid_mismatch";
        return "";
    }

    static bool SameSession(int targetPid)
    {
        uint a, b;
        if (!ProcessIdToSessionId((uint)targetPid, out a)) return false;
        if (!ProcessIdToSessionId(GetCurrentProcessId(), out b)) return false;
        return a == b;
    }

    static int IntegrityRank(int pid)
    {
        IntPtr proc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, (uint)pid);
        if (proc == IntPtr.Zero) return 99;
        IntPtr token = IntPtr.Zero;
        IntPtr buffer = IntPtr.Zero;
        try
        {
            if (!OpenProcessToken(proc, TOKEN_QUERY, out token)) return 99;
            int needed = 0;
            GetTokenInformation(token, TokenIntegrityLevel, IntPtr.Zero, 0, out needed);
            if (needed <= 0) return 99;
            buffer = Marshal.AllocHGlobal(needed);
            if (!GetTokenInformation(token, TokenIntegrityLevel, buffer, needed, out needed)) return 99;
            IntPtr sid = Marshal.ReadIntPtr(buffer);
            if (sid == IntPtr.Zero) return 99;
            IntPtr countPtr = GetSidSubAuthorityCount(sid);
            if (countPtr == IntPtr.Zero) return 99;
            byte count = Marshal.ReadByte(countPtr);
            if (count == 0) return 99;
            IntPtr sub = GetSidSubAuthority(sid, (uint)(count - 1));
            if (sub == IntPtr.Zero) return 99;
            int rid = Marshal.ReadInt32(sub);
            if (rid >= 0x3000) return 3;
            if (rid >= 0x2000) return 2;
            if (rid >= 0x1000) return 1;
            return 0;
        }
        catch
        {
            return 99;
        }
        finally
        {
            if (buffer != IntPtr.Zero) Marshal.FreeHGlobal(buffer);
            if (token != IntPtr.Zero) CloseHandle(token);
            if (proc != IntPtr.Zero) CloseHandle(proc);
        }
    }

    static string IntegrityName(int rank)
    {
        if (rank == 0) return "low";
        if (rank == 1) return "medium";
        if (rank == 2) return "high";
        if (rank == 3) return "system";
        return "unknown";
    }

    static bool IsSecureDesktop()
    {
        IntPtr desktop = OpenInputDesktop(0, false, DESKTOP_SWITCHDESKTOP);
        if (desktop == IntPtr.Zero) return true;
        try
        {
            StringBuilder sb = new StringBuilder(260);
            int needed = 0;
            if (!GetUserObjectInformation(desktop, UOI_NAME, sb, sb.Capacity, out needed)) return true;
            return !String.Equals(sb.ToString(), "Default", StringComparison.OrdinalIgnoreCase);
        }
        finally
        {
            CloseDesktop(desktop);
        }
    }

    static string CheckAction(IntPtr hwnd, int expectedPid)
    {
        string bad = CheckWindow(hwnd, expectedPid);
        if (bad.Length > 0) return bad;
        uint pid;
        GetWindowThreadProcessId(hwnd, out pid);
        if (!SameSession((int)pid)) return "uipi";
        int targetRank = IntegrityRank((int)pid);
        int currentRank = IntegrityRank((int)GetCurrentProcessId());
        // Unknown integrity must not be treated as same-level; fail closed.
        if (targetRank == 99 || currentRank == 99) return "uipi";
        if (targetRank > currentRank) return "uipi";
        if (IsSecureDesktop()) return "secure_desktop";
        return "";
    }

    static IntPtr FocusOrTarget(IntPtr hwnd)
    {
        IntPtr f = FocusHwnd(hwnd);
        if (f != IntPtr.Zero && (f == hwnd || IsChild(hwnd, f))) return f;
        return hwnd;
    }

    static IntPtr FocusHwnd(IntPtr hwnd)
    {
        uint pid;
        uint tid = GetWindowThreadProcessId(hwnd, out pid);
        GUITHREADINFO info = new GUITHREADINFO();
        info.cbSize = Marshal.SizeOf(typeof(GUITHREADINFO));
        if (GetGUIThreadInfo(tid, ref info)) return info.hwndFocus;
        return IntPtr.Zero;
    }

    static string ClassOf(IntPtr hwnd)
    {
        StringBuilder sb = new StringBuilder(256);
        int n = GetClassName(hwnd, sb, sb.Capacity);
        if (n <= 0) return "";
        return sb.ToString();
    }

    static IntPtr ChildAt(POINT pt)
    {
        IntPtr hit = WindowFromPoint(pt);
        if (hit == IntPtr.Zero) return IntPtr.Zero;
        return hit;
    }

    static bool OnDesktop(POINT pt)
    {
        return MonitorFromPoint(pt, MONITOR_DEFAULTTONULL) != IntPtr.Zero;
    }

    static bool TargetAt(IntPtr hwnd, POINT pt)
    {
        IntPtr hit = WindowFromPoint(pt);
        if (hit == IntPtr.Zero) return false;
        IntPtr root = GetAncestor(hit, GA_ROOT);
        return hit == hwnd || root == hwnd || IsChild(hwnd, hit);
    }

    static bool PointInClip(RECT clip, POINT pt)
    {
        return pt.X >= clip.Left && pt.X < clip.Right && pt.Y >= clip.Top && pt.Y < clip.Bottom;
    }

    // ---- B0 posted/control ----
    static void Activate(IntPtr hwnd)
    {
        IntPtr root = GetAncestor(hwnd, GA_ROOTOWNER);
        if (root == IntPtr.Zero) root = hwnd;
        IntPtr result;
        SendMessageTimeout(root, WM_ACTIVATE, new IntPtr(1), IntPtr.Zero, SMTO_BLOCK | SMTO_ABORTIFHUNG, 1000, out result);
    }

    static IntPtr MakeLParam(int x, int y)
    {
        uint ux = (uint)(x & 0xffff);
        uint uy = (uint)(y & 0xffff);
        long v = ((long)uy << 16) | (long)ux;
        return new IntPtr(v);
    }

    static bool PostClick(IntPtr hwnd, POINT screen, string button, int count, out string method, out string childClass, out int childHwnd, out string warning)
    {
        method = "posted";
        childClass = "";
        childHwnd = 0;
        warning = "";
        IntPtr target = ChildAt(screen);
        if (target == IntPtr.Zero) target = hwnd;
        childClass = ClassOf(target);
        childHwnd = (int)target.ToInt64();
        Activate(hwnd);
        POINT client = screen;
        if (!ScreenToClient(target, ref client)) return false;
        IntPtr lp = MakeLParam(client.X, client.Y);
        string btn = String.IsNullOrEmpty(button) ? "left" : button.ToLowerInvariant();
        if (btn == "left" && count == 1 && childClass == "Button" && IsWindowEnabled(target) && IsWindowVisible(target))
        {
            method = "bm_click";
            return PostMessage(target, BM_CLICK, IntPtr.Zero, IntPtr.Zero);
        }
        // WM_MOUSEMOVE is decorative: failure does not negate the subsequent down/up.
        PostMessage(target, WM_MOUSEMOVE, IntPtr.Zero, lp);
        Thread.Sleep(10);
        if (btn == "right")
        {
            if (!PostMessage(target, WM_RBUTTONDOWN, new IntPtr(MK_RBUTTON), lp)) return false;
            Thread.Sleep(30);
            bool up = PostMessage(target, WM_RBUTTONUP, IntPtr.Zero, lp);
            if (!up) up = PostMessage(target, WM_RBUTTONUP, IntPtr.Zero, lp);
            if (!up) warning = "mouse_up_failed";
            return true;
        }
        if (!PostMessage(target, WM_LBUTTONDOWN, new IntPtr(MK_LBUTTON), lp)) return false;
        Thread.Sleep(30);
        bool upLeft = PostMessage(target, WM_LBUTTONUP, IntPtr.Zero, lp);
        if (!upLeft) upLeft = PostMessage(target, WM_LBUTTONUP, IntPtr.Zero, lp);
        if (!upLeft) warning = "mouse_up_failed";
        if (count >= 2)
        {
            Thread.Sleep(30);
            uint cls = GetClassLong(target, GCL_STYLE);
            uint downMsg = ((cls & CS_DBLCLKS) != 0) ? WM_LBUTTONDBLCLK : WM_LBUTTONDOWN;
            bool down2 = PostMessage(target, downMsg, new IntPtr(MK_LBUTTON), lp);
            Thread.Sleep(30);
            bool up2 = down2 && PostMessage(target, WM_LBUTTONUP, IntPtr.Zero, lp);
            if (!up2) up2 = PostMessage(target, WM_LBUTTONUP, IntPtr.Zero, lp);
            if (!down2 || !up2) warning = "double_click_partial";
        }
        return true;
    }

    public static Dictionary<string, object> PostMouse(long hwndL, int expectedPid, int sx, int sy, string button, int count)
    {
        IntPtr hwnd = new IntPtr(hwndL);
        string bad = CheckAction(hwnd, expectedPid);
        if (bad.Length > 0) return Fail(bad, bad);
        POINT pt = new POINT();
        pt.X = sx; pt.Y = sy;
        if (!OnDesktop(pt)) return Fail("outside_desktop", "target point is outside the desktop");
        if (!TargetAt(hwnd, pt))
        {
            IntPtr hitNow = WindowFromPoint(pt);
            IntPtr rootNow = GetAncestor(hitNow, GA_ROOT);
            return Fail("occluded", "target window is not at the point hit=" + hitNow.ToInt64() + " root=" + rootNow.ToInt64() + " hwnd=" + hwnd.ToInt64() + " class=" + ClassOf(hitNow));
        }
        if (count < 1) count = 1;
        string method, childClass, warning;
        int childHwnd;
        bool delivered = PostClick(hwnd, pt, button, count, out method, out childClass, out childHwnd, out warning);
        if (!delivered) return Fail("post_failed", "PostMessage failed");
        Dictionary<string, object> d = Ok();
        d["delivered"] = true;
        d["method"] = method;
        d["childClass"] = childClass;
        d["childHwnd"] = childHwnd;
        d["effect"] = "unverifiable";
        if (!String.IsNullOrEmpty(warning)) { d["partial"] = true; d["warning_code"] = warning; }
        AddSideEffects(d, false, false, false);
        return d;
    }

    // ---- B0 keyboard/text ----
    public static Dictionary<string, object> PostKey(long hwndL, int expectedPid, int vk, bool extended)
    {
        IntPtr hwnd = new IntPtr(hwndL);
        string bad = CheckAction(hwnd, expectedPid);
        if (bad.Length > 0) return Fail(bad, bad);
        IntPtr target = FocusOrTarget(hwnd);
        uint sc = MapVirtualKey((uint)vk, 0);
        long down = 1L | ((long)(sc & 0xff) << 16);
        if (extended) down |= 1L << 24;
        long up = down | (1L << 30) | (1L << 31);
        IntPtr keyResult;
        IntPtr keyDown = SendMessageTimeout(target, WM_KEYDOWN, new IntPtr(vk), new IntPtr(down), SMTO_BLOCK | SMTO_ABORTIFHUNG, 1000, out keyResult);
        if (keyDown == IntPtr.Zero) return Fail("send_failed", "SendMessageTimeout WM_KEYDOWN failed");
        Thread.Sleep(10);
        IntPtr keyUp = SendMessageTimeout(target, WM_KEYUP, new IntPtr(vk), new IntPtr(up), SMTO_BLOCK | SMTO_ABORTIFHUNG, 1000, out keyResult);
        if (keyUp == IntPtr.Zero) keyUp = SendMessageTimeout(target, WM_KEYUP, new IntPtr(vk), new IntPtr(up), SMTO_BLOCK | SMTO_ABORTIFHUNG, 1000, out keyResult);
        Dictionary<string, object> d = Ok();
        d["delivered"] = true;
        d["method"] = "wm_key";
        d["focusedHwnd"] = (long)target.ToInt64();
        d["effect"] = "unverifiable";
        d["complete"] = keyUp != IntPtr.Zero;
        if (keyUp == IntPtr.Zero) { d["partial"] = true; d["warning_code"] = "key_up_failed"; }
        AddSideEffects(d, false, false, false);
        return d;
    }

    public static Dictionary<string, object> PostText(long hwndL, int expectedPid, bool hasPoint, int sx, int sy, string text)
    {
        IntPtr hwnd = new IntPtr(hwndL);
        string bad = CheckAction(hwnd, expectedPid);
        if (bad.Length > 0) return Fail(bad, bad);
        IntPtr target = IntPtr.Zero;
        if (hasPoint)
        {
            POINT pt = new POINT();
            pt.X = sx; pt.Y = sy;
            if (!OnDesktop(pt)) return Fail("outside_desktop", "target point is outside the desktop");
            if (!TargetAt(hwnd, pt))
            {
                IntPtr hitNow = WindowFromPoint(pt);
                IntPtr rootNow = GetAncestor(hitNow, GA_ROOT);
                return Fail("occluded", "target window is not at the point hit=" + hitNow.ToInt64() + " root=" + rootNow.ToInt64() + " hwnd=" + hwnd.ToInt64() + " class=" + ClassOf(hitNow));
            }
            target = ChildAt(pt);
        }
        else
        {
            target = FocusOrTarget(hwnd);
        }
        if (target == IntPtr.Zero) target = hwnd;
        if ((GetWindowLong(target, GWL_STYLE) & ES_PASSWORD) != 0) return Fail("password_denied", "target is a password field");
        int sent = 0;
        foreach (char ch in text)
        {
            IntPtr charResult;
            IntPtr charSent = SendMessageTimeout(target, WM_CHAR, new IntPtr((int)ch), new IntPtr(1), SMTO_BLOCK | SMTO_ABORTIFHUNG, 1000, out charResult);
            if (charSent == IntPtr.Zero)
            {
                Dictionary<string, object> f = Fail("send_failed", "SendMessageTimeout WM_CHAR failed after " + sent + " chars");
                f["delivered"] = sent > 0;
                f["sentChars"] = sent;
                if (sent > 0) { f["partial"] = true; f["warning_code"] = "text_partial"; }
                AddSideEffects(f, false, false, false);
                return f;
            }
            sent++;
            Thread.Sleep(15);
        }
        Dictionary<string, object> d = Ok();
        d["delivered"] = true;
        d["method"] = "wm_char";
        d["focusedHwnd"] = (long)target.ToInt64();
        d["verified"] = false;
        d["chars"] = sent;
        d["sentChars"] = sent;
        d["complete"] = true;
        d["effect"] = "unverifiable";
        AddSideEffects(d, false, false, false);
        return d;
    }

    // ---- B2 cursor anchored ----
    public static Dictionary<string, object> CursorClick(long hwndL, int expectedPid, int sx, int sy)
    {
        IntPtr hwnd = new IntPtr(hwndL);
        string bad = CheckAction(hwnd, expectedPid);
        if (bad.Length > 0) return Fail(bad, bad);
        if (IsIconic(hwnd)) return Fail("unavailable", "target window is minimized");
        POINT pt = new POINT();
        pt.X = sx; pt.Y = sy;
        if (!OnDesktop(pt)) return Fail("outside_desktop", "target point is outside the desktop");
        if (!TargetAt(hwnd, pt))
        {
            IntPtr hitNow = WindowFromPoint(pt);
            IntPtr rootNow = GetAncestor(hitNow, GA_ROOT);
            return Fail("occluded", "target window is not at the point hit=" + hitNow.ToInt64() + " root=" + rootNow.ToInt64() + " hwnd=" + hwnd.ToInt64() + " class=" + ClassOf(hitNow));
        }
        RECT clip;
        if (GetClipCursor(out clip) && !PointInClip(clip, pt))
            return Fail("clip_cursor", "cursor is clipped before the target point");
        POINT saved;
        if (!GetCursorPos(out saved)) return Fail("cursor_failed", "GetCursorPos failed");
        if (!BlockInput(true)) return Fail("block_input_failed", "BlockInput(TRUE) failed");
        int started = Environment.TickCount;
        bool restored = false;
        bool unblocked = true;
        bool moved = false;
        bool delivered = false;
        string warning = "";
        string failCode = "";
        string failError = "";
        try
        {
            if (!SetCursorPos(sx, sy))
            {
                failCode = "cursor_move_failed";
                failError = "SetCursorPos failed";
            }
            else
            {
                moved = true;
                Thread.Sleep(30);
                POINT actual;
                if (!GetCursorPos(out actual) || Math.Abs(actual.X - sx) > 2 || Math.Abs(actual.Y - sy) > 2)
                {
                    failCode = "cursor_move_failed";
                    failError = "cursor did not reach the requested point (clip/DPI?)";
                }
                else
                {
                    string method, childClass;
                    int childHwnd;
                    delivered = PostClick(hwnd, pt, "left", 1, out method, out childClass, out childHwnd, out warning);
                    if (!delivered)
                    {
                        failCode = "post_failed";
                        failError = "PostMessage failed";
                    }
                    Thread.Sleep(30);
                }
            }
        }
        finally
        {
            restored = SetCursorPos(saved.X, saved.Y);
            unblocked = BlockInput(false);
            if (!unblocked) Fatal = true; // Exiting the process releases BlockInput.
        }
        int elapsed = Environment.TickCount - started;
        if (failCode.Length > 0 || !delivered)
        {
            Dictionary<string, object> f = Fail(failCode.Length > 0 ? failCode : "post_failed", failError);
            f["cursorMoved"] = moved;
            f["cursorRestored"] = restored;
            f["inputBlockedMs"] = elapsed;
            f["inputUnblocked"] = unblocked;
            AddSideEffects(f, moved, false, false);
            if (!restored) f["warning_code"] = "cursor_restore_failed";
            else if (!unblocked) f["warning_code"] = "input_unblock_failed";
            return f;
        }
        Dictionary<string, object> d = Ok();
        d["delivered"] = true;
        d["method"] = "cursor_anchored";
        d["effect"] = "unverifiable";
        d["cursorMoved"] = true;
        d["cursorRestored"] = restored;
        d["inputBlockedMs"] = elapsed;
        d["inputUnblocked"] = unblocked;
        d["complete"] = restored && unblocked && String.IsNullOrEmpty(warning);
        if (!String.IsNullOrEmpty(warning)) { d["partial"] = true; d["warning_code"] = warning; }
        else if (!restored) d["warning_code"] = "cursor_restore_failed";
        else if (!unblocked) d["warning_code"] = "input_unblock_failed";
        AddSideEffects(d, true, false, false);
        return d;
    }

    // ---- B3 window anchored ----
    static bool RectNear(RECT r, int left, int top)
    {
        return Math.Abs(r.Left - left) <= 2 && Math.Abs(r.Top - top) <= 2;
    }

    static bool RestoreWindow(IntPtr hwnd, RECT original)
    {
        if (!SetWindowPos(hwnd, IntPtr.Zero, original.Left, original.Top, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS))
            return false;
        int deadline = Environment.TickCount + 500;
        while (Environment.TickCount < deadline)
        {
            RECT now;
            if (GetWindowRect(hwnd, out now) && RectNear(now, original.Left, original.Top)) return true;
            Thread.Sleep(20);
        }
        return false;
    }

    static Dictionary<string, object> FailWindow(string code, string error, bool moved, bool restored, RECT original, RECT current)
    {
        Dictionary<string, object> f = Fail(code, error);
        f["windowMoved"] = moved;
        f["windowRestored"] = restored;
        f["originalRect"] = RectDict(original);
        f["currentRect"] = RectDict(current);
        AddSideEffects(f, false, moved, false);
        if (!restored) f["warning_code"] = "window_restore_failed";
        return f;
    }

    public static Dictionary<string, object> WindowClick(long hwndL, int expectedPid, int clientX, int clientY)
    {
        IntPtr hwnd = new IntPtr(hwndL);
        string bad = CheckAction(hwnd, expectedPid);
        if (bad.Length > 0) return Fail(bad, bad);
        if (IsIconic(hwnd) || IsZoomed(hwnd)) return Fail("window_not_movable", "target window is minimized or maximized");
        int style = GetWindowLong(hwnd, GWL_STYLE);
        if (((uint)style & WS_POPUP) != 0 && ((uint)style & WS_CAPTION) == 0)
            return Fail("window_not_movable", "target window looks like borderless fullscreen");
        RECT original;
        if (!GetWindowRect(hwnd, out original)) return Fail("window_not_found", "GetWindowRect failed");
        POINT clientOrigin = new POINT();
        if (!ClientToScreen(hwnd, ref clientOrigin)) return Fail("window_move_failed", "ClientToScreen failed");
        int borderX = clientOrigin.X - original.Left;
        int borderY = clientOrigin.Y - original.Top;
        POINT cursor;
        if (!GetCursorPos(out cursor)) return Fail("cursor_failed", "GetCursorPos failed");
        int newLeft = cursor.X - clientX - borderX;
        int newTop = cursor.Y - clientY - borderY;
        bool moved = !RectNear(original, newLeft, newTop);
        uint moveFlags = SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS;
        if (!SetWindowPos(hwnd, IntPtr.Zero, newLeft, newTop, 0, 0, moveFlags))
            return FailWindow("window_move_failed", "SetWindowPos move failed", false, true, original, original);
        // Bounded polling instead of a fixed 100ms; distinguish "not applied yet" from external changes.
        bool reached = false;
        bool external = false;
        RECT current = original;
        int deadline = Environment.TickCount + 500;
        while (Environment.TickCount < deadline)
        {
            if (!GetWindowRect(hwnd, out current)) return FailWindow("window_not_found", "GetWindowRect failed after move", moved, false, original, current);
            if (RectNear(current, newLeft, newTop)) { reached = true; break; }
            if (!RectNear(current, original.Left, original.Top) && moved) { external = true; break; }
            Thread.Sleep(20);
        }
        if (external)
        {
            // Do not fight a window the user moved.
            return FailWindow("window_changed_externally", "window moved externally during alignment", moved, false, original, current);
        }
        if (!reached)
        {
            bool restored = RestoreWindow(hwnd, original);
            RECT now;
            GetWindowRect(hwnd, out now);
            return FailWindow("window_move_failed", "window did not reach the requested position", moved, restored, original, now);
        }
        POINT check = cursor;
        ScreenToClient(hwnd, ref check);
        if (Math.Abs(check.X - clientX) > 2 || Math.Abs(check.Y - clientY) > 2)
        {
            bool restored = RestoreWindow(hwnd, original);
            RECT now;
            GetWindowRect(hwnd, out now);
            return FailWindow("window_move_failed", "window alignment check failed", moved, restored, original, now);
        }
        if (!TargetAt(hwnd, cursor))
        {
            bool restored = RestoreWindow(hwnd, original);
            RECT now;
            GetWindowRect(hwnd, out now);
            return FailWindow("occluded", "target window is not at the cursor point after move", moved, restored, original, now);
        }
        POINT nowCursor;
        if (!GetCursorPos(out nowCursor) || Math.Abs(nowCursor.X - cursor.X) > 2 || Math.Abs(nowCursor.Y - cursor.Y) > 2)
        {
            bool restored = RestoreWindow(hwnd, original);
            RECT now;
            GetWindowRect(hwnd, out now);
            return FailWindow("cursor_changed", "cursor moved during window alignment", moved, restored, original, now);
        }
        string method, childClass, warning;
        int childHwnd;
        bool delivered = PostClick(hwnd, cursor, "left", 1, out method, out childClass, out childHwnd, out warning);
        Thread.Sleep(50);
        bool restoredFinal = RestoreWindow(hwnd, original);
        RECT finalRect;
        GetWindowRect(hwnd, out finalRect);
        if (!delivered)
            return FailWindow("post_failed", "PostMessage failed", moved, restoredFinal, original, finalRect);
        Dictionary<string, object> d = Ok();
        d["delivered"] = true;
        d["method"] = "window_anchored";
        d["effect"] = "unverifiable";
        d["windowMoved"] = moved;
        d["windowRestored"] = restoredFinal;
        d["cursorMoved"] = false;
        d["complete"] = restoredFinal && String.IsNullOrEmpty(warning);
        if (!String.IsNullOrEmpty(warning)) { d["partial"] = true; d["warning_code"] = warning; }
        else if (!restoredFinal) d["warning_code"] = "window_restore_failed";
        AddSideEffects(d, false, moved, false);
        return d;
    }

    // ---- probe ----
    public static Dictionary<string, object> Probe(long hwndL, int expectedPid)
    {
        IntPtr hwnd = new IntPtr(hwndL);
        string bad = CheckWindow(hwnd, expectedPid);
        if (bad.Length > 0) return Fail(bad, bad);
        uint pid;
        GetWindowThreadProcessId(hwnd, out pid);
        uint currentPid = GetCurrentProcessId();
        int targetRank = IntegrityRank((int)pid);
        int currentRank = IntegrityRank((int)currentPid);
        RECT windowRect, clientRect;
        GetWindowRect(hwnd, out windowRect);
        GetClientRect(hwnd, out clientRect);
        POINT clientOrigin = new POINT();
        ClientToScreen(hwnd, ref clientOrigin);
        POINT cursor;
        GetCursorPos(out cursor);
        RECT clip;
        bool hasClip = GetClipCursor(out clip);
        if (!hasClip) { clip = new RECT(); }
        POINT virtualPt = new POINT();
        virtualPt.X = GetSystemMetrics(SM_XVIRTUALSCREEN);
        virtualPt.Y = GetSystemMetrics(SM_YVIRTUALSCREEN);
        RECT virtualRect = new RECT();
        virtualRect.Left = virtualPt.X;
        virtualRect.Top = virtualPt.Y;
        virtualRect.Right = virtualPt.X + GetSystemMetrics(SM_CXVIRTUALSCREEN);
        virtualRect.Bottom = virtualPt.Y + GetSystemMetrics(SM_CYVIRTUALSCREEN);
        IntPtr focus = FocusHwnd(hwnd);
        uint touchFlags = 0;
        bool touch = IsTouchWindow(hwnd, out touchFlags);
        string image = "";
        IntPtr proc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
        if (proc != IntPtr.Zero)
        {
            try
            {
                StringBuilder sb = new StringBuilder(1024);
                int size = sb.Capacity;
                if (QueryFullProcessImageName(proc, 0, sb, ref size)) image = sb.ToString();
            }
            finally { CloseHandle(proc); }
        }
        Dictionary<string, object> d = Ok();
        d["hwnd"] = (long)hwnd.ToInt64();
        d["pid"] = (int)pid;
        d["className"] = ClassOf(hwnd);
        d["processImage"] = image;
        d["integrity"] = IntegrityName(targetRank);
        d["integrityRank"] = targetRank;
        d["currentIntegrityRank"] = currentRank;
        d["sameSession"] = SameSession((int)pid);
        d["secureDesktop"] = IsSecureDesktop();
        d["visible"] = IsWindowVisible(hwnd);
        d["iconic"] = IsIconic(hwnd);
        d["zoomed"] = IsZoomed(hwnd);
        d["foreground"] = GetForegroundWindow() == GetAncestor(hwnd, GA_ROOTOWNER);
        d["touchWindow"] = touch;
        d["focusHwnd"] = (long)focus.ToInt64();
        d["windowRect"] = RectDict(windowRect);
        d["clientRect"] = RectDict(clientRect);
        d["clientOrigin"] = PointDict(clientOrigin);
        d["cursor"] = PointDict(cursor);
        d["clipCursor"] = RectDict(clip);
        d["virtualScreen"] = RectDict(virtualRect);
        return d;
    }

    // ---- synthetic pointer worker ----
    static bool EnsureWorker()
    {
        lock (workerSync)
        {
            if (workerUnhealthy)
            {
                // Last injection was incomplete (pointer may still be down); stop and rebuild.
                workerUnhealthy = false;
                StopWorker();
            }
            if (worker != null && worker.IsAlive) return true;
            workerError = null;
            readyEvent = new ManualResetEventSlim(false);
            doneEvent = new ManualResetEventSlim(false);
            cmdEvent = new AutoResetEvent(false);
            stopEvent = new ManualResetEvent(false);
            worker = new Thread(WorkerMain);
            worker.IsBackground = true;
            worker.Name = "DshSyntheticPointer";
            worker.Start();
            if (!readyEvent.Wait(10000))
            {
                workerError = "synthetic worker readiness timeout";
                try { stopEvent.Set(); } catch { }
                return false;
            }
            if (!String.IsNullOrEmpty(workerError)) return false;
            return worker.IsAlive;
        }
    }

    static void StopWorker()
    {
        lock (workerSync)
        {
            if (worker == null) return;
            try { stopEvent.Set(); } catch { }
            try { cmdEvent.Set(); } catch { }
            try { worker.Join(1500); } catch { }
            worker = null;
            readyEvent = null;
            doneEvent = null;
            cmdEvent = null;
            stopEvent = null;
        }
    }

    static void WorkerMain()
    {
        try
        {
            string cls = "DshBgAnchor_" + GetCurrentProcessId() + "_" + Environment.TickCount;
            try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }
            try { SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch { }
            WNDCLASSEX wc = new WNDCLASSEX();
            wc.cbSize = (uint)Marshal.SizeOf(typeof(WNDCLASSEX));
            wc.lpfnWndProc = anchorProc;
            wc.hInstance = GetModuleHandle(null);
            wc.hbrBackground = new IntPtr(6);
            wc.lpszClassName = cls;
            if (RegisterClassEx(ref wc) == 0)
            {
                workerError = "RegisterClassEx failed";
                readyEvent.Set();
                return;
            }
            anchorClass = cls;
            uint exStyle = 0x00000080u | 0x08000000u | 0x00000008u | 0x00080000u; // TOOLWINDOW|NOACTIVATE|TOPMOST|LAYERED
            anchor = CreateWindowEx(exStyle, cls, "", WS_POPUP, 8, 8, 4, 4, IntPtr.Zero, IntPtr.Zero, wc.hInstance, IntPtr.Zero);
            if (anchor == IntPtr.Zero)
            {
                workerError = "CreateWindowEx failed";
                readyEvent.Set();
                return;
            }
            if (!SetLayeredWindowAttributes(anchor, 0, 1, LWA_ALPHA))
            {
                workerError = "SetLayeredWindowAttributes failed";
                readyEvent.Set();
                return;
            }
            ShowWindow(anchor, SW_SHOWNOACTIVATE);
            SetWindowPos(anchor, new IntPtr(-1), 8, 8, 4, 4, SWP_NOACTIVATE | SWP_NOOWNERZORDER);
            GetWindowRect(anchor, out anchorRect);
            anchorCenter.X = (anchorRect.Left + anchorRect.Right) / 2;
            anchorCenter.Y = (anchorRect.Top + anchorRect.Bottom) / 2;
            SetLastError(0);
            device = CreateSyntheticPointerDevice(PT_TOUCH, 2, POINTER_FEEDBACK_NONE);
            if (device == IntPtr.Zero)
            {
                workerError = "CreateSyntheticPointerDevice failed err=" + Marshal.GetLastWin32Error();
                readyEvent.Set();
                return;
            }
            readyEvent.Set();
            while (!stopEvent.WaitOne(0))
            {
                Pump();
                int idx = WaitHandle.WaitAny(new WaitHandle[] { cmdEvent, stopEvent }, 20);
                if (idx == 0)
                {
                    Dictionary<string, object> result;
                    IntPtr hwnd;
                    POINT pt;
                    int expectedPid;
                    lock (workerSync)
                    {
                        hwnd = pendingHwnd;
                        pt = pendingPoint;
                        expectedPid = pendingPid;
                    }
                    try { result = ExecuteSynthetic(hwnd, pt, expectedPid); }
                    catch (Exception ex) { result = Fail("synthetic_failed", ex.Message); }
                    lock (workerSync)
                    {
                        pendingResult = result;
                        doneEvent.Set();
                    }
                }
            }
        }
        catch (Exception ex)
        {
            workerError = ex.Message;
            try { readyEvent.Set(); } catch { }
        }
        finally
        {
            try { if (anchorDown && device != IntPtr.Zero) InjectTouch(device, 1, anchorCenter, POINTER_FLAG_UP); } catch { }
            anchorDown = false;
            if (device != IntPtr.Zero) { try { DestroySyntheticPointerDevice(device); } catch { } device = IntPtr.Zero; }
            if (anchor != IntPtr.Zero) { try { DestroyWindow(anchor); } catch { } anchor = IntPtr.Zero; }
            if (!String.IsNullOrEmpty(anchorClass)) { try { UnregisterClass(anchorClass, GetModuleHandle(null)); } catch { } anchorClass = null; }
        }
    }

    static void Pump()
    {
        MSG msg;
        while (PeekMessage(out msg, IntPtr.Zero, 0, 0, 1))
        {
            TranslateMessage(ref msg);
            DispatchMessage(ref msg);
        }
    }

    static IntPtr AnchorProc(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam)
    {
        if (msg == WM_TOUCH)
        {
            try { CloseTouchInputHandle(lParam); } catch { }
            return IntPtr.Zero;
        }
        if (msg == WM_POINTERENTER || msg == WM_POINTERLEAVE || msg == WM_POINTERUPDATE
            || msg == WM_POINTERDOWN || msg == WM_POINTERUP || msg == WM_POINTERCAPTURECHANGED)
            return IntPtr.Zero;
        if (msg == 0x0021) return new IntPtr(3); // WM_MOUSEACTIVATE -> MA_NOACTIVATE
        if (msg == 0x0084) return new IntPtr(1); // WM_NCHITTEST -> HTCLIENT
        return DefWindowProc(hwnd, msg, wParam, lParam);
    }

    static bool Intersects(RECT a, RECT b)
    {
        return a.Left < b.Right && a.Right > b.Left && a.Top < b.Bottom && a.Bottom > b.Top;
    }

    static POINT ChooseAnchorOrigin(RECT target)
    {
        int vx = GetSystemMetrics(SM_XVIRTUALSCREEN);
        int vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
        int vw = GetSystemMetrics(SM_CXVIRTUALSCREEN);
        int vh = GetSystemMetrics(SM_CYVIRTUALSCREEN);
        int margin = 8;
        int size = 4;
        POINT[] candidates = new POINT[]
        {
            new POINT { X = vx + margin, Y = vy + margin },
            new POINT { X = vx + vw - size - margin, Y = vy + margin },
            new POINT { X = vx + margin, Y = vy + vh - size - margin },
            new POINT { X = vx + vw - size - margin, Y = vy + vh - size - margin },
        };
        foreach (POINT p in candidates)
        {
            RECT r = new RECT();
            r.Left = p.X; r.Top = p.Y; r.Right = p.X + size; r.Bottom = p.Y + size;
            if (!Intersects(r, target)) return p;
        }
        return candidates[0];
    }

    static bool InjectTouch(IntPtr dev, uint id, POINT pt, uint flags)
    {
        POINTER_TYPE_INFO info = new POINTER_TYPE_INFO();
        info.type = PT_TOUCH;
        info.touchInfo.pointerInfo.pointerType = PT_TOUCH;
        info.touchInfo.pointerInfo.pointerId = id;
        info.touchInfo.pointerInfo.pointerFlags = flags;
        info.touchInfo.pointerInfo.ptPixelLocation = pt;
        info.touchInfo.touchFlags = 0;
        info.touchInfo.touchMask = TOUCH_MASK_CONTACTAREA | TOUCH_MASK_ORIENTATION | TOUCH_MASK_PRESSURE;
        info.touchInfo.rcContact.Left = pt.X - 2;
        info.touchInfo.rcContact.Top = pt.Y - 2;
        info.touchInfo.rcContact.Right = pt.X + 2;
        info.touchInfo.rcContact.Bottom = pt.Y + 2;
        info.touchInfo.rcContactRaw = info.touchInfo.rcContact;
        info.touchInfo.orientation = 90;
        info.touchInfo.pressure = 32000;
        return InjectSyntheticPointerInput(dev, new POINTER_TYPE_INFO[] { info }, 1);
    }

    static Dictionary<string, object> ExecuteSynthetic(IntPtr hwnd, POINT pt, int expectedPid)
    {
        string bad = CheckAction(hwnd, expectedPid);
        if (bad.Length > 0) return Fail(bad, bad);
        if (IsIconic(hwnd)) return Fail("unavailable", "target window is minimized");
        if (!OnDesktop(pt)) return Fail("outside_desktop", "target point is outside the desktop");
        RECT targetRect;
        GetWindowRect(hwnd, out targetRect);
        POINT origin = ChooseAnchorOrigin(targetRect);
        SetWindowPos(anchor, new IntPtr(-1), origin.X, origin.Y, 4, 4, SWP_NOACTIVATE | SWP_NOOWNERZORDER);
        GetWindowRect(anchor, out anchorRect);
        anchorCenter.X = (anchorRect.Left + anchorRect.Right) / 2;
        anchorCenter.Y = (anchorRect.Top + anchorRect.Bottom) / 2;
        if (PtInRect(ref anchorRect, pt)) return Fail("anchor_blocked", "target point is covered by the anchor window");
        if (WindowFromPoint(anchorCenter) != anchor) return Fail("anchor_blocked", "anchor window is covered by another topmost window");
        IntPtr hit = WindowFromPoint(pt);
        if (hit == IntPtr.Zero) return Fail("outside_desktop", "no window at target point");
        IntPtr root = GetAncestor(hit, GA_ROOT);
        if (hit != hwnd && root != hwnd && !IsChild(hwnd, hit))
            return Fail("occluded", "target point belongs to another window hit=" + hit.ToInt64() + " root=" + root.ToInt64() + " hwnd=" + hwnd.ToInt64() + " child=" + IsChild(hwnd, hit));
        bool fgBefore = GetForegroundWindow() == GetAncestor(hwnd, GA_ROOTOWNER);
        uint downFlags = POINTER_FLAG_DOWN | POINTER_FLAG_INRANGE | POINTER_FLAG_INCONTACT | POINTER_FLAG_CONFIDENCE;
        if (!InjectTouch(device, 1, anchorCenter, downFlags))
            return Fail("injection_failed", "anchor touch down failed");
        anchorDown = true;
        Thread.Sleep(12);
        if (!InjectTouch(device, 2, pt, downFlags))
        {
            bool anchorUp = InjectTouch(device, 1, anchorCenter, POINTER_FLAG_UP);
            if (!anchorUp) workerUnhealthy = true;
            anchorDown = !anchorUp;
            return Fail("injection_failed", "target touch down failed");
        }
        Thread.Sleep(12);
        bool upOk = InjectTouch(device, 2, pt, POINTER_FLAG_UP);
        if (!upOk) upOk = InjectTouch(device, 2, pt, POINTER_FLAG_UP);
        if (!upOk) workerUnhealthy = true; // pointer 2 may still be down; do not reuse this worker.
        Thread.Sleep(12);
        bool anchorUpOk = InjectTouch(device, 1, anchorCenter, POINTER_FLAG_UP);
        if (!anchorUpOk) anchorUpOk = InjectTouch(device, 1, anchorCenter, POINTER_FLAG_UP);
        if (!anchorUpOk) workerUnhealthy = true;
        else anchorDown = false;
        bool fgAfter = GetForegroundWindow() == GetAncestor(hwnd, GA_ROOTOWNER);
        Dictionary<string, object> d = Ok();
        d["delivered"] = true;
        d["method"] = "synthetic_touch";
        d["effect"] = "unverifiable";
        d["anchorUsed"] = true;
        d["complete"] = upOk && anchorUpOk;
        if (!upOk || !anchorUpOk) d["warning_code"] = "inject_up_failed";
        AddSideEffects(d, false, false, false, fgBefore != fgAfter);
        return d;
    }

    public static Dictionary<string, object> SyntheticClick(long hwndL, int expectedPid, int sx, int sy)
    {
        IntPtr hwnd = new IntPtr(hwndL);
        string bad = CheckAction(hwnd, expectedPid);
        if (bad.Length > 0) return Fail(bad, bad);
        if (IsIconic(hwnd)) return Fail("unavailable", "target window is minimized");
        POINT pt = new POINT();
        pt.X = sx; pt.Y = sy;
        if (!OnDesktop(pt)) return Fail("outside_desktop", "target point is outside the desktop");
        if (!EnsureWorker()) return Fail("synthetic_unavailable", workerError ?? "synthetic worker unavailable");
        lock (workerSync)
        {
            pendingHwnd = hwnd;
            pendingPoint = pt;
            pendingPid = expectedPid;
            pendingResult = null;
            doneEvent.Reset();
        }
        cmdEvent.Set();
        if (!doneEvent.Wait(6000))
        {
            // Worker may still be injecting; mark unhealthy so the next request rebuilds it.
            workerUnhealthy = true;
            return Fail("synthetic_timeout", "synthetic click timed out; result unknown");
        }
        lock (workerSync)
        {
            return pendingResult ?? Fail("synthetic_failed", "synthetic click returned no result");
        }
    }

    // ---- lifecycle ----
    public static Dictionary<string, object> Restore()
    {
        StopWorker();
        Dictionary<string, object> d = Ok();
        d["restored"] = true;
        return d;
    }

    public static Dictionary<string, object> Shutdown()
    {
        StopWorker();
        Dictionary<string, object> d = Ok();
        d["shutdown"] = true;
        return d;
    }
}
'@

Add-Type -TypeDefinition $src -Language CSharp

[Console]::Out.WriteLine('{"ready":true}')
[Console]::Out.Flush()

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $cmd = ''
    try {
        $req = $line | ConvertFrom-Json
        $cmd = [string]$req.cmd
        $resp = $null
        switch ($cmd) {
            'probe' { $resp = [DshInput]::Probe([long]$req.hwnd, [int]$req.pid) }
            'postMouse' { $resp = [DshInput]::PostMouse([long]$req.hwnd, [int]$req.pid, [int]$req.x, [int]$req.y, [string]$req.button, [int]$req.count) }
            'postKey' { $resp = [DshInput]::PostKey([long]$req.hwnd, [int]$req.pid, [int]$req.vk, [bool]$req.extended) }
            'postText' {
                $bytes = [Convert]::FromBase64String([string]$req.textB64)
                $text = [System.Text.Encoding]::UTF8.GetString($bytes)
                $resp = [DshInput]::PostText([long]$req.hwnd, [int]$req.pid, [bool]$req.hasPoint, [int]$req.x, [int]$req.y, $text)
            }
            'syntheticClick' { $resp = [DshInput]::SyntheticClick([long]$req.hwnd, [int]$req.pid, [int]$req.x, [int]$req.y) }
            'cursorClick' { $resp = [DshInput]::CursorClick([long]$req.hwnd, [int]$req.pid, [int]$req.x, [int]$req.y) }
            'windowClick' { $resp = [DshInput]::WindowClick([long]$req.hwnd, [int]$req.pid, [int]$req.clientX, [int]$req.clientY) }
            'restore' { $resp = [DshInput]::Restore() }
            'shutdown' { $resp = [DshInput]::Shutdown() }
            default { $resp = @{ ok = $false; code = 'unknown_command'; error = "unknown command: $cmd"; delivered = $false } }
        }
        if ($null -eq $resp) { $resp = @{ ok = $false; code = 'no_response'; error = 'helper returned null'; delivered = $false } }
        $json = $resp | ConvertTo-Json -Compress -Depth 8
        [Console]::Out.WriteLine($json)
        [Console]::Out.Flush()
        if ($cmd -eq 'shutdown') { break }
        if ([DshInput]::Fatal) { break }
    } catch {
        $msg = $_.Exception.Message
        $json = @{ ok = $false; code = 'exception'; error = $msg; delivered = $false } | ConvertTo-Json -Compress
        [Console]::Out.WriteLine($json)
        [Console]::Out.Flush()
    }
}
