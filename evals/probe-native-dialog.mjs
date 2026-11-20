/**
 * probe-native-dialog.mjs — 真机验证插件侧 Win32 原生对话框后端。
 *
 * 自建 WinForms 窗口（S4-NATIVE-DIALOG），用原生 BM_CLICK 打开 MessageBox
 * （避免触发 click 的 30s），然后只通过插件工具：
 *   screen_observe(window_id=dialog) → mode=native-dialog + 原生按钮
 *   computer_click(element=No)       → BM_CLICK，对话框关闭，state cancelled=1
 *   computer_double_click / computer_key → 明确拒绝
 *
 * 清理只按本探针 HWND / 子进程 PID（命令行含 native-dialog-app.ps1 与临时目录）；
 * 窗口另有 300s 自关 Timer。不加入 npm test。
 *
 * Run: node evals/probe-native-dialog.mjs
 */
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { defaultTransport } from '../lib/driver/transport.js'
import { scanNativeDialog, clickNativeDialog } from '../lib/nativeDialogs.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const mod = await import(pathToFileURL(join(root, 'index.js')).href)
const plugin = mod.default
const TITLE = 'S4-NATIVE-DIALOG'
const DIALOG_TITLE = 'S4-NATIVE-DIALOG-CONFIRM'
const work = mkdtempSync(join(tmpdir(), 's4-native-dialog-'))
const appPath = join(work, 'native-dialog-app.ps1')
const resultPath = join(work, 'state.json')
const openPath = join(work, 'open-dialog.ps1')
const closeFormPath = join(work, 'close-form.ps1')
console.log('native dialog probe workdir:', work)

const app = `param([string]$ResultFile)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
function Write-State($state) {
  $json = $state | ConvertTo-Json -Compress
  [IO.File]::WriteAllText($ResultFile, $json, (New-Object System.Text.UTF8Encoding($false)))
}
$state = [ordered]@{ opened = 0; cancelled = 0; confirmed = 0; at = (Get-Date).ToUniversalTime().ToString('o') }
Write-State $state
$form = New-Object System.Windows.Forms.Form
$form.Text = '${TITLE}'
$form.Width = 460
$form.Height = 220
$form.StartPosition = 'Manual'
$form.Left = 340
$form.Top = 280
$label = New-Object System.Windows.Forms.Label
$label.Text = 'Native dialog probe'
$label.AutoSize = $true
$label.Left = 24
$label.Top = 24
$form.Controls.Add($label)
$button = New-Object System.Windows.Forms.Button
$button.Text = 'Delete'
$button.Left = 24
$button.Top = 70
$button.Width = 120
$button.Height = 40
$button.Add_Click({
  $state.opened = [int]$state.opened + 1
  Write-State $state
  $answer = [System.Windows.Forms.MessageBox]::Show('Delete this item?', '${DIALOG_TITLE}', [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Warning)
  if ($answer -eq [System.Windows.Forms.DialogResult]::No) { $state.cancelled = [int]$state.cancelled + 1 } else { $state.confirmed = [int]$state.confirmed + 1 }
  $state.at = (Get-Date).ToUniversalTime().ToString('o')
  Write-State $state
})
$form.Controls.Add($button)
$auto = New-Object System.Windows.Forms.Timer
$auto.Interval = 300000
$auto.Add_Tick({ $auto.Stop(); $form.Close() })
$auto.Start()
[System.Windows.Forms.Application]::Run($form)
`
writeFileSync(appPath, app, 'utf8')

const open = `param([long]$Hwnd)
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class S4NativeOpen {
  public delegate bool EnumProc(IntPtr h, IntPtr lp);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr lp);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr h, uint msg, IntPtr w, IntPtr l);
}
'@
$script:btn = [IntPtr]::Zero
$cb = [S4NativeOpen+EnumProc]{
  param($h, $lp)
  $c = New-Object System.Text.StringBuilder 256
  [void][S4NativeOpen]::GetClassNameW($h, $c, 256)
  $t = New-Object System.Text.StringBuilder 256
  [void][S4NativeOpen]::GetWindowTextW($h, $t, 256)
  if (($c.ToString() -like '*BUTTON*') -and ($t.ToString() -eq 'Delete')) { $script:btn = $h }
  return $true
}
[void][S4NativeOpen]::EnumChildWindows([IntPtr]$Hwnd, $cb, [IntPtr]::Zero)
if ($script:btn -eq [IntPtr]::Zero) { Write-Output '{"ok":false,"error":"button_not_found"}'; exit 0 }
[void][S4NativeOpen]::PostMessageW($script:btn, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
Start-Sleep -Milliseconds 900
Write-Output '{"ok":true}'
`
writeFileSync(openPath, open, 'utf8')

