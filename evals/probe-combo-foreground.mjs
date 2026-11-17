/**
 * evals/probe-combo-foreground.mjs — 组合键自动前台真机探针（不加入 npm test）。
 *
 * 目的：验证 lib/actions.js key() 在 deliveryMode=background 下仍把组合键按前台
 * 投递。WinForms 目标窗放在一个 blocker 窗后面，插件必须 bring_to_front 后才能
 * 把 Ctrl+V 送进 TextBox；后台 synthetic 路径只会落一个 v。
 *
 * 清理：只关标题为 S4 Combo Probe / S4 Combo Blocker 的自建窗口；child 是本探针
 * 自己 spawn 的 PowerShell，可以 kill；不碰用户窗口，不按进程名杀用户进程。
 *
 * 运行：node evals/probe-combo-foreground.mjs
 */
import { spawn } from 'node:child_process'
import { writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { cuaCall, withSession, CUA_SESSION } from '../lib/cua.js'
import { key } from '../lib/actions.js'
import { setSnapshot, clearSnapshot } from '../lib/snapshot.js'

const TEMP = process.env.S4_TEMP
  || (process.platform === 'win32' ? join(homedir(), 'AppData', 'Local', 'Temp') : tmpdir())
const PS1 = join(TEMP, 's4-combo-probe.ps1')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function writeProbeScript() {
  // ASCII only: PowerShell 5.1 对无 BOM 的 UTF-8 中文会乱码。
  writeFileSync(PS1, `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$target = New-Object System.Windows.Forms.Form
$target.Text = 'S4 Combo Probe'
$target.Width = 560
$target.Height = 300
$target.StartPosition = 'Manual'
$target.Left = 220
$target.Top = 180
$tb = New-Object System.Windows.Forms.TextBox
$tb.Multiline = $true
$tb.Left = 30
$tb.Top = 30
$tb.Width = 480
$tb.Height = 160
$target.Controls.Add($tb)
$target.Add_Shown({ $tb.Focus() })
$target.Add_Activated({ $tb.Focus() })
$blocker = New-Object System.Windows.Forms.Form
$blocker.Text = 'S4 Combo Blocker'
$blocker.Width = 360
$blocker.Height = 160
$blocker.StartPosition = 'Manual'
$blocker.Left = 820
$blocker.Top = 180
$lbl = New-Object System.Windows.Forms.Label
$lbl.Text = 'blocker'
$lbl.Left = 20
$lbl.Top = 20
$blocker.Controls.Add($lbl)
$target.Show()
$blocker.Show()
$blocker.Activate()
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 90000
$timer.Add_Tick({ $target.Close(); $blocker.Close() })
$timer.Start()
[System.Windows.Forms.Application]::Run($target)
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

async function targetState(w) {
  return cuaCall('get_window_state', {
    pid: w.pid, window_id: w.window_id, include_screenshot: false, max_elements: 200,
  })
}

async function closeWindow(w) {
  try {
    const st = await targetState(w)
    const close = (st.elements || []).find((e) => /关闭|close/i.test(String(e.label || '')) && e.element_token)
    if (close) {
      await cuaCall('click', {
        pid: w.pid, window_id: w.window_id, element_token: close.element_token,
        count: 1, button: 'left', delivery_mode: 'background',
      })
    }
  } catch { /* timer will close it */ }
}

function snapshotFrom(w, st) {
  const entries = new Map()
  for (const e of st.elements || []) {
    if (e.element_token) entries.set(Number(e.element_index), {
      token: e.element_token, role: e.role, label: e.label, value: e.value,
    })
  }
  setSnapshot({
    pid: w.pid,
    windowId: w.window_id,
    at: Date.now(),
    entries,
    snapshotId: st.snapshot_id || 'probe',
    appName: 'powershell',
    title: String(w.title || ''),
    mode: 'ax',
    maxElements: 200,
  })
}

async function main() {
  try { rmSync(PS1, { force: true }) } catch { /* ignore */ }
  writeProbeScript()
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS1], {
    env: { ...process.env, TEMP, TMP: TEMP },
    stdio: 'ignore',
    windowsHide: false,
  })
  let target = null
  let blocker = null
  try {
    await cuaCall('start_session', { session: CUA_SESSION }).catch(() => undefined)
    target = await findWindow('S4 Combo Probe')
    blocker = await findWindow('S4 Combo Blocker')
    if (!target || !blocker) throw new Error('probe windows not found')

    const st0 = await targetState(target)
    const edit = (st0.elements || []).find((e) => String(e.role || '') === 'Edit' && e.element_token)
    if (!edit) throw new Error('probe TextBox not found in UIA tree')

    // 清空 TextBox + 写剪贴板
    await cuaCall('set_value', {
      session: CUA_SESSION, pid: target.pid, window_id: target.window_id,
      element_token: edit.element_token, value: '',
    }).catch(() => undefined)
    await cuaCall('clipboard_write', { session: CUA_SESSION, text: 'S4-COMBO' })

    // blocker 在前台、target 在后；插件应在 key() 内自动前台 target。
    snapshotFrom(target, st0)
    const cfg = {
      ttlMs: 60000, deliveryMode: 'background', maxElements: 200,
      xamlKeyFallback: 'off', xamlPressFallback: 'off', supersession: 'note', verboseReceipts: false,
    }
    const receipt = await key({ key: 'ctrl+v' }, cfg)
    clearSnapshot()
    await sleep(900)

    const st1 = await targetState(target)
    const edit1 = (st1.elements || []).find((e) => String(e.role || '') === 'Edit')
    const text = String(edit1?.value || '')
    const ok = text.includes('S4-COMBO') && /组合键需前台注入/.test(String(receipt.result || ''))
    const result = {
      ok,
      text,
      receipt: String(receipt.result || '').slice(0, 500),
      target: { pid: target.pid, window_id: target.window_id, title: target.title },
      blocker: { pid: blocker.pid, window_id: blocker.window_id, title: blocker.title },
      note: ok
        ? 'plugin key() foregrounded the target and Ctrl+V reached the TextBox'
        : 'Ctrl+V did not reach the TextBox; check foreground escalation/receipt note',
    }
    console.log(JSON.stringify(result, null, 2))
    if (!ok) process.exitCode = 1
  } finally {
    if (target) await closeWindow(target)
    if (blocker) await closeWindow(blocker)
    await sleep(400)
    try { child.kill() } catch { /* ignore */ }
    try { rmSync(PS1, { force: true }) } catch { /* ignore */ }
  }
}

main().catch((err) => {
  console.error(`combo foreground probe failed: ${err.message}`)
  process.exit(1)
})
