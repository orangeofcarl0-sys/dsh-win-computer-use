/**
 * probe-b2-elevated.mjs — one-shot UAC diagnostic for B2 BlockInput.
 *
 * The production helper runs as a normal (usually Medium IL) PowerShell child.
 * When BlockInput(TRUE) fails there, this probe answers the root-cause question:
 * does BlockInput work from an elevated process in the same interactive session?
 *
 * It does NOT change the plugin or start the background-input helper. The
 * elevated script blocks input for a few milliseconds, immediately unblocks it
 * in a finally block, and writes a JSON result to a temp file.
 *
 * Status semantics:
 *   PASS   — elevated diagnostic completed; blockInputOk tells the answer
 *   BLOCKED— UAC cancelled / no elevated result / non-Windows
 *   FAIL   — probe itself malformed (bad JSON, launcher error that is not UAC)
 *
 * Run: node evals/probe-b2-elevated.mjs
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const isWin = process.platform === 'win32'
const results = []
let failed = 0
let blocked = 0

function record(name, status, detail = '', data = undefined) {
  results.push({ name, status, detail, data })
  if (status === 'FAIL') failed++
  if (status === 'BLOCKED') blocked++
  const icon = status === 'PASS' ? '✅' : status === 'BLOCKED' ? '⛔' : '❌'
  console.log(`${icon} ${name}${detail ? ` — ${detail}` : ''}`)
}

function psQuote(s) {
  return `'${String(s).replace(/'/g, "''")}'`
}

const elevatedScript = `param([string]$OutFile)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class S4B2 {
    [DllImport("user32.dll", SetLastError = true)] public static extern bool BlockInput(bool block);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("kernel32.dll")] public static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] public static extern uint GetCurrentProcessId();
    [DllImport("kernel32.dll")] public static extern bool ProcessIdToSessionId(uint pid, out uint session);
    [DllImport("kernel32.dll")] public static extern uint WTSGetActiveConsoleSessionId();
    [DllImport("advapi32.dll", SetLastError = true)] public static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)] public static extern bool GetTokenInformation(IntPtr token, int cls, IntPtr info, int len, out int needed);
    [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] public static extern void SetLastError(uint code);

    public static uint TokenDword(int cls) {
        IntPtr token = IntPtr.Zero;
        IntPtr buf = IntPtr.Zero;
        try {
            if (!OpenProcessToken(GetCurrentProcess(), 0x0008, out token)) return 0;
            buf = Marshal.AllocHGlobal(4);
            int needed = 0;
            if (!GetTokenInformation(token, cls, buf, 4, out needed)) return 0;
            return (uint)Marshal.ReadInt32(buf);
        } finally {
            if (buf != IntPtr.Zero) Marshal.FreeHGlobal(buf);
            if (token != IntPtr.Zero) CloseHandle(token);
        }
    }
}
'@
$started = [Environment]::TickCount
$ok = $false
$win32 = 0
$unblockOk = $null
$unblockWin32 = 0
try {
  [S4B2]::SetLastError(0)
  $ok = [S4B2]::BlockInput($true)
  $win32 = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
} finally {
  if ($ok) {
    [S4B2]::SetLastError(0)
    $unblockOk = [S4B2]::BlockInput($false)
    $unblockWin32 = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
  }
}
[uint32]$session = 0
[void][S4B2]::ProcessIdToSessionId([S4B2]::GetCurrentProcessId(), [ref]$session)
$fg = [S4B2]::GetForegroundWindow()
[uint32]$fgPid = 0
[void][S4B2]::GetWindowThreadProcessId($fg, [ref]$fgPid)
$out = [ordered]@{
  ok = $true
  elevated = ([S4B2]::TokenDword(20) -ne 0)
  uiAccess = ([S4B2]::TokenDword(26) -ne 0)
  blockInputOk = $ok
  blockInputError = $win32
  blockInputUnblockOk = $unblockOk
  blockInputUnblockError = $unblockWin32
  blockedMs = [Environment]::TickCount - $started
  sessionId = [int]$session
  activeConsoleSessionId = [int][S4B2]::WTSGetActiveConsoleSessionId()
  foregroundPid = [int]$fgPid
}
[IO.File]::WriteAllText($OutFile, ($out | ConvertTo-Json -Compress))
`

let tempDir = ''
try {
  if (!isWin) {
    record('环境', 'BLOCKED', '非 Windows；BlockInput 提权探针不适用')
  } else {
    tempDir = mkdtempSync(join(tmpdir(), 's4-b2-elevated-'))
    const scriptPath = join(tempDir, 'b2-elevated.ps1')
    const outFile = join(tempDir, 'result.json')
    const launcherPath = join(tempDir, 'launch.ps1')
    writeFileSync(scriptPath, elevatedScript, 'utf8')
    writeFileSync(launcherPath, [
      '$ErrorActionPreference = "Stop"',
      `$p = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File', ${psQuote(scriptPath)}, '-OutFile', ${psQuote(outFile)}) -Verb RunAs -Wait -PassThru -WindowStyle Hidden`,
      'exit $p.ExitCode',
      '',
    ].join('\n'), 'utf8')

    const direct = process.argv.includes('--no-uac')
    const launchArgs = direct
      ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-OutFile', outFile]
      : ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', launcherPath]
    const launched = await new Promise((resolve) => {
      let settled = false
      let timer = null
      let ps = null
      const finish = (value) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        resolve(value)
      }
      ps = spawn('powershell.exe', launchArgs, {
        windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      })
      let err = ''
      ps.stderr.on('data', (d) => { err += d })
      ps.on('error', (e) => finish({ code: -1, err: String(e.message || e) }))
      ps.on('close', (code) => finish({ code, err }))
      timer = setTimeout(() => {
        try { ps.kill() } catch { /* ignore */ }
        finish({ code: -2, err: 'timeout waiting for UAC approval/result (90s)' })
      }, 90000)
    })

    if (!existsSync(outFile)) {
      const uacCancel = /canceled|cancelled|已取消|拒绝|elevation|The operation was canceled/i.test(launched.err)
      record('提权诊断', 'BLOCKED', uacCancel
        ? `UAC 被取消/拒绝；未得到结果：${launched.err.slice(-200)}`
        : `未得到提权结果（exit=${launched.code}）：${launched.err.slice(-300)}`)
    } else {
      let data = null
      try { data = JSON.parse(readFileSync(outFile, 'utf8')) } catch (err) {
        record('提权诊断', 'FAIL', `结果不是 JSON：${String(err?.message || err)}`)
      }
      if (data) {
        record('提权诊断完成', 'PASS',
          `elevated=${data.elevated} uiAccess=${data.uiAccess} BlockInput=${data.blockInputOk} err=${data.blockInputError} unblock=${data.blockInputUnblockOk} blockedMs=${data.blockedMs} session=${data.sessionId}/${data.activeConsoleSessionId}`,
          data)
        if (data.elevated !== true) {
          record('提权确认', 'BLOCKED', '进程仍非 High IL；UIAccess 未开启，无法据此判断 BlockInput 的提权条件')
        } else if (data.blockInputOk === true) {
          record('BlockInput 提权结论', 'PASS', '提权后 BlockInput 成功：严格 B2 属于 elevated/UIAccess-only，默认进程继续保持 BLOCKED')
        } else {
          record('BlockInput 提权结论', 'BLOCKED', `提权后仍失败（win32=${data.blockInputError}）：可能是输入已被阻塞、非活动输入桌面或策略拒绝`)
        }
      }
    }
  }
} catch (err) {
  record('探针异常', 'FAIL', String(err?.message || err).slice(0, 400))
} finally {
  if (tempDir && !process.env.S4_KEEP) {
    try { rmSync(tempDir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}

console.log(`\n${results.filter((x) => x.status === 'PASS').length} PASS / ${blocked} BLOCKED / ${failed} FAIL`)
console.log(`JSON ${JSON.stringify({ title: 'b2-elevated', results })}`)
process.exit(failed > 0 ? 1 : 0)