const closeForm = `param([long]$Hwnd)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class S4NativeClose {
  [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
}
'@
$h = [IntPtr]$Hwnd
[void][S4NativeClose]::PostMessageW($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
Start-Sleep -Milliseconds 700
if ([S4NativeClose]::IsWindow($h)) { Write-Output '{"ok":true,"alive":true}' } else { Write-Output '{"ok":true,"alive":false}' }
`
writeFileSync(closeFormPath, closeForm, 'utf8')

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
plugin.apply(ctx, {
  ttlMs: 60000, maxElements: 120, observeDedup: 'off', passwordScan: 'off',
  surfaceMode: 'hybrid', deliveryMode: 'auto', cursorMotion: 'off', nativeDialogs: 'auto',
})
const defs = new Map(mod.toolDefinitions().map((d) => [d.name, d]))
const agent = { options: { provider: 'p', model: 'm' }, session: { requestHeader: () => ({ config: { provider: 'p', model: 'm' } }) } }
async function call(name, args = {}) {
  const def = defs.get(name)
  if (!def) throw new Error('tool not defined: ' + name)
  const exec = { agent, signal: new AbortController().signal, get signalSet() { return true } }
  return await def.execute(args, exec)
}

const checks = []
function record(name, status, detail = '', data = null) {
  checks.push({ name, status, detail, data })
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⛔'
  console.log(`${icon} ${name}${detail ? ' — ' + detail : ''}`)
}
const pass = (name, ok, detail = '', data = null) => record(name, ok ? 'PASS' : 'FAIL', detail, data)
const blocked = (name, detail = '', data = null) => record(name, 'BLOCKED', detail, data)

async function wins() {
  const r = await defaultTransport.rawCall('list_windows', { on_screen_only: true }, { timeoutMs: 8000 })
  return r.windows || []
}
async function waitTitle(title, pid = 0, ms = 15000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const w = (await wins()).find((x) => (pid ? Number(x.pid) === Number(pid) : true)
      && String(x.title || '').includes(title))
    if (w) return w
    await delay(300)
  }
  return null
}
function readState() {
  try { return JSON.parse(readFileSync(resultPath, 'utf8')) } catch { return null }
}
function ownedChild(pid) {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
      `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}" -ErrorAction SilentlyContinue; if ($p) { $p.Name + '|' + $p.CommandLine }`,
    ], { encoding: 'utf8', timeout: 15000, windowsHide: true }).trim()
    const [name, cmd = ''] = out.split('|')
    return /^powershell\.exe$/i.test(name || '') && cmd.includes('native-dialog-app.ps1') && cmd.includes(work)
  } catch { return false }
}

