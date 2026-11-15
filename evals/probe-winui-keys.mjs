/**
 * evals/probe-winui-keys.mjs — WinUI/Notepad 键鼠通道成测试（不加入 npm test）。
 *
 * 目的：把 Ctrl+A / Alt+F / Alt+Tab 在 Win11 Notepad（WinUI3）上的真实可达性
 * 做成可复现矩阵，而不是只凭轨迹推断：
 *   - hotkey(background/foreground)
 *   - press_key + modifiers(background/foreground)
 *   - 菜单控件回退（编辑→全选 / 文件菜单）
 * 观测：
 *   - Ctrl+A：UIA TextPattern.GetSelection() 是否覆盖全文；
 *   - Alt+F：窗口 AX 树是否出现弹出菜单项（保存/另存为等）；
 *   - Alt+Tab：GetForegroundWindow 的 HWND 是否改变。
 *
 * 安全：只操作唯一标题/唯一 seed 的测试 Notepad；TabState 先备份后恢复；
 * 清理优先 Close-TestNotepad，其次 UIA/WM_CLOSE；绝不按进程名杀。
 *
 * 运行：node evals/probe-winui-keys.mjs
 */
import { spawnSync } from 'node:child_process'
import { writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { cuaCall } from '../lib/cua.js'

const ROOT = dirname(fileURLToPath(new URL('.', import.meta.url)))
const TEMP = process.env.S4_TEMP
  || (process.platform === 'win32' && process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'Temp')
    : (process.env.TEMP || tmpdir()))
const PS = 'powershell.exe'
const ENV = { ...process.env, TEMP, TMP: TEMP }
const FILE = join(TEMP, 's4-winui-keys.txt')
const STATE = join(TEMP, 's4-winui-keys-state.json')
const UIA = join(TEMP, 's4-winui-keys-uia.ps1')
const FG = join(TEMP, 's4-winui-keys-fg.ps1')
const OPEN = join(TEMP, 's4-winui-keys-open.ps1')
const CLOSE = join(TEMP, 's4-winui-keys-close.ps1')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const q = (s) => String(s).replace(/'/g, "''")

function psFile(file, args = [], timeout = 120000) {
  const r = spawnSync(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file, ...args], {
    env: ENV, encoding: 'utf8', timeout,
  })
  const out = `${r.stdout || ''}\n${r.stderr || ''}`.trim()
  let json = null
  for (const line of out.split(/\r?\n/)) {
    if (!line.trim().startsWith('{')) continue
    try { json = JSON.parse(line) } catch { /* continue */ }
  }
  return { code: r.status, out, json }
}

function psTabState(action) {
  return psFile(join(ROOT, 'evals', 'lib', 'tabstate.ps1'), [action], 60000)
}

function writeHelpers() {
  writeFileSync(UIA, `
param([int]$Hwnd, [string]$Action = 'read')
Add-Type -AssemblyName UIAutomationClient
$w = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$Hwnd)
if (-not $w) { @{ ok = $false; reason = 'no window' } | ConvertTo-Json -Compress; exit 0 }
$docCond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
  [System.Windows.Automation.ControlType]::Document)
$doc = $w.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $docCond)
if (-not $doc) { @{ ok = $false; reason = 'no document' } | ConvertTo-Json -Compress; exit 0 }
$tp = $doc.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
$range = $tp.DocumentRange
$text = $range.GetText(-1)
if ($Action -eq 'clear') {
  $r = $range.Clone()
  $r.MoveEndpointByRange(
    [System.Windows.Automation.Text.TextPatternRangeEndpoint]::Start,
    $r,
    [System.Windows.Automation.Text.TextPatternRangeEndpoint]::End)
  $r.Select()
  Start-Sleep -Milliseconds 100
  $tp = $doc.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
}
if ($Action -eq 'collapse') {
  $menuCond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::MenuItem)
  foreach ($m in $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, $menuCond)) {
    try {
      if ([string]$m.Current.Name -eq '文件' -or [string]$m.Current.Name -eq 'File') {
        $ec = $m.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
        $ec.Collapse()
      }
    } catch {}
  }
  Start-Sleep -Milliseconds 200
}
$sel = $tp.GetSelection()
$selText = ''
foreach ($s in $sel) { try { $selText += $s.GetText(-1) } catch {} }
@{ ok = $true; textLen = $text.Length; selLen = $selText.Length; sel = $selText } | ConvertTo-Json -Compress
`, 'utf8')

  writeFileSync(FG, `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class S4FgWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
}
"@
$h = [S4FgWin]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 512
[void][S4FgWin]::GetWindowText($h, $sb, 512)
@{ hwnd = [int]$h; title = $sb.ToString() } | ConvertTo-Json -Compress
`, 'utf8')

  writeFileSync(OPEN, `
param([string]$Path, [string]$StateFile)
. '${q(join(ROOT, 'evals', 'lib', 'common.ps1'))}' -TaskId 'winuikeys'
$s = Open-TestNotepad -Path $Path -TitleNeedle 's4-winui-keys' -StateFile $StateFile -ExpectedTabs @('s4-winui-keys.txt')
$s | ConvertTo-Json -Compress
`, 'utf8')

  writeFileSync(CLOSE, `
param([string]$StateFile)
. '${q(join(ROOT, 'evals', 'lib', 'common.ps1'))}' -TaskId 'winuikeys'
$r = Close-TestNotepad -StateFile $StateFile -AllowDiscardTestOnlyModified
if (-not $r.closed) {
  try { [void][S4W32]::PostMessage([IntPtr](Read-TestState $StateFile).hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) } catch {}
  Start-Sleep -Milliseconds 800
  $r = Close-TestNotepad -StateFile $StateFile -AllowDiscardTestOnlyModified
}
$r | ConvertTo-Json -Compress
`, 'utf8')
}

