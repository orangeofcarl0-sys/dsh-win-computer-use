#!/usr/bin/env node
/**
 * probe-cross-il.mjs — UIPI / integrity-level evidence.
 *
 * --no-uac (default): read-only current/driver/target integrity + classifier
 *   checks. It never creates an elevated window.
 *
 * --uac (one UAC consent): starts a test-owned elevated WinForms message sink,
 *   then uses the Medium plugin helper to probe it and attempt one B0 postMouse.
 *   It records whether the helper classifies the target as uipi and whether the
 *   click lands. The sink self-closes via a stop file; no process-name kill.
 *
 * UAC cancellation/timeout is BLOCKED, never PASS. Secure desktop remains out
 * of scope (not automatable by this design).
 *
 * Run: node evals/probe-cross-il.mjs [--uac] [--strict-blocked]
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { createBackgroundInputClient, classifyTarget } from '../lib/backgroundInput.js'

const TEMP = process.env.S4_TEMP || (process.platform === 'win32'
  ? join(homedir(), 'AppData', 'Local', 'Temp')
  : tmpdir())
const work = mkdtempSync(join(TEMP, 's4-cross-il-'))
const integrity = join(work, 'integrity.ps1')
const sink = join(work, 'sink.ps1')
const launch = join(work, 'launch.ps1')
const stateFile = join(work, 'sink-state.json')
const stopFile = join(work, 'stop.txt')
const wantUac = process.argv.includes('--uac')
const strict = process.argv.includes('--strict-blocked')
const sleep = (ms) => delay(ms)

writeFileSync(integrity, `param([int]$TargetPid)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class S4CrossTok {
  [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("advapi32.dll", SetLastError = true)] public static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError = true)] public static extern bool GetTokenInformation(IntPtr token, int cls, IntPtr buf, int len, out int ret);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool ConvertSidToStringSidW(IntPtr sid, out IntPtr str);
  [DllImport("kernel32.dll")] public static extern IntPtr LocalFree(IntPtr h);
}
'@
$p = [S4CrossTok]::OpenProcess(0x1000, $false, $TargetPid)
if ($p -eq [IntPtr]::Zero) { '{"ok":false,"error":"OpenProcess failed"}'; exit 0 }
$tok = [IntPtr]::Zero
try {
  if (-not [S4CrossTok]::OpenProcessToken($p, 0x0008, [ref]$tok)) { '{"ok":false,"error":"OpenProcessToken failed"}'; exit 0 }
  $len = 0
  [void][S4CrossTok]::GetTokenInformation($tok, 25, [IntPtr]::Zero, 0, [ref]$len)
  if ($len -le 0) { '{"ok":false,"error":"GetTokenInformation size failed"}'; exit 0 }
  $buf = [Runtime.InteropServices.Marshal]::AllocHGlobal($len)
  try {
    if (-not [S4CrossTok]::GetTokenInformation($tok, 25, $buf, $len, [ref]$len)) { '{"ok":false,"error":"GetTokenInformation failed"}'; exit 0 }
    $sidPtr = [Runtime.InteropServices.Marshal]::ReadIntPtr($buf)
    $str = [IntPtr]::Zero
    if (-not [S4CrossTok]::ConvertSidToStringSidW($sidPtr, [ref]$str)) { '{"ok":false,"error":"ConvertSidToStringSidW failed"}'; exit 0 }
    $sid = [Runtime.InteropServices.Marshal]::PtrToStringUni($str)
    [void][S4CrossTok]::LocalFree($str)
    $rid = 0
    try { $rid = [int]($sid.Split('-')[-1]) } catch {}
    ('{"ok":true,"sid":"' + $sid + '","rid":' + $rid + '}')
  } finally { [Runtime.InteropServices.Marshal]::FreeHGlobal($buf) }
} finally {
  if ($tok -ne [IntPtr]::Zero) { [void][S4CrossTok]::CloseHandle($tok) }
  [void][S4CrossTok]::CloseHandle($p)
}
`, 'utf8')

writeFileSync(sink, `param([string]$StateFile, [string]$StopFile)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
function Write-State($s) {
  [IO.File]::WriteAllText($StateFile, ($s | ConvertTo-Json -Compress), (New-Object System.Text.UTF8Encoding($false)))
}
$script:state = [ordered]@{ ok = $true; pid = [int]$PID; hwnd = 0; events = 0; closed = $false }
$form = New-Object System.Windows.Forms.Form
$form.Text = 'S4-CROSS-IL-SINK'
$form.Width = 420
$form.Height = 220
$form.StartPosition = 'Manual'
$form.Left = 300
$form.Top = 220
$panel = New-Object System.Windows.Forms.Panel
$panel.Left = 10
$panel.Top = 10
$panel.Width = 380
$panel.Height = 140
$panel.BackColor = [System.Drawing.Color]::White
$panel.Add_MouseDown({ $script:state.events = [int]$script:state.events + 1; Write-State $script:state })
$form.Controls.Add($panel)
$form.Add_Shown({
  $script:state.hwnd = [int]$form.Handle
  $script:state.pid = [int]$PID
  Write-State $script:state
})
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 200
$timer.Add_Tick({
  if (Test-Path -LiteralPath $StopFile) {
    $timer.Stop()
    $script:state.closed = $true
    Write-State $script:state
    $form.Close()
  }
})
$timer.Start()
$auto = New-Object System.Windows.Forms.Timer
$auto.Interval = 60000
$auto.Add_Tick({ $auto.Stop(); $form.Close() })
$auto.Start()
[System.Windows.Forms.Application]::Run($form)
`, 'utf8')

writeFileSync(launch, `param([string]$Sink, [string]$StateFile, [string]$StopFile)
$args = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $Sink, '-StateFile', $StateFile, '-StopFile', $StopFile)
$p = Start-Process -FilePath 'powershell.exe' -ArgumentList $args -Verb RunAs -PassThru -WindowStyle Hidden
[Console]::Out.WriteLine($p.Id)
`, 'utf8')

function runIntegrity(pid) {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', integrity,
      '-TargetPid', String(pid)], { encoding: 'utf8', timeout: 15000, windowsHide: true })
    return JSON.parse(out.trim().split(/\r?\n/).filter(Boolean).pop())
  } catch { return null }
}

function readState() {
  try { return JSON.parse(readFileSync(stateFile, 'utf8')) } catch { return null }
}

const checks = []
function record(name, status, detail = '') {
  checks.push({ name, status, detail })
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⛔'
  console.log(`${icon} ${name}${detail ? ' — ' + detail : ''}`)
}

const me = runIntegrity(process.pid)
record('current process integrity', me?.ok ? 'PASS' : 'BLOCKED', JSON.stringify(me))
const classifier = classifyTarget({
  snap: { backend: 'ax', entries: new Map(), elementCount: 0, titleBarRect: null },
  profile: { integrityRank: 2, currentIntegrityRank: 1, sameSession: true, secureDesktop: false, visible: true, iconic: false },
})
record('classifier high IL -> uipi', classifier === 'uipi' ? 'PASS' : 'FAIL', classifier)
if (classifier !== 'uipi') process.exitCode = 1

let sinkPid = 0
let client = null
let failed = 0
let blocked = 0
try {
  if (!wantUac) {
    record('cross-IL real probe', 'BLOCKED', '--no-uac: read-only only; pass --uac for one test-owned elevated sink')
    blocked++
  } else {
    let launched = null
    try {
      launched = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launch,
        '-Sink', sink, '-StateFile', stateFile, '-StopFile', stopFile], { encoding: 'utf8', timeout: 120000, windowsHide: true })
      sinkPid = Number(String(launched).trim().match(/\d+/)?.[0] || 0)
    } catch (e) {
      record('UAC elevated sink launch', 'BLOCKED', String(e?.stderr || e?.message || e).slice(0, 300))
      blocked++
    }
    let state = null
    for (let i = 0; i < 60 && !state; i++) {
      state = readState()
      if (!state) await sleep(250)
    }
    if (!state?.hwnd) {
      record('elevated sink state', 'BLOCKED', 'UAC canceled/timeout or sink did not start')
      blocked++
    } else {
      sinkPid = Number(state.pid) || sinkPid
      const sinkIntegrity = runIntegrity(sinkPid)
      record('elevated sink integrity', sinkIntegrity?.rid >= 12288 ? 'PASS' : 'BLOCKED',
        JSON.stringify(sinkIntegrity))
      client = createBackgroundInputClient()
      const profile = await client.probe({ hwnd: Number(state.hwnd), pid: Number(state.pid) }).catch((e) => ({ error: String(e?.message || e) }))
      record('helper probe sink', profile?.integrityRank === 2 && profile?.currentIntegrityRank === 1 ? 'PASS' : 'BLOCKED',
        JSON.stringify(profile))
      const highSnap = { backend: 'ax', entries: new Map(), elementCount: 0, titleBarRect: null, appName: 'powershell' }
      const cls = classifyTarget({ snap: highSnap, profile })
      record('plugin classifies sink as uipi', cls === 'uipi' ? 'PASS' : 'FAIL', cls)
      const post = await client.postMouse({ hwnd: Number(state.hwnd), pid: Number(state.pid), x: 40, y: 40, button: 'left', count: 1 }).catch((e) => ({ ok: false, error: String(e?.message || e), code: e?.code }))
      await sleep(800)
      const after = readState()
      const refused = post?.ok === false && /uipi|higher|secure|integrity|denied/i.test(JSON.stringify(post))
      const delivered = Number(after?.events || 0) > 0
      record('medium helper -> high target', refused && !delivered ? 'PASS' : (delivered ? 'FAIL' : 'BLOCKED'),
        `post=${JSON.stringify(post)} events=${after?.events ?? 'n/a'}`)
      if (delivered) failed++
      else if (!refused) blocked++
      try { writeFileSync(stopFile, 'stop', 'utf8') } catch { /* ignore */ }
      for (let i = 0; i < 20; i++) {
        const s = readState()
        if (s?.closed) break
        await sleep(200)
      }
      record('sink self-close', readState()?.closed === true ? 'PASS' : 'BLOCKED',
        `state=${JSON.stringify(readState())}`)
    }
  }
} catch (e) {
  console.error(`❌ cross-IL probe failed: ${e?.message || e}`)
  failed++
} finally {
  try { client?.stop?.() } catch { /* ignore */ }
  try { writeFileSync(stopFile, 'stop', 'utf8') } catch { /* ignore */ }
  try { rmSync(work, { recursive: true, force: true }) } catch { /* ignore */ }
}

const pass = checks.filter((c) => c.status === 'PASS').length
const blocks = checks.filter((c) => c.status === 'BLOCKED').length || blocked
console.log(`\nprobe-cross-il: ${pass} PASS / ${blocks} BLOCKED / ${failed} FAIL${sinkPid ? ` (sink pid ${sinkPid})` : ''}`)
process.exit(failed ? 1 : (strict && blocks ? 2 : 0))
