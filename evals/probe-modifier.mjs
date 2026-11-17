/**
 * evals/probe-modifier.mjs — modifier click/drag 真机确定性探针（不加入 npm test）。
 *
 * 目的：driver 0.23.2 的 click/drag schema 已声明 modifier，但 click 的说明里仍有
 * 一句过时的 "Swift-only modifier not supported"。这里用一个 WinForms 测试窗，
 * 让按钮的 Click/MouseDown/MouseUp 直接写 Control.ModifierKeys：
 *   1. element_token + modifier:['ctrl'] + foreground click；
 *   2. 坐标 + modifier:['ctrl'] + foreground click；
 *   3. 坐标 drag + modifier:['shift'] + foreground。
 * marker 里出现 Control/Shift 才说明修饰键真的到达目标。
 *
 * 清理：只关标题为 S4 Modifier Probe 的窗口；child 是本探针自己 spawn 的 PowerShell，
 * 可以 kill；不碰任何用户窗口，不按进程名杀。
 *
 * 运行：node evals/probe-modifier.mjs
 */
import { spawn } from 'node:child_process'
import { writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { cuaCall, withSession, CUA_SESSION } from '../lib/cua.js'

const TEMP = process.env.S4_TEMP
  || (process.platform === 'win32' ? join(homedir(), 'AppData', 'Local', 'Temp') : tmpdir())
const PS1 = join(TEMP, 's4-modifier-probe.ps1')
const MARK_CLICK = join(TEMP, 's4-modifier-click.txt')
const MARK_DOWN = join(TEMP, 's4-modifier-drag-down.txt')
const MARK_UP = join(TEMP, 's4-modifier-drag-up.txt')
const MARK_LOG = join(TEMP, 's4-modifier-drag-log.txt')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function writeProbeScript() {
  // ASCII only: PowerShell 5.1 对无 BOM 的 UTF-8 中文会乱码。
  writeFileSync(PS1, `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$form = New-Object System.Windows.Forms.Form
$form.Text = 'S4 Modifier Probe'
$form.Width = 640
$form.Height = 500
$form.StartPosition = 'Manual'
$form.Left = 260
$form.Top = 220
$dragLog = Join-Path $env:TEMP 's4-modifier-drag-log.txt'
function Log($s) {
  $m = [System.Windows.Forms.Control]::ModifierKeys
  Add-Content -Path $dragLog -Value ($s + '|' + [string]$m + '|' + [System.Windows.Forms.Cursor]::Position.ToString())
}
$btn = New-Object System.Windows.Forms.Button
$btn.Text = 'CTRL-CLICK'
$btn.Width = 220
$btn.Height = 80
$btn.Left = 80
$btn.Top = 80
$btn.Add_Click({
  $m = [System.Windows.Forms.Control]::ModifierKeys
  [IO.File]::WriteAllText((Join-Path $env:TEMP 's4-modifier-click.txt'), [string]$m)
})
$btn.Add_MouseDown({ Log 'btn-down' })
$btn.Add_MouseUp({ Log 'btn-up' })
$btn.Add_MouseMove({ Log 'btn-move' })
$form.Controls.Add($btn)
$drag = New-Object System.Windows.Forms.Button
$drag.Text = 'SHIFT-DRAG'
$drag.Width = 300
$drag.Height = 140
$drag.Left = 80
$drag.Top = 220
$drag.Add_MouseDown({
  Log 'drag-down'
  $m = [System.Windows.Forms.Control]::ModifierKeys
  [IO.File]::WriteAllText((Join-Path $env:TEMP 's4-modifier-drag-down.txt'), ([string]$m + '|' + [System.Windows.Forms.Cursor]::Position.ToString()))
})
$drag.Add_MouseUp({
  Log 'drag-up'
  $m = [System.Windows.Forms.Control]::ModifierKeys
  [IO.File]::WriteAllText((Join-Path $env:TEMP 's4-modifier-drag-up.txt'), ([string]$m + '|' + [System.Windows.Forms.Cursor]::Position.ToString()))
})
$drag.Add_MouseMove({ Log 'drag-move' })
$form.Controls.Add($drag)
$form.Add_MouseDown({ Log 'form-down' })
$form.Add_MouseUp({ Log 'form-up' })
$form.Add_MouseMove({ Log 'form-move' })
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 90000
$timer.Add_Tick({ $form.Close() })
$timer.Start()
[System.Windows.Forms.Application]::Run($form)
`, 'utf8')
}

async function findProbeWindow() {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const v = await cuaCall('list_windows', { on_screen_only: true })
    const w = (v.windows || []).find((x) => String(x.title || '').includes('S4 Modifier Probe'))
    if (w) return w
    await sleep(300)
  }
  return null
}