let child = null
let mainHwnd = 0
let dialogHwnd = 0
let probePid = 0
try {
  child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', appPath, '-ResultFile', resultPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  })
  let childErr = ''
  child.stderr.on('data', (d) => { childErr += d })
  const main = await waitTitle(TITLE, 0, 30000)
  if (!main) throw new Error('probe window not found; pid=' + child.pid + ' stderr=' + childErr.slice(0, 500))
  mainHwnd = Number(main.window_id)
  probePid = Number(main.pid)
  pass('probe window found', Boolean(probePid && mainHwnd), `pid=${probePid} window_id=${mainHwnd}`)

  const mainObs = await call('screen_observe', { window_id: mainHwnd, mode: 'ax' })
  const del = (mainObs.elements || []).find((e) => /^Delete$/i.test(String(e.label || '')))
  pass('main observe has Delete', mainObs.ok === true && Boolean(del),
    `els=${(mainObs.elements || []).map((e) => e.label).join('|')}`)
  if (!del) throw new Error('main window has no Delete button')

  // 关键：用插件的 UIA element click 触发模态。这个 Invoke 会一直挂到对话框关闭，
  // 正是 t20 的真实路径；此时对话框的 UIA 树应为 0，native 后端才有机会接管。
  const trigger = call('computer_click', { element: del.index })
  const dialog = await waitTitle(DIALOG_TITLE, probePid, 12000)
  if (!dialog) throw new Error('dialog not found after UIA trigger')
  dialogHwnd = Number(dialog.window_id)
  pass('UIA trigger opened dialog', true, `window_id=${dialogHwnd} pid=${dialog.pid}`)

  const obs = await call('screen_observe', { window_id: dialogHwnd, mode: 'ax' })
  const els = Array.isArray(obs.elements) ? obs.elements : []
  const no = els.find((e) => /^No$|^否/.test(String(e.label || '')))
  const yes = els.find((e) => /^Yes$|^是/.test(String(e.label || '')))
  pass('screen_observe native-dialog', obs.ok === true && obs.mode === 'native-dialog'
    && els.length >= 2 && Boolean(no) && Boolean(yes)
    && /原生对话框后端/.test(obs.result || '') && /BM_CLICK/.test(obs.result || ''),
  `mode=${obs.mode} els=${els.map((e) => e.label).join('|')}`, { obs })

  if (no) {
    const dbl = await call('computer_do', { action: 'call', tool: 'computer_double_click', args: { element: no.index } })
    pass('double_click refused on native dialog', dbl.ok === false && /仅支持.*单次左键/.test(dbl.result || ''), dbl.result)
    const key = await call('computer_key', { key: 'enter' })
    pass('computer_key refused on native dialog', key.ok === false && /native_dialog_unsupported/.test(key.result || ''), key.result)

    const click = await call('computer_click', { element: no.index })
    pass('native click accepted', click.ok === true && /原生消息/.test(click.result || '')
      && /未验证/.test(click.result || '') && /对话框/.test(click.result || ''), click.result)
    await delay(1200)
    const state = readState()
    const gone = !(await waitTitle(DIALOG_TITLE, probePid, 1000))
    pass('dialog closed + state cancelled=1', gone && state?.cancelled === 1,
      `gone=${gone} state=${JSON.stringify(state)}`, { gone, state })
    const trig = await trigger
    pass('UIA trigger settled after dialog close', true,
      `ok=${trig.ok} ${String(trig.result || '').slice(0, 120)}`, { trigger: trig })
  } else {
    blocked('native No button not found', `labels=${els.map((e) => e.label).join('|')}`)
  }
} catch (e) {
  console.error('❌ probe aborted:', e?.stack || e)
  process.exitCode = 1
} finally {
  try {
    if (dialogHwnd) {
      const dlg = probePid ? await scanNativeDialog({ pid: probePid, hwnd: dialogHwnd }).catch(() => null) : null
      if (dlg?.buttons?.length) {
        const no = dlg.buttons.find((b) => /No|否/i.test(b.label))
        if (no) await clickNativeDialog({ pid: probePid, hwnd: dialogHwnd, controlId: no.id, className: no.className, label: no.label }).catch(() => undefined)
      }
    }
    if (mainHwnd) {
      try { execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', closeFormPath, '-Hwnd', String(mainHwnd)], { timeout: 15000, windowsHide: true }) } catch {}
    }
    await delay(500)
    const still = await waitTitle(TITLE, 0, 1000)
    if (still) {
      if (ownedChild(child?.pid)) {
        try { child.kill() } catch {}
      } else {
        console.error('refusing to kill child without ownership proof:', child?.pid)
      }
    }
  } catch { /* 清理不覆盖主结果 */ }
  try { rmSync(work, { recursive: true, force: true }) } catch {}
}

const fails = checks.filter((c) => c.status === 'FAIL').length
const blocks = checks.filter((c) => c.status === 'BLOCKED').length
console.log(`\n结果：${checks.filter((c) => c.status === 'PASS').length} PASS / ${blocks} BLOCKED / ${fails} FAIL`)
console.log('JSON ' + JSON.stringify({ title: TITLE, dialog: DIALOG_TITLE, checks }, null, 2))
process.exitCode = fails ? 1 : 0
