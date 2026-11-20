param(
  [string]$StateFile,
  [string]$LogFile,
  [string]$CoverFile,
  [string]$StopFile
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;

public static class ProbeTouch
{
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential)] public struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public POINT pt; }
    public delegate IntPtr WndProc(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct WNDCLASSEX
    {
        public uint cbSize; public uint style; public WndProc lpfnWndProc;
        public int cbClsExtra; public int cbWndExtra; public IntPtr hInstance;
        public IntPtr hIcon; public IntPtr hCursor; public IntPtr hbrBackground;
        public string lpszMenuName; public string lpszClassName; public IntPtr hIconSm;
    }
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern ushort RegisterClassEx(ref WNDCLASSEX wc);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateWindowEx(uint ex, string cls, string name, uint style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr inst, IntPtr param);
    [DllImport("user32.dll")] static extern bool RegisterTouchWindow(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] static extern bool CloseTouchInputHandle(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int cmd);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] static extern bool DestroyWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern IntPtr DefWindowProc(IntPtr hwnd, uint msg, IntPtr w, IntPtr l);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
    [DllImport("kernel32.dll")] static extern uint GetCurrentProcessId();

    public static IntPtr Hwnd = IntPtr.Zero;
    static string logPath = "";
    static WndProc proc = WndProcImpl;

    public static string Start(string title, int x, int y, int w, int h, string logFile)
    {
        logPath = logFile;
        string cls = "DshProbeTouch_" + GetCurrentProcessId() + "_" + Environment.TickCount;
        WNDCLASSEX wc = new WNDCLASSEX();
        wc.cbSize = (uint)Marshal.SizeOf(typeof(WNDCLASSEX));
        wc.lpfnWndProc = proc;
        wc.hInstance = GetModuleHandle(null);
        wc.hbrBackground = new IntPtr(6);
        wc.lpszClassName = cls;
        if (RegisterClassEx(ref wc) == 0) return "register_failed";
        uint style = 0x00C00000u | 0x00080000u | 0x10000000u;
        Hwnd = CreateWindowEx(0x00000008u, cls, title, style, x, y, w, h, IntPtr.Zero, IntPtr.Zero, wc.hInstance, IntPtr.Zero);
        if (Hwnd == IntPtr.Zero) return "create_failed";
        if (!RegisterTouchWindow(Hwnd, 0)) return "touch_failed";
        ShowWindow(Hwnd, 5);
        SetWindowPos(Hwnd, new IntPtr(-1), x, y, w, h, 0x0010);
        return "ok";
    }

    public static void MoveTo(IntPtr h, int x, int y)
    {
        if (h != IntPtr.Zero) SetWindowPos(h, IntPtr.Zero, x, y, 0, 0, 0x0001 | 0x0004 | 0x0010);
    }

    public static void SetTop(IntPtr h)
    {
        if (h != IntPtr.Zero) SetWindowPos(h, new IntPtr(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010);
    }

    public static void Close()
    {
        if (Hwnd != IntPtr.Zero) { DestroyWindow(Hwnd); Hwnd = IntPtr.Zero; }
    }

    static void Log(string line)
    {
        try { File.AppendAllText(logPath, line + "\n"); } catch { }
    }

    static IntPtr WndProcImpl(IntPtr hwnd, uint msg, IntPtr w, IntPtr l)
    {
        if (msg == 0x0201) { Log("MOUSEDOWN"); return IntPtr.Zero; }
        if (msg == 0x0202) { Log("MOUSEUP"); return IntPtr.Zero; }
        if (msg == 0x0100) { Log("KEYDOWN:" + w.ToInt64()); return IntPtr.Zero; }
        if (msg == 0x0102) { Log("CHAR:" + w.ToInt64()); return IntPtr.Zero; }
        if (msg == 0x0246) { Log("TOUCHDOWN"); return IntPtr.Zero; }
        if (msg == 0x0247) { Log("TOUCHUP"); return IntPtr.Zero; }
        if (msg == 0x0240) { Log("WMTOUCH"); try { CloseTouchInputHandle(l); } catch { } return IntPtr.Zero; }
        if (msg == 0x0021) return new IntPtr(3);
        return DefWindowProc(hwnd, msg, w, l);
    }
}

public static class ProbeTouchOnly
{
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
    public delegate IntPtr WndProc(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct WNDCLASSEX
    {
        public uint cbSize; public uint style; public WndProc lpfnWndProc;
        public int cbClsExtra; public int cbWndExtra; public IntPtr hInstance;
        public IntPtr hIcon; public IntPtr hCursor; public IntPtr hbrBackground;
        public string lpszMenuName; public string lpszClassName; public IntPtr hIconSm;
    }
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern ushort RegisterClassEx(ref WNDCLASSEX wc);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateWindowEx(uint ex, string cls, string name, uint style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr inst, IntPtr param);
    [DllImport("user32.dll")] static extern bool RegisterTouchWindow(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] static extern bool CloseTouchInputHandle(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int cmd);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] static extern bool DestroyWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern IntPtr DefWindowProc(IntPtr hwnd, uint msg, IntPtr w, IntPtr l);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
    [DllImport("kernel32.dll")] static extern uint GetCurrentProcessId();

