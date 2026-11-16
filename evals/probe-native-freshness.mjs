/**
 * evals/probe-native-freshness.mjs — native 截图 freshness 真机探针（不加入 npm test）。
 *
 * 背景：t11 轨迹出现过 drag 前后同一 PNG hash、AX 状态已变的疑似陈旧截图。
 * 本探针用 WinForms 测试窗改变 Label 文本，分别在两层取证：
 *   1. driver 层：连续 get_window_state(include_screenshot) 的 screenshot_png_b64 hash；
 *   2. 插件层：screen_observe(mode=native, force=true) 的 screenshotFile hash。
 * 若 AX 文本已变而 hash 不变，说明该层缓存陈旧。
 *
 * 清理：只关标题为 S4 Native Freshness Probe 的窗口；child 是本探针 spawn 的 PowerShell。
 *
 * 运行：node evals/probe-native-freshness.mjs
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { cuaCall, withSession, CUA_SESSION } from '../lib/cua.js'
import { screenObserve } from '../lib/observe.js'
import { clearSnapshot } from '../lib/snapshot.js'

const TEMP = process.env.S4_TEMP
  || (process.platform === 'win32' ? join(homedir(), 'AppData', 'Local', 'Temp') : tmpdir())
const PS1 = join(TEMP, 's4-native-freshness-probe.ps1')
const MARK_CLICK = join(TEMP, 's4-native-freshness-click.txt')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const hashOf = (v) => createHash('sha256').update(v || '').digest('hex').slice(0, 16)

function writeProbeScript() {
  // ASCII only: PowerShell 5.1 对无 BOM 的 UTF-8 中文会乱码。
  writeFileSync(PS1, `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$form = New-Object System.Windows.Forms.Form
$form.Text = 'S4 Native Freshness Probe'
$form.Width = 560
$form.Height = 380
$form.StartPosition = 'Manual'
$form.Left = 300
$form.Top = 260
$label = New-Object System.Windows.Forms.Label
$label.Text = 'ALPHA'
$label.AutoSize = $true
$label.Left = 80
$label.Top = 80
$label.Font = New-Object System.Drawing.Font('Segoe UI', 20)
$form.Controls.Add($label)
$btn = New-Object System.Windows.Forms.Button
$btn.Text = 'CHANGE-LABEL'
$btn.Left = 80
$btn.Top = 170
$btn.Width = 220
$btn.Height = 70
$n = 0
$btn.Add_Click({
  $script:n = $script:n + 1
  $label.Text = 'BRAVO-' + $script:n
  [IO.File]::WriteAllText((Join-Path $env:TEMP 's4-native-freshness-click.txt'), $label.Text)
})
$form.Controls.Add($btn)
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
    const w = (v.windows || []).find((x) => String(x.title || '').includes('S4 Native Freshness Probe'))
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

function driverShot(st) {
  return {
    hash: hashOf(st?.screenshot_png_b64 || ''),
    labels: (st?.elements || []).map((e) => String(e.label || '')).filter(Boolean).slice(0, 12),
    file: st?.screenshot_out_file || null,
  }
}

function fileHash(path) {
  try {
    if (typeof path !== 'string' || !path) return ''
    return existsSync(path) ? hashOf(readFileSync(path)) : ''
  } catch { return '' }
}

async function pluginShot(ctx, cfg, exec, w) {
  const v = await screenObserve(ctx, { window_id: w.window_id, mode: 'native', force: true }, cfg, exec)
  return {
    ok: v?.ok === true,
    screenshotHash: fileHash(v?.screenshotFile),
    screenshotFile: v?.screenshotFile || null,
    imageBytes: v?.image?.bytes ?? null,
    resultHead: String(v?.result || '').slice(0, 160),
  }
}

async function clickChange(w, st) {
  const btn = (st.elements || []).find((e) => String(e.label || '') === 'CHANGE-LABEL' && e.element_token)
  if (!btn) throw new Error('CHANGE-LABEL button not found')
  await cuaCall('click', withSession({
    pid: w.pid, window_id: w.window_id, element_token: btn.element_token,
    count: 1, button: 'left', delivery_mode: 'background',
  }))
  const deadline = Date.now() + 5000
  while (Date.now() < deadline && !existsSync(MARK_CLICK)) await sleep(120)
  const label = existsSync(MARK_CLICK) ? readFileSync(MARK_CLICK, 'utf8').trim() : ''
  try { rmSync(MARK_CLICK, { force: true }) } catch { /* ignore */ }
  await sleep(400)
  return label
}

async function main() {
  try { rmSync(MARK_CLICK, { force: true }) } catch { /* ignore */ }
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
    clearSnapshot()

    const d1 = driverShot(await cuaCall('get_window_state', {
      pid: w.pid, window_id: w.window_id, include_screenshot: true, max_elements: 200,
    }))
    const label1 = await clickChange(w, await cuaCall('get_window_state', {
      pid: w.pid, window_id: w.window_id, include_screenshot: false, max_elements: 200,
    }))
    const d2 = driverShot(await cuaCall('get_window_state', {
      pid: w.pid, window_id: w.window_id, include_screenshot: true, max_elements: 200,
    }))

    const ctx = {
      get: (k) => k === 'attachments'
        ? {
          imageLimits: { maxImageBytes: 5 * 1024 * 1024, maxImagePixels: 40_000_000 },
          saveImage: async (o) => ({
            attachmentId: 'probe-native-freshness',
            mediaType: o.mediaType,
            bytes: o.data.length,
          }),
        }
        : k === 'llm'
          ? { resolveModelInfo: async () => ({ inputModalities: ['image', 'text'] }) }
          : null,
    }
    const exec = { agent: { options: { provider: 'probe', model: 'probe-vision' } } }
    const cfg = {
      ttlMs: 60000, maxElements: 120, nativeImage: 'auto', deliveryMode: 'background',
      cursorMotion: 'off', supersession: 'note', verifyAfterAction: 'off', verboseReceipts: true,
      observeDedup: 'off',
    }

    const p1 = await pluginShot(ctx, cfg, exec, w)
    const label2 = await clickChange(w, await cuaCall('get_window_state', {
      pid: w.pid, window_id: w.window_id, include_screenshot: false, max_elements: 200,
    }))
    const p2 = await pluginShot(ctx, cfg, exec, w)

    const driverFresh = d1.hash !== d2.hash
    const pluginFresh = p1.screenshotHash && p2.screenshotHash
      ? p1.screenshotHash !== p2.screenshotHash
      : (p1.imageBytes != null && p2.imageBytes != null
        ? p1.imageBytes !== p2.imageBytes
        : null)
    const result = {
      ok: driverFresh && (pluginFresh !== false),
      window: { pid: w.pid, window_id: w.window_id },
      labels: { first: label1, second: label2 },
      driver: { first: d1, second: d2, changed: driverFresh },
      plugin: { first: p1, second: p2, changed: pluginFresh },
      verdict: driverFresh
        ? (pluginFresh === false ? 'plugin-native-cache-stale' : 'fresh')
        : 'driver-screenshot-stale',
    }
    console.log(JSON.stringify(result, null, 2))
    if (!result.ok) process.exitCode = 1
  } finally {
    if (w) await closeProbe(w)
    try { child.kill() } catch { /* ignore */ }
    try { rmSync(PS1, { force: true }) } catch { /* ignore */ }
    try { rmSync(MARK_CLICK, { force: true }) } catch { /* ignore */ }
    clearSnapshot()
  }
}

main().catch((err) => {
  console.error(`native freshness probe failed: ${err.message}`)
  process.exit(1)
})
