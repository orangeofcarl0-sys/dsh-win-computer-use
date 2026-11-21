#!/usr/bin/env node
/**
 * probe-common-dialogs.mjs — 原生后端对 WinForms 常见对话框的只读探针。
 *
 * 目标：补 MessageBox 之外的 Open/Save/Font/Color/Print 证据。
 * 只验证 `scanNativeDialog` / `clickNativeDialog` 这条后端链路；插件
 * `screen_observe` 的集成路径已由 probe-native-dialog 的 MessageBox 场景覆盖。
 *
 * 每个对话框：
 *   WinForms fixture 原生 BM_CLICK 触发（不用 UIA click，避免 30s 阻塞）
 *   → 枚举同 pid 标准 #32770
 *   → scanNativeDialog 读按钮/modal 证明
 *   → clickNativeDialog(Cancel) BM_CLICK
 *   → 检查对话框关闭 + fixture state cancelled
 *
 * 不写仓库文件；只按本探针精确 HWND/PID 清理。300s 自关 Timer 兜底。
 *
 * Run: node evals/probe-common-dialogs.mjs [--strict-blocked]
 */
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { scanNativeDialog, clickNativeDialog } from '../lib/nativeDialogs.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const strict = process.argv.includes('--strict-blocked')
const work = mkdtempSync(join(tmpdir(), 's4-common-dialogs-'))
const appPath = join(work, 'common-dialogs-app.ps1')
const helperPath = join(work, 'common-dialogs-helper.ps1')
const resultPath = join(work, 'state.json')
const TITLE = 'S4-COMMON-DIALOGS'
console.log('common dialogs probe workdir:', work)

const app = `param([string]$ResultFile)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
function Write-State($s) {
  [IO.File]::WriteAllText($ResultFile, ($s | ConvertTo-Json -Compress), (New-Object System.Text.UTF8Encoding($false)))
}
$script:state = [ordered]@{ opened = 0; closed = 0; lastKind = ''; lastResult = ''; lastError = ''; at = '' }
Write-State $script:state
$script:form = New-Object System.Windows.Forms.Form
$script:form.Text = '${TITLE}'
$script:form.Width = 360
$script:form.Height = 360
$script:form.StartPosition = 'Manual'
$script:form.Left = 340
$script:form.Top = 280
function Show-CommonDialog([string]$Kind) {
  $script:state.opened = [int]$script:state.opened + 1
  $script:state.lastKind = $Kind
  $script:state.lastResult = ''
  $script:state.lastError = ''
  Write-State $script:state
  $r = [System.Windows.Forms.DialogResult]::None
  try {
    switch ($Kind) {
      'open' {
        $d = New-Object System.Windows.Forms.OpenFileDialog
        $d.Title = 'S4-COMMON-OPEN'
        $d.CheckFileExists = $false
        $d.ValidateNames = $false
        $r = $d.ShowDialog($script:form)
      }
      'save' {
        $d = New-Object System.Windows.Forms.SaveFileDialog
        $d.Title = 'S4-COMMON-SAVE'
        $d.OverwritePrompt = $false
        $d.FileName = 's4-common-save.txt'
        $r = $d.ShowDialog($script:form)
      }
      'font' {
        $d = New-Object System.Windows.Forms.FontDialog
        $d.ShowColor = $true
        $r = $d.ShowDialog($script:form)
      }
      'color' {
        $d = New-Object System.Windows.Forms.ColorDialog
        $r = $d.ShowDialog($script:form)
      }
      'print' {
        $count = 0
        try { $count = [System.Drawing.Printing.PrinterSettings]::InstalledPrinters.Count } catch { $count = 0 }
        if ($count -eq 0) {
          $script:state.lastError = 'no_printers'
          $script:state.closed = [int]$script:state.closed + 1
          $script:state.at = (Get-Date).ToUniversalTime().ToString('o')
          Write-State $script:state
          return
        }
        $d = New-Object System.Windows.Forms.PrintDialog
        $d.UseEXDialog = $false
        $r = $d.ShowDialog($script:form)
      }
      default { throw ('unknown kind: ' + $Kind) }
    }
    $script:state.lastResult = [string]$r
  } catch {
    $script:state.lastError = [string]$_.Exception.Message
  }
  $script:state.closed = [int]$script:state.closed + 1
  $script:state.at = (Get-Date).ToUniversalTime().ToString('o')
  Write-State $script:state
}
$specs = @(
  @{ Text = 'Open'; Kind = 'open' },
  @{ Text = 'Save'; Kind = 'save' },
  @{ Text = 'Font'; Kind = 'font' },
  @{ Text = 'Color'; Kind = 'color' },
  @{ Text = 'Print'; Kind = 'print' }
)
$top = 18
foreach ($spec in $specs) {
  $b = New-Object System.Windows.Forms.Button
  $b.Text = [string]$spec.Text
  $b.Tag = [string]$spec.Kind
  $b.Left = 24
  $b.Top = $top
  $b.Width = 120
  $b.Height = 40
  $b.Add_Click({ Show-CommonDialog ([string]$this.Tag) })
  $script:form.Controls.Add($b)
  $top = $top + 50
}
$auto = New-Object System.Windows.Forms.Timer
$auto.Interval = 300000
$auto.Add_Tick({ $auto.Stop(); $script:form.Close() })
$auto.Start()
[System.Windows.Forms.Application]::Run($script:form)
`
writeFileSync(appPath, app, 'utf8')