async function closeProbe(w) {
  try {
    const st = await cuaCall('get_window_state', {
      pid: w.pid, window_id: w.window_id, include_screenshot: false, max_elements: 200,
    })
    const close = (st.elements || []).find((e) => /关闭|close/i.test(String(e.label || '')) && e.element_token)
    if (close) {
      await cuaCall('click', {
        pid: w.pid, window_id: w.window_id, element_token: close.element_token,
        count: 1, button: 'left', delivery_mode: 'background',
      })
    }
  } catch { /* fall through */ }
  await sleep(600)
  try {
    const list = await cuaCall('list_windows', { on_screen_only: true })
    const still = (list.windows || []).find((x) => Number(x.window_id) === Number(w.window_id))
    if (still) {
      await cuaCall('hotkey', withSession({
        keys: ['alt', 'f4'], pid: w.pid, window_id: w.window_id, delivery_mode: 'foreground',
      }))
    }
  } catch { /* timer will close it */ }
}

async function waitMarker(path, deadlineMs = 5000) {
  const deadline = Date.now() + deadlineMs
  while (Date.now() < deadline && !existsSync(path)) await sleep(150)
  return existsSync(path) ? readFileSync(path, 'utf8').trim() : ''
}

function localCenter(el, bounds) {
  return {
    x: Math.round(Number(el.frame.x) + Number(el.frame.w) / 2 - Number(bounds.x || 0)),
    y: Math.round(Number(el.frame.y) + Number(el.frame.h) / 2 - Number(bounds.y || 0)),
  }
}

