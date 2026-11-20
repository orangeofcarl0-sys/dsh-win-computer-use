/**
 * probe-modal-escapes.mjs — 模态期间可用的逃逸路径（纯 Win32 vs 驱动）。
 *
 * 前一个探针（probe-modal-timeout.mjs）已证明：WinForms MessageBox 打开时，
 * 该进程的 UIA provider 完全不响应（get_window_state 0 元素，预算 1s/5s/15s 都一样），
 * 驱动的 bring_to_front / press_key / click 全部阻塞。本探针只回答一个问题：
 * 模态循环是否还会处理普通 Win32 消息？如果会，插件侧就有不依赖 UIA 的收尾路径。
 *
 * 每个用例都重新打开一次模态，逐一测量：
 *   - 原生 WM_COMMAND(IDNO/IDYES) / GetDlgItem+BM_CLICK
 *   - 原生 PostMessage(WM_KEYDOWN/WM_KEYUP, VK_ESCAPE)
 *   - 驱动 press_key background Escape（60s 上限）
 *   - 驱动 hotkey Alt+N foreground（60s 上限）
 *   - 触发模态的 element click 何时返回（证明它被模态生命周期卡住）
 *
 * 分类：PASS = 该路径关闭了对话框；BLOCKED = 60s 内没有效果；FAIL = 探针自身失败。
 * 清理：只按本探针 HWND / 子进程 PID（命令行含 modal-esc-app.ps1 与临时目录）；
 * 窗口另有 300s 自关 Timer。
 *
 * Run: node evals/probe-modal-escapes.mjs
 */
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { defaultTransport } from '../lib/driver/transport.js'
import { CUA_SESSION } from '../lib/cua.js'

const TITLE = 'S4-MODAL-ESC'
const DIALOG_TITLE = 'S4-MODAL-ESC-CONFIRM'
const TRIGGER_ONLY = process.argv.includes('--trigger-only')
const work = mkdtempSync(join(tmpdir(), 's4-modal-esc-'))
const appPath = join(work, 'modal-esc-app.ps1')
const resultPath = join(work, 'state.json')
const nativePath = join(work, 'native-dialog.ps1')
const formClosePath = join(work, 'form-close.ps1')
const nativeClickPath = join(work, 'native-click.ps1')
console.log('modal escape probe workdir:', work)

const app = `param([string]$ResultFile)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
function Write-State($state) {
  $json = $state | ConvertTo-Json -Compress
  [IO.File]::WriteAllText($ResultFile, $json, (New-Object System.Text.UTF8Encoding($false)))
}
$state = [ordered]@{ opened = 0; cancelled = 0; confirmed = 0; deleted = $false; at = (Get-Date).ToUniversalTime().ToString('o') }
Write-State $state
$form = New-Object System.Windows.Forms.Form
$form.Text = '${TITLE}'
$form.Width = 460
$form.Height = 220
$form.StartPosition = 'Manual'
$form.Left = 300
$form.Top = 240
$label = New-Object System.Windows.Forms.Label
$label.Text = 'Modal escape probe'
$label.AutoSize = $true
$label.Left = 24
$label.Top = 24
$form.Controls.Add($label)
$button = New-Object System.Windows.Forms.Button
$button.Text = 'Delete'
$button.Left = 24
$button.Top = 70
$button.Width = 120
$button.Height = 40
$button.Add_Click({
  $state.opened = [int]$state.opened + 1
  Write-State $state
  $answer = [System.Windows.Forms.MessageBox]::Show('Delete this item?', '${DIALOG_TITLE}', [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Warning)
  if ($answer -eq [System.Windows.Forms.DialogResult]::No) {
    $state.cancelled = [int]$state.cancelled + 1
  } else {
    $state.confirmed = [int]$state.confirmed + 1
    $state.deleted = $true
  }
  $state.at = (Get-Date).ToUniversalTime().ToString('o')
  Write-State $state
})
$form.Controls.Add($button)
$auto = New-Object System.Windows.Forms.Timer
$auto.Interval = 300000
$auto.Add_Tick({ $auto.Stop(); $form.Close() })
$auto.Start()
[System.Windows.Forms.Application]::Run($form)
`
writeFileSync(appPath, app, 'utf8')