const helper = `param(
  [Parameter(Mandatory = $true)][ValidateSet('find', 'trigger', 'close')][string]$Action,
  [int]$TargetPid = 0,
  [long]$Hwnd = 0,
  [string]$Label = ''
)
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class S4CommonDlg {
  public delegate bool EnumProc(IntPtr h, IntPtr lp);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr lp);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr h, uint msg, IntPtr w, IntPtr l);
}
'@
function Get-Class([IntPtr]$h) {
  $sb = New-Object System.Text.StringBuilder 256
  [void][S4CommonDlg]::GetClassNameW($h, $sb, $sb.Capacity)
  return $sb.ToString()
}
function Get-Text([IntPtr]$h) {
  $sb = New-Object System.Text.StringBuilder 512
  [void][S4CommonDlg]::GetWindowTextW($h, $sb, $sb.Capacity)
  return $sb.ToString()
}
function Get-PidOf([IntPtr]$h) {
  [uint32]$p = 0
  [void][S4CommonDlg]::GetWindowThreadProcessId($h, [ref]$p)
  return [int]$p
}
if ($Action -eq 'find') {
  $items = @()
  $cb = [S4CommonDlg+EnumProc]{
    param($h, $lp)
    if ([S4CommonDlg]::IsWindowVisible($h) -and (Get-PidOf $h) -eq $TargetPid) {
      $script:items += [ordered]@{ hwnd = $h.ToInt64(); title = (Get-Text $h); className = (Get-Class $h) }
    }
    return $true
  }
  $script:items = @()
  [void][S4CommonDlg]::EnumWindows($cb, [IntPtr]::Zero)
  [Console]::Out.WriteLine((ConvertTo-Json @($script:items) -Compress -Depth 4))
  exit 0
}
if ($Action -eq 'trigger') {
  $script:found = [IntPtr]::Zero
  $cb = [S4CommonDlg+EnumProc]{
    param($h, $lp)
    if ((Get-Class $h) -like '*BUTTON*' -and (Get-Text $h) -eq $Label) { $script:found = $h }
    return $true
  }
  [void][S4CommonDlg]::EnumChildWindows([IntPtr]$Hwnd, $cb, [IntPtr]::Zero)
  if ($script:found -eq [IntPtr]::Zero) {
    [Console]::Out.WriteLine('{"ok":false,"error":"button_not_found"}')
    exit 0
  }
  $posted = [S4CommonDlg]::PostMessageW($script:found, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
  [Console]::Out.WriteLine((ConvertTo-Json ([ordered]@{ ok = [bool]$posted; hwnd = $script:found.ToInt64() }) -Compress))
  exit 0
}
if ($Action -eq 'close') {
  if ((Get-PidOf ([IntPtr]$Hwnd)) -ne $TargetPid) {
    [Console]::Out.WriteLine('{"ok":false,"error":"pid_mismatch"}')
    exit 0
  }
  [void][S4CommonDlg]::PostMessageW([IntPtr]$Hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 400
  [Console]::Out.WriteLine('{"ok":true}')
  exit 0
}
`
writeFileSync(helperPath, helper, 'utf8')

function runHelper(action, extra = []) {
  const r = execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', helperPath, '-Action', action, ...extra,
  ], { encoding: 'utf8', timeout: 15000, windowsHide: true })
  const line = r.trim().split(/\r?\n/).filter(Boolean).pop()
  return line ? JSON.parse(line) : null
}

function readState() {
  try { return JSON.parse(readFileSync(resultPath, 'utf8')) } catch { return null }
}

function listWindows(pid) {
  const j = runHelper('find', ['-TargetPid', String(pid)])
  return Array.isArray(j) ? j : (j ? [j] : [])
}

async function waitFor(predicate, ms = 10000, step = 150) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const v = await predicate()
    if (v) return v
    await delay(step)
  }
  return null
}

