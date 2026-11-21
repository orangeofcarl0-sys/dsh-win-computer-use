#!/usr/bin/env node
/**
 * probe-gesture-truth.mjs — compare driver-native vs private SendInput drags
 * against a WinForms target that records the actual mouse event sequence.
 *
 * PASS requires the target to observe down -> move(s) -> up with Ctrl held for
 * both engines. A receipt alone is not enough: this probe reads the fixture log.
 *
 * Only the test-owned window is closed (exact HWND or 60s self-close timer).
 * No model, no user window, no process-name kill.
 *
 * Run: node evals/probe-gesture-truth.mjs [--strict-blocked]
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { cuaCall, CUA_SESSION, cuaDriverCapabilities } from '../lib/cua.js'
import { capabilitySummary } from '../lib/driver/capabilities.js'
import { drag } from '../lib/actions.js'
import { setSnapshot, clearSnapshot } from '../lib/snapshot.js'
import { stopPrivateDrag } from '../lib/privateDrag.js'

const TEMP = process.env.S4_TEMP || (process.platform === 'win32'
  ? join(homedir(), 'AppData', 'Local', 'Temp')
  : tmpdir())
const work = mkdtempSync(join(TEMP, 's4-gesture-truth-'))
const PS1 = join(work, 'fixture.ps1')
const MARK = join(work, 'events.log')
const CLOSE = join(work, 'close.ps1')
const TITLE = 'S4 Gesture Truth'
const strict = process.argv.includes('--strict-blocked')
const sleep = (ms) => delay(ms)

writeFileSync(PS1, `
param([string]$Marker)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$form = New-Object System.Windows.Forms.Form
$form.Text = '${TITLE}'
$form.Width = 620
$form.Height = 420
$form.StartPosition = 'Manual'
$form.Left = 220
$form.Top = 160
$panel = New-Object System.Windows.Forms.Button
$panel.Text = 'GESTURE-TARGET'
$panel.Left = 10
$panel.Top = 10
$panel.Width = 580
$panel.Height = 340
$panel.FlatStyle = 'Flat'
$panel.BackColor = [System.Drawing.Color]::White
$panel.TabStop = $true
$script:firstMove = $false
function Log([string]$phase) {
  $m = [System.Windows.Forms.Control]::ModifierKeys
  $p = [System.Windows.Forms.Cursor]::Position
  $b = [System.Windows.Forms.Control]::MouseButtons
  $line = $phase + '|' + [string]$m + '|' + $p.X + ',' + $p.Y + '|' + [string]$b
  Add-Content -LiteralPath $Marker -Value $line -Encoding UTF8
}
$panel.Add_MouseDown({ Log 'down' })
$panel.Add_MouseMove({
  if (([System.Windows.Forms.Control]::MouseButtons -band [System.Windows.Forms.MouseButtons]::Left) -ne 0) {
    if (-not $script:firstMove) { $script:firstMove = $true; Log 'move' }
  }
})
$panel.Add_MouseUp({ Log 'up' })
$form.Controls.Add($panel)
$form.Add_Shown({ $panel.Focus() })
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 60000
$timer.Add_Tick({ $timer.Stop(); $form.Close() })
$timer.Start()
[System.Windows.Forms.Application]::Run($form)
`, 'utf8')

writeFileSync(CLOSE, `param([long]$Hwnd, [int]$TargetPid)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class S4GestureClose {
  [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
'@
[int]$actual = 0
[uint32]$p = 0
[void][S4GestureClose]::GetWindowThreadProcessId([IntPtr]$Hwnd, [ref]$p)
$actual = [int]$p
if ($actual -ne $TargetPid) { [Console]::Out.WriteLine('{"ok":false,"error":"pid_mismatch"}'); exit 0 }
[void][S4GestureClose]::PostMessageW([IntPtr]$Hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
Start-Sleep -Milliseconds 500
[Console]::Out.WriteLine(([ordered]@{ ok = -not [S4GestureClose]::IsWindow([IntPtr]$Hwnd) } | ConvertTo-Json -Compress))
`, 'utf8')

function closeWindow(w) {
  if (!w) return false
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', CLOSE,
      '-Hwnd', String(w.window_id), '-TargetPid', String(w.pid)], { encoding: 'utf8', timeout: 10000, windowsHide: true })
    const line = out.trim().split(/\r?\n/).filter(Boolean).pop()
    return JSON.parse(line)?.ok === true
  } catch { return false }
}

async function findWindow(ms = 15000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const v = await cuaCall('list_windows', { on_screen_only: true })
    const w = (v.windows || []).find((x) => String(x.title || '').includes(TITLE))
    if (w) return w
    await sleep(250)
  }
  return null
}

function readEvents() {
  if (!existsSync(MARK)) return []
  return readFileSync(MARK, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => {
    const clean = line.replace(/^\uFEFF/, '')
    const [phase, modifiers, pos, buttons] = clean.split('|')
    return { phase, modifiers, pos, buttons }
  })
}

function makeSnapshot(w, state) {
  const b = state?.window?.bounds || w.bounds || {}
  return {
    at: Date.now(), ttlMs: 60000,
    pid: Number(w.pid), windowId: Number(w.window_id), appName: 'powershell', title: w.title,
    coordinateSpace: 'window-screenshot-px',
    screenOrigin: { x: Number(b.x), y: Number(b.y), width: Number(b.width), height: Number(b.height) },
    snapshotId: `gesture-${Date.now()}`, entries: new Map(),
    screenshotWidth: Number(state?.screenshot_width) || Number(b.width),
    screenshotHeight: Number(state?.screenshot_height) || Number(b.height),
    mode: 'ax', maxElements: 0,
  }
}

async function runGesture({ w, state, start, engine }) {
  try { rmSync(MARK, { force: true }) } catch { /* ignore */ }
  setSnapshot(makeSnapshot(w, state))
  const args = {
    from_x: start.x, from_y: start.y, to_x: start.x + 150, to_y: start.y + 70,
    steps: 24, duration_ms: 700, modifier: ['ctrl'],
  }
  if (engine === 'private') args.dwell_ms = 1
  const receipt = await drag(args, {
    ttlMs: 60000, deliveryMode: 'auto', maxElements: 0,
    xamlKeyFallback: 'off', xamlPressFallback: 'off',
    supersession: 'note', verboseReceipts: false, dragEngine: 'auto',
  })
  clearSnapshot()
  await sleep(400)
  const events = readEvents()
  const down = events.find((e) => e.phase === 'down')
  const move = events.find((e) => e.phase === 'move')
  const up = events.find((e) => e.phase === 'up')
  const held = Boolean(down && up
    && /Control/.test(down.modifiers) && /Control/.test(up.modifiers))
  const moved = Boolean(move && /Control/.test(move.modifiers))
  const routeOk = receipt?.engine === (engine === 'private' ? 'private_sendinput' : 'driver_native')
  // Private SendInput must produce a real move sequence; driver-native drag is
  // allowed to deliver only down/up on this driver, but that is recorded as
  // BLOCKED (not silently promoted to a full gesture).
  const ok = receipt?.ok === true && held && routeOk && moved
  const status = ok ? 'PASS' : (engine === 'native' && held && routeOk && !moved ? 'BLOCKED' : 'FAIL')
  return {
    engine, ok, status,
    receipt: String(receipt?.result || '').slice(0, 220),
    route: receipt?.engine || null,
    events: { down: down || null, move: move || null, up: up || null, count: events.length },
    raw: existsSync(MARK) ? readFileSync(MARK, 'utf8').slice(0, 500) : '',
    held, moved,
  }
}

