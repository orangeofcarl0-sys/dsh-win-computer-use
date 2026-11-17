# DSH private drag helper (ASCII only; PowerShell 5.1 safe).
# Protocol: one JSON request per stdin line, one JSON response per stdout line.
# Request: { hwnd, fromX, fromY, toX, toY, steps, durationMs, dwellMs, button, modifier[] }
# Coordinates are SCREEN PHYSICAL pixels (virtual desktop). The helper owns the
# whole gesture: foreground -> modifiers -> mouse down -> moves -> up -> modifiers up.

$ErrorActionPreference = 'Stop'

$src = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class DshPrivateDrag
{
    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT
    {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public UIntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public UIntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct HARDWAREINPUT
    {
        public uint uMsg;
        public ushort wParamL;
        public ushort wParamH;
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct InputUnion
    {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
        [FieldOffset(0)] public HARDWAREINPUT hi;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT
    {
        public uint type;
        public InputUnion U;
    }

    [DllImport("user32.dll", SetLastError = true)]
    static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
    [DllImport("user32.dll")]
    static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")]
    static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr processId);
    [DllImport("kernel32.dll")]
    static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")]
    static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("user32.dll")]
    static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")]
    static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    static extern int GetSystemMetrics(int nIndex);
    [DllImport("user32.dll")]
    static extern short GetAsyncKeyState(int vKey);
    [DllImport("winmm.dll")]
    static extern uint timeBeginPeriod(uint uPeriod);
    [DllImport("winmm.dll")]
    static extern uint timeEndPeriod(uint uPeriod);
    [DllImport("user32.dll")]
    static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")]
    static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);

    const uint INPUT_MOUSE = 0;
    const uint INPUT_KEYBOARD = 1;
    const uint MOUSEEVENTF_MOVE = 0x0001;
    const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    const uint MOUSEEVENTF_LEFTUP = 0x0004;
    const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    const uint MOUSEEVENTF_ABSOLUTE = 0x8000;
    const uint MOUSEEVENTF_VIRTUALDESK = 0x4000;
    const uint KEYEVENTF_KEYUP = 0x0002;

    const int VK_SHIFT = 0x10;
    const int VK_CONTROL = 0x11;
    const int VK_MENU = 0x12;
    const int VK_LWIN = 0x5B;
    const int VK_LBUTTON = 0x01;
    const int VK_RBUTTON = 0x02;
    const int VK_MBUTTON = 0x04;

    static INPUT MouseInput(uint flags, int dx, int dy)
    {
        INPUT input = new INPUT();
        input.type = INPUT_MOUSE;
        input.U.mi.dx = dx;
        input.U.mi.dy = dy;
        input.U.mi.mouseData = 0;
        input.U.mi.dwFlags = flags;
        input.U.mi.time = 0;
        input.U.mi.dwExtraInfo = UIntPtr.Zero;
        return input;
    }

    static INPUT KeyInput(int vk, bool up)
    {
        INPUT input = new INPUT();
        input.type = INPUT_KEYBOARD;
        input.U.ki.wVk = (ushort)vk;
        input.U.ki.wScan = 0;
        input.U.ki.dwFlags = up ? KEYEVENTF_KEYUP : 0;
        input.U.ki.time = 0;
        input.U.ki.dwExtraInfo = UIntPtr.Zero;
        return input;
    }

    static int SendOne(INPUT input)
    {
        INPUT[] arr = new INPUT[] { input };
        uint sent = SendInput(1, arr, Marshal.SizeOf(typeof(INPUT)));
        return sent == 1 ? 1 : 0;
    }

    static int SendChecked(INPUT input)
    {
        int n = SendOne(input);
        if (n != 1) throw new InvalidOperationException("SendInput returned 0 (UIPI or blocked input)");
        return n;
    }

    static int Norm(int value, int origin, int size)
    {
        if (size <= 1) return 0;
        long n = ((long)value - (long)origin) * 65535L / ((long)size - 1L);
        if (n < 0L) n = 0L;
        if (n > 65535L) n = 65535L;
        return (int)n;
    }

    static int VkOf(string key)
    {
        string k = (key == null ? "" : key.Trim().ToLowerInvariant());
        if (k == "ctrl" || k == "control") return VK_CONTROL;
        if (k == "shift") return VK_SHIFT;
        if (k == "alt" || k == "option") return VK_MENU;
        if (k == "win" || k == "cmd" || k == "command") return VK_LWIN;
        return 0;
    }

    static bool IsDown(int vk)
    {
        return (GetAsyncKeyState(vk) & 0x8000) != 0;
    }

    static string Esc(string s)
    {
        if (s == null) return "";
        return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", " ").Replace("\n", " ");
    }

    static string Fail(string code, int sent, string detail)
    {
        return "{\"ok\":false,\"code\":\"" + Esc(code) + "\",\"sent\":" + sent
            + ",\"detail\":\"" + Esc(detail) + "\"}";
    }

    public static string Drag(int hwnd, int fromX, int fromY, int toX, int toY,
        int steps, int durationMs, int dwellMs, int button, string[] modifiers)
    {
        int sent = 0;
        bool buttonDown = false;
        bool[] held = new bool[4];
        int[] vks = new int[4];
        IntPtr target = new IntPtr(hwnd);
        IntPtr previous = IntPtr.Zero;
        uint previousThread = 0;
        uint currentThread = 0;
        bool foregroundRestored = true;
        string failure = "";

        if (steps < 1) steps = 1;
        if (steps > 200) steps = 200;
        if (durationMs < 0) durationMs = 0;
        if (durationMs > 10000) durationMs = 10000;
        if (dwellMs < 0) dwellMs = 0;
        if (dwellMs > 2000) dwellMs = 2000;

        uint downFlag = MOUSEEVENTF_LEFTDOWN;
        uint upFlag = MOUSEEVENTF_LEFTUP;
        int buttonVk = VK_LBUTTON;
        if (button == 1) { downFlag = MOUSEEVENTF_RIGHTDOWN; upFlag = MOUSEEVENTF_RIGHTUP; buttonVk = VK_RBUTTON; }
        if (button == 2) { downFlag = MOUSEEVENTF_MIDDLEDOWN; upFlag = MOUSEEVENTF_MIDDLEUP; buttonVk = VK_MBUTTON; }

        try
        {
            try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }
            try { SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch { }
            timeBeginPeriod(1);

            if (hwnd == 0)
            {
                return Fail("bad_window", sent, "hwnd is 0");
            }

            int vx = GetSystemMetrics(76);
            int vy = GetSystemMetrics(77);
            int vw = GetSystemMetrics(78);
            int vh = GetSystemMetrics(79);
            if (vw <= 1 || vh <= 1)
            {
                return Fail("bad_virtual_desk", sent, "virtual screen metrics unavailable");
            }

            previous = GetForegroundWindow();
            currentThread = GetCurrentThreadId();
            if (previous != IntPtr.Zero)
            {
                previousThread = GetWindowThreadProcessId(previous, IntPtr.Zero);
            }
            if (IsIconic(target)) ShowWindow(target, 9);
            if (previousThread != 0 && previousThread != currentThread)
            {
                AttachThreadInput(currentThread, previousThread, true);
            }
            SetForegroundWindow(target);
            if (previousThread != 0 && previousThread != currentThread)
            {
                AttachThreadInput(currentThread, previousThread, false);
            }
            Thread.Sleep(90);
            if (GetForegroundWindow() != target)
            {
                return Fail("foreground_unavailable", sent, "target did not become foreground");
            }

            SetCursorPos(fromX, fromY);
            sent += SendChecked(MouseInput(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
                Norm(fromX, vx, vw), Norm(fromY, vy, vh)));
            Thread.Sleep(40);

            string[] mods = modifiers == null ? new string[0] : modifiers;
            for (int i = 0; i < mods.Length && i < 4; i++)
            {
                int vk = VkOf(mods[i]);
                if (vk == 0) continue;
                vks[i] = vk;
                if (IsDown(vk))
                {
                    held[i] = false;
                    continue;
                }
                sent += SendChecked(KeyInput(vk, false));
                held[i] = true;
            }
            Thread.Sleep(30);

            sent += SendChecked(MouseInput(downFlag, 0, 0));
            buttonDown = true;
            Thread.Sleep(100);

            double dx = (double)toX - (double)fromX;
            double dy = (double)toY - (double)fromY;
            int firstX = fromX;
            int firstY = fromY;
            if (Math.Abs(dx) >= Math.Abs(dy))
            {
                firstX = fromX + (dx >= 0 ? 6 : -6);
            }
            else
            {
                firstY = fromY + (dy >= 0 ? 6 : -6);
            }
            sent += SendChecked(MouseInput(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
                Norm(firstX, vx, vw), Norm(firstY, vy, vh)));
            Thread.Sleep(30);

            int sleepPer = steps > 0 ? durationMs / steps : 0;
            int lastX = firstX;
            int lastY = firstY;
            for (int i = 1; i <= steps; i++)
            {
                int x = fromX + (int)Math.Round(dx * (double)i / (double)steps);
                int y = fromY + (int)Math.Round(dy * (double)i / (double)steps);
                if (x == lastX && y == lastY) continue;
                sent += SendChecked(MouseInput(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
                    Norm(x, vx, vw), Norm(y, vy, vh)));
                lastX = x;
                lastY = y;
                if (sleepPer > 0) Thread.Sleep(sleepPer);
            }
            if (lastX != toX || lastY != toY)
            {
                sent += SendChecked(MouseInput(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
                    Norm(toX, vx, vw), Norm(toY, vy, vh)));
            }
            if (dwellMs > 0) Thread.Sleep(dwellMs);

            sent += SendChecked(MouseInput(upFlag, 0, 0));
            buttonDown = false;
            Thread.Sleep(70);
        }
        catch (Exception ex)
        {
            failure = ex.GetType().Name + ": " + ex.Message;
        }
        finally
        {
            if (buttonDown)
            {
                try { SendOne(MouseInput(upFlag, 0, 0)); } catch { }
                buttonDown = false;
            }
            for (int i = held.Length - 1; i >= 0; i--)
            {
                if (held[i] && vks[i] != 0)
                {
                    try { SendOne(KeyInput(vks[i], true)); } catch { }
                    held[i] = false;
                }
            }
            if (previous != IntPtr.Zero && previous != target)
            {
                try
                {
                    if (IsIconic(previous)) { }
                    uint pt = GetWindowThreadProcessId(previous, IntPtr.Zero);
                    uint ct = GetCurrentThreadId();
                    if (pt != 0 && pt != ct) AttachThreadInput(ct, pt, true);
                    foregroundRestored = SetForegroundWindow(previous);
                    if (pt != 0 && pt != ct) AttachThreadInput(ct, pt, false);
                }
                catch { foregroundRestored = false; }
            }
            try { timeEndPeriod(1); } catch { }
        }

        bool stuckButton = IsDown(buttonVk);
        StringBuilder stuck = new StringBuilder();
        for (int i = 0; i < vks.Length; i++)
        {
            if (vks[i] != 0 && IsDown(vks[i]))
            {
                if (stuck.Length > 0) stuck.Append(",");
                stuck.Append(vks[i]);
            }
        }
        if (failure.Length > 0)
        {
            return "{\"ok\":false,\"code\":\"exception\",\"sent\":" + sent
                + ",\"detail\":\"" + Esc(failure) + "\",\"stuckButton\":" + (stuckButton ? "true" : "false")
                + ",\"stuckModifiers\":\"" + Esc(stuck.ToString()) + "\"}";
        }
        return "{\"ok\":true,\"code\":\"\",\"sent\":" + sent
            + ",\"foregroundRestored\":" + (foregroundRestored ? "true" : "false")
            + ",\"stuckButton\":" + (stuckButton ? "true" : "false")
            + ",\"stuckModifiers\":\"" + Esc(stuck.ToString()) + "\"}";
    }
}
'@

Add-Type -TypeDefinition $src -Language CSharp

[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if ($line.Trim().Length -eq 0) { continue }
    try {
        $req = ConvertFrom-Json $line
        $mods = [string[]]@()
        if ($null -ne $req.modifier) {
            $mods = [string[]]@($req.modifier | ForEach-Object { [string]$_ })
        }
        $out = [DshPrivateDrag]::Drag(
            [int]$req.hwnd, [int]$req.fromX, [int]$req.fromY, [int]$req.toX, [int]$req.toY,
            [int]$req.steps, [int]$req.durationMs, [int]$req.dwellMs, [int]$req.button, $mods)
        [Console]::Out.WriteLine($out)
    } catch {
        $msg = [string]$_.Exception.Message
        $msg = $msg.Replace('\', '\\').Replace('"', '\"').Replace("`r", ' ').Replace("`n", ' ')
        [Console]::Out.WriteLine('{"ok":false,"code":"exception","sent":0,"detail":"' + $msg + '"}')
    }
    [Console]::Out.Flush()
}
