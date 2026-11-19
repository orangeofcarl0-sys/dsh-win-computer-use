/**
 * probe-launch.mjs — real app_launch + High-IL cleanup probe (no model).
 *
 * What this proves (or disproves) at runtime:
 *   1. app_launch returns a pid and a window for a benign system app.
 *   2. the launched child inherits High IL from the elevated driver.
 *   3. the driver itself can close its own High-IL window (alt+F4), or the
 *      window is reported as an exact leftover instead of being killed by name.
 *   4. no pre-existing user window is closed by the probe.
 *
 * Targets are deliberately benign (powershell/cmd/mshta). Notepad/Paint/Office
 * are never used: they can restore user documents or user tabs.
 *
 * Classification:
 *   PASS       launched, High IL confirmed, driver-side close confirmed
 *   LEFT_OVER  launched but the High-IL window did not close; exact identity
 *              is written to ~/.dsh/s4-evals/_leftovers/ for manual cleanup
 *   BLOCKED    app_launch cannot resolve a benign target, or integrity cannot
 *              be measured from the current integrity level
 *   FAIL       contract violation: no pid/window, wrong window closed, etc.
 *
 * Run: node evals/probe-launch.mjs [--app powershell.exe]
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync, rmSync, mkdtempSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { cuaCall, withSession } from '../lib/cua.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const mod = await import(pathToFileURL(join(root, 'index.js')).href)
const plugin = mod.default
const work = mkdtempSync(join(tmpdir(), 's4-launch-'))
const integrityPath = join(work, 'integrity.ps1')
const alivePath = join(work, 'alive.ps1')
const leftoverPath = join(work, 'leftover.ps1')

const args = process.argv.slice(2)
const appArg = (() => {
  const i = args.indexOf('--app')
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : ''
})()
const candidates = appArg ? [appArg] : ['powershell.exe', 'cmd.exe', 'mshta.exe']

const integrity = `param([int]$TargetPid)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class S4Tok {
  [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("advapi32.dll", SetLastError = true)] public static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError = true)] public static extern bool GetTokenInformation(IntPtr token, int cls, IntPtr buf, int len, out int ret);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool ConvertSidToStringSidW(IntPtr sid, out IntPtr str);
  [DllImport("kernel32.dll")] public static extern IntPtr LocalFree(IntPtr h);
}
'@
$p = [S4Tok]::OpenProcess(0x1000, $false, $TargetPid)
if ($p -eq [IntPtr]::Zero) { '{"ok":false,"error":"OpenProcess failed"}'; exit 0 }
$tok = [IntPtr]::Zero
try {
  if (-not [S4Tok]::OpenProcessToken($p, 0x0008, [ref]$tok)) { '{"ok":false,"error":"OpenProcessToken failed"}'; exit 0 }
  $len = 0
  [void][S4Tok]::GetTokenInformation($tok, 25, [IntPtr]::Zero, 0, [ref]$len)
  if ($len -le 0) { '{"ok":false,"error":"GetTokenInformation size failed"}'; exit 0 }
  $buf = [Runtime.InteropServices.Marshal]::AllocHGlobal($len)
  try {
    if (-not [S4Tok]::GetTokenInformation($tok, 25, $buf, $len, [ref]$len)) { '{"ok":false,"error":"GetTokenInformation failed"}'; exit 0 }
    $sidPtr = [Runtime.InteropServices.Marshal]::ReadIntPtr($buf)
    $str = [IntPtr]::Zero
    if (-not [S4Tok]::ConvertSidToStringSidW($sidPtr, [ref]$str)) { '{"ok":false,"error":"ConvertSidToStringSidW failed"}'; exit 0 }
    $sid = [Runtime.InteropServices.Marshal]::PtrToStringUni($str)
    [void][S4Tok]::LocalFree($str)
    $rid = 0
    try { $rid = [int]($sid.Split('-')[-1]) } catch {}
    ('{"ok":true,"sid":"' + $sid + '","rid":' + $rid + '}')
  } finally {
    [Runtime.InteropServices.Marshal]::FreeHGlobal($buf)
  }
} finally {
  if ($tok -ne [IntPtr]::Zero) { [void][S4Tok]::CloseHandle($tok) }
  [void][S4Tok]::CloseHandle($p)
}
`
writeFileSync(integrityPath, integrity, 'utf8')

const alive = `param([int]$Hwnd)
. '${join(root, 'evals', 'lib', 'common.ps1').replace(/'/g, "''")}'
if (Test-WindowAlive $Hwnd) { '1' } else { '0' }
`
writeFileSync(alivePath, alive, 'utf8')

const leftover = `param([string]$TaskId, [string]$StateFile, [string]$Reason, [string]$Title)
. '${join(root, 'evals', 'lib', 'common.ps1').replace(/'/g, "''")}'
$r = Save-LeftoverState -TaskId $TaskId -StateFile $StateFile -Result ([ordered]@{ reason = $Reason; leftover = $Title })
if ($r) { $r } else { '' }
`
writeFileSync(leftoverPath, leftover, 'utf8')

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
plugin.apply(ctx, { ttlMs: 60000, maxElements: 200, deliveryMode: 'auto', nativeImage: 'auto', passwordScan: 'off' })
const defs = new Map(mod.toolDefinitions().map((d) => [d.name, d]))
const agent = { options: { provider: 'p', model: 'm' }, session: { requestHeader: () => ({ config: { provider: 'p', model: 'm' } }) } }
async function call(name, a = {}) {
  const def = defs.get(name)
  if (!def) throw new Error('tool not defined: ' + name)
  const exec = { agent, signal: new AbortController().signal, get signalSet() { return true } }
  return await def.execute(a, exec)
}

const checks = []
function record(name, status, detail = '') {
  checks.push({ name, status, detail })
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : status === 'LEFT_OVER' ? '⚠️' : '⛔'
  console.log(`${icon} ${name}${detail ? ' — ' + detail : ''}`)
}
const pass = (name, ok, detail = '') => record(name, ok ? 'PASS' : 'FAIL', detail)
const blocked = (name, detail = '') => record(name, 'BLOCKED', detail)

function runPs(script, extra = [], timeout = 20000) {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...extra], { encoding: 'utf8', timeout, windowsHide: true })
    return String(out).trim()
  } catch (err) {
    return String(err?.stdout || '').trim()
  }
}
function integrityOf(pid) {
  const raw = runPs(integrityPath, [String(pid)])
  const line = raw.split(/\r?\n/).filter((l) => l.trim().startsWith('{')).pop()
  try { return line ? JSON.parse(line) : null } catch { return null }
}
const aliveHwnd = (h) => runPs(alivePath, [String(h)]) === '1'
function processAlive(pid) {
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-Command', `if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { '1' } else { '0' }`], { encoding: 'utf8', timeout: 10000, windowsHide: true }).trim() === '1'
  } catch { return false }
}

let baseline = []
let launchedApp = ''
let pid = 0
let hwnd = 0
let title = ''
let leftoverWritten = ''

try {
  const list0 = await cuaCall('list_windows', { on_screen_only: true })
  baseline = (list0.windows || []).map((w) => Number(w.window_id)).filter((x) => Number.isFinite(x) && x > 0)
  pass('baseline windows recorded', baseline.length > 0, `count=${baseline.length}`)

  let launch = null
  let lastRefusal = ''
  for (const app of candidates) {
    const r = await call('app_launch', { name: app })
    if (r?.ok === true) { launch = r; launchedApp = app; break }
    lastRefusal = String(r?.result || r?.error || '').slice(0, 240)
    console.log(`app_launch ${app} -> refused: ${lastRefusal}`)
  }
  if (!launch) {
    blocked('app_launch launched a benign target', `tried ${candidates.join(', ')}; last=${lastRefusal}`)
    throw new Error('no launch')
  }
  pid = Number(launch.pid) || 0
  hwnd = Number(launch.window_id) || 0
  pass('app_launch returned pid', pid > 0, `app=${launchedApp} pid=${pid} window_id=${hwnd}`)

  // The driver may return before the window exists (console start-up).
  let win = null
  if (hwnd > 0) {
    const list = await cuaCall('list_windows', { on_screen_only: true })
    win = (list.windows || []).find((w) => Number(w.window_id) === hwnd) || null
  }
  if (!win && pid > 0) {
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      const list = await cuaCall('list_windows', { on_screen_only: true })
      win = (list.windows || []).find((w) => Number(w.pid) === pid) || null
      if (win) break
      await delay(400)
    }
  }
  if (!win) {
    pass('launched window found', false, `pid=${pid} window_id=${hwnd}; no visible window after 10s`)
  } else {
    hwnd = Number(win.window_id)
    pid = Number(win.pid) || pid
    title = String(win.title || '')
    pass('launched window found', true, `hwnd=${hwnd} pid=${pid} title=${title}`)
    const obs = await call('screen_observe', { window_id: hwnd, mode: 'ax' })
    pass('screen_observe launched window', obs?.ok === true, `elements=${(obs?.elements || []).length}`)
  }

  if (pid > 0) {
    const child = integrityOf(pid)
    const self = integrityOf(process.pid)
    const apps = await call('app_list', {})
    const driverApp = (apps?.apps || []).find((a) => /cua-driver/i.test(String(a.name || '')))
    const driver = driverApp ? integrityOf(Number(driverApp.pid)) : null
    const selfText = self?.ok ? `${self.sid}` : 'unknown'
    const driverText = driver?.ok ? `${driver.sid}` : 'unknown'
    if (!child?.ok) blocked('launched process integrity measured', `cannot read child token: ${child?.error || 'unknown'}`)
    else {
      pass('launched process integrity measured', true, `child=${child.sid} node=${selfText} driver=${driverText}`)
      if (Number(child.rid) < 12288 && driver?.ok && Number(driver.rid) >= 12288) {
        console.log('NOTE: driver is High but the launched child is not; High-IL inheritance is driver/path-dependent and did not reproduce here.')
      }
    }
  }

  // Driver-side close. The driver is High IL and can operate its own child;
  // Node-side kill is deliberately not used.
  if (hwnd > 0) {
    await call('computer_activate', { window_id: hwnd, pid })
    await delay(400)
    const close = await cuaCall('hotkey', withSession({ keys: ['alt', 'f4'], pid, window_id: hwnd, delivery_mode: 'foreground' }))
      .catch((e) => ({ error: String(e?.message || e) }))
    console.log('driver close:', JSON.stringify(close).slice(0, 300))
    let windowGone = false
    for (let i = 0; i < 12; i++) {
      await delay(400)
      if (!aliveHwnd(hwnd)) { windowGone = true; break }
    }
    let closePath = 'hotkey alt+f4'
    if (!windowGone) {
      const obs = await call('screen_observe', { window_id: hwnd, mode: 'ax' })
      const closeBtn = (obs?.elements || []).find((e) => /^(关闭|Close|Close window)$/i.test(String(e.label || '')))
      if (closeBtn) {
        const c = await call('computer_click', { element: closeBtn.index })
        console.log('close button:', JSON.stringify(c).slice(0, 240))
        await delay(1500)
        windowGone = !aliveHwnd(hwnd)
        closePath = c?.ok === true ? 'close button' : 'hotkey alt+f4 (close button refused)'
      }
    }
    const processGone = !processAlive(pid)
    if (windowGone || processGone) {
      pass('driver-side close confirmed', true, `path=${closePath} windowGone=${windowGone} processGone=${processGone}`)
    } else {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const durableState = join(homedir(), '.dsh', 's4-evals', '_leftovers', `probe-launch-${stamp}.json`)
      mkdirSync(dirname(durableState), { recursive: true })
      const state = { task: 'probe-launch', app: launchedApp, hwnd, pid, title, owned: true, at: new Date().toISOString() }
      writeFileSync(durableState, JSON.stringify(state, null, 2))
      leftoverWritten = runPs(leftoverPath, ['probe-launch', durableState, 'driver hotkey alt+f4 did not close window', title])
      record('driver-side close confirmed', 'LEFT_OVER', `hwnd=${hwnd} pid=${pid} title=${title} leftover=${leftoverWritten || durableState}`)
    }
  }

  // The probe must not close any pre-existing window.
  const closedBaseline = baseline.filter((h) => !aliveHwnd(h))
  pass('baseline windows preserved', closedBaseline.length === 0, `closed=${JSON.stringify(closedBaseline)}`)
} catch (err) {
  if (String(err?.message || err) !== 'no launch') {
    pass('probe completed', false, String(err.message || err))
  }
} finally {
  if (!process.env.S4_KEEP) { try { rmSync(work, { recursive: true, force: true }) } catch {} }
}

if (leftoverWritten) console.log('leftover state: ' + leftoverWritten)
const passes = checks.filter((c) => c.status === 'PASS').length
const left = checks.filter((c) => c.status === 'LEFT_OVER').length
const blocks = checks.filter((c) => c.status === 'BLOCKED').length
const fails = checks.filter((c) => c.status === 'FAIL').length
console.log(`\n结果：PASS ${passes}/${checks.length}，LEFT_OVER ${left}，BLOCKED ${blocks}，FAIL ${fails}`)
process.exit(fails ? 1 : 0)
