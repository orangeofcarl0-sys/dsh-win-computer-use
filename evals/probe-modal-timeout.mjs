/**
 * probe-modal-timeout.mjs — 复现 t20 的 WinForms MessageBox 30s 阻塞。
 *
 * 背景：t20 两次真跑中，点击 Delete（触发 MessageBox）与之后所有 UIA/按键动作
 * 都会 30s 超时；get_window_state 在模态期间对同 pid 的所有窗口返回
 * "PARTIAL TREE: the 1000 ms timeout_ms budget ran out"（0 元素）。
 *
 * 本探针只创建自己的 WinForms 窗口（S4-MODAL-PROBE），按固定顺序测量：
 *   1. 基线 AX 树 → 点 Delete（后台 element click，故意不 await）
 *   2. 模态出现后：
 *      - get_window_state 默认 1000ms 预算 / timeout_ms=5000 / 15000
 *      - 同 pid 主窗口 timeout_ms=5000（判断是整个进程的 UIA 饥饿还是仅对话框）
 *      - capture-only（include_accessibility_tree:false）
 *      - bring_to_front / press_key background+foreground / 坐标 click（各 8s 上限）
 *   3. 若 timeout_ms=5000 能取到按钮：直接 element click 关闭对话框；
 *      否则退回 hotkey Alt+N。测量触发 click 的原始调用何时返回。
 *   4. 第二轮验证“timeout_ms=5000 + element click”路径可重复。
 *
 * 分类：
 *   PASS   观测到预期效果（例如 5s 预算取回按钮并关闭对话框）
 *   FAIL   工具声称成功但无效果，或基线不可用
 *   BLOCKED 驱动/应用侧无法在模态期间完成该原语（如实记录，不算 pass）
 *
 * 清理：只按本探针的 HWND / 子进程 PID（命令行含 modal-app.ps1 与临时目录）关闭；
 * 不按进程名杀。窗口另有 300s 自关 Timer。
 *
 * Run: node evals/probe-modal-timeout.mjs [--strict-blocked]
 */
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { defaultTransport } from '../lib/driver/transport.js'
import { CUA_SESSION } from '../lib/cua.js'

const TITLE = 'S4-MODAL-PROBE'
const DIALOG_TITLE = 'S4-MODAL-CONFIRM'
const work = mkdtempSync(join(tmpdir(), 's4-modal-'))
const appPath = join(work, 'modal-app.ps1')
const resultPath = join(work, 'state.json')
const dialogClosePath = join(work, 'dialog-close.ps1')
const formClosePath = join(work, 'form-close.ps1')
console.log('modal probe workdir:', work)

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
$form.Left = 260
$form.Top = 220
$label = New-Object System.Windows.Forms.Label
$label.Text = 'Modal timeout probe'
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

// 纯 Win32 关闭：UIA 在模态期间会阻塞，不能用 UIA 找/关对话框。
const dialogClose = `param([long]$Hwnd = 0, [string]$DialogTitle = '', [string]$Choice = 'No')
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class S4ModalWin {
  public delegate bool EnumProc(IntPtr h, IntPtr lp);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindowW(string cls, string title);
  [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr parent, int id);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr lp);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
}
'@
$target = [IntPtr]::Zero
if ($DialogTitle) { $target = [S4ModalWin]::FindWindowW($null, $DialogTitle) }
if ($target -eq [IntPtr]::Zero -and $Hwnd -gt 0) { $target = [IntPtr]$Hwnd }
if ($target -eq [IntPtr]::Zero) { Write-Output '{"ok":false,"reason":"not_found"}'; exit 0 }
$id = if ($Choice -eq 'Yes') { 6 } else { 7 }
# MessageBox 的按钮控件 ID 与语言无关：优先 BM_CLICK 到 GetDlgItem；
# 某些宿主里 GetDlgItem 返回 null，退回按 GetDlgCtrlID 枚举。
$btn = [S4ModalWin]::GetDlgItem($target, $id)
if ($null -eq $btn -or $btn -eq [IntPtr]::Zero) {
  $script:found = [IntPtr]::Zero
  $cb = [S4ModalWin+EnumProc]{
    param($h, $lp)
    if ([S4ModalWin]::GetDlgCtrlID($h) -eq $id) { $script:found = $h }
    return $true
  }
  [void][S4ModalWin]::EnumChildWindows($target, $cb, [IntPtr]::Zero)
  $btn = $script:found
}
if ($null -ne $btn -and $btn -ne [IntPtr]::Zero) {
  [void][S4ModalWin]::PostMessageW($btn, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
} else {
  [void][S4ModalWin]::PostMessageW($target, 0x0111, [IntPtr]$id, [IntPtr]::Zero)
}
Start-Sleep -Milliseconds 900
$alive = [S4ModalWin]::IsWindow($target)
if ($alive) { Write-Output '{"ok":true,"alive":true}' } else { Write-Output '{"ok":true,"alive":false}' }
`
writeFileSync(dialogClosePath, dialogClose, 'utf8')

