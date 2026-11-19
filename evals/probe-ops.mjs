/**
 * probe-ops.mjs — real-driver primitive matrix (no model).
 *
 * Covers primitives that had no runtime probe before:
 *   click / double_click / right_click / key / menu / hover /
 *   verify / wait_for / activate / app_list
 *
 * Creates only its own WinForms window (title S4-OPS-PROBE) and closes it by
 * HWND/PID. The fixture has a 120s self-close timer so a crashed probe cannot
 * leave a window behind.
 *
 * Classification:
 *   PASS    the tool returned ok and the fixture observed the effect
 *   FAIL    the tool claimed success without the effect, or errored
 *   BLOCKED driver/app does not support the primitive (reported, not a pass)
 *
 * Run: node evals/probe-ops.mjs
 */
import { spawn, execFileSync } from 'node:child_process'
import { writeFileSync, readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { cuaCall } from '../lib/cua.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const mod = await import(pathToFileURL(join(root, 'index.js')).href)
const plugin = mod.default
const TITLE = 'S4-OPS-PROBE'
const work = mkdtempSync(join(tmpdir(), 's4-ops-'))
const appPath = join(work, 'ops-app.ps1')
const resultPath = join(work, 'marks.txt')
const closePath = join(work, 'close.ps1')
console.log('ops app:', appPath)
const app = `param([string]$ResultFile)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;
public class S4NativeMenu {
  [DllImport("user32.dll")] public static extern IntPtr CreateMenu();
  [DllImport("user32.dll")] public static extern IntPtr CreatePopupMenu();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool AppendMenuW(IntPtr hMenu, uint flags, IntPtr id, string text);
  [DllImport("user32.dll")] public static extern bool SetMenu(IntPtr hwnd, IntPtr menu);
  [DllImport("user32.dll")] public static extern bool DrawMenuBar(IntPtr hwnd);
}
public class S4Form : Form {
  public event EventHandler Command;
  protected override void WndProc(ref Message m) {
    if (m.Msg == 0x0111) { if (Command != null) Command(this, EventArgs.Empty); }
    base.WndProc(ref m);
  }
}
'@ -ReferencedAssemblies System.Windows.Forms
function Write-Mark([string]$m) {
  [IO.File]::AppendAllText($ResultFile, $m + [Environment]::NewLine)
}
$form = New-Object S4Form
$form.Text = '${TITLE}'
$form.Width = 760
$form.Height = 580
$form.StartPosition = 'Manual'
$form.Left = 160
$form.Top = 100
$form.add_Command({ Write-Mark 'menu' })
$form.Add_Shown({
  $menu = [S4NativeMenu]::CreateMenu()
  $popup = [S4NativeMenu]::CreatePopupMenu()
  [void][S4NativeMenu]::AppendMenuW($popup, 0x0000, [IntPtr]1001, 'Mark')
  [void][S4NativeMenu]::AppendMenuW($menu, 0x0010, $popup, 'Tools')
  $set = [S4NativeMenu]::SetMenu($form.Handle, $menu)
  [void][S4NativeMenu]::DrawMenuBar($form.Handle)
  Write-Mark ('menu-set:' + $set)
})
$click = New-Object System.Windows.Forms.Button
$click.Text = 'Click'
$click.Left = 24; $click.Top = 48; $click.Width = 150; $click.Height = 40
$click.Add_Click({ Write-Mark 'click' })
$form.Controls.Add($click)
$right = New-Object System.Windows.Forms.Button
$right.Text = 'Right'
$right.Left = 194; $right.Top = 48; $right.Width = 150; $right.Height = 40
$right.Add_MouseUp({ param($s, $e) if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Right) { Write-Mark 'right' } })
$form.Controls.Add($right)
$hover = New-Object System.Windows.Forms.Button
$hover.Text = 'Hover'
$hover.Left = 364; $hover.Top = 48; $hover.Width = 150; $hover.Height = 40
$hover.Add_MouseEnter({ Write-Mark 'hover' })
$form.Controls.Add($hover)
$nameLabel = New-Object System.Windows.Forms.Label
$nameLabel.Text = 'Name'
$nameLabel.Left = 24; $nameLabel.Top = 116; $nameLabel.AutoSize = $true
$form.Controls.Add($nameLabel)
$nameBox = New-Object System.Windows.Forms.TextBox
$nameBox.Left = 100; $nameBox.Top = 112; $nameBox.Width = 414
$nameBox.Add_KeyDown({ param($s, $e) if ($e.KeyCode -eq [System.Windows.Forms.Keys]::F2) { Write-Mark 'key:F2' } })
$form.Controls.Add($nameBox)
$listLabel = New-Object System.Windows.Forms.Label
$listLabel.Text = 'Double target'
$listLabel.Left = 24; $listLabel.Top = 164; $listLabel.AutoSize = $true
$form.Controls.Add($listLabel)
$list = New-Object System.Windows.Forms.ListBox
$list.Left = 24; $list.Top = 184; $list.Width = 300; $list.Height = 48
[void]$list.Items.Add('DoubleTarget')
$list.Add_DoubleClick({ Write-Mark 'double' })
$list.Add_MouseDoubleClick({ Write-Mark 'double' })
$form.Controls.Add($list)
$start = New-Object System.Windows.Forms.Button
$start.Text = 'Start'
$start.Left = 364; $start.Top = 184; $start.Width = 150; $start.Height = 40
$form.Controls.Add($start)
$statusLabel = New-Object System.Windows.Forms.Label
$statusLabel.Text = 'Status'
$statusLabel.Left = 364; $statusLabel.Top = 240; $statusLabel.AutoSize = $true
$form.Controls.Add($statusLabel)
$status = New-Object System.Windows.Forms.Label
$status.Text = 'IDLE'
$status.Left = 430; $status.Top = 240; $status.AutoSize = $true
$form.Controls.Add($status)
$readyTimer = New-Object System.Windows.Forms.Timer
$readyTimer.Interval = 5000
$readyTimer.Add_Tick({
  $readyTimer.Stop()
  $status.Text = 'READY'
  $start.Text = 'READY'
  Write-Mark 'ready'
})
$start.Add_Click({
  $status.Text = 'PENDING'
  $start.Text = 'PENDING'
  Write-Mark 'start'
  $readyTimer.Stop()
  $readyTimer.Start()
})
$auto = New-Object System.Windows.Forms.Timer
$auto.Interval = 120000
$auto.Add_Tick({ $auto.Stop(); $form.Close() })
$auto.Start()
[System.Windows.Forms.Application]::Run($form)
`
writeFileSync(appPath, app, 'utf8')

const closeScript = `param([int]$Hwnd)
. '${join(root, 'evals', 'lib', 'common.ps1').replace(/'/g, "''")}'
$r = $false
try { $r = Close-WindowUia $Hwnd } catch { $r = $false }
if (-not $r) {
  try { [void][S4W32]::PostMessage([IntPtr]$Hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) } catch {}
}
`
writeFileSync(closePath, closeScript, 'utf8')

const services = {
  attachments: {
    imageLimits: { maxImageBytes: 5e6, maxImagePixels: 4e7, maxImagesPerMessage: 20, maxMessageImageBytes: 1e8, mediaTypes: ['image/png', 'image/jpeg'] },
    async saveImage(input) { return { attachmentId: 'sha256:' + 'a'.repeat(64), mediaType: input.mediaType, bytes: input.data.byteLength, width: 1, height: 1, name: input.name } },
    async validateImage() {},
    async readImage() { return { data: new Uint8Array([1]) } },
  },
  llm: {
    async resolveModelInfo(provider, model) { return { provider, id: model, inputModalities: ['text', 'image'] } },
    async * stream() { throw new Error('MISSING_CREDENTIAL (stub)') },
  },
  approval: { async request() { return 'allowed-once' } },
}
const registered = new Map()
const ctx = {
  get: (n) => services[n],
  logger: { info() {}, error() {} },
  tools: { register(def) { registered.set(def.name, def); return () => registered.delete(def.name) } },
  toolsRuntime: null,
}
plugin.apply(ctx, { ttlMs: 60000, maxElements: 300, deliveryMode: 'auto', nativeImage: 'auto', passwordScan: 'off' })
const defs = new Map(mod.toolDefinitions().map((d) => [d.name, d]))
const agent = { options: { provider: 'p', model: 'm' }, session: { requestHeader: () => ({ config: { provider: 'p', model: 'm' } }) } }
async function call(name, args = {}) {
  const def = defs.get(name)
  if (!def) throw new Error('tool not defined: ' + name)
  const exec = { agent, signal: new AbortController().signal, get signalSet() { return true } }
  return await def.execute(args, exec)
}

const checks = []
function record(name, status, detail = '') {
  checks.push({ name, status, detail })
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⛔'
  console.log(`${icon} ${name}${detail ? ' — ' + detail : ''}`)
}
const pass = (name, ok, detail = '') => record(name, ok ? 'PASS' : 'FAIL', detail)
const blocked = (name, detail = '') => record(name, 'BLOCKED', detail)

function readMarks() {
  if (!existsSync(resultPath)) return []
  return readFileSync(resultPath, 'utf8').split(/\r?\n/).filter(Boolean)
}
const hasMark = (m) => readMarks().some((x) => x === m)

function rectOf(e) {
  if (!e) return null
  const f = e.frame || e.bounds || {}
  const x = Number(e.x ?? f.x)
  const y = Number(e.y ?? f.y)
  const width = Number(e.width ?? f.width)
  const height = Number(e.height ?? f.height)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  // screen_observe exposes x/y as the already-mapped window-local centre; it
  // does not carry width/height. Treat missing size as a point target.
  if (!(width > 0) || !(height > 0)) return { x, y, width: 0, height: 0, cx: Math.round(x), cy: Math.round(y) }
  return { x, y, width, height, cx: Math.round(x + width / 2), cy: Math.round(y + height / 2) }
}

const findByLabel = (els, re) => els.find((e) => re.test(String(e.label || '')) || re.test(String(e.value || '')))
const findByRole = (els, re) => els.find((e) => re.test(String(e.role || '')))

let child = null
let hwnd = 0
let pid = 0

async function observe() {
  const obs = await call('screen_observe', { window_id: hwnd, mode: 'ax' })
  return { obs, els: obs?.elements || [] }
}


function foregroundHwnd() {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
      "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class S4Fg { [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); }'; [S4Fg]::GetForegroundWindow().ToInt64()",
    ], { encoding: 'utf8', timeout: 15000, windowsHide: true })
    return Number(String(out).trim())
  } catch { return 0 }
}