function uia(hwnd, action = 'read') {
  return psFile(UIA, [String(hwnd), action]).json
}
function fg() {
  return psFile(FG).json
}
function brief(v) {
  if (v == null) return { threw: 'null' }
  if (typeof v === 'string') return { text: v.slice(0, 160) }
  return {
    effect: v.effect ?? null,
    delivery: v.delivery?.mode ?? null,
    code: v.code ?? null,
    error: typeof v.error === 'string' ? v.error.slice(0, 160) : null,
    refusal: v.refusal?.code ?? null,
  }
}
async function callSafe(fn) {
  try { return { value: await fn() } } catch (e) { return { error: String(e?.message || e).slice(0, 240) } }
}
async function state(pid, wid) {
  return cuaCall('get_window_state', { pid, window_id: wid, include_screenshot: false, max_elements: 400 })
}
function findDoc(st) {
  return (st.elements || []).find((e) => /^Document$/i.test(String(e.role || '')) && e.element_token) || null
}
function findMenu(st, label) {
  return (st.elements || []).find((e) => /MenuItem/i.test(String(e.role || ''))
    && String(e.label || '').trim().toLowerCase() === String(label).toLowerCase() && e.element_token) || null
}
function menuOpen(st) {
  const top = new Set(['文件', '编辑', '查看', 'file', 'edit', 'view'])
  const system = new Set(['系统', 'system'])
  return (st.elements || []).some((e) => /MenuItem/i.test(String(e.role || ''))
    && !top.has(String(e.label || '').trim().toLowerCase())
    && !system.has(String(e.label || '').trim().toLowerCase()))
}
async function clickToken(pid, wid, token, mode = 'background') {
  return callSafe(() => cuaCall('click', {
    pid, window_id: wid, element_token: token, count: 1, button: 'left', delivery_mode: mode,
  }))
}
async function focusDoc(pid, wid, doc) {
  await clickToken(pid, wid, doc.element_token, 'background')
  await sleep(300)
}