// 纯 Win32；不使用 UIA（模态期间 UIA provider 不响应）。
const native = `param([long]$Hwnd = 0, [string]$DialogTitle = '', [string]$Mode = 'command-no')
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class S4ModalNative {
  public delegate bool EnumProc(IntPtr h, IntPtr lp);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindowW(string cls, string title);
  [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr parent, int id);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr lp);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
}
'@
$target = [IntPtr]::Zero
if ($DialogTitle) { $target = [S4ModalNative]::FindWindowW($null, $DialogTitle) }
if ($target -eq [IntPtr]::Zero -and $Hwnd -gt 0) { $target = [IntPtr]$Hwnd }
if ($target -eq [IntPtr]::Zero) { Write-Output '{"ok":false,"reason":"not_found"}'; exit 0 }
$WM_COMMAND = 0x0111
$WM_KEYDOWN = 0x0100
$WM_KEYUP = 0x0101
$BM_CLICK = 0x00F5
$VK_ESCAPE = 0x1B
$VK_RETURN = 0x0D
switch ($Mode) {
  'command-no' {
    $btn = [S4ModalNative]::GetDlgItem($target, 7)
    if ($null -ne $btn -and $btn -ne [IntPtr]::Zero) { [void][S4ModalNative]::PostMessageW($btn, $BM_CLICK, [IntPtr]::Zero, [IntPtr]::Zero) }
    else { [void][S4ModalNative]::PostMessageW($target, $WM_COMMAND, [IntPtr]7, [IntPtr]::Zero) }
  }
  'command-yes' {
    $btn = [S4ModalNative]::GetDlgItem($target, 6)
    if ($null -ne $btn -and $btn -ne [IntPtr]::Zero) { [void][S4ModalNative]::PostMessageW($btn, $BM_CLICK, [IntPtr]::Zero, [IntPtr]::Zero) }
    else { [void][S4ModalNative]::PostMessageW($target, $WM_COMMAND, [IntPtr]6, [IntPtr]::Zero) }
  }
  'escape' {
    [void][S4ModalNative]::PostMessageW($target, $WM_KEYDOWN, [IntPtr]$VK_ESCAPE, [IntPtr]::Zero)
    [void][S4ModalNative]::PostMessageW($target, $WM_KEYUP, [IntPtr]$VK_ESCAPE, [IntPtr]::Zero)
  }
  'enter' {
    [void][S4ModalNative]::PostMessageW($target, $WM_KEYDOWN, [IntPtr]$VK_RETURN, [IntPtr]::Zero)
    [void][S4ModalNative]::PostMessageW($target, $WM_KEYUP, [IntPtr]$VK_RETURN, [IntPtr]::Zero)
  }
  default { Write-Output '{"ok":false,"reason":"unknown-mode"}'; exit 0 }
}
Start-Sleep -Milliseconds 900
$alive = [S4ModalNative]::IsWindow($target)
if ($alive) { Write-Output '{"ok":true,"closed":false}' } else { Write-Output '{"ok":true,"closed":true}' }
`
writeFileSync(nativePath, native, 'utf8')

const formClose = `param([long]$Hwnd)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class S4EscFormWin {
  [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
}
'@
$h = [IntPtr]$Hwnd
[void][S4EscFormWin]::PostMessageW($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
Start-Sleep -Milliseconds 700
if ([S4EscFormWin]::IsWindow($h)) { Write-Output '{"ok":true,"alive":true}' } else { Write-Output '{"ok":true,"alive":false}' }
`
writeFileSync(formClosePath, formClose, 'utf8')