function normalizeLabel(label) {
  return String(label || '').replace(/&/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function cancelButton(buttons) {
  return (buttons || []).find((b) => Number(b.id) === 2
    || /^(cancel|取消|キャンセル)$/i.test(normalizeLabel(b.label)))
}

const checks = []
function record(name, status, detail = '') {
  checks.push({ name, status, detail })
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⛔'
  console.log(`${icon} ${name}${detail ? ' — ' + detail : ''}`)
}

let child = null
let mainHwnd = 0
let probePid = 0
let dirty = false
try {
  child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', appPath, '-ResultFile', resultPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  })
  let childErr = ''
  child.stderr.on('data', (d) => { childErr += d })
  const main = await waitFor(async () => {
    const found = listWindows(Number(child.pid))
    return found.find((w) => String(w.title || '').includes(TITLE)) || null
  }, 25000)
  if (!main) throw new Error(`fixture window not found; pid=${child.pid} stderr=${childErr.slice(0, 300)}`)
  mainHwnd = Number(main.hwnd)
  probePid = Number(child.pid)
  record('fixture window', 'PASS', `pid=${probePid} hwnd=${mainHwnd}`)

  const kinds = [
    { kind: 'open', label: 'Open' },
    { kind: 'save', label: 'Save' },
    { kind: 'font', label: 'Font' },
    { kind: 'color', label: 'Color' },
    { kind: 'print', label: 'Print' },
  ]

  for (const { kind, label } of kinds) {
    const before = readState() || { opened: 0, closed: 0 }
    const trigger = runHelper('trigger', ['-TargetPid', String(probePid), '-Hwnd', String(mainHwnd), '-Label', label])
    if (!trigger?.ok) {
      record(`${kind}: trigger`, 'FAIL', JSON.stringify(trigger))
      continue
    }
    const dialog = await waitFor(async () => {
      const wins = listWindows(probePid)
      return wins.find((w) => String(w.className || '') === '#32770'
        && Number(w.hwnd) !== mainHwnd) || null
    }, 12000)
    if (!dialog) {
      const st = readState()
      const status = st?.lastError ? 'BLOCKED' : 'FAIL'
      record(`${kind}: dialog`, status, `state=${JSON.stringify(st)}`)
      continue
    }
    const scan = await scanNativeDialog({ pid: probePid, hwnd: Number(dialog.hwnd), timeoutMs: 4000 })
    if (!scan) {
      record(`${kind}: scan`, 'BLOCKED', `class=${dialog.className} title=${dialog.title}`)
      runHelper('close', ['-TargetPid', String(probePid), '-Hwnd', String(dialog.hwnd)])
      continue
    }
    const btn = cancelButton(scan.buttons)
    const base = `class=${scan.className} title=${scan.title} modal=${scan.modal} proof=${scan.modalProof} buttons=${scan.buttons.map((b) => b.label).join('|')}`
    if (!scan.modal || !btn) {
      record(`${kind}: scan`, 'BLOCKED', base)
      runHelper('close', ['-TargetPid', String(probePid), '-Hwnd', String(dialog.hwnd)])
      continue
    }
    const click = await clickNativeDialog({
      pid: probePid, hwnd: Number(dialog.hwnd),
      controlId: Number(btn.id), className: btn.className, label: btn.label, timeoutMs: 4000,
    })
    const gone = await waitFor(async () => !listWindows(probePid).some((w) => String(w.className || '') === '#32770'
      && Number(w.hwnd) === Number(dialog.hwnd)), 5000, 100)
    await delay(350)
    const after = readState() || {}
    const ok = click.ok && gone
      && Number(after.closed) === Number(before.closed) + 1
      && /cancel/i.test(String(after.lastResult || ''))
    record(`${kind}: cancel`, ok ? 'PASS' : 'FAIL',
      `click=${JSON.stringify(click)} gone=${Boolean(gone)} result=${after.lastResult} error=${after.lastError} ${base}`)
  }
} catch (e) {
  console.error('❌ probe aborted:', e?.stack || e)
  process.exitCode = 1
} finally {
  try {
    if (probePid && mainHwnd) {
      const dialogs = listWindows(probePid).filter((w) => String(w.className || '') === '#32770')
      for (const d of dialogs) runHelper('close', ['-TargetPid', String(probePid), '-Hwnd', String(d.hwnd)])
      runHelper('close', ['-TargetPid', String(probePid), '-Hwnd', String(mainHwnd)])
    }
  } catch { /* 清理失败不覆盖主结果 */ }
  await delay(500)
  if (child && child.exitCode === null) {
    const alive = listWindows(probePid).some((w) => Number(w.hwnd) === mainHwnd)
    if (alive) {
      dirty = true
      console.log('⛔ fixture window still alive; left for 300s self-close timer (no process-name kill)')
    }
  }
  try { rmSync(work, { recursive: true, force: true }) } catch { /* 进程仍持有时保留临时目录 */ }
}

const pass = checks.filter((c) => c.status === 'PASS').length
const blocked = checks.filter((c) => c.status === 'BLOCKED').length
const failed = checks.filter((c) => c.status === 'FAIL').length
console.log(`\nprobe-common-dialogs: ${pass} PASS / ${blocked} BLOCKED / ${failed} FAIL${dirty ? ' / DIRTY' : ''}`)
process.exit(failed || dirty ? 1 : (strict && blocked ? 2 : 0))