async function main() {
  for (const p of [FILE, STATE, UIA, FG, OPEN, CLOSE]) { try { rmSync(p, { force: true }) } catch {} }
  writeHelpers()
  writeFileSync(FILE, 'WINUI-KEY-PROBE\r\nSECOND-LINE', 'utf8')

  const backup = psTabState('backup')
  if (!backup.json?.ok) throw new Error(`tabstate backup failed: ${backup.json?.reason || backup.out}`)
  let opened = null
  let closed = null
  const report = { backup: backup.json, ctrlA: [], altF: [], altTab: [], menuWorkaround: null }
  try {
    const o = psFile(OPEN, [FILE, STATE], 120000)
    opened = o.json
    if (!opened?.ok) throw new Error(`Open-TestNotepad failed: ${o.out}`)
    const pid = Number(opened.pid)
    const wid = Number(opened.hwnd)
    let st = await state(pid, wid)
    let doc = findDoc(st)
    if (!doc) throw new Error('Document element not found')

    // Ctrl+A 四种通道
    for (const [name, run] of [
      ['hotkey-bg', () => cuaCall('hotkey', { pid, window_id: wid, keys: ['ctrl', 'a'], delivery_mode: 'background' })],
      ['hotkey-fg', () => cuaCall('hotkey', { pid, window_id: wid, keys: ['ctrl', 'a'], delivery_mode: 'foreground' })],
      ['press-bg', () => cuaCall('press_key', { pid, window_id: wid, key: 'a', modifiers: ['ctrl'], delivery_mode: 'background' })],
      ['press-fg', () => cuaCall('press_key', { pid, window_id: wid, key: 'a', modifiers: ['ctrl'], delivery_mode: 'foreground' })],
    ]) {
      uia(wid, 'clear')
      await focusDoc(pid, wid, doc)
      const before = uia(wid)
      const r = await callSafe(run)
      await sleep(700)
      const after = uia(wid)
      report.ctrlA.push({
        method: name,
        driver: r.error ? { error: r.error } : brief(r.value),
        beforeSel: before?.selLen ?? null,
        afterSel: after?.selLen ?? null,
        textLen: after?.textLen ?? null,
        selectedAll: Boolean(after && after.textLen > 0 && after.selLen >= after.textLen),
      })
    }

    // 菜单回退：点编辑 → 点全选
    uia(wid, 'collapse')
    st = await state(pid, wid)
    const editMenu = findMenu(st, '编辑') || findMenu(st, 'Edit')
    if (editMenu) {
      const m1 = await clickToken(pid, wid, editMenu.element_token, 'background')
      await sleep(500)
      st = await state(pid, wid)
      const selectAll = findMenu(st, '全选') || findMenu(st, 'Select All')
      let m2 = null
      if (selectAll) {
        m2 = await clickToken(pid, wid, selectAll.element_token, 'background')
        await sleep(600)
      }
      const after = uia(wid)
      report.menuWorkaround = {
        editClick: m1.error ? { error: m1.error } : brief(m1.value),
        foundSelectAll: Boolean(selectAll),
        selectAllClick: m2 ? (m2.error ? { error: m2.error } : brief(m2.value)) : null,
        selectedAll: Boolean(after && after.textLen > 0 && after.selLen >= after.textLen),
        textLen: after?.textLen ?? null,
        selLen: after?.selLen ?? null,
      }
    }

    // Alt+F 四种通道
    for (const [name, run] of [
      ['hotkey-bg', () => cuaCall('hotkey', { pid, window_id: wid, keys: ['alt', 'f'], delivery_mode: 'background' })],
      ['hotkey-fg', () => cuaCall('hotkey', { pid, window_id: wid, keys: ['alt', 'f'], delivery_mode: 'foreground' })],
      ['press-bg', () => cuaCall('press_key', { pid, window_id: wid, key: 'f', modifiers: ['alt'], delivery_mode: 'background' })],
      ['press-fg', () => cuaCall('press_key', { pid, window_id: wid, key: 'f', modifiers: ['alt'], delivery_mode: 'foreground' })],
    ]) {
      uia(wid, 'collapse')
      await cuaCall('bring_to_front', { pid, window_id: wid }).catch(() => null)
      await focusDoc(pid, wid, doc)
      const r = await callSafe(run)
      await sleep(700)
      st = await state(pid, wid)
      report.altF.push({
        method: name,
        driver: r.error ? { error: r.error } : brief(r.value),
        menuOpen: menuOpen(st),
        menuItems: (st.elements || []).filter((e) => /MenuItem/i.test(String(e.role || ''))
          && !/^(文件|编辑|查看|file|edit|view|系统|system)$/i.test(String(e.label || '').trim()))
          .slice(0, 6).map((e) => String(e.label || '').slice(0, 20)),
      })
    }
    uia(wid, 'collapse')

    // 菜单回退：直接点文件菜单，证明检测器本身有效
    st = await state(pid, wid)
    const fileMenu = findMenu(st, '文件') || findMenu(st, 'File')
    let fileClick = null
    if (fileMenu) {
      fileClick = await clickToken(pid, wid, fileMenu.element_token, 'background')
      await sleep(500)
      st = await state(pid, wid)
    }
    report.fileMenuBaseline = {
      click: fileClick ? (fileClick.error ? { error: fileClick.error } : brief(fileClick.value)) : null,
      menuOpen: menuOpen(st),
    }
    uia(wid, 'collapse')

    // Alt+Tab 四种通道（用 GetForegroundWindow 验证）
    for (const [name, run] of [
      ['hotkey-bg', () => cuaCall('hotkey', { pid, window_id: wid, keys: ['alt', 'tab'], delivery_mode: 'background' })],
      ['hotkey-fg', () => cuaCall('hotkey', { pid, window_id: wid, keys: ['alt', 'tab'], delivery_mode: 'foreground' })],
      ['press-bg', () => cuaCall('press_key', { pid, window_id: wid, key: 'tab', modifiers: ['alt'], delivery_mode: 'background' })],
      ['press-fg', () => cuaCall('press_key', { pid, window_id: wid, key: 'tab', modifiers: ['alt'], delivery_mode: 'foreground' })],
    ]) {
      await cuaCall('bring_to_front', { pid, window_id: wid }).catch(() => null)
      await sleep(400)
      const before = fg()
      const r = await callSafe(run)
      await sleep(1000)
      const after = fg()
      report.altTab.push({
        method: name,
        driver: r.error ? { error: r.error } : brief(r.value),
        before,
        after,
        changed: Boolean(before?.hwnd && after?.hwnd && before.hwnd !== after.hwnd),
      })
      await cuaCall('bring_to_front', { pid, window_id: wid }).catch(() => null)
      await sleep(300)
    }
  } finally {
    const c = psFile(CLOSE, [STATE], 120000)
    closed = c.json
    await sleep(500)
    const restore = psTabState('restore')
    report.close = closed
    report.restore = restore.json
    for (const p of [FILE, STATE, UIA, FG, OPEN, CLOSE]) { try { rmSync(p, { force: true }) } catch {} }
  }
  console.log(JSON.stringify(report, null, 2))
  const ok = report.ctrlA.some((x) => x.selectedAll)
    || Boolean(report.menuWorkaround?.selectedAll)
    || report.altF.some((x) => x.menuOpen)
    || Boolean(report.fileMenuBaseline?.menuOpen)
    || report.altTab.some((x) => x.changed)
  if (!ok) process.exit(1)
}

main().catch((err) => {
  console.error(`❌ winui keys probe failed: ${err.message}`)
  process.exit(1)
})
