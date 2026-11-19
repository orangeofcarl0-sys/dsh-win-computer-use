/**
 * probe-scroll.mjs — real-driver scroll probe (no model).
 * Creates a self-owned WinForms AutoScroll panel, scrolls by element, and reads
 * the panel's VerticalScroll.Value from a result file. Closes only its own PID.
 */
import { spawn } from 'node:child_process'
import { writeFileSync, readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { cuaCall } from '../lib/cua.js'

const root = 'F:/Codex_Work_Space/DSH plugin/dsh-computer-use'
const mod = await import(pathToFileURL(join(root, 'index.js')).href)
const plugin = mod.default
const TITLE = 'S4-SCROLL-PROBE'
const work = mkdtempSync(join(tmpdir(), 's4-scroll-'))
const appPath = join(work, 'scroll-app.ps1')
const resultPath = join(work, 'scroll.txt')
const app = `param([string]$ResultFile)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$form = New-Object System.Windows.Forms.Form
$form.Text = '${TITLE}'
$form.Width = 520
$form.Height = 360
$form.StartPosition = 'Manual'
$form.Left = 260
$form.Top = 180
$panel = New-Object System.Windows.Forms.Panel
$panel.Dock = 'Fill'
$panel.AutoScroll = $true
$label = New-Object System.Windows.Forms.Label
$label.Text = ('line ' + (1..120 -join [Environment]::NewLine + 'line '))
$label.AutoSize = $true
$label.Left = 20
$label.Top = 20
$panel.Controls.Add($label)
$panel.Add_Scroll({ [IO.File]::WriteAllText($ResultFile, [string]$panel.VerticalScroll.Value) })
$form.Controls.Add($panel)
[System.Windows.Forms.Application]::Run($form)
`
writeFileSync(appPath, app, 'utf8')

const services = {
  attachments: { imageLimits: { maxImageBytes: 5e6, maxImagePixels: 4e7, maxImagesPerMessage: 20, maxMessageImageBytes: 1e8, mediaTypes: ['image/png'] }, async saveImage(i) { return { attachmentId: 'x', mediaType: i.mediaType, bytes: i.data.byteLength, width: 1, height: 1, name: i.name } }, async validateImage() {}, async readImage() { return { data: new Uint8Array([1]) } } },
  llm: { async resolveModelInfo(p, m) { return { provider: p, id: m, inputModalities: ['text', 'image'] } }, async * stream() { throw new Error('stub') } },
  approval: { async request() { return 'allowed-once' } },
}
const registered = new Map()
const ctx = { get: (n) => services[n], logger: { info() {}, error() {} }, tools: { register(d) { registered.set(d.name, d); return () => registered.delete(d.name) } }, toolsRuntime: null }
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
const check = (name, ok, detail = '') => { checks.push({ name, ok, detail }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`) }

let pid = 0
try {
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', appPath, '-ResultFile', resultPath])
  const deadline = Date.now() + 30000
  let win = null
  while (Date.now() < deadline) {
    const list = await cuaCall('list_windows', { on_screen_only: true })
    win = (list.windows || []).find((w) => String(w.title || '').includes(TITLE))
    if (win) break
    await delay(300)
  }
  if (!win) throw new Error('scroll window not found')
  pid = win.pid
  const wid = win.window_id
  const obs = await call('screen_observe', { window_id: wid, mode: 'ax' })
  const elements = obs?.elements || []
  console.log('elements:', JSON.stringify(elements.map((e) => ({ index: e.index, role: e.role, label: e.label })).slice(0, 20)))
  const panel = elements.find((e) => /pane|panel|窗格|scroll/i.test(String(e.role || ''))) || elements[0]
  check('scrollable element found', Boolean(panel), panel ? `index=${panel.index}` : 'none')
  if (!panel) throw new Error('no scrollable element')
  const down = await call('computer_scroll', { element: panel.index, direction: 'down', amount: 5 })
  await delay(500)
  const v1 = existsSync(resultPath) ? Number(readFileSync(resultPath, 'utf8')) : -1
  check('scroll down delivered', down?.ok === true && v1 > 0, `value=${v1} result=${String(down?.result || '').slice(0, 80)}`)
  const up = await call('computer_scroll', { element: panel.index, direction: 'up', amount: 5 })
  await delay(500)
  const v2 = existsSync(resultPath) ? Number(readFileSync(resultPath, 'utf8')) : -1
  check('scroll up delivered', up?.ok === true && v2 < v1, `value=${v2}`)
} catch (err) {
  check('probe completed', false, String(err.message || err))
} finally {
  if (pid) {
    try { spawn('powershell.exe', ['-NoProfile', '-Command', `$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if($p -and $p.ProcessName -eq 'powershell'){Stop-Process -Id ${pid} -Force}`], { windowsHide: true }) } catch {}
  }
  await delay(800)
  try { rmSync(work, { recursive: true, force: true }) } catch {}
}
const failed = checks.filter((c) => !c.ok)
console.log(`\n结果：${checks.length - failed.length}/${checks.length} 通过`)
process.exit(failed.length ? 1 : 0)
