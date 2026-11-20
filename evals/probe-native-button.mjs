/**
 * probe-native-button.mjs — 原生 Button 触发真机探针（不加入 npm test）。
 *
 * 自建无害 WinForms 窗口：Delete 按钮 → MessageBox(Yes/No)。
 * 验证 nativeButtonTrigger:auto 时 computer_click(element=Delete) 在模态打开前快速返回，
 * 模态出现后由 native-dialog 关闭；重复点击被 10s latch 拦住。
 *
 * 运行：node evals/probe-native-button.mjs
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
const work = mkdtempSync(join(tmpdir(), 's4-native-button-'))
const appPath = join(work, 'button-app.ps1')
const statePath = join(work, 'state.json')
const TITLE = 'S4-NATIVE-BTN'

const app = `param([string]$StateFile)
$ErrorActionPreference = 'Stop'
trap { [IO.File]::AppendAllText($StateFile + '.stage', ('ERROR: ' + $_ + [Environment]::NewLine)); exit 1 }
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[IO.File]::WriteAllText($StateFile + '.stage', 'start' + [Environment]::NewLine)
$state = [ordered]@{ opened = 0; cancelled = 0; confirmed = 0; deleted = $false; hwnd = 0 }
function Save-State {
  $json = $state | ConvertTo-Json -Compress
  [IO.File]::WriteAllText($StateFile, $json, (New-Object System.Text.UTF8Encoding($false)))
}
Save-State
$form = New-Object System.Windows.Forms.Form
$form.Text = '${TITLE}'
$form.Width = 460
$form.Height = 220
$form.StartPosition = 'Manual'
$form.Left = 260
$form.Top = 220
$label = New-Object System.Windows.Forms.Label
$label.Text = 'Native button trigger probe'
$label.AutoSize = $true
$label.Left = 24; $label.Top = 24
$form.Controls.Add($label)
$button = New-Object System.Windows.Forms.Button
$button.Text = 'Delete'
$button.Left = 24; $button.Top = 70; $button.Width = 120; $button.Height = 40
$button.Add_Click({
  $state.opened = [int]$state.opened + 1
  Save-State
  $answer = [System.Windows.Forms.MessageBox]::Show('Delete this item?', 'Confirm', [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Warning)
  if ($answer -eq [System.Windows.Forms.DialogResult]::No) { $state.cancelled = [int]$state.cancelled + 1 }
  else { $state.confirmed = [int]$state.confirmed + 1; $state.deleted = $true }
  Save-State
})
$form.Controls.Add($button)
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 180000
$timer.Add_Tick({ $timer.Stop(); $form.Close() })
$timer.Start()
$form.Add_Shown({
  $state.hwnd = $form.Handle.ToInt64()
  Save-State
  [IO.File]::AppendAllText($StateFile + '.stage', ('shown hwnd=' + $state.hwnd + [Environment]::NewLine))
})
[IO.File]::AppendAllText($StateFile + '.stage', 'before-run' + [Environment]::NewLine)
$form.Show()
$form.Activate()
[System.Windows.Forms.Application]::Run($form)
`
writeFileSync(appPath, app, 'utf8')

const results = []
const record = (name, status, detail = '') => {
  results.push({ name, status, detail })
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⛔'
  console.log(`${icon} ${name}${detail ? ' — ' + detail : ''}`)
}
const readState = () => {
  try { return JSON.parse(readFileSync(statePath, 'utf8')) } catch { return null }
}
const findWindow = async (needle, pid) => {
  const list = await cuaCall('list_windows', { on_screen_only: true })
  return (list?.windows || []).find((w) => Number(w.pid) === Number(pid) && String(w.title || '').includes(needle))
}
const closeOwnApp = () => {
  if (!appProc?.pid) return
  try {
    const cmd = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `$p=Get-CimInstance Win32_Process -Filter "ProcessId=${appProc.pid}" | Select-Object -First 1; if ($p) { $p.CommandLine } else { '' }`],
    { encoding: 'utf8', windowsHide: true })
    if (String(cmd).includes('button-app.ps1') || String(cmd).includes(work)) {
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Stop-Process -Id ${appProc.pid} -Force -ErrorAction SilentlyContinue`], { windowsHide: true })
    }
  } catch { /* ignore */ }
}