async function main() {
  for (const p of [MARK_CLICK, MARK_DOWN, MARK_UP, MARK_LOG]) {
    try { rmSync(p, { force: true }) } catch { /* ignore */ }
  }
  writeProbeScript()
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS1], {
    env: { ...process.env, TEMP, TMP: TEMP },
    stdio: 'ignore',
    windowsHide: false,
  })
  let w = null
  try {
    await cuaCall('start_session', { session: CUA_SESSION }).catch(() => undefined)
    w = await findProbeWindow()
    if (!w) throw new Error('probe window not found')
    const st = await cuaCall('get_window_state', {
      pid: w.pid, window_id: w.window_id, include_screenshot: false, max_elements: 200,
    })
    const btn = (st.elements || []).find((e) => String(e.label || '') === 'CTRL-CLICK' && e.frame && e.element_token)
    const drag = (st.elements || []).find((e) => String(e.label || '') === 'SHIFT-DRAG' && e.frame)
    if (!btn || !drag) throw new Error('probe buttons not found in UIA tree')
    const b = w.bounds || {}
    const bc = localCenter(btn, b)
    const dc = localCenter(drag, b)

    // 1) element_token + ctrl
    try { rmSync(MARK_CLICK, { force: true }) } catch { /* ignore */ }
    // 0.52+ 的前台点击需要目标真的在前台（否则可能报 screenshot_context_missing）。
    await cuaCall('bring_to_front', withSession({ pid: w.pid, window_id: w.window_id })).catch(() => null)
    await sleep(300)
    const elementClick = await cuaCall('click', withSession({
      pid: w.pid, window_id: w.window_id, element_token: btn.element_token,
      count: 1, button: 'left', modifier: ['ctrl'], delivery_mode: 'foreground',
    }))
    const elementMark = await waitMarker(MARK_CLICK)

    // 2) coordinate + ctrl
    try { rmSync(MARK_CLICK, { force: true }) } catch { /* ignore */ }
    await cuaCall('bring_to_front', withSession({ pid: w.pid, window_id: w.window_id })).catch(() => null)
    // 0.52+ 像素动作需要截图上下文；0.23.2 也接受该字段。
    await cuaCall('get_window_state', {
      pid: w.pid, window_id: w.window_id, include_screenshot: true, max_elements: 200,
    }).catch(() => null)
    await sleep(200)
    const coordClick = await cuaCall('click', withSession({
      pid: w.pid, window_id: w.window_id, x: bc.x, y: bc.y,
      count: 1, button: 'left', modifier: ['ctrl'], delivery_mode: 'foreground',
    }))
    const coordMark = await waitMarker(MARK_CLICK)

    // 3) drag + shift：先把测试窗真正激活，再拖已证明可点击的按钮
    for (const p of [MARK_LOG, MARK_DOWN, MARK_UP]) {
      try { rmSync(p, { force: true }) } catch { /* ignore */ }
    }
    await cuaCall('bring_to_front', withSession({ pid: w.pid, window_id: w.window_id }))
    await cuaCall('get_window_state', {
      pid: w.pid, window_id: w.window_id, include_screenshot: true, max_elements: 200,
    }).catch(() => null)
    await sleep(500)
    const btnDrag = await cuaCall('drag', withSession({
      pid: w.pid, window_id: w.window_id,
      from_x: bc.x, from_y: bc.y,
      to_x: bc.x + 90, to_y: bc.y + 30,
      duration_ms: 700, steps: 20, modifier: ['shift'], delivery_mode: 'foreground',
    }))
    const btnDown = await waitMarker(MARK_DOWN)
    const btnUp = await waitMarker(MARK_UP, 800)

    for (const p of [MARK_DOWN, MARK_UP]) {
      try { rmSync(p, { force: true }) } catch { /* ignore */ }
    }
    await cuaCall('bring_to_front', withSession({ pid: w.pid, window_id: w.window_id }))
    await cuaCall('get_window_state', {
      pid: w.pid, window_id: w.window_id, include_screenshot: true, max_elements: 200,
    }).catch(() => null)
    await sleep(400)
    const panelDrag = await cuaCall('drag', withSession({
      pid: w.pid, window_id: w.window_id,
      from_x: dc.x, from_y: dc.y,
      to_x: dc.x + 90, to_y: dc.y + 30,
      duration_ms: 1200, steps: 20, modifier: ['Shift'], delivery_mode: 'foreground',
    }))
    const panelDown = await waitMarker(MARK_DOWN)
    const panelUp = await waitMarker(MARK_UP, 800)
    const dragLog = existsSync(MARK_LOG) ? readFileSync(MARK_LOG, 'utf8').trim() : ''

    const okElement = /Control/i.test(elementMark)
    const okCoord = /Control/i.test(coordMark)
    const okDrag = /Shift/i.test(btnDown) || /Shift/i.test(btnUp)
      || /Shift/i.test(panelDown) || /Shift/i.test(panelUp) || /Shift/i.test(dragLog)
    const logLines = dragLog ? dragLog.split(/\r?\n/) : []
    const result = {
      // 门禁只看 click 家族：drag modifier 在 0.23.2 上实测不进入目标键状态，
      // 不能因为 schema 有声明就当成可用能力。
      ok: okElement && okCoord,
      dragModifierSupported: okDrag,
      note: okDrag ? 'drag modifier delivered' : 'driver 0.23.2 drag accepts modifier in schema but target sees ModifierKeys=None',
      window: { pid: w.pid, window_id: w.window_id, bounds: b },
      buttons: { clickLocal: bc, dragLocal: dc },
      elementClick: { response: elementClick, marker: elementMark, ok: okElement },
      coordClick: { response: coordClick, marker: coordMark, ok: okCoord },
      buttonDrag: { response: btnDrag, down: btnDown, up: btnUp },
      panelDrag: { response: panelDrag, down: panelDown, up: panelUp },
      dragLogSample: logLines.slice(0, 12),
      dragLogLines: logLines.length,
    }
    console.log(JSON.stringify(result, null, 2))
    if (!result.ok) process.exitCode = 1
  } finally {
    if (w) await closeProbe(w)
    try { child.kill() } catch { /* ignore */ }
    try { rmSync(PS1, { force: true }) } catch { /* ignore */ }
    try { rmSync(MARK_CLICK, { force: true }) } catch { /* ignore */ }
    try { rmSync(MARK_DOWN, { force: true }) } catch { /* ignore */ }
    try { rmSync(MARK_UP, { force: true }) } catch { /* ignore */ }
    try { rmSync(MARK_LOG, { force: true }) } catch { /* ignore */ }
  }
}

main().catch((err) => {
  console.error(`modifier probe failed: ${err.message}`)
  process.exit(1)
})
