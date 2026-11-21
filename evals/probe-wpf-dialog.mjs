#!/usr/bin/env node
/**
 * probe-wpf-dialog.mjs — read-only WPF modal evidence (no install, no model).
 *
 * A PowerShell WPF fixture opens a modal WPF Window on a timer, so the probe
 * can measure the modal window's class/owner/UIA tree without triggering a
 * 30s click. It records:
 *   - main WPF UIA tree before modal
 *   - modal top-level window class/owner/title
 *   - UIA tree at 1s/5s budgets + capture-only
 *   - nativeDialogs scan (expected null for WPF HwndWrapper)
 *
 * The fixture auto-closes; the probe only closes its own exact HWND.
 *
 * Run: node evals/probe-wpf-dialog.mjs [--strict-blocked]
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { cuaCall, CUA_SESSION } from '../lib/cua.js'
import { scanNativeDialog } from '../lib/nativeDialogs.js'

const TEMP = process.env.S4_TEMP || (process.platform === 'win32'
  ? join(homedir(), 'AppData', 'Local', 'Temp')
  : tmpdir())
const work = mkdtempSync(join(TEMP, 's4-wpf-dialog-'))
const PS1 = join(work, 'wpf-fixture.ps1')
const CLOSE = join(work, 'close.ps1')
const INFO = join(work, 'window-info.ps1')
const STATE = join(work, 'state.json')
const MAIN = 'S4-WPF-MAIN'
const MODAL = 'S4-WPF-MODAL'
const strict = process.argv.includes('--strict-blocked')
const sleep = (ms) => delay(ms)

writeFileSync(PS1, `param([string]$StateFile)
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
$script:state = [ordered]@{ main = $false; modal = $false; modalClosed = $false; at = '' }
function Write-State {
  [IO.File]::WriteAllText($StateFile, ($script:state | ConvertTo-Json -Compress), (New-Object System.Text.UTF8Encoding($false)))
}
$app = New-Object System.Windows.Application
$main = New-Object System.Windows.Window
$main.Title = '${MAIN}'
$main.Width = 520
$main.Height = 360
$main.Left = 260
$main.Top = 180
$panel = New-Object System.Windows.Controls.StackPanel
$main.Content = $panel
$label = New-Object System.Windows.Controls.TextBlock
$label.Text = 'WPF modal probe'
$panel.Children.Add($label) | Out-Null
$main.Add_ContentRendered({
  $script:state.main = $true
  Write-State
  $t = New-Object System.Windows.Threading.DispatcherTimer
  $t.Interval = [TimeSpan]::FromMilliseconds(1200)
  $t.Add_Tick({
    $t.Stop()
    $script:state.modal = $true
    Write-State
    $modal = New-Object System.Windows.Window
    $modal.Title = '${MODAL}'
    $modal.Width = 360
    $modal.Height = 220
    $modal.Owner = $main
    $modal.WindowStartupLocation = 'CenterOwner'
    $text = New-Object System.Windows.Controls.TextBlock
    $text.Text = 'WPF modal content'
    $modal.Content = $text
    $auto = New-Object System.Windows.Threading.DispatcherTimer
    $auto.Interval = [TimeSpan]::FromMilliseconds(25000)
    $auto.Add_Tick({
      $auto.Stop()
      $script:state.modalClosed = $true
      Write-State
      $modal.Close()
    })
    $auto.Start()
    $modal.ShowDialog() | Out-Null
  })
  $t.Start()
})
$auto = New-Object System.Windows.Threading.DispatcherTimer
$auto.Interval = [TimeSpan]::FromMilliseconds(60000)
$auto.Add_Tick({ $auto.Stop(); $main.Close() })
$auto.Start()
[void]$app.Run($main)
`, 'utf8')

writeFileSync(INFO, `param([long]$Hwnd)
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class S4WpfInfo {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetLastActivePopup(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
'@
$c = New-Object System.Text.StringBuilder 256
[void][S4WpfInfo]::GetClassNameW([IntPtr]$Hwnd, $c, $c.Capacity)
$t = New-Object System.Text.StringBuilder 512
[void][S4WpfInfo]::GetWindowTextW([IntPtr]$Hwnd, $t, $t.Capacity)
$owner = [S4WpfInfo]::GetWindow([IntPtr]$Hwnd, 4)
[uint32]$op = 0
if ($owner -ne [IntPtr]::Zero) { [void][S4WpfInfo]::GetWindowThreadProcessId($owner, [ref]$op) }
[ordered]@{
  ok = $true; className = $c.ToString(); title = $t.ToString()
  owner = $owner.ToInt64(); ownerPid = [int]$op
  ownerEnabled = if ($owner -ne [IntPtr]::Zero) { [bool][S4WpfInfo]::IsWindowEnabled($owner) } else { $false }
  lastPopup = if ($owner -ne [IntPtr]::Zero) { [S4WpfInfo]::GetLastActivePopup($owner).ToInt64() } else { 0 }
  foreground = [S4WpfInfo]::GetForegroundWindow().ToInt64()
} | ConvertTo-Json -Compress
`, 'utf8')

function windowInfo(hwnd) {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', INFO,
      '-Hwnd', String(hwnd)], { encoding: 'utf8', timeout: 10000, windowsHide: true })
    const line = out.trim().split(/\r?\n/).filter(Boolean).pop()
    return JSON.parse(line)
  } catch { return null }
}


writeFileSync(CLOSE, `param([long]$Hwnd, [int]$TargetPid)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class S4WpfClose {
  [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
'@
[uint32]$p = 0
[void][S4WpfClose]::GetWindowThreadProcessId([IntPtr]$Hwnd, [ref]$p)
if ([int]$p -ne $TargetPid) { [Console]::Out.WriteLine('{"ok":false,"error":"pid_mismatch"}'); exit 0 }
[void][S4WpfClose]::PostMessageW([IntPtr]$Hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
Start-Sleep -Milliseconds 500
[Console]::Out.WriteLine(([ordered]@{ ok = -not [S4WpfClose]::IsWindow([IntPtr]$Hwnd) } | ConvertTo-Json -Compress))
`, 'utf8')

function closeWindow(w) {
  if (!w) return
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', CLOSE,
      '-Hwnd', String(w.window_id), '-TargetPid', String(w.pid)], { encoding: 'utf8', timeout: 10000, windowsHide: true })
  } catch { /* self-close timer */ }
}