    public static IntPtr Hwnd = IntPtr.Zero;
    static string logPath = "";
    static WndProc proc = WndProcImpl;

    public static string Start(string title, int x, int y, int w, int h, string logFile)
    {
        logPath = logFile;
        string cls = "DshProbeTouchOnly_" + GetCurrentProcessId() + "_" + Environment.TickCount;
        WNDCLASSEX wc = new WNDCLASSEX();
        wc.cbSize = (uint)Marshal.SizeOf(typeof(WNDCLASSEX));
        wc.lpfnWndProc = proc;
        wc.hInstance = GetModuleHandle(null);
        wc.hbrBackground = new IntPtr(6);
        wc.lpszClassName = cls;
        if (RegisterClassEx(ref wc) == 0) return "register_failed";
        uint style = 0x00C00000u | 0x00080000u | 0x10000000u;
        Hwnd = CreateWindowEx(0x00000008u, cls, title, style, x, y, w, h, IntPtr.Zero, IntPtr.Zero, wc.hInstance, IntPtr.Zero);
        if (Hwnd == IntPtr.Zero) return "create_failed";
        if (!RegisterTouchWindow(Hwnd, 0)) return "touch_failed";
        ShowWindow(Hwnd, 5);
        SetWindowPos(Hwnd, new IntPtr(-1), x, y, w, h, 0x0010);
        return "ok";
    }

    public static void Close()
    {
        if (Hwnd != IntPtr.Zero) { DestroyWindow(Hwnd); Hwnd = IntPtr.Zero; }
    }

    static void Log(string line)
    {
        try { File.AppendAllText(logPath, line + "\n"); } catch { }
    }

    static IntPtr WndProcImpl(IntPtr hwnd, uint msg, IntPtr w, IntPtr l)
    {
        if (msg == 0x0240) { Log("WMTOUCH"); try { CloseTouchInputHandle(l); } catch { } return IntPtr.Zero; }
        if (msg == 0x0021) return new IntPtr(3);
        return DefWindowProc(hwnd, msg, w, l);
    }
}
'@

[IO.File]::WriteAllText($LogFile, "")

$form = New-Object System.Windows.Forms.Form
$form.Text = 'BG-CONTROLLER'
$form.Width = 400
$form.Height = 250
$form.StartPosition = 'Manual'
$form.Left = -32000
$form.Top = -32000
$form.FormBorderStyle = 'None'
$form.ShowInTaskbar = $false
$form.BackColor = [System.Drawing.Color]::Black

$script:started = [Environment]::TickCount
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 100
$timer.Add_Tick({
    $want = ''
    try { if ([IO.File]::Exists($CoverFile)) { $want = ([IO.File]::ReadAllText($CoverFile)).Trim() } } catch { }
    if ($want -eq '1') {
        [ProbeTouch]::MoveTo($form.Handle, 3000, 700)
        [ProbeTouch]::SetTop($form.Handle)
    }
    else {
        [ProbeTouch]::MoveTo($form.Handle, -32000, -32000)
        [ProbeTouch]::SetTop([ProbeTouch]::Hwnd)
    }
    $stop = [IO.File]::Exists($StopFile)
    $timeout = ([Environment]::TickCount - $script:started) -gt 300000
    if ($stop -or $timeout) {
        $timer.Stop()
        [ProbeTouch]::Close()
        [ProbeTouchOnly]::Close()
        $form.Close()
    }
})
$timer.Start()

$form.Add_Shown({
    $script:touch = [ProbeTouch]::Start('BG-POINTER', 3000, 700, 400, 250, ($LogFile + '.wnd'))
    if ($script:touch -ne 'ok') { throw "touch window failed: $script:touch" }
    $script:touchOnly = [ProbeTouchOnly]::Start('BG-TOUCHONLY', 3000, 1000, 400, 250, ($LogFile + '.touch'))
    if ($script:touchOnly -ne 'ok') { throw "touch-only window failed: $script:touchOnly" }
    $state = [ordered]@{
        pid = $PID
        message = [int64][ProbeTouch]::Hwnd
        pointer = [int64][ProbeTouch]::Hwnd
        touchOnly = [int64][ProbeTouchOnly]::Hwnd
        cover = [int64]$form.Handle
    }
    [IO.File]::WriteAllText($StateFile, ($state | ConvertTo-Json -Compress))
})

[System.Windows.Forms.Application]::Run($form)
[ProbeTouch]::Close()
[ProbeTouchOnly]::Close()