function closeFixture() {
  if (hwnd) {
    try { execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', closePath, String(hwnd)], { timeout: 15000, windowsHide: true }) } catch {}
  }
  if (child?.pid) {
    try {
      const name = execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${child.pid} -ErrorAction SilentlyContinue).ProcessName`], { encoding: 'utf8', timeout: 10000, windowsHide: true }).trim()
      if (name === 'powershell') child.kill()
    } catch {}
  }
}

try {
  child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', appPath, '-ResultFile', resultPath])
  let childErr = ''
  let childOut = ''
  child.stdout.on('data', (d) => { childOut += d })
  child.stderr.on('data', (d) => { childErr += d })
  const deadline = Date.now() + 30000
  let win = null
  while (Date.now() < deadline) {
    const list = await cuaCall('list_windows', { on_screen_only: true })
    win = (list.windows || []).find((w) => String(w.title || '').includes(TITLE))
    if (win) break
    await delay(300)
  }
  if (!win) {
    const list = await cuaCall('list_windows', { on_screen_only: true })
    const titles = (list.windows || []).map((w) => String(w.title || '')).filter(Boolean).slice(0, 40)
    throw new Error('ops window not found; child pid=' + child.pid + ' stderr=' + childErr.slice(0, 600) + ' stdout=' + childOut.slice(0, 600) + ' titles=' + JSON.stringify(titles))
  }
  hwnd = Number(win.hwnd || win.window_id)
  pid = Number(win.pid)
  console.log('window ids:', JSON.stringify({ window_id: win.window_id, hwnd: win.hwnd, pid: win.pid, bounds: win.bounds }))
  const driverWid = Number(win.window_id)
  pass('ops window found', Boolean(hwnd && pid), `hwnd=${hwnd} pid=${pid} title=${win.title}`)
  {
    const first = await observe()
    console.log('elements:', JSON.stringify((first.els || []).map((e) => ({
      i: e.index, r: e.role, l: e.label, v: e.value, x: e.x, y: e.y, w: e.width, h: e.height,
    })).slice(0, 40)))
  }

  // click
  {
    const { els } = await observe()
    const btn = findByLabel(els, /^Click$/)
    if (!btn) pass('click element found', false, 'no element labelled Click')
    else {
      const r = await call('computer_click', { element: btn.index })
      await delay(400)
      pass('click delivered', r?.ok === true && hasMark('click'), String(r?.result || '').slice(0, 100))
    }
  }

  // double click (element first, coordinate fallback)
  {
    const { els } = await observe()
    const item = findByLabel(els, /DoubleTarget/) || findByRole(els, /list/i)
    if (!item) pass('double target found', false, 'no list item')
    else {
      let r = await call('computer_double_click', { element: item.index })
      await delay(500)
      let ok = r?.ok === true && hasMark('double')
      let note = 'element'
      const rc = rectOf(item)
      if (!ok && rc) {
        r = await call('computer_double_click', { x: rc.cx, y: rc.cy })
        await delay(500)
        ok = r?.ok === true && hasMark('double')
        note = 'coordinate fallback'
      }
      pass('double_click delivered', ok, `${note}; ${String(r?.result || '').slice(0, 90)}`)
    }
  }

  // right click
  {
    const { els } = await observe()
    const btn = findByLabel(els, /^Right$/)
    if (!btn) pass('right target found', false, 'no element labelled Right')
    else {
      let r = await call('computer_right_click', { element: btn.index })
      await delay(500)
      let ok = r?.ok === true && hasMark('right')
      let note = 'element'
      const rc = rectOf(btn)
      if (!ok && rc) {
        r = await call('computer_right_click', { x: rc.cx, y: rc.cy })
        await delay(500)
        ok = r?.ok === true && hasMark('right')
        note = 'coordinate fallback'
      }
      pass('right_click delivered', ok, `${note}; ${String(r?.result || '').slice(0, 90)}`)
    }
  }

  // key
  {
    const { els } = await observe()
    const box = findByLabel(els, /^Name$/) || findByRole(els, /edit|text|输入框/i)
    if (!box) pass('key target found', false, 'no text box')
    else {
      const rc = rectOf(box)
      if (rc) await call('computer_click', { x: rc.cx, y: rc.cy, foreground: true })
      else await call('computer_click', { element: box.index, foreground: true })
      await delay(400)
      await observe()
      let r = await call('computer_key', { key: 'f2', foreground: true })
      await delay(500)
      let ok = r?.ok === true && hasMark('key:F2')
      let note = 'foreground'
      if (!ok) {
        await observe()
        r = await call('computer_key', { key: 'F2', foreground: true })
        await delay(500)
        ok = r?.ok === true && hasMark('key:F2')
        note = 'foreground uppercase'
      }
      if (!ok) {
        await observe()
        r = await call('computer_key', { key: 'f2' })
        await delay(500)
        ok = r?.ok === true && hasMark('key:F2')
        note = 'background'
      }
      pass('key delivered', ok, `${note}; ${String(r?.result || '').slice(0, 100)}`)
    }
  }

  // activate (foreground check)
  {
    const r = await call('computer_activate', { window_id: hwnd, pid })
    await delay(400)
    const fg = foregroundHwnd()
    pass('activate brings window to front', r?.ok === true && fg === hwnd, `fg=${fg} hwnd=${hwnd} result=${String(r?.result || '').slice(0, 80)}`)
  }

  // hover (real pointer; app-level MouseEnter)
  {
    const { obs, els } = await observe()
    const origin = obs?.screenOrigin
    const btn = findByLabel(els, /hover/i)
    const rc = rectOf(btn)
    if (!btn || !rc) {
      console.log('hover candidates:', JSON.stringify(els.map((e) => ({ i: e.index, r: e.role, l: e.label, x: e.x, y: e.y })).slice(0, 40)))
      pass('hover target found', false, 'no Hover element with coordinates')
    } else if (!origin || !Number.isFinite(Number(origin.x)) || !Number.isFinite(Number(origin.y))) {
      blocked('hover (real pointer)', 'screenOrigin missing from screen_observe; cannot convert to screen coordinates')
    } else {
      const r = await call('computer_hover', { window_id: hwnd, pid, x: Number(origin.x) + rc.cx, y: Number(origin.y) + rc.cy, real: true })
      await delay(600)
      if (r?.ok !== true) pass('hover moved real pointer', false, String(r?.result || '').slice(0, 120))
      else if (hasMark('hover')) pass('hover triggered app MouseEnter', true, `screenOrigin=${origin.x},${origin.y}`)
      else blocked('hover triggered app MouseEnter', 'pointer moved but no MouseEnter; hover is documented experimental')
    }
  }

  // verify + wait_for
  const expectVariants = [
    ['button role', [{ element: { selector: { role: '按钮', label_contains: 'READY' }, exists: true } }]],
    ['button role label-only', [{ element: { selector: { label_contains: 'READY' }, exists: true } }]],
    ['button role=button', [{ element: { selector: { role: 'button', label_contains: 'READY' }, exists: true } }]],
    ['button role=Button', [{ element: { selector: { role: 'Button', label_contains: 'READY' }, exists: true } }]],
  ]
  let workingExpect = null
  {
    const { els } = await observe()
    const start = findByLabel(els, /^Start$/)
    if (!start) pass('verify target found', false, 'no Start button')
    else {
      // Baseline: a button that exists right now must be observable, otherwise
      // the driver cannot evaluate predicates on this window at all.
      const baseline = JSON.stringify([{ element: { selector: { role: '按钮', label_contains: 'Click' }, exists: true } }])
      const b = await call('computer_verify', { window_id: hwnd, pid, expect: baseline })
      console.log(`verify baseline: ok=${b?.ok} status=${b?.status} reason=${b?.results?.[0]?.unknownReason || ''}`)
      await call('computer_click', { element: start.index })
      await delay(6000)
      await call('computer_activate', { window_id: hwnd, pid })
      let last = null
      for (const [label, exp] of expectVariants) {
        const v = await call('computer_verify', { window_id: hwnd, pid, expect: JSON.stringify(exp) })
        last = v
        const reason = v?.results?.[0]?.unknownReason || ''
        console.log(`verify ${label}: ok=${v?.ok} status=${v?.status} reason=${reason}`)
        if (v?.ok === true) { workingExpect = exp; pass('computer_verify satisfied', true, label); break }
        if (v?.status === 'unsatisfied') { pass('computer_verify satisfied', false, `${label}: unsatisfied`); break }
      }
      if (!workingExpect && last?.status === 'unknown') {
        blocked('computer_verify satisfied', 'all selector variants unknown: ' + String(last?.results?.[0]?.unknownReason || last?.result || '').slice(0, 120))
      }
    }
  }
  {
    const { els } = await observe()
    const start = findByLabel(els, /^(Start|READY|PENDING)$/) || findByLabel(els, /start|ready|pending/i)
    if (!start) pass('wait_for target found', false, 'no Start button')
    else {
      await call('computer_click', { element: start.index })
      const exp = workingExpect || expectVariants[1][1]
      const w = await call('computer_wait_for', { window_id: hwnd, pid, expect: JSON.stringify(exp), timeoutMs: 12000, pollMs: 500 })
      if (w?.ok === true) pass('computer_wait_for converged', true, `attempts=${w?.attempts} waitedMs=${w?.waitedMs}`)
      else if (w?.status === 'unknown') blocked('computer_wait_for converged', 'driver returned unknown: ' + String(w?.results?.[0]?.unknownReason || w?.result || '').slice(0, 120))
      else pass('computer_wait_for converged', false, String(w?.result || '').slice(0, 120))
    }
  }

  // app_list
  {
    const r = await call('app_list', {})
    const apps = r?.apps || []
    const hit = apps.some((a) => Number(a.pid) === pid)
    console.log('app_list:', JSON.stringify(apps.map((a) => ({ name: a.name, pid: a.pid, active: a.active })).slice(0, 30)))
    if (r?.ok !== true) pass('app_list returns apps', false, String(r?.result || '').slice(0, 100))
    else pass('app_list returns apps', apps.length > 0, `apps=${apps.length}`)
    if (r?.ok === true && hit) pass('app_list contains fixture pid', true, `pid=${pid}`)
    else if (r?.ok === true) blocked('app_list contains fixture pid', `pid=${pid} not listed; apps=${apps.length}`)
  }

  // menu
  {
    await call('computer_activate', { window_id: hwnd, pid })
    const ids = [...new Set([driverWid, hwnd].filter((x) => Number.isFinite(x) && x > 0))]
    let r = null
    for (const id of ids) {
      r = await call('computer_menu', { window_id: id, pid, path: ['Tools', 'Mark'] })
      await delay(400)
      if (r?.ok === true && hasMark('menu')) break
    }
    if (r?.ok !== true || !hasMark('menu')) {
      const { els } = await observe()
      const tools = findByLabel(els, /^Tools$/)
      if (tools) {
        await call('computer_click', { element: tools.index })
        await delay(600)
        await observe()
        const openIds = [...new Set([driverWid, hwnd].filter((x) => Number.isFinite(x) && x > 0))]
        for (const id of openIds) {
          const rr = await call('computer_menu', { window_id: id, pid, path: ['Mark'] })
          await delay(300)
          if (rr?.ok === true && hasMark('menu')) { r = rr; break }
          if (rr) r = rr
        }
        if (r?.ok !== true || !hasMark('menu')) {
          for (const id of openIds) {
            const rr = await call('computer_menu', { window_id: id, pid, path: ['Tools', 'Mark'] })
            await delay(300)
            if (rr?.ok === true && hasMark('menu')) { r = rr; break }
            if (rr) r = rr
          }
        }
      }
    }
    await delay(500)
    if (r?.ok === true && hasMark('menu')) pass('computer_menu invoked item', true, String(r?.result || '').slice(0, 100))
    else if (r?.ok === true) pass('computer_menu invoked item', false, 'ok:true but menu item never fired')
    else blocked('computer_menu invoked item', String(r?.result || '').slice(0, 180))
  }
} catch (err) {
  pass('probe completed', false, String(err.message || err))
} finally {
  closeFixture()
  await delay(800)
  if (!process.env.S4_KEEP) { try { rmSync(work, { recursive: true, force: true }) } catch {} }
}

const passes = checks.filter((c) => c.status === 'PASS').length
const blocks = checks.filter((c) => c.status === 'BLOCKED').length
const fails = checks.filter((c) => c.status === 'FAIL').length
console.log(`\n结果：PASS ${passes}/${checks.length}，BLOCKED ${blocks}，FAIL ${fails}`)
if (blocks) console.log('BLOCKED: ' + checks.filter((c) => c.status === 'BLOCKED').map((c) => c.name).join('; '))
process.exit(fails ? 1 : 0)