const formClose = `param([long]$Hwnd)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class S4FormWin {
  [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
}
'@
$h = [IntPtr]$Hwnd
[void][S4FormWin]::PostMessageW($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
Start-Sleep -Milliseconds 700
if ([S4FormWin]::IsWindow($h)) { Write-Output '{"ok":true,"alive":true}' } else { Write-Output '{"ok":true,"alive":false}' }
`
writeFileSync(formClosePath, formClose, 'utf8')

const checks = []
function record(name, status, detail = '', data = null) {
  checks.push({ name, status, detail, data })
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : status === 'BLOCKED' ? '⛔' : 'ℹ️'
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

async function waitWindow(needle, pid, ms = 10000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const w = await findWindow(needle, pid)
    if (w) return w
    await delay(250)
  }
  return null
}

function tree(pid, windowId, extra = {}, timeoutMs = 20000) {
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

function treeSummary(r) {
  if (!r.ok) return { ok: false, ms: r.ms, kind: r.kind, error: r.error.slice(0, 120) }
  const v = r.value || {}
  return {
    ok: true,
    ms: r.ms,
    elements: Array.isArray(v.elements) ? v.elements.length : null,
    elementCount: v.element_count ?? null,
    budget: v.timeout_ms ?? null,
    truncated: v.truncated ?? null,
    reason: v.truncation_reason ?? null,
    complete: v.elements_complete ?? null,
    degraded: String(v.degraded_reason || '').slice(0, 90),
  }
}

function elLabel(e) {
  return String(e?.label || e?.name || e?.value || '')
}
function findButton(res, re) {
  const els = res?.ok && Array.isArray(res.value?.elements) ? res.value.elements : []
  return els.find((e) => re.test(elLabel(e)) && /button|按钮/i.test(String(e.role || '')))
    || els.find((e) => re.test(elLabel(e)))
    || null
}

function readState() {
  try { return JSON.parse(readFileSync(resultPath, 'utf8')) } catch { return null }
}

function closeDialog(choice, hwnd = 0) {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', dialogClosePath,
      '-Hwnd', String(hwnd), '-DialogTitle', DIALOG_TITLE, '-Choice', choice], { encoding: 'utf8', timeout: 15000, windowsHide: true })
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

/** 子进程归属证明：命令行必须含本探针的临时目录与 modal-app.ps1。 */
function ownedChild(pid) {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
      `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}" -ErrorAction SilentlyContinue; if ($p) { $p.Name + '|' + $p.CommandLine }`,
    ], { encoding: 'utf8', timeout: 15000, windowsHide: true }).trim()
    const [name, cmd = ''] = out.split('|')
    return /^powershell\.exe$/i.test(name || '') && cmd.includes('modal-app.ps1') && cmd.includes(work)
  } catch { return false }
}