let w = null
let child = null
let failed = 0
let blocked = 0
try {
  await cuaCall('start_session', { session: CUA_SESSION }).catch(() => undefined)
  child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS1, '-Marker', MARK], {
    env: { ...process.env, TEMP, TMP: TEMP },
    stdio: 'ignore',
    windowsHide: false,
  })
  w = await findWindow()
  if (!w) throw new Error('gesture fixture window not found')
  const state = await cuaCall('get_window_state', {
    pid: w.pid, window_id: w.window_id, include_screenshot: false, max_elements: 80,
  })
  const btn = (state?.elements || []).find((e) => String(e.label || '').includes('GESTURE-TARGET')
    && e.frame && Number(e.frame.w) > 100)
  if (!btn) throw new Error('GESTURE-TARGET UIA frame not found')
  const b = state?.window?.bounds || w.bounds || {}
  const start = {
    x: Math.round(Number(btn.frame.x) + Number(btn.frame.w) / 2 - Number(b.x)),
    y: Math.round(Number(btn.frame.y) + Number(btn.frame.h) / 2 - Number(b.y)),
  }
  console.log(`gesture target: window=${JSON.stringify(b)} frame=${JSON.stringify(btn.frame)} start=${JSON.stringify(start)}`)
  const caps = await cuaDriverCapabilities().catch(() => null)
  console.log(`driver caps: ${capabilitySummary(caps)}`)
  const results = []
  results.push(await runGesture({ w, state, start, engine: 'private' }))
  if (caps?.dragModifier === true) results.push(await runGesture({ w, state, start, engine: 'native' }))
  else {
    console.log('⛔ native drag: driver reports dragModifier=false')
    blocked++
  }
  for (const r of results) {
    const icon = r.status === 'PASS' ? '✅' : r.status === 'BLOCKED' ? '⛔' : '❌'
    console.log(`${icon} ${r.engine}: status=${r.status} route=${r.route} held=${r.held} moved=${r.moved} events=${JSON.stringify(r.events)}`)
    console.log(`   receipt: ${r.receipt}`)
    if (r.status === 'FAIL') failed++
    if (r.status === 'BLOCKED') blocked++
  }
} catch (e) {
  console.error(`❌ gesture truth probe failed: ${e?.message || e}`)
  failed++
} finally {
  if (w) closeWindow(w)
  try { child?.kill() } catch { /* ignore */ }
  stopPrivateDrag()
  clearSnapshot()
  try { rmSync(work, { recursive: true, force: true }) } catch { /* ignore */ }
}
console.log(`\ngesture truth: failed=${failed} blocked=${blocked}`)
process.exit(failed ? 1 : (strict && blocked ? 2 : 0))
