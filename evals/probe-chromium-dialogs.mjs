#!/usr/bin/env node
/**
 * probe-chromium-dialogs.mjs — Edge/Chrome file chooser + print preview evidence.
 *
 * Launches a dedicated temp-profile browser window with a local page containing
 * <input type=file> and a Print button. It records:
 *   - whether the file chooser is a new top-level window, its class/owner,
 *     and whether nativeDialogs can scan it;
 *   - whether Ctrl+P produces a new/changed surface and whether UIA is readable.
 *
 * Only the test-owned browser window/process is closed; user browser profiles
 * are never touched. No model.
 *
 * Run: node evals/probe-chromium-dialogs.mjs [--browser edge|chrome] [--strict-blocked]
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { cuaCall, CUA_SESSION } from '../lib/cua.js'
import { scanNativeDialog } from '../lib/nativeDialogs.js'

const TEMP = process.env.S4_TEMP || (process.platform === 'win32'
  ? join(homedir(), 'AppData', 'Local', 'Temp')
  : tmpdir())
const work = mkdtempSync(join(TEMP, 's4-chromium-'))
const profile = join(work, 'profile')
const page = join(work, 'dialogs.html')
const INFO = join(work, 'window-info.ps1')
const CLOSE = join(work, 'close.ps1')
const TITLE = 'S4-CHROMIUM-DIALOGS'
const strict = process.argv.includes('--strict-blocked')
const browserArg = (() => {
  const i = process.argv.indexOf('--browser')
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : 'edge'
})()
const sleep = (ms) => delay(ms)

const candidates = browserArg === 'chrome'
  ? [join(process.env.ProgramFiles || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe')]
  : [
    join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft\\Edge\\Application\\msedge.exe'),
    join(process.env.ProgramFiles || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
  ]
const browser = candidates.find((p) => p && existsSync(p))
if (!browser) {
  console.log(`⛔ browser not found (${browserArg})`)
  process.exit(strict ? 2 : 0)
}

writeFileSync(page, `<!doctype html><html><head><meta charset="utf-8"><title>${TITLE}</title></head>
<body style="font:16px Segoe UI;margin:24px">
<h1>${TITLE}</h1>
<p><input id="file" type="file" style="position:absolute;left:40px;top:140px;width:260px"></p>
<p><button id="print" onclick="window.print()" style="position:absolute;left:40px;top:200px">Print</button></p>
</body></html>`, 'utf8')

writeFileSync(INFO, `param([long]$Hwnd)
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class S4ChromiumInfo {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetLastActivePopup(IntPtr h);
}
'@
$c = New-Object System.Text.StringBuilder 256
[void][S4ChromiumInfo]::GetClassNameW([IntPtr]$Hwnd, $c, $c.Capacity)
$t = New-Object System.Text.StringBuilder 512
[void][S4ChromiumInfo]::GetWindowTextW([IntPtr]$Hwnd, $t, $t.Capacity)
$owner = [S4ChromiumInfo]::GetWindow([IntPtr]$Hwnd, 4)
[uint32]$op = 0
if ($owner -ne [IntPtr]::Zero) { [void][S4ChromiumInfo]::GetWindowThreadProcessId($owner, [ref]$op) }
[ordered]@{
  ok = $true; className = $c.ToString(); title = $t.ToString()
  owner = $owner.ToInt64(); ownerPid = [int]$op
  ownerEnabled = if ($owner -ne [IntPtr]::Zero) { [bool][S4ChromiumInfo]::IsWindowEnabled($owner) } else { $false }
  lastPopup = if ($owner -ne [IntPtr]::Zero) { [S4ChromiumInfo]::GetLastActivePopup($owner).ToInt64() } else { 0 }
} | ConvertTo-Json -Compress
`, 'utf8')

writeFileSync(CLOSE, `param([long]$Hwnd, [int]$TargetPid)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class S4ChromiumClose {
  [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
'@
[uint32]$p = 0
[void][S4ChromiumClose]::GetWindowThreadProcessId([IntPtr]$Hwnd, [ref]$p)
if ([int]$p -ne $TargetPid) { [Console]::Out.WriteLine('{"ok":false,"error":"pid_mismatch"}'); exit 0 }
[void][S4ChromiumClose]::PostMessageW([IntPtr]$Hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
Start-Sleep -Milliseconds 500
[Console]::Out.WriteLine(([ordered]@{ ok = -not [S4ChromiumClose]::IsWindow([IntPtr]$Hwnd) } | ConvertTo-Json -Compress))
`, 'utf8')

function windowInfo(hwnd) {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', INFO,
      '-Hwnd', String(hwnd)], { encoding: 'utf8', timeout: 10000, windowsHide: true })
    return JSON.parse(out.trim().split(/\r?\n/).filter(Boolean).pop())
  } catch { return null }
}

function closeWindow(w) {
  if (!w) return
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', CLOSE,
      '-Hwnd', String(w.window_id), '-TargetPid', String(w.pid)], { encoding: 'utf8', timeout: 10000, windowsHide: true })
  } catch { /* browser may close itself */ }
}

