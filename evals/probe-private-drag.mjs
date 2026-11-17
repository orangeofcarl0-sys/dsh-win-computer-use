/**
 * evals/probe-private-drag.mjs — 私有 SendInput 拖拽真机探针（不加入 npm test）。
 *
 * WinForms 目标按钮记录 MouseDown/Move/Up 时的 Control.ModifierKeys；
 * privateDrag() 应在 blocker 不在场时激活目标、按住 Ctrl+Shift、完成一次拖拽，
 * 并在 drop 后释放修饰键。只关闭标题为 S4 Private Drag Probe 的自建窗口。
 *
 * 运行：node evals/probe-private-drag.mjs
 */
import { spawn } from 'node:child_process'
import { writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { cuaCall, CUA_SESSION } from '../lib/cua.js'
import { drag } from '../lib/actions.js'
import { setSnapshot, clearSnapshot } from '../lib/snapshot.js'
import { stopPrivateDrag } from '../lib/privateDrag.js'

const TEMP = process.env.S4_TEMP
  || (process.platform === 'win32' ? join(homedir(), 'AppData', 'Local', 'Temp') : tmpdir())
const PS1 = join(TEMP, 's4-private-drag-probe.ps1')
const MARK = join(TEMP, 's4-private-drag-marker.txt')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function writeProbeScript() {
  writeFileSync(PS1, `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$form = New-Object System.Windows.Forms.Form
$form.Text = 'S4 Private Drag Probe'
$form.Width = 560
$form.Height = 380
$form.StartPosition = 'Manual'
$form.Left = 240
$form.Top = 200
$btn = New-Object System.Windows.Forms.Button
$btn.Text = 'DRAG-TARGET'
$btn.Left = 30
$btn.Top = 30
$btn.Width = 480
$btn.Height = 280
$btn.FlatStyle = 'Flat'
$mark = Join-Path $env:TEMP 's4-private-drag-marker.txt'
function Log($phase) {
  $m = [System.Windows.Forms.Control]::ModifierKeys
  $p = [System.Windows.Forms.Cursor]::Position
  Add-Content -Path $mark -Value ($phase + '|' + [string]$m + '|' + $p.X + ',' + $p.Y)
}
$btn.Add_MouseDown({ Log 'down' })
$btn.Add_MouseMove({
  if (([System.Windows.Forms.Control]::MouseButtons -band [System.Windows.Forms.MouseButtons]::Left) -ne 0) {
    if (-not $script:firstDragMove) { $script:firstDragMove = $true; Log 'move' }
  }
})
$btn.Add_MouseUp({ Log 'up' })
$form.Controls.Add($btn)
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 90000
$timer.Add_Tick({ $form.Close() })
$timer.Start()
[System.Windows.Forms.Application]::Run($form)
`, 'utf8')
}

async function findWindow(title) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const v = await cuaCall('list_windows', { on_screen_only: true })
    const w = (v.windows || []).find((x) => String(x.title || '').includes(title))
    if (w) return w
    await sleep(300)
  }
  return null
}

async function closeWindow(w) {
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
  } catch { /* timer closes it */ }
}

async function main() {
  for (const p of [MARK, PS1]) { try { rmSync(p, { force: true }) } catch { /* ignore */ } }
  writeProbeScript()
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS1], {
    env: { ...process.env, TEMP, TMP: TEMP },
    stdio: 'ignore',
    windowsHide: false,
  })
  let w = null
  try {
    await cuaCall('start_session', { session: CUA_SESSION }).catch(() => undefined)
    w = await findWindow('S4 Private Drag Probe')
    if (!w) throw new Error('probe window not found')
    const st = await cuaCall('get_window_state', {
      pid: w.pid, window_id: w.window_id, include_screenshot: false, max_elements: 200,
    })
    const btn = (st.elements || []).find((e) => String(e.label || '') === 'DRAG-TARGET'
      && e.frame && Number(e.frame.w) > 100 && e.element_token)
    if (!btn) throw new Error('DRAG-TARGET button not found in UIA tree')
    const b = w.bounds || {}
    if (!(Number(b.width) > 0) || !(Number(b.height) > 0)) throw new Error('probe window bounds missing')
    const cx = Math.round(Number(btn.frame.x) + Number(btn.frame.w) / 2)
    const cy = Math.round(Number(btn.frame.y) + Number(btn.frame.h) / 2)
    const fromX = cx - Number(b.x)
    const fromY = cy - Number(b.y)
    setSnapshot({
      at: Date.now(), ttlMs: 60000,
      pid: w.pid, windowId: w.window_id, appName: 'powershell', title: w.title,
      coordinateSpace: 'window-screenshot-px',
      screenOrigin: { x: Number(b.x), y: Number(b.y), width: Number(b.width), height: Number(b.height) },
      snapshotId: 'probe', entries: new Map(), screenshotWidth: Number(b.width), screenshotHeight: Number(b.height),
      mode: 'ax', maxElements: 200,
    })
    const receipt = await drag({
      from_x: fromX, from_y: fromY, to_x: fromX + 120, to_y: fromY + 60,
      steps: 24, duration_ms: 700, dwell_ms: 120, modifier: ['ctrl', 'shift'],
    }, {
      ttlMs: 60000, deliveryMode: 'auto', maxElements: 200,
      xamlKeyFallback: 'off', xamlPressFallback: 'off', supersession: 'note', verboseReceipts: false,
    })
    clearSnapshot()
    await sleep(500)
    const marker = existsSync(MARK) ? readFileSync(MARK, 'utf8').trim() : ''
    const lines = marker ? marker.split(/\r?\n/) : []
    const down = lines.find((l) => l.startsWith('down|')) || ''
    const move = lines.find((l) => l.startsWith('move|')) || ''
    const up = lines.find((l) => l.startsWith('up|')) || ''
    const ok = receipt.ok === true && /私有 SendInput/.test(String(receipt.result || ''))
      && /Control/.test(down) && /Shift/.test(down)
      && /Control/.test(move) && /Shift/.test(move)
      && /Control/.test(up) && /Shift/.test(up)
      && !/stuck/.test(String(receipt.result || ''))
    console.log(JSON.stringify({
      ok,
      receipt: String(receipt.result || '').slice(0, 700),
      marker: { down, move, up, lines: lines.length },
      window: { pid: w.pid, window_id: w.window_id, title: w.title },
      note: ok
        ? 'plugin computer_drag -> private SendInput held Ctrl+Shift through down/move/up and released cleanly'
        : 'plugin private drag did not deliver both modifiers through the gesture',
    }, null, 2))
    if (!ok) process.exitCode = 1
  } finally {
    if (w) await closeWindow(w)
    try { child.kill() } catch { /* ignore */ }
    stopPrivateDrag()
    for (const p of [PS1, MARK]) { try { rmSync(p, { force: true }) } catch { /* ignore */ } }
  }
}

main().catch((err) => {
  console.error(`private drag probe failed: ${err.message}`)
  try { stopPrivateDrag() } catch { /* ignore */ }
  process.exit(1)
})
