/**
 * evals/probe-from-zoom.mjs — from_zoom 真机确定性探针（不加入 npm test）。
 *
 * 目的：模型在 t01/t05 中从未主动使用 from_zoom，不能靠任务轨迹证明驱动映射。
 * 这里自建一个 WinForms 测试窗（按钮点击写 marker 文件）：
 *   1. 找到测试窗与按钮中心；
 *   2. 用插件 screenZoom 裁按钮周围区域；
 *   3. 用 computer_click(x,y,from_zoom=true) 点击 zoom 图中心；
 *   4. 断言 marker 生成（证明驱动把 zoom 图坐标映射回窗口坐标）。
 *
 * 清理：优先 UIA/WM_CLOSE 关闭测试窗；只关标题为 S4 FromZoom Probe 的窗口。
 * 不碰 Notepad/用户窗口，不按进程名杀任何东西。
 *
 * 运行：node evals/probe-from-zoom.mjs
 */
import { spawn, execFileSync } from 'node:child_process'
import { writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { cuaCall } from '../lib/cua.js'
import { screenZoom } from '../lib/observe.js'
import { click } from '../lib/actions.js'
import { setSnapshot, clearSnapshot } from '../lib/snapshot.js'

const TEMP = process.env.S4_TEMP || process.env.TEMP || tmpdir()
const PS1 = join(TEMP, 's4-fromzoom-probe.ps1')
const MARKER = join(TEMP, 's4-fromzoom-marker.txt')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function writeProbeScript() {
  // ASCII only: PowerShell 5.1 对无 BOM 的 UTF-8 中文会乱码。
  writeFileSync(PS1, `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$form = New-Object System.Windows.Forms.Form
$form.Text = 'S4 FromZoom Probe'
$form.Width = 600
$form.Height = 400
$form.StartPosition = 'Manual'
$form.Left = 240
$form.Top = 240
$btn = New-Object System.Windows.Forms.Button
$btn.Text = 'CLICK-ME'
$btn.Width = 200
$btn.Height = 80
$btn.Left = 200
$btn.Top = 160
$btn.Add_Click({ [IO.File]::WriteAllText((Join-Path $env:TEMP 's4-fromzoom-marker.txt'), 'clicked') })
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
    const w = (v.windows || []).find((x) => String(x.title || '').includes('S4 FromZoom Probe'))
    if (w) return w
    await sleep(300)
  }
  return null
}

async function closeProbe(w) {
  try {
    const st = await cuaCall('get_window_state', { pid: w.pid, window_id: w.window_id, include_screenshot: false, max_elements: 200 })
    const close = (st.elements || []).find((e) => /关闭|close/i.test(String(e.label || '')) && e.element_token)
    if (close) {
      await cuaCall('click', { pid: w.pid, window_id: w.window_id, element_token: close.element_token, count: 1, button: 'left', delivery_mode: 'background' })
    }
  } catch { /* fall through */ }
  await sleep(800)
  try {
    const list = await cuaCall('list_windows', { on_screen_only: true })
    const still = (list.windows || []).find((x) => Number(x.window_id) === Number(w.window_id))
    if (still) {
      execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
        `. '${join(process.cwd(), 'evals', 'lib', 'common.ps1').replace(/'/g, "''")}' -TaskId 'fromzoomprobe'; [void](Close-WindowUia(${Number(w.window_id)})); [void][S4W32]::PostMessage([IntPtr]${Number(w.window_id)}, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)`,
      ], { env: { ...process.env, TEMP, TMP: TEMP }, stdio: 'ignore' })
      await sleep(800)
    }
  } catch { /* best effort */ }
}

async function main() {
  try { rmSync(MARKER, { force: true }) } catch {}
  writeProbeScript()
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS1], {
    env: { ...process.env, TEMP, TMP: TEMP },
    stdio: 'ignore',
    windowsHide: false,
  })
  let w = null
  try {
    w = await findProbeWindow()
    if (!w) throw new Error('probe window not found')
    const st = await cuaCall('get_window_state', { pid: w.pid, window_id: w.window_id, include_screenshot: false, max_elements: 200 })
    const btn = (st.elements || []).find((e) => String(e.label || '') === 'CLICK-ME' && e.frame)
    if (!btn) throw new Error('probe button not found in UIA tree')
    const b = w.bounds || {}
    const cx = Math.round(btn.frame.x + btn.frame.w / 2 - Number(b.x || 0))
    const cy = Math.round(btn.frame.y + btn.frame.h / 2 - Number(b.y || 0))
    const halfW = 80
    const halfH = 50
    setSnapshot({
      at: Date.now(), ttlMs: 60000, pid: w.pid, windowId: w.window_id,
      appName: 'probe', title: w.title, snapshotId: 'probe-fromzoom',
      entries: new Map(),
      screenshotWidth: b.width || 900,
      screenshotHeight: b.height || 600,
    })
    const ctx = {
      get: (k) => k === 'attachments'
        ? {
          imageLimits: { maxImageBytes: 5 * 1024 * 1024, maxImagePixels: 40_000_000 },
          saveImage: async (o) => ({ attachmentId: 'probe-fromzoom', mediaType: o.mediaType, bytes: o.data.length }),
        }
        : k === 'llm'
          ? { resolveModelInfo: async () => ({ inputModalities: ['image', 'text'] }) }
          : null,
    }
    const exec = { agent: { options: { provider: 'probe', model: 'probe-vision' } } }
    const cfg = {
      ttlMs: 60000, maxElements: 120, nativeImage: 'auto', deliveryMode: 'background',
      cursorMotion: 'off', supersession: 'note', verifyAfterAction: 'off', verboseReceipts: true,
    }
    const z = await screenZoom(ctx, {
      pid: w.pid, window_id: w.window_id,
      x1: Math.max(0, cx - halfW), y1: Math.max(0, cy - halfH),
      x2: Math.min(Number(b.width || 900), cx + halfW), y2: Math.min(Number(b.height || 600), cy + halfH),
    }, cfg, exec)
    if (!z.ok || z.fromZoom !== true) throw new Error(`screen_zoom failed: ${z.result}`)
    const imgW = Number(z.image?.width)
    const imgH = Number(z.image?.height)
    if (!imgW || !imgH) throw new Error(`zoom image dimensions missing: ${JSON.stringify(z.image)}`)
    const c = await click({ x: Math.round(imgW / 2), y: Math.round(imgH / 2), from_zoom: true }, cfg)
    if (!c.ok) throw new Error(`from_zoom click failed: ${c.result}`)
    const deadline = Date.now() + 5000
    while (Date.now() < deadline && !existsSync(MARKER)) await sleep(200)
    const marker = existsSync(MARKER) ? readFileSync(MARKER, 'utf8').trim() : ''
    if (marker !== 'clicked') throw new Error('marker not written: from_zoom click did not hit the button')
    console.log(JSON.stringify({
      ok: true,
      window: { pid: w.pid, window_id: w.window_id, bounds: b },
      buttonLocal: { x: cx, y: cy },
      zoom: { crop: z.crop, image: { width: imgW, height: imgH }, coordinateSpace: z.coordinateSpace },
      click: c.result,
      marker,
    }, null, 2))
  } finally {
    if (w) await closeProbe(w)
    try { child.kill() } catch {}
    try { rmSync(PS1, { force: true }) } catch {}
    clearSnapshot()
  }
}

main().catch((err) => {
  console.error(`❌ from_zoom probe failed: ${err.message}`)
  process.exit(1)
})