async function list() {
  const v = await cuaCall('list_windows', { on_screen_only: true }).catch(() => ({ windows: [] }))
  return v.windows || []
}

async function waitWindow(title, ms = 15000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const w = (await list()).find((x) => String(x.title || '').includes(title))
    if (w) return w
    await sleep(250)
  }
  return null
}

async function stateWindow(w, timeoutMs = 1500) {
  try {
    return await cuaCall('get_window_state', {
      session: CUA_SESSION, pid: Number(w.pid), window_id: Number(w.window_id),
      tree_format: 'elements', max_elements: 160, timeout_ms: timeoutMs, include_screenshot: false,
    }, { timeoutMs: timeoutMs + 3000 })
  } catch (e) { return { error: String(e?.message || e) } }
}

const checks = []
function record(name, status, detail = '') {
  checks.push({ name, status, detail })
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⛔'
  console.log(`${icon} ${name}${detail ? ' — ' + detail : ''}`)
}

let child = null
let mainW = null
let dialogW = null
let failed = 0
try {
  await cuaCall('start_session', { session: CUA_SESSION }).catch(() => undefined)
  child = spawn(browser, [
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-session-crashed-bubble',
    '--new-window', '--window-size=1000,800', pathToFileURL(page).href,
  ], { stdio: 'ignore', windowsHide: false })
  mainW = await waitWindow(TITLE, 20000)
  if (!mainW) throw new Error('browser window not found')
  const st = await stateWindow(mainW)
  const els = Array.isArray(st.elements) ? st.elements : []
  record('browser window', 'PASS', `pid=${mainW.pid} window_id=${mainW.window_id} elements=${els.length} title=${mainW.title}`)
  console.log('browser elements:', JSON.stringify(els.slice(0, 30).map((e) => ({ i: e.element_index, t: e.element_token, r: e.role, l: e.label, n: e.name, x: e.frame?.x, y: e.frame?.y }))))

  const beforeIds = new Set((await list()).map((w) => String(w.window_id)))
  const fileEl = els.find((e) => /choose file|选择文件|browse|浏览/i.test(`${e.label || ''} ${e.name || ''}`))
  const fileToken = fileEl?.element_token || fileEl?.elementToken
  let clickReceipt = null
  if (fileToken) {
    clickReceipt = await cuaCall('click', {
      session: CUA_SESSION, pid: mainW.pid, window_id: mainW.window_id, element_token: fileToken, delivery_mode: 'foreground',
    }).catch((e) => ({ error: String(e?.message || e) }))
  } else {
    // Page layout in the captured window: file input at ~x=60..165, y=310..345.
    await cuaCall('get_window_state', {
      session: CUA_SESSION, pid: mainW.pid, window_id: mainW.window_id,
      include_screenshot: true, include_accessibility_tree: true, max_elements: 1,
    }, { timeoutMs: 8000 }).then((shot) => {
      if (process.env.S4_CHROMIUM_SHOT && shot?.screenshot_png_b64) {
        const p = join(TEMP, 's4-chromium-shot.png')
        writeFileSync(p, Buffer.from(shot.screenshot_png_b64, 'base64'))
        console.log('saved screenshot:', p)
      }
    }).catch(() => null)
    clickReceipt = await cuaCall('click', {
      session: CUA_SESSION, pid: mainW.pid, window_id: mainW.window_id, x: 110, y: 328, delivery_mode: 'foreground',
    }).catch((e) => ({ error: String(e?.message || e) }))
  }
  console.log('file input click:', JSON.stringify({ token: Boolean(fileToken), receipt: clickReceipt }))
  if (!fileToken) {
    // Mouse hit may only focus the file input; Space/Enter is the keyboard
    // activation path for a focused <input type=file>.
    await cuaCall('press_key', {
      session: CUA_SESSION, pid: mainW.pid, window_id: mainW.window_id, key: 'space', delivery_mode: 'foreground',
    }, { timeoutMs: 5000 }).catch(() => null)
    await sleep(500)
    await cuaCall('press_key', {
      session: CUA_SESSION, pid: mainW.pid, window_id: mainW.window_id, key: 'enter', delivery_mode: 'foreground',
    }, { timeoutMs: 5000 }).catch(() => null)
  }
  await sleep(1200)
  const after = await list()
  const newWins = after.filter((w) => !beforeIds.has(String(w.window_id))
    && Number(w.window_id) !== Number(mainW.window_id))
  console.log('new windows after file click:', JSON.stringify(newWins.map((w) => ({ id: w.window_id, pid: w.pid, title: w.title, app: w.app_name }))))
  dialogW = newWins.find((w) => /open|打开/i.test(String(w.title || '')))
    || newWins.find((w) => Number(w.pid) === Number(mainW.pid))
    || newWins[0]
    || null
  if (dialogW) {
    const info = windowInfo(dialogW.window_id)
    const scan = await scanNativeDialog({ pid: Number(dialogW.pid), hwnd: Number(dialogW.window_id), timeoutMs: 4000 })
    record('file chooser surface', 'PASS',
      `title=${dialogW.title} class=${info?.className || ''} owner=${info?.owner || 0} ownerPid=${info?.ownerPid || 0} ownerEnabled=${info?.ownerEnabled} scan=${scan ? 'native-dialog' : 'null'}`)
    if (scan?.buttons?.length) {
      const cancel = scan.buttons.find((b) => Number(b.id) === 2 || /cancel|取消/i.test(String(b.label || '')))
      if (cancel) {
        const clicked = await (await import('../lib/nativeDialogs.js')).clickNativeDialog({
          pid: Number(dialogW.pid), hwnd: Number(dialogW.window_id),
          controlId: Number(cancel.id), className: cancel.className, label: cancel.label, timeoutMs: 4000,
        })
        record('file chooser native cancel', clicked.ok ? 'PASS' : 'BLOCKED', JSON.stringify(clicked))
      } else {
        record('file chooser native cancel', 'BLOCKED', 'no Cancel button')
      }
    } else {
      record('file chooser native scan', 'BLOCKED', 'no native dialog buttons')
    }
  } else {
    record('file chooser surface', 'BLOCKED', 'no new top-level window after file input click')
  }

  await cuaCall('hotkey', {
    session: CUA_SESSION, pid: mainW.pid, window_id: mainW.window_id, keys: ['ctrl', 'p'], delivery_mode: 'foreground',
  }, { timeoutMs: 10000 }).catch(() => null)
  await sleep(2000)
  const printW = (await list()).find((w) => Number(w.pid) === Number(mainW.pid)
    && /print|打印/i.test(String(w.title || '')))
  const stPrint = printW ? await stateWindow(printW, 2000) : null
  record('print preview surface', printW ? 'PASS' : 'BLOCKED',
    printW ? `title=${printW.title} window_id=${printW.window_id} elements=${stPrint?.elements?.length ?? 'n/a'}` : 'no new print window/title')
  if (printW) {
    await cuaCall('press_key', {
      session: CUA_SESSION, pid: printW.pid, window_id: printW.window_id, key: 'escape', delivery_mode: 'foreground',
    }, { timeoutMs: 5000 }).catch(() => null)
  }
} catch (e) {
  console.error(`❌ chromium probe failed: ${e?.message || e}`)
  failed++
} finally {
  closeWindow(dialogW)
  closeWindow(mainW)
  try { child?.kill() } catch { /* ignore */ }
  // Only terminate the test-owned process whose command line contains this
  // temp profile; never kill by process name.
  try {
    if (mainW) {
      const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
        `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${Number(mainW.pid)}" -ErrorAction SilentlyContinue; if ($p -and $p.CommandLine -like '*${profile.replace(/'/g, "''")}*') { Stop-Process -Id ${Number(mainW.pid)} -Force; 'killed-test-owned' } else { 'kept' }`,
      ], { encoding: 'utf8', timeout: 10000, windowsHide: true })
      console.log('browser process:', out.trim())
    }
  } catch { /* ignore */ }
  try { rmSync(work, { recursive: true, force: true }) } catch { /* ignore */ }
}

const pass = checks.filter((c) => c.status === 'PASS').length
const blocks = checks.filter((c) => c.status === 'BLOCKED').length
console.log(`\nprobe-chromium-dialogs: ${pass} PASS / ${blocks} BLOCKED / ${failed} FAIL`)
process.exit(failed ? 1 : (strict && blocks ? 2 : 0))
