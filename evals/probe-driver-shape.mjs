/**
 * evals/probe-driver-shape.mjs — cua-driver 响应形态真机探针（不加入 npm test）。
 *
 * 目的：在写兼容层之前，用 raw transport（不经过任何归一化）确认真实驱动的
 * 字段空间，尤其是升级前后的三处关键差异：
 *   1. get_window_state 是否默认带 elements（0.53 默认 markdown）；
 *   2. window 是嵌套对象还是顶层 window_bounds/window_title；
 *   3. 元素是 frame 还是 screenshot_frame，frame 属于屏幕坐标还是截图坐标。
 * 同时记录 zoom 的 mime/format、click 回执的 effect/delivery/verified。
 *
 * 清理：只关标题为 S4 Driver Shape Probe 的窗口；child 是本探针自己 spawn 的
 * PowerShell，可以 kill；不按进程名杀，不碰用户窗口。
 *
 * 运行：node evals/probe-driver-shape.mjs
 */
import { spawn } from 'node:child_process'
import { writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { defaultTransport, resolveBin } from '../lib/driver/transport.js'

const TEMP = process.env.S4_TEMP
  || (process.platform === 'win32' ? join(homedir(), 'AppData', 'Local', 'Temp') : tmpdir())
const PS1 = join(TEMP, 's4-driver-shape.ps1')
const MARK = join(TEMP, 's4-driver-shape-click.txt')
const REPORT = join(TEMP, `s4-driver-shape-${Date.now()}.json`)
const TITLE = 'S4 Driver Shape Probe'
const SESSION = process.env.CUA_SESSION || 'dsh-win-computer-use'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function writeProbeScript() {
  // ASCII only: PowerShell 5.1 对无 BOM 的 UTF-8 中文会乱码。
  // marker 写绝对路径：Node spawn 的 PowerShell 的 $env:TEMP 可能是 C:\Windows\TEMP。
  const mark = MARK.replace(/'/g, "''")
  writeFileSync(PS1, `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$form = New-Object System.Windows.Forms.Form
$form.Text = '${TITLE}'
$form.Width = 720
$form.Height = 540
$form.StartPosition = 'Manual'
$form.Left = 300
$form.Top = 240
$btn = New-Object System.Windows.Forms.Button
$btn.Text = 'SHAPE-BTN'
$btn.Width = 240
$btn.Height = 90
$btn.Left = 80
$btn.Top = 80
$btn.Add_Click({
  $m = [System.Windows.Forms.Control]::ModifierKeys
  $p = [System.Windows.Forms.Cursor]::Position
  [IO.File]::WriteAllText('${mark}', ([string]$m + '|' + $p.ToString()))
})
$form.Controls.Add($btn)
$edit = New-Object System.Windows.Forms.TextBox
$edit.Left = 80
$edit.Top = 220
$edit.Width = 400
$edit.Text = 'shape-probe-text'
$form.Controls.Add($edit)
$label = New-Object System.Windows.Forms.Label
$label.Left = 80
$label.Top = 290
$label.Width = 400
$label.Text = 'S4-SHAPE-LABEL'
$form.Controls.Add($label)
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 120000
$timer.Add_Tick({ $form.Close() })
$timer.Start()
[System.Windows.Forms.Application]::Run($form)
`, 'utf8')
}

function scrub(value, depth = 0) {
  if (depth > 6 || value === null || value === undefined) return value
  if (Array.isArray(value)) return value.slice(0, 3).map((v) => scrub(v, depth + 1))
  if (typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      if (/b64|base64|png|jpeg|data/i.test(k) && typeof v === 'string') {
        out[k] = `<string len=${v.length}>`
      } else {
        out[k] = scrub(v, depth + 1)
      }
    }
    return out
  }
  return value
}

function keysOf(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : []
}

async function raw(tool, args) {
  return defaultTransport.rawCall(tool, args)
}

async function findProbeWindow(deadlineMs = 30000) {
  const deadline = Date.now() + deadlineMs
  let lastError = ''
  while (Date.now() < deadline) {
    try {
      const v = await raw('list_windows', { on_screen_only: true })
      const w = (v.windows || []).find((x) => String(x.title || '').includes(TITLE))
      if (w) return w
    } catch (err) {
      lastError = String(err?.message || err)
    }
    await sleep(300)
  }
  if (lastError) console.log(`window poll last error: ${lastError.slice(0, 200)}`)
  return null
}

function describeElement(el) {
  return {
    element_index: el.element_index,
    element_token: el.element_token ? `<token len=${String(el.element_token).length}>` : el.element_token,
    role: el.role,
    label: el.label,
    name: el.name,
    value: el.value,
    frame: el.frame,
    screenshot_frame: el.screenshot_frame,
    has_frame: Boolean(el.frame),
    has_screenshot_frame: Boolean(el.screenshot_frame),
  }
}

async function closeProbe(w) {
  try {
    const st = await raw('get_window_state', {
      pid: w.pid, window_id: w.window_id, include_screenshot: false, max_elements: 200,
    })
    const close = (st.elements || []).find((e) => /close|关闭/i.test(String(e.label || e.name || '')) && e.element_token)
    if (close) {
      await raw('click', {
        pid: w.pid, window_id: w.window_id, element_token: close.element_token,
        count: 1, button: 'left', delivery_mode: 'background',
      })
    }
  } catch { /* fall through */ }
  await sleep(600)
  try {
    const list = await raw('list_windows', { on_screen_only: true })
    if ((list.windows || []).some((x) => Number(x.window_id) === Number(w.window_id))) {
      await raw('hotkey', {
        session: SESSION,
        keys: ['alt', 'f4'], pid: w.pid, window_id: w.window_id, delivery_mode: 'foreground',
      })
    }
  } catch { /* timer will close it */ }
}

async function main() {
  if (process.platform !== 'win32') {
    console.log('SKIP: Windows only')
    return 0
  }
  rmSync(MARK, { force: true })
  rmSync('C:\\Windows\\TEMP\\s4-driver-shape-click.txt', { force: true })
  writeProbeScript()
  let childError = ''
  let childOut = ''
  let childExit = null
  const child = spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS1,
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', (d) => { childOut += d })
  child.stderr.on('data', (d) => { childError += d })
  child.on('error', (e) => { childError += String(e?.message || e) })
  child.on('exit', (code) => { childExit = code })
  let failures = 0
  const report = { bin: resolveBin(), title: TITLE, at: new Date().toISOString() }
  let win = null
  try {
    win = await findProbeWindow()
    if (!win) {
      const diag = [
        childError ? `stderr: ${childError.slice(0, 400)}` : '',
        childOut ? `stdout: ${childOut.slice(0, 400)}` : '',
        childExit !== null ? `exit: ${childExit}` : '',
      ].filter(Boolean).join(' | ')
      console.log(`FAIL: probe window not found${diag ? ` (${diag})` : ''}`)
      return 1
    }
    report.window = scrub(win)

    const session = SESSION
    await raw('start_session', { session })

    const plain = await raw('get_window_state', {
      session: SESSION,
      pid: win.pid, window_id: win.window_id, include_screenshot: true, max_elements: 80,
    })
    report.plain = {
      keys: keysOf(plain),
      window: scrub(plain.window),
      window_bounds: plain.window_bounds,
      window_title: plain.window_title,
      app_name: plain.app_name,
      screenshot_width: plain.screenshot_width,
      screenshot_height: plain.screenshot_height,
      screenshot_mime_type: plain.screenshot_mime_type,
      element_count: plain.element_count,
      returned_element_count: plain.returned_element_count,
      total_element_count: plain.total_element_count,
      snapshot_id: plain.snapshot_id,
      degraded: plain.degraded,
      degraded_reason: plain.degraded_reason,
      elements_complete: plain.elements_complete,
      tree_markdown_len: typeof plain.tree_markdown === 'string' ? plain.tree_markdown.length : null,
      elements: (plain.elements || []).slice(0, 6).map(describeElement),
    }

    let treeFormatAccepted = null
    let treeFormatError = ''
    let clickElements = plain.elements || []
    try {
      const t = await raw('get_window_state', {
        session: SESSION,
        pid: win.pid, window_id: win.window_id, include_screenshot: false,
        max_elements: 40, tree_format: 'elements',
      })
      treeFormatAccepted = Array.isArray(t.elements) && t.elements.length > 0
      clickElements = t.elements || clickElements
      report.tree_format = {
        accepted: true,
        elements: (t.elements || []).length,
        keys: keysOf(t),
        has_tree_markdown: typeof t.tree_markdown === 'string',
        sample: (t.elements || []).slice(0, 6).map(describeElement),
      }
    } catch (err) {
      treeFormatError = String(err?.message || err).slice(0, 300)
      report.tree_format = { accepted: false, error: treeFormatError }
    }

    // 先点（token 最新），再建立截图上下文并 zoom；0.52 的 zoom 需要同一窗口
    // 最近一次带截图的读取，否则 screenshot_context_missing。
    const elems = clickElements
    const btn = elems.find((e) => /SHAPE-BTN/i.test(String(e.label || e.name || e.value || '')))
      || elems.find((e) => e.element_token)
    if (btn) {
      try {
        // 0.52 的 foreground click 会校验目标 HWND 真的是前台；先精确前置。
        const prev = await raw('bring_to_front', {
          session: SESSION, pid: win.pid, window_id: win.window_id,
        })
        const c = await raw('click', {
          session: SESSION,
          pid: win.pid, window_id: win.window_id, element_token: btn.element_token,
          count: 1, button: 'left', delivery_mode: 'foreground',
        })
        report.click = { keys: keysOf(c), receipt: scrub(c) }
        if (prev?.previous_fg_hwnd) {
          const list = await raw('list_windows', {})
          const back = (list.windows || []).find((w) => Number(w.window_id) === Number(prev.previous_fg_hwnd))
          if (back) {
            await raw('bring_to_front', {
              session: SESSION, pid: back.pid, window_id: back.window_id,
            }).catch(() => undefined)
          }
        }
      } catch (err) {
        report.click = { error: String(err?.message || err).slice(0, 300) }
      }
    }
    await sleep(800)
    report.click_marker = existsSync(MARK) ? readFileSync(MARK, 'utf8').trim() : ''

    try {
      const combo = await raw('get_window_state', {
        session: SESSION,
        pid: win.pid, window_id: win.window_id, include_screenshot: true,
        max_elements: 1, tree_format: 'elements',
      })
      report.combined = {
        keys: keysOf(combo),
        elements: (combo.elements || []).length,
        screenshot_width: combo.screenshot_width,
        screenshot_height: combo.screenshot_height,
        b64_len: typeof combo.screenshot_png_b64 === 'string' ? combo.screenshot_png_b64.length : null,
        tree_format: combo.tree_format,
      }
    } catch (err) {
      report.combined = { error: String(err?.message || err).slice(0, 300) }
    }

    try {
      const z = await raw('zoom', {
        session: SESSION,
        pid: win.pid, window_id: win.window_id, x1: 0, y1: 0, x2: 300, y2: 220,
      })
      report.zoom = {
        keys: keysOf(z),
        width: z.width,
        height: z.height,
        format: z.format,
        mime_type: z.mime_type,
        mime: z.mime,
        b64_len: typeof z.screenshot_png_b64 === 'string' ? z.screenshot_png_b64.length : null,
        crop: z.crop,
        scale: z.scale,
        padding: z.padding,
      }
    } catch (err) {
      report.zoom = { error: String(err?.message || err).slice(0, 300) }
    }
    report.frame_space = {
      window_x: win.bounds?.x ?? win.x,
      window_y: win.bounds?.y ?? win.y,
      window_w: win.bounds?.width ?? win.width,
      window_h: win.bounds?.height ?? win.height,
      screenshot_width: plain.screenshot_width,
      screenshot_height: plain.screenshot_height,
      scale_x: plain.screenshot_width && (win.bounds?.width ?? win.width)
        ? Number((plain.screenshot_width / (win.bounds?.width ?? win.width)).toFixed(6)) : null,
      scale_y: plain.screenshot_height && (win.bounds?.height ?? win.height)
        ? Number((plain.screenshot_height / (win.bounds?.height ?? win.height)).toFixed(6)) : null,
      sample: (clickElements || []).slice(0, 3).map((e) => ({
        label: e.label || e.name,
        frame: e.frame || null,
        screenshot_frame: e.screenshot_frame || null,
      })),
    }

    writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8')

    const majorOk = plain.element_count > 0 || (plain.elements || []).length > 0
    if (!majorOk) {
      console.log('FAIL: get_window_state returned no elements on the WinForms probe window')
      failures++
    }
    if (treeFormatAccepted === false) {
      console.log(`WARN: tree_format not accepted by this driver: ${treeFormatError}`)
    }
    if (!report.click_marker) {
      console.log('WARN: click marker not written (element token click may not have hit SHAPE-BTN)')
    }
    console.log(`probe report: ${REPORT}`)
    console.log(JSON.stringify({
      keys: report.plain.keys,
      window: report.plain.window,
      window_bounds: report.plain.window_bounds,
      screenshot: `${report.plain.screenshot_width}x${report.plain.screenshot_height}`,
      elements: report.plain.element_count,
      tree_format: report.tree_format,
      zoom: report.zoom,
      click: report.click?.keys,
      click_marker: report.click_marker,
    }, null, 2))
    return failures ? 1 : 0
  } finally {
    if (win) await closeProbe(win)
    try { child.kill() } catch { /* 忽略 */ }
  }
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error('probe failed:', err)
  process.exit(1)
})