// 只在屏幕点下找到标准 Win32 Button 时 PostMessage(BM_CLICK)。
// 用来验证：触发模态的那次点击本身能否绕过 UIA Invoke 的同步阻塞。
const nativeClick = `param([int]$X = 0, [int]$Y = 0, [long]$Hwnd = 0, [string]$Text = '', [string]$DialogTitle = '')
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class S4ClickNative {
  public delegate bool EnumProc(IntPtr h, IntPtr lp);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr lp);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindowW(string cls, string title);
}
'@
$btn = [IntPtr]::Zero
$cls = ''
$txt = ''
if ($Text -and $Hwnd -gt 0) {
  $script:btn = [IntPtr]::Zero
  $script:cls = ''
  $script:txt = ''
  $cb = [S4ClickNative+EnumProc]{
    param($h, $lp)
    $sb = New-Object System.Text.StringBuilder 256
    [void][S4ClickNative]::GetClassNameW($h, $sb, 256)
    $c = $sb.ToString()
    $sb2 = New-Object System.Text.StringBuilder 256
    [void][S4ClickNative]::GetWindowTextW($h, $sb2, 256)
    $t = $sb2.ToString()
    if ($c -like '*BUTTON*' -and $t.IndexOf($Text, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
      $script:btn = $h
      $script:cls = $c
      $script:txt = $t
    }
    return $true
  }
  [void][S4ClickNative]::EnumChildWindows([IntPtr]$Hwnd, $cb, [IntPtr]::Zero)
  $btn = $script:btn
  $cls = $script:cls
  $txt = $script:txt
} else {
  $p = New-Object S4ClickNative+POINT
  $p.X = $X
  $p.Y = $Y
  $h = [S4ClickNative]::WindowFromPoint($p)
  $cur = $h
  for ($i = 0; $i -lt 5 -and $cur -ne [IntPtr]::Zero; $i++) {
    $sb = New-Object System.Text.StringBuilder 256
    [void][S4ClickNative]::GetClassNameW($cur, $sb, 256)
    $cls = $sb.ToString()
    if ($cls -like '*BUTTON*') { $btn = $cur; break }
    $cur = [S4ClickNative]::GetParent($cur)
  }
  if ($null -ne $btn -and $btn -ne [IntPtr]::Zero) {
    $sb2 = New-Object System.Text.StringBuilder 256
    [void][S4ClickNative]::GetWindowTextW($btn, $sb2, 256)
    $txt = $sb2.ToString()
  }
}
if ($null -ne $btn -and $btn -ne [IntPtr]::Zero) {
  [void][S4ClickNative]::PostMessageW($btn, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
}
Start-Sleep -Milliseconds 1200
$modal = 0
if ($DialogTitle) { $modal = [S4ClickNative]::FindWindowW($null, $DialogTitle).ToInt64() }
Write-Output ('{"ok":true,"class":"' + $cls.Replace('"', '') + '","text":"' + $txt.Replace('"', '') + '","button":' + $btn.ToInt64() + ',"modal":' + $modal + '}')
`
writeFileSync(nativeClickPath, nativeClick, 'utf8')

const checks = []
function record(name, status, detail = '', data = null) {
  checks.push({ name, status, detail, data })
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⛔'
  console.log(`${icon} ${name}${detail ? ' — ' + detail : ''}`)
}
const pass = (name, ok, detail = '', data = null) => record(name, ok ? 'PASS' : 'FAIL', detail, data)
const blocked = (name, detail = '', data = null) => record(name, 'BLOCKED', detail, data)

async function raw(tool, args = {}, timeoutMs = 30000) {
  const started = Date.now()
  try {
    const value = await defaultTransport.rawCall(tool, args, { timeoutMs })
    return { ok: true, value, ms: Date.now() - started }
  } catch (e) {
    return { ok: false, error: String(e?.message || e), kind: e?.kind || '', ms: Date.now() - started }
  }
}

async function listWindows() {
  const r = await raw('list_windows', { on_screen_only: true }, 8000)
  return r.ok ? (r.value.windows || []) : []
}

async function findWindow(needle, pid = 0) {
  const wins = await listWindows()
  return wins.find((w) => (pid ? Number(w.pid) === Number(pid) : true)
    && String(w.title || '').includes(needle)) || null
}

async function waitWindow(needle, pid, ms = 12000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const w = await findWindow(needle, pid)
    if (w) return w
    await delay(250)
  }
  return null
}

function treeOnce(pid, windowId, timeoutMs = 20000, extra = {}) {
  return raw('get_window_state', {
    pid,
    window_id: windowId,
    include_screenshot: false,
    max_elements: 120,
    tree_format: 'elements',
    session: CUA_SESSION,
    ...extra,
  }, timeoutMs)
}

/** 模态关闭后 UIA provider 可能还需一点时间恢复；空树重试几次。 */
async function tree(pid, windowId) {
  let last = null
  for (let i = 0; i < 8; i++) {
    last = await treeOnce(pid, windowId)
    if (last.ok && (last.value?.elements?.length || 0) > 0) return last
    await delay(500)
  }
  return last
}