let child = null
let hwnd = 0
let pid = 0
let dialogHwnd = 0

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
    throw new Error('probe window not found; pid=' + child.pid + ' stderr=' + childErr.slice(0, 500)
      + ' titles=' + JSON.stringify(wins.map((w) => w.title).filter(Boolean).slice(0, 25)))
  }
  pid = Number(win.pid)
  hwnd = Number(win.window_id)
  console.log('probe window:', JSON.stringify({ pid, window_id: hwnd, title: win.title }))
  pass('probe window found', Boolean(pid && hwnd), `pid=${pid} window_id=${hwnd}`)

  const base = await tree(pid, hwnd)
  const baseSum = treeSummary(base)
  record('baseline tree', baseSum.ok && baseSum.elements > 0 ? 'PASS' : 'FAIL',
    `els=${baseSum.elements} count=${baseSum.elementCount} ${baseSum.ms}ms ${baseSum.degraded || ''}`, baseSum)
  const del = findButton(base, /^Delete$/i)
  pass('Delete button found', Boolean(del), del ? `token=${del.element_token}` : 'no button labelled Delete')
  if (!del) throw new Error('baseline tree has no Delete button')

  // 触发模态：故意不 await。调用方应被 MessageBox 的模态循环卡住。
  const triggerStarted = Date.now()
  const pendingTrigger = raw('click', {
    pid,
    window_id: hwnd,
    element_token: del.element_token,
    count: 1,
    button: 'left',
    delivery_mode: 'background',
    session: CUA_SESSION,
  }, 120000)

  const modal = await waitWindow(DIALOG_TITLE, pid, 12000)
  if (!modal) {
    const t = await pendingTrigger
    throw new Error('modal did not appear; trigger=' + JSON.stringify({ ok: t.ok, ms: t.ms, error: t.error })
      + ' state=' + JSON.stringify(readState()))
  }
  dialogHwnd = Number(modal.window_id)
  console.log('modal window:', JSON.stringify({ pid: modal.pid, window_id: dialogHwnd, title: modal.title }))
  pass('modal appeared after click', true, `after ${Date.now() - triggerStarted}ms`)

  // 1) 默认 1000ms 预算
  const tDefault = await tree(pid, dialogHwnd)
  const defaultSum = treeSummary(tDefault)
  record('modal tree default budget', defaultSum.ok ? (defaultSum.elements > 0 ? 'PASS' : 'BLOCKED') : 'FAIL',
    `els=${defaultSum.elements} budget=${defaultSum.budget} ${defaultSum.ms}ms ${defaultSum.reason || ''}`, defaultSum)
  if (defaultSum.ok && defaultSum.elements === 0) {
    blocked('modal AX tree @1000ms', 'PARTIAL/0 elements while modal is open')
  }

  // 2) timeout_ms=5000（驱动文档要求：预算耗尽时用 5000 重试）
  const t5000 = await tree(pid, dialogHwnd, { timeout_ms: 5000 })
  const sum5000 = treeSummary(t5000)
  record('modal tree timeout_ms=5000', sum5000.ok ? (sum5000.elements > 0 ? 'PASS' : 'BLOCKED') : 'FAIL',
    `els=${sum5000.elements} budget=${sum5000.budget} ${sum5000.ms}ms ${sum5000.reason || ''} ${sum5000.degraded}`, sum5000)
  if (sum5000.ok && sum5000.elements === 0) {
    blocked('modal AX tree @5000ms', 'larger budget did not recover the tree')
  }

  // 3) 5000 仍为空时，用 15000 区分“预算不够”与“provider 完全不响应”
  let t15000 = null
  if (sum5000.ok && sum5000.elements === 0) {
    t15000 = await tree(pid, dialogHwnd, { timeout_ms: 15000 }, 25000)
    const sum15 = treeSummary(t15000)
    record('modal tree timeout_ms=15000', sum15.ok ? (sum15.elements > 0 ? 'PASS' : 'BLOCKED') : 'FAIL',
      `els=${sum15.elements} budget=${sum15.budget} ${sum15.ms}ms ${sum15.reason || ''}`, sum15)
    if (sum15.ok && sum15.elements === 0) {
      blocked('modal AX tree @15000ms', 'provider unresponsive during the modal loop, not a budget size issue')
    }
  }

  // 4) capture-only：不做 UIA walk，只截图
  const capStarted = Date.now()
  const cap = await raw('get_window_state', {
    pid,
    window_id: dialogHwnd,
    include_accessibility_tree: false,
    include_screenshot: true,
    max_image_dimension: 320,
    session: CUA_SESSION,
  }, 15000)
  const capBytes = cap.ok ? Buffer.from(String(cap.value?.screenshot_png_b64 || ''), 'base64').byteLength : 0
  record('modal capture-only', cap.ok ? 'PASS' : 'FAIL',
    cap.ok ? `${cap.ms}ms png=${capBytes}B` : `${cap.ms}ms ${cap.kind} ${cap.error.slice(0, 100)}`,
    { ok: cap.ok, ms: cap.ms, bytes: capBytes })

  // 5) 同 pid 主窗口在模态期间是否也读不到树
  const tMain = await tree(pid, hwnd, { timeout_ms: 5000 })
  const mainSum = treeSummary(tMain)
  record('main window tree during modal', mainSum.ok ? (mainSum.elements > 0 ? 'PASS' : 'BLOCKED') : 'FAIL',
    `els=${mainSum.elements} ${mainSum.ms}ms ${mainSum.reason || ''}`, mainSum)
  if (mainSum.ok && mainSum.elements === 0) {
    blocked('same-pid main tree during modal', 'whole process UIA access starved while modal is open')
  }

  // 6) bring_to_front / keyboard / coordinate click：各 8s 上限，避免探针本身耗 30s
  const bring = await raw('bring_to_front', { pid, window_id: dialogHwnd, session: CUA_SESSION }, 8000)
  record('modal bring_to_front', bring.ok ? 'PASS' : 'BLOCKED',
    bring.ok ? `${bring.ms}ms` : `${bring.ms}ms ${bring.kind} ${bring.error.slice(0, 100)}`,
    { ok: bring.ok, ms: bring.ms, kind: bring.kind })

  const keyBg = await raw('press_key', {
    key: 'a', pid, window_id: dialogHwnd, delivery_mode: 'background', session: CUA_SESSION,
  }, 8000)
  record('modal press_key background', keyBg.ok ? 'PASS' : 'BLOCKED',
    keyBg.ok ? `${keyBg.ms}ms` : `${keyBg.ms}ms ${keyBg.kind} ${keyBg.error.slice(0, 100)}`,
    { ok: keyBg.ok, ms: keyBg.ms, kind: keyBg.kind })
  pass('modal survives harmless key', Boolean(await findWindow(DIALOG_TITLE, pid)), 'a/b keys do not dismiss Yes/No')

  const keyFg = await raw('press_key', {
    key: 'b', pid, window_id: dialogHwnd, delivery_mode: 'foreground', session: CUA_SESSION,
  }, 8000)
  record('modal press_key foreground', keyFg.ok ? 'PASS' : 'BLOCKED',
    keyFg.ok ? `${keyFg.ms}ms` : `${keyFg.ms}ms ${keyFg.kind} ${keyFg.error.slice(0, 100)}`,
    { ok: keyFg.ok, ms: keyFg.ms, kind: keyFg.kind })

  const clickBg = await raw('click', {
    pid, window_id: dialogHwnd, x: 20, y: 20, count: 1, button: 'left',
    delivery_mode: 'background', session: CUA_SESSION,
  }, 8000)
  record('modal coordinate click background', clickBg.ok ? 'PASS' : 'BLOCKED',
    clickBg.ok ? `${clickBg.ms}ms` : `${clickBg.ms}ms ${clickBg.kind} ${clickBg.error.slice(0, 100)}`,
    { ok: clickBg.ok, ms: clickBg.ms, kind: clickBg.kind })

  // 7) 关闭路径 A：timeout_ms=5000 的树 + element click
  let dismiss = null
  const noBtn = findButton(t5000, /^No$|取消|Cancel/i)
  if (noBtn) {
    const d = await raw('click', {
      pid,
      window_id: dialogHwnd,
      element_token: noBtn.element_token,
      count: 1,
      button: 'left',
      delivery_mode: 'background',
      session: CUA_SESSION,
    }, 40000)
    dismiss = { path: 'element', ok: d.ok, ms: d.ms, error: d.error, label: elLabel(noBtn) }
    record('modal dismiss via element click', d.ok ? 'PASS' : 'BLOCKED',
      `${elLabel(noBtn)} token=${noBtn.element_token} ${d.ms}ms${d.ok ? '' : ' ' + d.kind + ' ' + d.error.slice(0, 90)}`,
      dismiss)
  } else {
    blocked('modal dismiss via element click', 'timeout_ms=5000 tree still has 0 elements; no element token')
    const native = closeDialog('No', dialogHwnd)
    record('native WM_COMMAND dismiss', /"alive":false/.test(native) ? 'PASS' : 'BLOCKED', native)
  }
  const modalGone = !(await findWindow(DIALOG_TITLE, pid))
  pass('modal dismissed', modalGone,
    modalGone ? `${Date.now() - triggerStarted}ms after trigger` : 'still visible; native fallback will close it',
    { modalGone, path: dismiss?.path || null })
  if (!modalGone) {
    const native = closeDialog('No', dialogHwnd)
    record('native fallback dismissed modal', /"alive":false/.test(native) ? 'PASS' : 'BLOCKED', native)
  }

  const trigger = await pendingTrigger
  record('trigger click returned after modal', trigger.ok ? 'PASS' : 'BLOCKED',
    `${trigger.ms}ms${trigger.ok ? '' : ' ' + trigger.kind + ' ' + trigger.error.slice(0, 100)}`,
    { ok: trigger.ok, ms: trigger.ms, kind: trigger.kind })
  const state1 = readState()
  record('state after first modal', state1 ? 'PASS' : 'FAIL',
    state1 ? `opened=${state1.opened} cancelled=${state1.cancelled} confirmed=${state1.confirmed}` : 'state file unreadable',
    state1)

  // 汇总
  const fails = checks.filter((c) => c.status === 'FAIL').length
  const blocks = checks.filter((c) => c.status === 'BLOCKED').length
  console.log(`\n结果：${checks.filter((c) => c.status === 'PASS').length} PASS / ${blocks} BLOCKED / ${fails} FAIL`)
  console.log('JSON ' + JSON.stringify({ title: TITLE, dialog: DIALOG_TITLE, checks }, null, 2))
  const strict = process.argv.includes('--strict-blocked')
  process.exitCode = fails ? 1 : (strict && blocks ? 2 : 0)
} catch (e) {
  console.error('❌ probe aborted:', e?.stack || e)
  process.exitCode = 1
} finally {
  try {
    if (await findWindow(DIALOG_TITLE, pid)) closeDialog('No')
    if (hwnd) closeForm(hwnd)
    await delay(400)
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