async function list() {
  const v = await cuaCall('list_windows', { on_screen_only: true }).catch(() => ({ windows: [] }))
  return v.windows || []
}

async function waitWindow(title, ms = 15000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const w = (await list()).find((x) => String(x.title || '').includes(title))
    if (w) return w
    await sleep(250)
  }
  return null
}

async function stateWindow(w, maxElements = 120, timeoutMs = 1500) {
  try {
    return await cuaCall('get_window_state', {
      pid: Number(w.pid), window_id: Number(w.window_id),
      tree_format: 'elements', max_elements: maxElements, timeout_ms: timeoutMs, include_screenshot: false,
    }, { timeoutMs: timeoutMs + 3000 })
  } catch (e) { return { error: String(e?.message || e) } }
}

async function captureOnly(w) {
  try {
    return await cuaCall('get_window_state', {
      pid: Number(w.pid), window_id: Number(w.window_id),
      include_accessibility_tree: false, include_screenshot: true, max_elements: 1,
    }, { timeoutMs: 8000 })
  } catch (e) { return { error: String(e?.message || e) } }
}

const checks = []
function record(name, status, detail = '') {
  checks.push({ name, status, detail })
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⛔'
  console.log(`${icon} ${name}${detail ? ' — ' + detail : ''}`)
}

let child = null
let mainW = null
let modalW = null
let failed = 0
let blocked = 0
try {
  await cuaCall('start_session', { session: CUA_SESSION }).catch(() => undefined)
  child = spawn('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', PS1, '-StateFile', STATE], {
    env: { ...process.env, TEMP, TMP: TEMP },
    stdio: 'ignore',
    windowsHide: false,
  })
  mainW = await waitWindow(MAIN)
  if (!mainW) throw new Error('WPF main window not found')
  const mainState = await stateWindow(mainW)
  const mainInfo = windowInfo(mainW.window_id)
  const mainElements = Array.isArray(mainState.elements) ? mainState.elements.length : 0
  record('WPF main window', mainElements > 0 ? 'PASS' : 'BLOCKED',
    `pid=${mainW.pid} window_id=${mainW.window_id} elements=${mainElements} class=${mainInfo?.className || mainState.window?.class_name || ''}`)

  modalW = await waitWindow(MODAL, 10000)
  if (!modalW) {
    record('WPF modal appeared', 'FAIL', 'modal window not found')
    failed++
  } else {
    record('WPF modal appeared', 'PASS', `pid=${modalW.pid} window_id=${modalW.window_id}`)
    const info = windowInfo(modalW.window_id)
    const cap = await captureOnly(modalW)
    const st1 = await stateWindow(modalW, 120, 1000)
    const st5 = await stateWindow(modalW, 120, 5000)
    const scan = await scanNativeDialog({ pid: Number(modalW.pid), hwnd: Number(modalW.window_id), timeoutMs: 4000 })
    const cls = String(info?.className || st5.window?.class_name || st1.window?.class_name || '')
    record('WPF modal class', cls && !/^#32770$/.test(cls) ? 'PASS' : 'BLOCKED',
      `class=${cls} owner=${info?.owner || 0} ownerPid=${info?.ownerPid || 0} ownerEnabled=${info?.ownerEnabled} lastPopup=${info?.lastPopup || 0} foreground=${info?.foreground || 0}`)
    record('WPF modal UIA @1s', Array.isArray(st1.elements) ? 'PASS' : 'BLOCKED',
      `elements=${st1.elements?.length ?? 'n/a'} error=${st1.error || st1.degraded_reason || ''}`)
    record('WPF modal UIA @5s', Array.isArray(st5.elements) ? 'PASS' : 'BLOCKED',
      `elements=${st5.elements?.length ?? 'n/a'} error=${st5.error || st5.degraded_reason || ''}`)
    record('WPF modal capture-only', cap.capture_id || cap.screenshot_png_b64 ? 'PASS' : 'BLOCKED',
      `capture_id=${cap.capture_id || ''} bytes=${String(cap.screenshot_png_b64 || '').length} error=${cap.error || ''}`)
    record('WPF modal native-dialog scan', scan ? 'BLOCKED' : 'PASS',
      scan ? `unexpected #32770: ${JSON.stringify(scan.buttons)}` : 'null (not #32770)')
    if (checks.some((c) => c.status === 'FAIL')) failed++
  }
} catch (e) {
  console.error(`❌ WPF probe failed: ${e?.message || e}`)
  failed++
} finally {
  closeWindow(modalW)
  closeWindow(mainW)
  try { child?.kill() } catch { /* self-close */ }
  try { rmSync(work, { recursive: true, force: true }) } catch { /* ignore */ }
}

const pass = checks.filter((c) => c.status === 'PASS').length
const blocks = checks.filter((c) => c.status === 'BLOCKED').length
console.log(`\nprobe-wpf-dialog: ${pass} PASS / ${blocks} BLOCKED / ${failed} FAIL`)
process.exit(failed ? 1 : (strict && blocks ? 2 : 0))