function findButton(res, re) {
  const els = res?.ok && Array.isArray(res.value?.elements) ? res.value.elements : []
  return els.find((e) => re.test(String(e?.label || e?.name || '')) && /button|按钮/i.test(String(e?.role || '')))
    || els.find((e) => re.test(String(e?.label || e?.name || '')))
    || null
}

function readState() {
  try { return JSON.parse(readFileSync(resultPath, 'utf8')) } catch { return null }
}

function nativeClose(hwnd, mode) {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', nativePath,
      '-Hwnd', String(hwnd), '-DialogTitle', DIALOG_TITLE, '-Mode', mode], { encoding: 'utf8', timeout: 15000, windowsHide: true })
    return String(out || '').trim()
  } catch (e) { return `error: ${e.message}` }
}

function nativeClickAt(x, y) {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', nativeClickPath,
      '-X', String(Math.round(x)), '-Y', String(Math.round(y)), '-DialogTitle', DIALOG_TITLE],
    { encoding: 'utf8', timeout: 15000, windowsHide: true })
    return String(out || '').trim()
  } catch (e) { return `error: ${e.message}` }
}

function nativeClickText(hwnd, text) {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', nativeClickPath,
      '-Hwnd', String(hwnd), '-Text', text, '-DialogTitle', DIALOG_TITLE],
    { encoding: 'utf8', timeout: 15000, windowsHide: true })
    return String(out || '').trim()
  } catch (e) { return `error: ${e.message}` }
}

function closeForm(hwnd) {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', formClosePath,
      '-Hwnd', String(hwnd)], { encoding: 'utf8', timeout: 15000, windowsHide: true })
    return String(out || '').trim()
  } catch (e) { return `error: ${e.message}` }
}

function ownedChild(pid) {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
      `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}" -ErrorAction SilentlyContinue; if ($p) { $p.Name + '|' + $p.CommandLine }`,
    ], { encoding: 'utf8', timeout: 15000, windowsHide: true }).trim()
    const [name, cmd = ''] = out.split('|')
    return /^powershell\.exe$/i.test(name || '') && cmd.includes('modal-esc-app.ps1') && cmd.includes(work)
  } catch { return false }
}

let child = null
let hwnd = 0
let pid = 0

async function openModal(label) {
  const base = await tree(pid, hwnd)
  const del = findButton(base, /^Delete$/i)
  if (!del) throw new Error(`${label}: no Delete button in baseline tree`)
  const started = Date.now()
  const pending = raw('click', {
    pid,
    window_id: hwnd,
    element_token: del.element_token,
    count: 1,
    button: 'left',
    delivery_mode: 'background',
    session: CUA_SESSION,
  }, 120000)
  const modal = await waitWindow(DIALOG_TITLE, pid, 12000)
  if (!modal) throw new Error(`${label}: modal did not appear`)
  return { pending, modal, dialogHwnd: Number(modal.window_id), started }
}

async function settle(open, label, { closeIfAlive = true, extraMs = 1200 } = {}) {
  await delay(extraMs)
  let gone = !(await findWindow(DIALOG_TITLE, pid))
  const firstGone = gone
  if (!gone && closeIfAlive) {
    nativeClose(open.dialogHwnd, 'command-no')
    await delay(900)
    gone = !(await findWindow(DIALOG_TITLE, pid))
  }
  const closeAt = Date.now()
  const trig = await open.pending
  const resolvedAt = Date.now()
  return { gone, firstGone, trig, resolvedAfterCloseMs: trig.ok ? Math.max(0, resolvedAt - closeAt) : null }
}

