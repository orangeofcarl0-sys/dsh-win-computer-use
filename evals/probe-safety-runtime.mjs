/**
 * probe-safety-runtime.mjs — real-driver safety probe (no model).
 *
 * Covers claims that offline stubs cannot prove:
 *   1. password fields refuse computer_type / computer_set_value
 *   2. expired snapshots refuse the action
 *   3. computer_stop latches all desktop tools; computer_resume restores them
 *   4. a structured driver error does not poison the next observe
 *
 * Creates only its own WinForms window and closes it by HWND/PID. No user
 * window is selected, moved, or closed.
 *
 * Run: node evals/probe-safety-runtime.mjs
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
const TITLE = 'S4-SAFETY-PROBE'
const work = mkdtempSync(join(tmpdir(), 's4-safety-'))
const appPath = join(work, 'safety-app.ps1')
const resultPath = join(work, 'clicks.txt')
const closePath = join(work, 'close.ps1')
console.log('safety app:', appPath)
const app = `param([string]$ResultFile)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$form = New-Object System.Windows.Forms.Form
$form.Text = '${TITLE}'
$form.Width = 560
$form.Height = 320
$form.StartPosition = 'Manual'
$form.Left = 260
$form.Top = 180
$nameLabel = New-Object System.Windows.Forms.Label
$nameLabel.Text = 'Name'
$nameLabel.Left = 24; $nameLabel.Top = 24; $nameLabel.AutoSize = $true
$nameBox = New-Object System.Windows.Forms.TextBox
$nameBox.Left = 120; $nameBox.Top = 20; $nameBox.Width = 300
$pwdLabel = New-Object System.Windows.Forms.Label
$pwdLabel.Text = 'Password'
$pwdLabel.Left = 24; $pwdLabel.Top = 70; $pwdLabel.AutoSize = $true
$pwdBox = New-Object System.Windows.Forms.TextBox
$pwdBox.Left = 120; $pwdBox.Top = 66; $pwdBox.Width = 300
$pwdBox.UseSystemPasswordChar = $true
$btn = New-Object System.Windows.Forms.Button
$btn.Text = 'Click'
$btn.Left = 120; $btn.Top = 120; $btn.Width = 120
$btn.Add_Click({ Add-Content -Path $ResultFile -Value 'click' })
$form.Controls.AddRange(@($nameLabel, $nameBox, $pwdLabel, $pwdBox, $btn))
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
plugin.apply(ctx, { ttlMs: 1000, maxElements: 200, deliveryMode: 'auto', nativeImage: 'auto', passwordScan: 'auto' })
const defs = new Map(mod.toolDefinitions().map((d) => [d.name, d]))
const agent = { options: { provider: 'p', model: 'm' }, session: { requestHeader: () => ({ config: { provider: 'p', model: 'm' } }) } }
async function call(name, args = {}) {
  const def = defs.get(name)
  if (!def) throw new Error('tool not defined: ' + name)
  const exec = { agent, signal: new AbortController().signal, get signalSet() { return true } }
  return await def.execute(args, exec)
}

const checks = []
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

let child = null
let hwnd = 0
let pid = 0
let childStart = ''
function psOne(command) {
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8', timeout: 15000, windowsHide: true }).trim()
  } catch { return '' }
}
function closeWindow() {
  if (hwnd) {
    try { execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', closePath, String(hwnd)], { timeout: 15000, windowsHide: true }) } catch {}
  }
  if (child?.pid) {
    const name = psOne(`(Get-Process -Id ${child.pid} -ErrorAction SilentlyContinue).ProcessName`)
    const start = psOne(`try { (Get-Process -Id ${child.pid} -ErrorAction Stop).StartTime.ToString('o') } catch { '' }`)
    if (name === 'powershell' && (!childStart || start === childStart)) {
      try { child.kill() } catch {}
    }
  }
}

try {
  child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', appPath, '-ResultFile', resultPath])
  childStart = psOne(`try { (Get-Process -Id ${child.pid} -ErrorAction Stop).StartTime.ToString('o') } catch { '' }`)
  let childErr = ''
  let childOut = ''
  child.stdout.on('data', (d) => { childOut += d })
  child.stderr.on('data', (d) => { childErr += d })
  child.on('exit', (code) => { childErr += `\nexit=${code} pid=${child.pid}` })
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
    throw new Error('safety window not found; child pid=' + child.pid + ' stderr=' + childErr.slice(0, 600) + ' stdout=' + childOut.slice(0, 600) + ' titles=' + JSON.stringify(titles))
  }
  hwnd = win.window_id
  pid = win.pid
  const wid = win.window_id

  let obs = await call('screen_observe', { window_id: wid, mode: 'ax' })
  check('observe safety window', obs?.ok === true, String(obs?.result || '').split('\n')[0]?.slice(0, 90))
  const elements = obs?.elements || []
  console.log('elements:', JSON.stringify(elements.map((e) => ({ index: e.index, role: e.role, label: e.label, value: e.value, is_password: e.is_password })).slice(0, 20)))
  const pwd = elements.find((e) => e.is_password) || elements.find((e) => /password/i.test(String(e.label || '')))
  const edit = elements.find((e) => e !== pwd && /edit|text|输入框/i.test(String(e.role || '')))
  const btn = elements.find((e) => /button|按钮/i.test(String(e.role || '')) && /click/i.test(String(e.label || '')))
    || elements.find((e) => /button|按钮/i.test(String(e.role || '')))
  check('password element found', Boolean(pwd), pwd ? `index=${pwd.index}` : 'none')
  check('normal edit found', Boolean(edit), edit ? `index=${edit.index}` : 'none')
  check('button found', Boolean(btn), btn ? `index=${btn.index}` : 'none')

  if (pwd) {
    const t = await call('computer_type', { element: pwd.index, text: 'SECRET' })
    check('type into password refused', t?.ok === false && /password|密码|凭据|credential/i.test(String(t?.result || '')), String(t?.result || '').slice(0, 120))
    const v = await call('computer_set_value', { element: pwd.index, value: 'SECRET' })
    check('set_value into password refused', v?.ok === false && /password|密码|凭据|credential/i.test(String(v?.result || '')), String(v?.result || '').slice(0, 120))
  }
  if (edit) {
    const s = await call('computer_set_value', { element: edit.index, value: 'Alice' })
    check('set_value normal edit accepted', s?.ok === true, String(s?.result || '').slice(0, 120))
  }

  if (btn) {
    await delay(1300)
    const stale = await call('computer_click', { element: btn.index })
    check('expired snapshot refused', stale?.ok === false && /snapshot_expired|过期/i.test(String(stale?.result || '')), String(stale?.result || '').slice(0, 120))
  }

  await call('computer_stop', {})
  const stopped = await call('screen_observe', { window_id: wid, mode: 'ax' })
  check('stop latches observe', stopped?.ok === false, String(stopped?.result || '').slice(0, 120))
  await call('computer_resume', {})
  obs = await call('screen_observe', { window_id: wid, mode: 'ax' })
  check('resume restores observe', obs?.ok === true, String(obs?.result || '').split('\n')[0]?.slice(0, 90))
  if (btn && obs?.ok) {
    const click = await call('computer_click', { element: btn.index })
    await delay(300)
    check('click after resume delivered', click?.ok === true && existsSync(resultPath) && readFileSync(resultPath, 'utf8').includes('click'), String(click?.result || '').slice(0, 120))
  }

  const bad = await call('screen_observe', { window_id: 999999999, mode: 'ax' })
  check('driver error structured', bad?.ok === false && Boolean(bad?.result || bad?.error), String(bad?.result || '').slice(0, 120))
  const good = await call('screen_observe', { window_id: wid, mode: 'ax' })
  check('observe recovers after driver error', good?.ok === true, String(good?.result || '').split('\n')[0]?.slice(0, 90))
} catch (err) {
  check('probe completed', false, String(err.message || err))
} finally {
  closeWindow()
  await delay(800)
  if (!process.env.S4_KEEP) { try { rmSync(work, { recursive: true, force: true }) } catch {} }
}

const failed = checks.filter((c) => !c.ok)
console.log(`\n结果：${checks.length - failed.length}/${checks.length} 通过`)
process.exit(failed.length ? 1 : 0)