let appProc = null
let appOut = ''
let ctx = null
let defs = null
try {
  appProc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', appPath, '-StateFile', statePath], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  })
  appProc.stdout.on('data', (d) => { appOut += d })
  appProc.stderr.on('data', (d) => { appOut += d })
  for (let i = 0; i < 50; i += 1) {
    if (existsSync(statePath)) break
    await delay(200)
  }
  if (!existsSync(statePath)) throw new Error('app state file not created')
  let state0 = null
  for (let i = 0; i < 50; i += 1) {
    state0 = readState()
    if (Number(state0?.hwnd) > 0) break
    await delay(200)
  }
  if (!Number(state0?.hwnd)) throw new Error(`app hwnd not recorded: state=${JSON.stringify(state0)} out=${appOut.slice(0, 300)}`)
  const win = { window_id: Number(state0.hwnd), pid: Number(appProc.pid) }

  const services = {
    attachments: {
      imageLimits: { maxImageBytes: 5e6, maxImagePixels: 4e7, maxImagesPerMessage: 20, maxMessageImageBytes: 1e8, mediaTypes: ['image/png', 'image/jpeg'] },
      async saveImage(input) { return { attachmentId: 'sha256:' + 'a'.repeat(64), mediaType: input.mediaType, bytes: input.data.byteLength, width: 1, height: 1, name: input.name } },
      async validateImage() {},
      async readImage() { return { data: new Uint8Array([1]) } },
    },
    llm: { async resolveModelInfo(provider, model) { return { provider, id: model, inputModalities: ['text', 'image'] } }, async * stream() { throw new Error('MISSING_CREDENTIAL (stub)') } },
    approval: { async request() { return 'allowed-once' } },
  }
  const registered = new Map()
  ctx = {
    get: (n) => services[n],
    logger: { info() {}, error() {} },
    tools: { register(def) { registered.set(def.name, def); return () => registered.delete(def.name) } },
    toolsRuntime: null,
  }
  plugin.apply(ctx, {
    ttlMs: 60000, maxElements: 200, observeDedup: 'off', passwordScan: 'off',
    nativeDialogs: 'auto', nativeMenus: 'off', nativeButtonTrigger: 'auto',
    surfaceMode: 'dispatcher', deliveryMode: 'auto', cursorMotion: 'off',
  })
  defs = new Map(mod.toolDefinitions().map((d) => [d.name, d]))
  const exec = { agent: { options: { provider: 'p', model: 'm' }, session: { requestHeader: () => ({ config: { provider: 'p', model: 'm' } }) } }, signal: new AbortController().signal }
  const call = (name, args = {}) => defs.get(name).execute(args, exec)

  const obs = await call('screen_observe', { window_id: win.window_id, mode: 'ax' })
  const del = (obs.elements || []).find((e) => /^Delete$/.test(String(e.label || '')))
  if (!del) throw new Error(`Delete button not found in AX snapshot: ${JSON.stringify({ ok: obs.ok, mode: obs.mode, count: (obs.elements || []).length, result: String(obs.result || '').slice(0, 240) })}`)

  const t0 = Date.now()
  const click = await call('computer_click', { element: del.index })
  const elapsed = Date.now() - t0
  const state1 = readState()
  if (click.ok === true && /原生 Win32 按钮/.test(click.result || '') && elapsed < 5000 && state1?.opened === 1) {
    record('原生触发快速返回', 'PASS', `elapsed=${elapsed}ms opened=${state1.opened}`)
  } else {
    record('原生触发快速返回', 'FAIL', `elapsed=${elapsed}ms result=${String(click.result || '').slice(0, 180)} state=${JSON.stringify(state1)}`)
  }

  let dialog = null
  for (let i = 0; i < 30; i += 1) {
    dialog = await findWindow('Confirm', appProc.pid)
    if (dialog) break
    await delay(200)
  }
  if (!dialog) {
    record('模态出现', 'FAIL', 'Confirm dialog not found within 6s')
  } else {
    record('模态出现', 'PASS', `window_id=${dialog.window_id}`)
    const dObs = await call('screen_observe', { window_id: dialog.window_id, mode: 'ax' })
    const no = (dObs.elements || []).find((e) => /^(No|否)/.test(String(e.label || '')))
    if (!no) {
      record('native-dialog 关闭', 'FAIL', JSON.stringify(dObs.elements || []))
    } else {
      const c = await call('computer_click', { element: no.index })
      await delay(500)
      const state2 = readState()
      record('native-dialog 关闭', c.ok === true && state2?.cancelled === 1 && state2?.opened === 1 ? 'PASS' : 'FAIL',
        `result=${String(c.result || '').slice(0, 120)} state=${JSON.stringify(state2)}`)
    }
  }

  const obs2 = await call('screen_observe', { window_id: win.window_id, mode: 'ax' })
  const del2 = (obs2.elements || []).find((e) => /^Delete$/.test(String(e.label || '')))
  const again = del2 ? await call('computer_click', { element: del2.index }) : { ok: true, result: 'Delete not found after modal' }
  await delay(400)
  const state3 = readState()
  record('10s latch 阻止重复', state3?.opened === 1 && /latch|10s|10 秒|不要重复/.test(String(again.result || '')) ? 'PASS' : 'FAIL',
    `result=${String(again.result || '').slice(0, 180)} state=${JSON.stringify(state3)}`)
} catch (err) {
  record('探针异常', 'FAIL', String(err?.message || err).slice(0, 400))
} finally {
  closeOwnApp()
  await delay(500)
  if (!process.env.S4_KEEP) { try { rmSync(work, { recursive: true, force: true }) } catch { /* ignore */ } }
}

const fail = results.some((x) => x.status === 'FAIL')
const blocked = results.some((x) => x.status === 'BLOCKED')
console.log(`\n${results.filter((x) => x.status === 'PASS').length} PASS / ${results.filter((x) => x.status === 'BLOCKED').length} BLOCKED / ${results.filter((x) => x.status === 'FAIL').length} FAIL`)
console.log('JSON ' + JSON.stringify({ title: 'native-button-trigger', results }))
process.exit(fail ? 1 : blocked ? 0 : 0)