try {
  child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', appPath, '-ResultFile', resultPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  })
  let childErr = ''
  child.stderr.on('data', (d) => { childErr += d })
  const win = await waitWindow(TITLE, 0, 30000)
  if (!win) {
    const wins = await listWindows()
    throw new Error('probe window not found; pid=' + child.pid + ' stderr=' + childErr.slice(0, 400)
      + ' titles=' + JSON.stringify(wins.map((w) => w.title).filter(Boolean).slice(0, 20)))
  }
  pid = Number(win.pid)
  hwnd = Number(win.window_id)
  pass('probe window found', Boolean(pid && hwnd), `pid=${pid} window_id=${hwnd}`)
  const first = await tree(pid, hwnd)
  pass('baseline tree', first.ok && (first.value?.elements?.length || 0) > 0,
    `els=${first.value?.elements?.length ?? 0} ${first.ms}ms`)

  // 0. 触发侧：用原生 WindowFromPoint + BM_CLICK 点 Delete，验证能否避开
  //    UIA Invoke 的同步阻塞（驱动 element click 会卡到模态关闭）。
  {
    const els = first.value?.elements || []
    const del = els.find((e) => /^Delete$/i.test(String(e.label || e.name || '')))
    const f = del?.frame || del?.bounds
    if (!del || !f) {
      blocked('native BM_CLICK trigger', 'Delete element has no frame')
    } else {
      const cx = Number(f.x) + Number(f.w ?? f.width) / 2
      const cy = Number(f.y) + Number(f.h ?? f.height) / 2
      const started = Date.now()
      // 优先按控件文本枚举（不受窗口遮挡影响）；同时记录点命中结果作对照。
      const byText = nativeClickText(hwnd, 'Delete')
      const modal = await waitWindow(DIALOG_TITLE, pid, 8000)
      const ms = Date.now() - started
      record('native BM_CLICK trigger', modal && /"button":[1-9]/.test(byText) ? 'PASS' : 'BLOCKED',
        `${byText} modal=${Boolean(modal)} ${ms}ms frame=${JSON.stringify(f)}`
        + '（helper 的 modal 字段是 1.2s 时的快照，可能晚于 MessageBox 创建）',
        { byText, modal: Boolean(modal), ms, frame: f, cx, cy })
      if (modal) {
        nativeClose(Number(modal.window_id), 'command-no')
        await delay(900)
      }
    }
  }

  if (TRIGGER_ONLY) {
    const fails = checks.filter((c) => c.status === 'FAIL').length
    const blocks = checks.filter((c) => c.status === 'BLOCKED').length
    console.log(`\n结果（trigger-only）：${checks.filter((c) => c.status === 'PASS').length} PASS / ${blocks} BLOCKED / ${fails} FAIL`)
    console.log('JSON ' + JSON.stringify({ title: TITLE, dialog: DIALOG_TITLE, checks }, null, 2))
    process.exitCode = fails ? 1 : 0
    throw { __done: true }
  }

  // 1. 原生 WM_COMMAND(IDNO) / BM_CLICK
  {
    const before = readState()
    const open = await openModal('native-no')
    const native = nativeClose(open.dialogHwnd, 'command-no')
    const s = await settle(open, 'native-no')
    const after = readState()
    record('native WM_COMMAND(IDNO)', /"closed":true/.test(native) && s.firstGone ? 'PASS' : 'BLOCKED',
      `${native} firstGone=${s.firstGone} trigger=${s.trig.ms}ms resolvedAfterClose=${s.resolvedAfterCloseMs}ms; `
      + `cancelled ${before?.cancelled}->${after?.cancelled}`,
      { native, gone: s.gone, firstGone: s.firstGone, triggerMs: s.trig.ms, resolvedAfterCloseMs: s.resolvedAfterCloseMs, before, after })
  }

  // 2. 原生 WM_COMMAND(IDYES)，确认正向路径
  {
    const before = readState()
    const open = await openModal('native-yes')
    const native = nativeClose(open.dialogHwnd, 'command-yes')
    const s = await settle(open, 'native-yes')
    const after = readState()
    record('native WM_COMMAND(IDYES)', /"closed":true/.test(native) && s.firstGone ? 'PASS' : 'BLOCKED',
      `${native} firstGone=${s.firstGone} trigger=${s.trig.ms}ms resolvedAfterClose=${s.resolvedAfterCloseMs}ms; `
      + `confirmed ${before?.confirmed}->${after?.confirmed}`,
      { native, gone: s.gone, firstGone: s.firstGone, triggerMs: s.trig.ms, resolvedAfterCloseMs: s.resolvedAfterCloseMs, before, after })
  }

  // 3. 原生 PostMessage(WM_KEYDOWN/UP, VK_ESCAPE)：Yes/No 没有 Cancel，预期无效
  {
    const open = await openModal('native-escape')
    const native = nativeClose(open.dialogHwnd, 'escape')
    const s = await settle(open, 'native-escape')
    record('native PostMessage VK_ESCAPE', s.firstGone ? 'PASS' : 'BLOCKED',
      `${native} firstGone=${s.firstGone} (Yes/No has no Cancel) trigger=${s.trig.ms}ms`,
      { native, gone: s.gone, firstGone: s.firstGone, triggerMs: s.trig.ms })
  }

  // 4. 驱动 press_key background Escape（60s 上限）
  {
    const open = await openModal('driver-key-bg')
    const key = await raw('press_key', {
      key: 'escape', pid, window_id: open.dialogHwnd, delivery_mode: 'background', session: CUA_SESSION,
    }, 60000)
    const s = await settle(open, 'driver-key-bg')
    record('driver press_key background Escape', key.ok && s.firstGone ? 'PASS' : 'BLOCKED',
      `${key.ms}ms ok=${key.ok} firstGone=${s.firstGone} trigger=${s.trig.ms}ms resolvedAfterClose=${s.resolvedAfterCloseMs}ms`,
      { keyMs: key.ms, keyOk: key.ok, kind: key.kind, error: key.error, gone: s.gone, firstGone: s.firstGone, triggerMs: s.trig.ms })
  }

  // 5. 驱动 hotkey Alt+N foreground（60s 上限）：t20 r1 曾 24.7s 成功
  {
    const open = await openModal('driver-hotkey')
    const hk = await raw('hotkey', {
      keys: ['alt', 'n'], pid, window_id: open.dialogHwnd, delivery_mode: 'foreground', session: CUA_SESSION,
    }, 60000)
    const s = await settle(open, 'driver-hotkey')
    record('driver hotkey Alt+N foreground', s.firstGone ? 'PASS' : 'BLOCKED',
      `${hk.ms}ms ok=${hk.ok} firstGone=${s.firstGone} trigger=${s.trig.ms}ms resolvedAfterClose=${s.resolvedAfterCloseMs}ms`
      + (hk.ok ? '' : ` reported=${hk.kind}:${String(hk.error || '').slice(0, 70)}`),
      { hkMs: hk.ms, hkOk: hk.ok, kind: hk.kind, error: hk.error, gone: s.gone, firstGone: s.firstGone, triggerMs: s.trig.ms })
  }

  // 6. 驱动 press_key foreground Return（60s 上限）
  {
    const open = await openModal('driver-key-fg')
    const key = await raw('press_key', {
      key: 'return', pid, window_id: open.dialogHwnd, delivery_mode: 'foreground', session: CUA_SESSION,
    }, 60000)
    const s = await settle(open, 'driver-key-fg')
    record('driver press_key foreground Return', key.ok && s.firstGone ? 'PASS' : 'BLOCKED',
      `${key.ms}ms ok=${key.ok} firstGone=${s.firstGone} trigger=${s.trig.ms}ms resolvedAfterClose=${s.resolvedAfterCloseMs}ms`,
      { keyMs: key.ms, keyOk: key.ok, kind: key.kind, error: key.error, gone: s.gone, firstGone: s.firstGone, triggerMs: s.trig.ms })
  }

  const state = readState()
  record('state written', state ? 'PASS' : 'FAIL', state ? `opened=${state.opened} cancelled=${state.cancelled} confirmed=${state.confirmed}` : 'unreadable', state)
  const fails = checks.filter((c) => c.status === 'FAIL').length
  const blocks = checks.filter((c) => c.status === 'BLOCKED').length
  console.log(`\n结果：${checks.filter((c) => c.status === 'PASS').length} PASS / ${blocks} BLOCKED / ${fails} FAIL`)
  console.log('JSON ' + JSON.stringify({ title: TITLE, dialog: DIALOG_TITLE, checks }, null, 2))
  process.exitCode = fails ? 1 : 0
} catch (e) {
  if (!e?.__done) {
    console.error('❌ probe aborted:', e?.stack || e)
    process.exitCode = 1
  }
} finally {
  try {
    if (await findWindow(DIALOG_TITLE, pid)) nativeClose(0, 'command-no')
    if (hwnd) closeForm(hwnd)
    await delay(500)
    const still = await findWindow(TITLE, pid)
    if (still) {
      if (ownedChild(child?.pid)) {
        try { child.kill() } catch { /* 已退出 */ }
      } else {
        console.error('refusing to kill child without ownership proof:', child?.pid)
      }
    }
  } catch { /* 清理不覆盖主结果 */ }
  try { rmSync(work, { recursive: true, force: true }) } catch { /* 忽略 */ }
}
