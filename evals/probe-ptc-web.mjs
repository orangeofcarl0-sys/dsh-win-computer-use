/**
 * probe-ptc-web.mjs -- live Web PTC dogfood (not part of npm package).
 *
 * Starts a temporary Web profile with this working tree linked, a disposable WPF
 * fixture, and drives a PTC session through four compact run_code phases:
 *   A capabilities/discovery, B input/effect, C screenshot onImage + real scroll,
 *   D show/minimize/stop-resume/diagnostics.
 * Also checks that a Standard session does not see computer_cua.
 *
 * Safety: exact HWND/PID fixture cleanup, exact server PID stop, temp roots,
 * no process-name kills, no secrets printed, no repo writes.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, rmdirSync, existsSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DSH_BIN = process.env.DSH_BIN
  || join(process.env.APPDATA || '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const POWERSHELL = process.env.DSH_POWERSHELL || 'powershell.exe'
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const STAMP = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
const WORK = mkdtempSync(join(tmpdir(), 'dsh-ptc-web-'))
const PROFILE_NAME = `ptc-web-probe-${STAMP}`
const PROFILE_DIR = join(DSH_HOME, 'profiles', PROFILE_NAME)
const JUNCTION = join(PROFILE_DIR, 'node_modules', 'dsh-win-computer-use')
const TITLE = `S4-PTC-WEB-${STAMP}`
const FACADE = pathToFileURL(join(ROOT, 'lib', 'ptc', 'facade.js')).href
const COMMON = join(ROOT, 'evals', 'lib', 'common.ps1')

const checks = []
const fmt = (v) => typeof v === 'string' ? v : (() => { try { return JSON.stringify(v) } catch { return String(v) } })()
const check = (name, ok, detail) => checks.push({
  name,
  ok: Boolean(ok),
  detail: detail === undefined || detail === null ? '' : fmt(detail).slice(0, 500),
})
const report = { ok: false, checks, phases: {}, standard: {}, fixture: {}, server: {}, cleanup: {} }

function pathForYaml(p) {
  return JSON.stringify(String(p).replace(/\\/g, '/'))
}

function run(cmd, args, { timeoutMs = 120000, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, shell: false, env })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      try { child.kill() } catch {}
      reject(new Error(`${cmd} timeout after ${timeoutMs}ms`))
    }, timeoutMs)
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })
    child.on('error', (err) => { clearTimeout(timer); reject(err) })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

function parseJsonLine(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i]) } catch {}
  }
  throw new Error(`no JSON line in output: ${String(text).slice(0, 300)}`)
}

// ---------------------------------------------------------------------------
// WPF fixture
// ---------------------------------------------------------------------------
const fixtureApp = String.raw`param(
  [Parameter(Mandatory = $true)][string]$StateFile,
  [Parameter(Mandatory = $true)][string]$TitleFile
)
$ErrorActionPreference = 'Stop'
$Title = (Get-Content -LiteralPath $TitleFile -Raw).Trim()
if (-not $Title) { throw 'empty title file' }
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

$script:state = [ordered]@{
  ok = $true
  owned = $true
  pid = $PID
  hwnd = 0
  title = $Title
  processStart = (Get-Process -Id $PID).StartTime.ToString('o')
  at = (Get-Date).ToString('o')
  offset = 0.0
  horizontalOffset = 0.0
  extent = 0.0
  viewport = 0.0
  submitted = ''
  submitCount = 0
  minimized = $false
  windowState = 'Normal'
  events = [System.Collections.ArrayList]::new()
}
function Write-State {
  [IO.File]::WriteAllText($StateFile, ($script:state | ConvertTo-Json -Compress -Depth 6),
    (New-Object System.Text.UTF8Encoding($false)))
}

$app = New-Object System.Windows.Application
$win = New-Object System.Windows.Window
$win.Title = $Title
$win.Width = 720
$win.Height = 620
$win.Left = 320
$win.Top = 180

$root = New-Object System.Windows.Controls.StackPanel

$inputBox = New-Object System.Windows.Controls.TextBox
$inputBox.Width = 640
$inputBox.Height = 28
$inputBox.Text = 'SEED'
[System.Windows.Automation.AutomationProperties]::SetName($inputBox, 'Input')
[System.Windows.Automation.AutomationProperties]::SetAutomationId($inputBox, 'Input')

$buttons = New-Object System.Windows.Controls.StackPanel
$buttons.Orientation = 'Horizontal'
$submit = New-Object System.Windows.Controls.Button
$submit.Content = 'Submit'
$submit.Width = 120
$submit.Height = 30
[System.Windows.Automation.AutomationProperties]::SetName($submit, 'Submit')
[System.Windows.Automation.AutomationProperties]::SetAutomationId($submit, 'Submit')
$minimize = New-Object System.Windows.Controls.Button
$minimize.Content = 'Minimize'
$minimize.Width = 120
$minimize.Height = 30
$minimize.Margin = '12,0,0,0'
[System.Windows.Automation.AutomationProperties]::SetName($minimize, 'Minimize')
[System.Windows.Automation.AutomationProperties]::SetAutomationId($minimize, 'Minimize')
[void]$buttons.Children.Add($submit)
[void]$buttons.Children.Add($minimize)

$status = New-Object System.Windows.Controls.TextBox
$status.Width = 640
$status.Height = 28
$status.IsReadOnly = $true
$status.Text = 'READY'
[System.Windows.Automation.AutomationProperties]::SetName($status, 'Status')
[System.Windows.Automation.AutomationProperties]::SetAutomationId($status, 'Status')

$sv = New-Object System.Windows.Controls.ScrollViewer
$sv.Width = 660
$sv.Height = 420
$sv.VerticalScrollBarVisibility = 'Visible'
$sv.HorizontalScrollBarVisibility = 'Visible'
$sv.CanContentScroll = $false
[System.Windows.Automation.AutomationProperties]::SetName($sv, 'ScrollArea')
[System.Windows.Automation.AutomationProperties]::SetAutomationId($sv, 'ScrollArea')

$sp = New-Object System.Windows.Controls.StackPanel
$sp.Width = 2400
1..200 | ForEach-Object {
  $tb = New-Object System.Windows.Controls.TextBlock
  $tb.Text = "row $_"
  $tb.Height = 22
  $tb.Width = 2400
  [void]$sp.Children.Add($tb)
}
$sv.Content = $sp

[void]$root.Children.Add($inputBox)
[void]$root.Children.Add($buttons)
[void]$root.Children.Add($status)
[void]$root.Children.Add($sv)
$win.Content = $root

$submit.Add_Click({
  try {
    $script:state.submitted = 'SUBMITTED:' + $inputBox.Text
    $script:state.submitCount = [int]$script:state.submitCount + 1
    $status.Text = [string]$script:state.submitted
    Write-State
  } catch {}
})
$minimize.Add_Click({
  try {
    $win.WindowState = 'Minimized'
    $script:state.minimized = $true
    Write-State
  } catch {}
})
$sv.Add_ScrollChanged({
  param($s, $e)
  try {
    $script:state.offset = [double]$s.VerticalOffset
    $script:state.horizontalOffset = [double]$s.HorizontalOffset
    $script:state.extent = [double]$s.ExtentHeight
    $script:state.viewport = [double]$s.ViewportHeight
    [void]$script:state.events.Add([ordered]@{
      at = (Get-Date).ToString('o')
      offset = [double]$s.VerticalOffset
      hOffset = [double]$s.HorizontalOffset
      change = [double]$e.VerticalChange
      hChange = [double]$e.HorizontalChange
    })
    $status.Text = 'SCROLLED:' + [int]$s.VerticalOffset
    Write-State
  } catch {}
})
$win.Add_StateChanged({
  try {
    $script:state.windowState = [string]$win.WindowState
    $script:state.minimized = ($win.WindowState -eq 'Minimized')
    Write-State
  } catch {}
})
$win.Add_ContentRendered({
  try {
    $helper = [System.Windows.Interop.WindowInteropHelper]::new($win)
    $script:state.hwnd = [long]$helper.Handle
    $script:state.extent = [double]$sv.ExtentHeight
    $script:state.viewport = [double]$sv.ViewportHeight
    Write-State
  } catch {}
})

$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromSeconds(600)
$timer.Add_Tick({ $timer.Stop(); $win.Close() })
$timer.Start()

[void]$app.Run($win)
`

const startScript = String.raw`param(
  [Parameter(Mandatory = $true)][string]$StateFile,
  [Parameter(Mandatory = $true)][string]$AppScript,
  [Parameter(Mandatory = $true)][string]$TitleFile
)
$ErrorActionPreference = 'Stop'
$proc = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', $AppScript, '-StateFile', $StateFile, '-TitleFile', $TitleFile) -PassThru
for ($i = 0; $i -lt 100; $i++) {
  if (Test-Path -LiteralPath $StateFile) {
    Start-Sleep -Milliseconds 250
    try {
      $s = Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json
      if ($s.hwnd -and $s.pid) {
        $s | ConvertTo-Json -Compress -Depth 6
        exit 0
      }
    } catch {}
  }
  Start-Sleep -Milliseconds 200
}
try {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($proc.Id)" -ErrorAction SilentlyContinue
  if ($p -and ([string]$p.CommandLine).Contains('fixture-app.ps1')) {
    Stop-Process -Id $proc.Id -Force
  }
} catch {}
"TIMEOUT pid=$($proc.Id)"
exit 3
`

const closeScript = String.raw`param(
  [Parameter(Mandatory = $true)][string]$TaskId,
  [Parameter(Mandatory = $true)][string]$StateFile
)
$ErrorActionPreference = 'Stop'
. '__COMMON__' -TaskId $TaskId
$r = Close-TestAppWindow -StateFile $StateFile
$r | ConvertTo-Json -Compress -Depth 8
if (-not $r.closed) { exit 4 }
`

const minimizeScript = String.raw`param(
  [Parameter(Mandatory = $true)][long]$Hwnd,
  [Parameter(Mandatory = $true)][int]$TargetPid
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class DshMiniNative {
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
}
"@
$h = [IntPtr]$Hwnd
if (-not [DshMiniNative]::IsWindow($h)) { '{"ok":false,"code":"window_not_found"}'; exit 0 }
$winPid = 0
[void][DshMiniNative]::GetWindowThreadProcessId($h, [ref]$winPid)
if ([int]$winPid -ne [int]$TargetPid) { '{"ok":false,"code":"pid_mismatch","winPid":' + [int]$winPid + '}'; exit 0 }
[void][DshMiniNative]::ShowWindow($h, 6)
Start-Sleep -Milliseconds 400
$iconic = [DshMiniNative]::IsIconic($h)
'{"ok":true,"iconic":' + $iconic.ToString().ToLower() + '}'
`

async function startFixture() {
  const appPath = join(WORK, 'fixture-app.ps1')
  const titlePath = join(WORK, 'title.txt')
  const statePath = join(WORK, 'fixture.json')
  const startPath = join(WORK, 'start.ps1')
  const closePath = join(WORK, 'close.ps1')
  const minimizePath = join(WORK, 'minimize.ps1')
  writeFileSync(appPath, fixtureApp, 'utf8')
  writeFileSync(titlePath, TITLE, 'utf8')
  writeFileSync(startPath, startScript, 'utf8')
  writeFileSync(closePath, closeScript.replace('__COMMON__', COMMON.replace(/\\/g, '/')), 'utf8')
  writeFileSync(minimizePath, minimizeScript, 'utf8')
  const r = await run(POWERSHELL, [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', startPath,
    '-StateFile', statePath, '-AppScript', appPath, '-TitleFile', titlePath,
  ], { timeoutMs: 40000 })
  if (r.code !== 0) throw new Error(`fixture start failed: ${r.stdout} ${r.stderr}`)
  const state = parseJsonLine(r.stdout)
  if (!state.hwnd || !state.pid) throw new Error(`fixture state missing hwnd/pid: ${JSON.stringify(state)}`)
  return {
    pid: Number(state.pid),
    hwnd: Number(state.hwnd),
    title: state.title,
    statePath,
    minimize: async () => {
      const m = await run(POWERSHELL, [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', minimizePath,
        '-Hwnd', String(state.hwnd), '-TargetPid', String(state.pid),
      ], { timeoutMs: 15000 })
      if (m.code !== 0) throw new Error(`minimize failed: ${m.stderr || m.stdout}`)
      return parseJsonLine(m.stdout || '{}')
    },
    close: async () => {
      const c = await run(POWERSHELL, [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', closePath,
        '-TaskId', `ptc-web-${STAMP}`, '-StateFile', statePath,
      ], { timeoutMs: 30000 })
      const out = parseJsonLine(c.stdout || '{}')
      return { code: c.code, ...out }
    },
  }
}

// ---------------------------------------------------------------------------
// Temporary Web profile
// ---------------------------------------------------------------------------
function writeProfile() {
  mkdirSync(join(PROFILE_DIR, 'node_modules'), { recursive: true })
  writeFileSync(join(PROFILE_DIR, 'package.json'), JSON.stringify({
    name: `dsh-profile-${PROFILE_NAME}`,
    private: true,
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-win-computer-use'] } },
  }, null, 2), 'utf8')
  writeFileSync(join(PROFILE_DIR, 'cordis.patch.yml'), '[]\n', 'utf8')
  writeFileSync(join(PROFILE_DIR, 'cordis.yml'), '[]\n', 'utf8')
  symlinkSync(ROOT, JUNCTION, 'junction')

  const sessions = join(WORK, 'web-sessions')
  const storages = join(WORK, 'web-storages')
  const home = join(WORK, 'web-home')
  mkdirSync(sessions, { recursive: true })
  mkdirSync(storages, { recursive: true })
  mkdirSync(home, { recursive: true })
  const overlay = [
    '- id: credentials',
    '  disabled: false',
    '',
    '- id: llm-pi-ai',
    '  config:',
    '    providers:',
    '      opencode-go:',
    '        displayName: OpenCode Go (PTC web probe)',
    '        apiKeyEnv: OPENCODE_GO_API_KEY',
    '        api: openai-completions',
    '        baseURL: https://opencode.ai/zen/go/v1',
    '        headers:',
    '          x-opencode-session: zcode-ptc-web-probe',
    '        retryPolicy:',
    '          mode: normal',
    '          maxRetries: 10',
    '        models:',
    '          - id: deepseek-v4.1-flash',
    '            name: DeepSeek V4.1 Flash (OpenCode)',
    '            contextWindow: 1000000',
    '            maxTokens: 128000',
    '            input:',
    '              - text',
    '              - image',
    '            reasoningEfforts:',
    '              low: low',
    '              high: high',
    '              max: max',
    '',
    '- id: agent-default-model',
    '  config:',
    '    provider: opencode-go',
    '    model: deepseek-v4.1-flash',
    '',
    '- id: agent-preset-registry',
    '  config:',
    '    default: standard',
    '    selectedDefault: ptc',
    '',
    '- id: session-persistence-jsonl',
    '  config:',
    `    root: ${pathForYaml(sessions)}`,
    '',
    '- id: storage-json',
    '  config:',
    `    root: ${pathForYaml(storages)}`,
    '',
    '- id: attachment-local',
    '  config:',
    `    dshHome: ${pathForYaml(home)}`,
    '',
    '- id: dsh-win-computer-use',
    '  config:',
    '    surfaceMode: dispatcher',
    '    ttlMs: 60000',
    '    maxElements: 300',
    '    passwordScan: off',
    '    deliveryMode: auto',
    '    observeDedup: off',
    "    ptcBridge: 'on'",
    '',
  ].join('\n')
  const overlayPath = join(WORK, 'ptc-web.patch.yml')
  writeFileSync(overlayPath, overlay, 'utf8')
  return overlayPath
}

async function auth(base, token) {
  const res = await fetch(`${base}/?token=${encodeURIComponent(token)}`, { redirect: 'manual' })
  const cookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')]
  const cookie = cookies.map((c) => String(c || '').split(';')[0]).filter(Boolean).join('; ')
  if (!cookie) throw new Error(`web auth failed (${res.status})`)
  return cookie
}

async function rpc(base, cookie, method, args = {}) {
  const res = await fetch(`${base}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload: { args } }),
  })
  const body = await res.json()
  if (!body?.result?.ok) throw new Error(`${method} failed: ${JSON.stringify(body?.result?.error || body).slice(0, 600)}`)
  return body.result.value
}

async function startWeb(overlayPath) {
  const child = spawn(process.execPath, [
    DSH_BIN,
    '--profile', PROFILE_NAME,
    '--patch', overlayPath,
    '--no-open',
    '--port', '0',
  ], {
    cwd: ROOT,
    env: { ...process.env, DSH_PERMISSION_MODE: 'read-only' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (d) => { stdout += d })
  child.stderr.on('data', (d) => { stderr += d })
  const deadline = Date.now() + 90000
  let line = ''
  while (Date.now() < deadline) {
    line = String(stdout).split(/\r?\n/).find((l) => /dsh web: http/.test(l)) || ''
    if (line) break
    await new Promise((r) => setTimeout(r, 250))
  }
  if (!line) throw new Error(`web server did not print URL: ${stderr.slice(0, 600)}`)
  const url = new URL(line.slice(line.indexOf('http')))
  const base = url.origin
  const token = url.searchParams.get('token')
  const cookie = await auth(base, token)
  return {
    child,
    base,
    cookie,
    close: async () => {
      try { child.kill() } catch {}
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 5000)
        child.once('close', () => { clearTimeout(timer); resolve() })
      })
    },
  }
}

async function waitIdle(base, cookie, sessionId) {
  let waited
  for (let i = 0; i < 40; i++) {
    waited = await rpc(base, cookie, 'session/wait', {
      request: { sessionId, timeoutMs: 20000, afterSeq: -1, maxMessages: 30 },
    })
    if (waited.reason !== 'timeout') break
  }
  return waited
}

async function eventsOf(base, cookie, sessionId) {
  const page = await rpc(base, cookie, 'session/events', {
    request: { address: { kind: 'session', sessionId }, maxMessages: 2000 },
  })
  return (page.records || []).map((r) => r.event).filter(Boolean)
}

function toolNames(events) {
  return events.filter((e) => e.type === 'request/header').at(-1)?.data?.header?.tools?.map((t) => t.name) || []
}

function parseRunResult(events, nonce) {
  const calls = events.filter((e) => e.type === 'tool/call' && e.data?.name === 'run_code')
  const call = calls.find((e) => String(e.data?.arguments || '').includes(nonce))
  if (!call) return { error: `no run_code call for ${nonce}` }
  const callId = call.data.callId
  const result = events.find((e) => e.type === 'tool/result'
    && (e.data?.message?.toolCallId === callId || e.data?.message?.source?.callId === callId))
  if (!result) return { error: `no tool_result for ${nonce}` }
  const text = (result.data?.message?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n')
  try { writeFileSync(join(WORK, `phase-${nonce}.result.txt`), text, 'utf8') } catch {}
  if (/tool result middle pruned|Full formatted result stored at:/.test(text)) {
    return { error: 'tool result pruned/spilled', text: text.slice(0, 300) }
  }
  const start = text.indexOf('{')
  if (start < 0) return { error: 'no JSON object in result', text: text.slice(0, 300) }
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') { inStr = true; continue }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        try { return { value: JSON.parse(text.slice(start, i + 1)), text } } catch (e) {
          return { error: `result parse failed: ${e.message}`, text: text.slice(0, 300) }
        }
      }
    }
  }
  return { error: 'result JSON incomplete', text: text.slice(0, 300) }
}

function dispatchNames(events) {
  return events.filter((e) => e.type === 'tool/ptc-dispatch').map((e) => e.data?.name).filter(Boolean)
}

// ---------------------------------------------------------------------------
// PTC program phases
// ---------------------------------------------------------------------------
const prelude = String.raw`
const PID = __PID__;
const HWND = __HWND__;
const TITLE = __TITLE__;
const FACADE = __FACADE__;
const NONCE = __NONCE__;
const { connectCua } = await import(FACADE);
const cua = connectCua(() => tools.computer_cua, { onText: () => {}, onImage: (img) => { globalThis.__ptcImage = { pixelWidth: img.pixelWidth, pixelHeight: img.pixelHeight, bytes: img.bytes.length, mimeType: img.mimeType }; } });
function treeInfo(tree) {
  const sid = (String(tree).match(/快照\s+([A-Za-z0-9_-]+)/) || [])[1] || '';
  const lineOf = (label) => String(tree).split(/\r?\n/).find((l) => l.indexOf('"' + label + '"') >= 0) || '';
  const idOf = (label) => { const l = lineOf(label); const m = String(l).match(/^\[(\d+)\]/); return sid && m ? sid + ':' + m[1] : ''; };
  const pointOf = (label) => { const l = lineOf(label); const m = String(l).match(/@\((\d+),(\d+)\)/); return m ? { x: Number(m[1]), y: Number(m[2]) } : null; };
  return { sid, input: idOf('Input'), submit: idOf('Submit'), minimize: idOf('Minimize'), status: idOf('Status'), scroll: idOf('ScrollArea'), scrollPoint: pointOf('ScrollArea'), minimizePoint: pointOf('Minimize'), line: lineOf('ScrollArea') };
}
async function ctx() {
  const app = await cua.getApp(String(PID));
  const wins = await app.getWindows({ emit: false });
  const win = await app.getWindow(HWND);
  const tree = await win.getAccessibilityTree({ emit: false, maxElements: 300 });
  return { app, wins, win, tree, ids: treeInfo(tree) };
}
`

function buildCode(phase, pid, hwnd, title, nonce) {
  return prelude
    .replace('__PID__', String(pid))
    .replace('__HWND__', String(hwnd))
    .replace('__TITLE__', JSON.stringify(title))
    .replace('__FACADE__', JSON.stringify(FACADE))
    .replace('__NONCE__', JSON.stringify(nonce))
    + `\nconst checks = [];\nconst fmt = (v) => typeof v === 'string' ? v : (() => { try { return JSON.stringify(v); } catch { return String(v); } })();\nconst ck = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail: detail === undefined || detail === null ? '' : fmt(detail).slice(0, 300) });\n`
    + phaseBody(phase)
    + `\nconst failed = checks.filter((c) => !c.ok);\nreturn JSON.stringify({ phase: ${JSON.stringify(phase)}, nonce: NONCE, ok: failed.length === 0, checks });\n`
}

function phaseBody(phase) {
  if (phase === 'A') {
    return String.raw`
const status = await tools.computer_do({ action: 'status' });
const catalog = await tools.computer_do({ action: 'catalog' });
const caps = await cua.getCapabilities({ emit: false });
const { app, wins, win, tree, ids } = await ctx();
ck('status PTC on', /PTC：on/.test(String(status && status.result)), status && status.result);
ck('catalog no computer_cua', Array.isArray(catalog && catalog.tools) && catalog.tools.length === 21 && !catalog.tools.includes('computer_cua'), catalog && catalog.tools);
ck('caps win32 methods', caps.platform === 'win32' && ['screenshot','show','scroll','performAction'].every((m) => caps.methods.includes(m)), caps && caps.methods);
ck('cap driver modern', caps.driver && caps.driver.profile !== 'unknown', caps && caps.driver);
ck('app/window', app.appHandle === 'pid:' + PID && Number(win.windowId) === HWND, { app: app.appHandle, win: win.windowId });
ck('window title', (wins || []).some((w) => Number(w.windowId) === HWND && String(w.title).includes(TITLE)), wins);
ck('tree controls', Boolean(ids.sid && ids.input && ids.submit && ids.minimize && ids.status && ids.scroll), ids);
`
  }
  if (phase === 'B') {
    return String.raw`
const { win, ids } = await ctx();
let set = null;
try { set = await win.setValue(ids.input, 'WEB-ALPHA'); } catch (e) { ck('setValue', false, e && e.message); }
ck('setValue dispatched', set && set.dispatched === true, set);
let act = null;
try { act = await win.performAction(ids.input, 'ValuePattern.SetValue', 'WEB-BRAVO'); } catch (e) { ck('performAction', false, { code: e && e.code, details: e && e.details }); }
ck('performAction value', act && act.dispatched === true, act);
try { await win.click(ids.input); } catch {}
let typed = null;
try { typed = await win.typeText('WEB-CHARLIE'); } catch (e) { ck('typeText', false, e && e.message); }
ck('typeText dispatched', typed && typed.dispatched === true, typed);
let inv = null;
try { inv = await win.invoke(ids.submit); } catch (e) { ck('invoke', false, e && e.message); }
ck('invoke dispatched', inv && inv.dispatched === true, inv);
await new Promise((r) => setTimeout(r, 400));
const after = await ctx();
const statusLine = String(after.tree).split(/\r?\n/).find((l) => /SUBMITTED:/.test(l)) || '';
ck('submit effect', /SUBMITTED:/.test(after.tree), statusLine || String(after.tree).slice(0, 200));
`
  }
  if (phase === 'C') {
    return String.raw`
const { win, ids } = await ctx();
ck('scroll target', Boolean(ids.scroll && ids.scrollPoint), ids);
let shot = null;
try { shot = await win.getScreenshot({ emit: true }); } catch (e) { ck('screenshot', false, { code: e && e.code, message: e && e.message }); }
ck('screenshot bytes', shot && shot.bytes instanceof Uint8Array && shot.bytes.length > 0 && shot.pixelWidth > 0 && shot.pixelHeight > 0, shot && { w: shot.pixelWidth, h: shot.pixelHeight, bytes: shot.bytes.length });
ck('onImage called', Boolean(globalThis.__ptcImage && globalThis.__ptcImage.bytes > 0), globalThis.__ptcImage);
const p = ids.scrollPoint;
const down = await win.scroll({ x: p.x, y: p.y, deltaLinesY: -5 });
ck('scroll down moved', down.dispatched === true && down.moved === true && down.percentAfter.v > down.percentBefore.v && down.axisMoved.v === true, down);
const up = await win.scroll({ x: p.x, y: p.y, deltaLinesY: 5 });
ck('scroll up moved', up.dispatched === true && up.moved === true && up.percentAfter.v < up.percentBefore.v, up);
let top = null;
try { await win.scroll({ x: p.x, y: p.y, deltaLinesY: 1 }); top = { ok: true }; } catch (e) { top = { code: e && e.code, message: String(e && e.message), details: e && e.details }; }
ck('scroll at top rejected', top.code === 'OPERATION_FAILED' && (top.details?.code === 'scroll_no_effect' || /scroll_no_effect/.test(top.message)), top);
const multi = await win.scroll({ x: p.x, y: p.y, deltaLinesX: -1, deltaLinesY: -5 });
ck('scroll multi-axis', multi.dispatched === true && multi.moved === true && multi.axisMoved.h === true && multi.axisMoved.v === true && multi.attempted === 6, multi);
`
  }
  return String.raw`
const app = await cua.getApp(String(PID));
const win = await app.getWindow(HWND);
let shown = null;
try { shown = await win.show(); } catch (e) { ck('show from minimized', false, { code: e && e.code, message: e && e.message }); }
if (shown) ck('show from minimized', shown.dispatched === true && Number(shown.windowId) === HWND, shown);
await new Promise((r) => setTimeout(r, 500));
const after = await ctx();
ck('restored tree', Boolean(after.ids.input && after.ids.submit), after.ids);
const win2 = after.win;
const ids = after.ids;
try { await win2.selectText(ids.input, 'x'); ck('selectText diagnostic', false, 'no error'); } catch (e) { ck('selectText diagnostic', e && e.code === 'CAPABILITY_UNAVAILABLE', { code: e && e.code }); }
try { await win2.paste('x'); ck('paste diagnostic', false, 'no error'); } catch (e) { ck('paste diagnostic', e && e.code === 'CAPABILITY_UNAVAILABLE', { code: e && e.code }); }
try { await win2.click([1, 1], { holdMs: 1 }); ck('holdMs option', false, 'no error'); } catch (e) { ck('holdMs option', e && e.code === 'CAPABILITY_OPTION_UNAVAILABLE', { code: e && e.code }); }
const stop = await tools.computer_do({ action: 'call', tool: 'computer_stop', args: {} });
ck('stop', stop && stop.ok === true, stop);
let locked = false;
try { await cua.getCapabilities({ emit: false }); } catch (e) { locked = e && e.code === 'OPERATION_LOCKED'; }
ck('locked after stop', locked);
const resume = await tools.computer_do({ action: 'call', tool: 'computer_resume', args: {} });
ck('resume', resume && resume.ok === true, resume);
const caps2 = await cua.getCapabilities({ emit: false });
ck('resumed', caps2 && caps2.platform === 'win32', caps2 && caps2.platform);
`
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
let fixture = null
let web = null
let profileCreated = false
try {
  if (!existsSync(DSH_BIN)) throw new Error(`dsh bin not found: ${DSH_BIN}`)
  if (!existsSync(COMMON)) throw new Error(`common.ps1 not found: ${COMMON}`)

  fixture = await startFixture()
  report.fixture.identity = { pid: fixture.pid, hwnd: fixture.hwnd, title: fixture.title }

  const overlay = writeProfile()
  profileCreated = true
  web = await startWeb(overlay)
  report.server.base = web.base

  const presets = await rpc(web.base, web.cookie, 'agentPresets/list', {})
  check('agentPresets ptc/standard', Array.isArray(presets?.presets)
    && presets.presets.some((p) => p.id === 'ptc') && presets.presets.some((p) => p.id === 'standard'), presets)

  // Standard negative control.
  const std = await rpc(web.base, web.cookie, 'session/create', {
    request: { cwd: join(WORK, 'work-standard'), agentPreset: 'standard' },
  })
  await rpc(web.base, web.cookie, 'session/prompt', {
    request: { requestId: randomUUID(), sessionId: std.sessionId, mode: 'queue', content: [{ type: 'text', text: 'Reply with exactly: STANDARD-OK' }] },
  })
  const stdWait = await waitIdle(web.base, web.cookie, std.sessionId)
  const stdEvents = await eventsOf(web.base, web.cookie, std.sessionId)
  const stdTools = toolNames(stdEvents)
  report.standard = { agentPreset: std.agentPreset, tools: stdTools, wait: stdWait.reason }
  check('Standard preset', std.agentPreset === 'standard', std)
  check('Standard no computer_cua', !stdTools.includes('computer_cua'), stdTools)
  check('Standard no run_code', !stdTools.includes('run_code'), stdTools)
  check('Standard has computer_do/screen_observe', stdTools.includes('computer_do') && stdTools.includes('screen_observe'), stdTools)

  // PTC session.
  const ptc = await rpc(web.base, web.cookie, 'session/create', {
    request: { cwd: join(WORK, 'work-ptc'), agentPreset: 'ptc' },
  })
  check('PTC preset', ptc.agentPreset === 'ptc', ptc)
  const ptcEventsAll = []
  for (const phase of ['A', 'B', 'C', 'D']) {
    if (phase === 'D') {
      const mini = await fixture.minimize()
      report.fixture.minimized = mini
      check('fixture minimized exact HWND', mini.ok === true && mini.iconic === true, mini)
    }
    const nonce = `PTC-WEB-${phase}-${STAMP}`
    const code = buildCode(phase, fixture.pid, fixture.hwnd, fixture.title, nonce)
    const prompt = [
      'Call the run_code tool exactly once with the exact code below, verbatim. Do not edit the code.',
      'Do not call any other tool. After run_code returns, reply with the returned JSON.',
      '',
      '```js',
      code,
      '```',
    ].join('\n')
    await rpc(web.base, web.cookie, 'session/prompt', {
      request: { requestId: randomUUID(), sessionId: ptc.sessionId, mode: 'queue', content: [{ type: 'text', text: prompt }] },
    })
    const waited = await waitIdle(web.base, web.cookie, ptc.sessionId)
    const events = await eventsOf(web.base, web.cookie, ptc.sessionId)
    ptcEventsAll.push(...events)
    const parsed = parseRunResult(events, nonce)
    report.phases[phase] = { wait: waited.reason, parsed: parsed.error ? { error: parsed.error, text: parsed.text } : parsed.value }
    check(`phase ${phase} run_code result`, !parsed.error && parsed.value?.ok === true, parsed.error || JSON.stringify(parsed.value).slice(0, 400))
  }

  const ptcTools = toolNames(ptcEventsAll)
  check('PTC header run_code', ptcTools.includes('run_code'), ptcTools)
  const dispatches = dispatchNames(ptcEventsAll)
  check('PTC dispatches computer_cua', dispatches.includes('computer_cua'), dispatches)
  check('PTC dispatches computer_do', dispatches.includes('computer_do'), dispatches)
  check('PTC no write/edit/bash', !dispatches.some((n) => ['write', 'edit', 'bash', 'pwsh'].includes(n)), dispatches)
  const images = ptcEventsAll.filter((e) => e.type === 'user/message'
    && e.data?.source?.kind === 'ptc-mode'
    && (e.data?.content || []).some((b) => b.type === 'image'))
  check('PTC image context', images.length >= 1, images.length)
  const screenshotDispatch = ptcEventsAll.find((e) => e.type === 'tool/ptc-dispatch'
    && e.data?.name === 'computer_cua'
    && e.data?.arguments?.method === 'screenshot')
  check('PTC screenshot dispatch image', Boolean(screenshotDispatch)
    && !screenshotDispatch.data.isError
    && (screenshotDispatch.data.content || []).some((b) => b.type === 'image'), screenshotDispatch && screenshotDispatch.data?.content)
  const ptcState = await rpc(web.base, web.cookie, 'session/state', { request: { sessionId: ptc.sessionId } })
  check('PTC pendingInput empty', Array.isArray(ptcState?.pendingInput) && ptcState.pendingInput.length === 0, ptcState)
  check('PTC no approval/asked', !ptcEventsAll.some((e) => /^(approval\/asked|question|user-question)/.test(String(e.type || ''))), '')

  // Fixture-side oracle.
  const fstate = JSON.parse(readFileSync(fixture.statePath, 'utf8'))
  report.fixture.state = {
    submitted: fstate.submitted, submitCount: fstate.submitCount,
    offset: fstate.offset, horizontalOffset: fstate.horizontalOffset,
    events: Array.isArray(fstate.events) ? fstate.events.length : 0,
    windowState: fstate.windowState,
  }
  check('fixture submit effect', String(fstate.submitted || '').startsWith('SUBMITTED:') && Number(fstate.submitCount) >= 1, report.fixture.state)
  check('fixture scroll effect', Number(fstate.offset) > 0 && Number(fstate.horizontalOffset) > 0, report.fixture.state)
  check('fixture scroll events', Array.isArray(fstate.events) && fstate.events.length >= 2, report.fixture.state)
} catch (error) {
  check('probe execution', false, error && error.message)
  report.error = String(error && error.message)
} finally {
  if (fixture) {
    try {
      const closed = await fixture.close()
      report.cleanup.fixture = closed
      check('fixture closed exact HWND', closed.closed === true, closed)
    } catch (e) {
      report.cleanup.fixture = { error: String(e && e.message) }
      check('fixture closed exact HWND', false, e && e.message)
    }
  }
  if (web) {
    try {
      await web.close()
      report.cleanup.server = 'stopped'
      check('web server stopped', true)
    } catch (e) {
      report.cleanup.server = String(e && e.message)
      check('web server stopped', false, e && e.message)
    }
  }
  if (profileCreated) {
    try {
      if (existsSync(JUNCTION)) rmdirSync(JUNCTION)
      if (existsSync(PROFILE_DIR)) rmSync(PROFILE_DIR, { recursive: true, force: true })
      report.cleanup.profile = 'removed'
      check('temp profile removed', !existsSync(PROFILE_DIR))
    } catch (e) {
      report.cleanup.profile = String(e && e.message)
      check('temp profile removed', false, e && e.message)
    }
  }
  report.ok = checks.every((c) => c.ok)
  const out = join(WORK, 'report.json')
  writeFileSync(out, JSON.stringify(report, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: report.ok, checks: checks.length, failed: checks.filter((c) => !c.ok).length, report: out }, null, 2))
  for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? ' — ' + c.detail : ''}`)
  process.exit(report.ok ? 0 : 1)
}
