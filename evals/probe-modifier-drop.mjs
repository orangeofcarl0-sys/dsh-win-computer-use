/**
 * probe-modifier-drop.mjs — real Explorer modifier-drop probe (no model).
 *
 * Proves at runtime:
 *   1. Explorer Ctrl+drag from a file to a folder copies it (source survives).
 *   2. a plain drag of the same file to the same folder moves it.
 *   3. the Ctrl modifier is released after the drop (GetAsyncKeyState + receipt).
 *
 * The sandbox is a fresh temp directory; only the test-owned Explorer HWND is
 * closed. User Explorer windows and user files are never touched.
 *
 * Optional --excel branch: opens a temp copy of the t14 fixture and tries a
 * cell Ctrl+drag. It is opt-in because Excel/UIA cell geometry is environment
 * dependent; a failure there is reported as BLOCKED/ENV, never as PASS.
 *
 * Classification: PASS / LEFT_OVER / BLOCKED / FAIL; exit 1 only on FAIL.
 *
 * Run: node evals/probe-modifier-drop.mjs [--excel]
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync, readFileSync, existsSync, rmSync, mkdtempSync, mkdirSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 's4-drag-'))
const skipExplorer = process.argv.includes('--excel-only')
const sandbox = join(work, 'sandbox')
const destDir = join(sandbox, 'dest')
mkdirSync(sandbox, { recursive: true })
mkdirSync(destDir, { recursive: true })
const payload = `S4-DRAG-${Date.now()}`
writeFileSync(join(sandbox, 'payload.txt'), payload + '\n', 'utf8')
const leaf = basename(sandbox)

const helperPath = join(work, 'explorer-state.ps1')
const keyPath = join(work, 'keystate.ps1')
const commonPath = join(root, 'evals', 'lib', 'common.ps1').replace(/'/g, "''")
writeFileSync(helperPath, `param([string]$Action, [string]$Path, [string]$TitleNeedle, [string]$StateFile)
. '${commonPath}'
if ($Action -eq 'open') {
  $r = Open-TestExplorer -Path $Path -TitleNeedle @($TitleNeedle) -StateFile $StateFile
} elseif ($Action -eq 'close') {
  $r = Close-TestExplorer -StateFile $StateFile
} else {
  $r = [ordered]@{ ok = $false; reason = 'unknown action' }
}
$r | ConvertTo-Json -Compress
`, 'utf8')
writeFileSync(keyPath, `Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class S4Key {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
}
'@
$s = [S4Key]::GetAsyncKeyState(0x11)
if (($s -band 0x8000) -ne 0) { '1' } else { '0' }
`, 'utf8')

const commonEsc = join(root, 'evals', 'lib', 'common.ps1').replace(/'/g, "''")
const officeEsc = join(root, 'evals', 'lib', 'office.ps1').replace(/'/g, "''")
const excelGeomEsc = join(root, 'evals', 'lib', 'excel-geometry.ps1').replace(/'/g, "''")
// Separate temp dir: the Explorer cleanup removes `work` before the Excel branch.
const excelWork = mkdtempSync(join(tmpdir(), 's4-excel-'))
const excelHelperPath = join(excelWork, 'excel-helper.ps1')
writeFileSync(excelHelperPath, `param([string]$Action, [string]$Path, [string]$Payload, [string]$StateFile, [int]$Hwnd)
. '${commonEsc}'
. '${officeEsc}'
. '${excelGeomEsc}'
$r = switch ($Action) {
  'find' { Find-S4ExcelExe }
  'make' { New-S4DragWorkbook -Path $Path -Payload $Payload }
  'unblock' {
    try { Unblock-File -LiteralPath $Path; [ordered]@{ ok = $true } }
    catch { [ordered]@{ ok = $false; reason = $_.Exception.Message } }
  }
  'open' {
    $found = Find-S4ExcelExe
    if (-not $found.ok) { $found }
    else {
      Open-TestAppWindow -Exe $found.exe -Arguments @($Path) -ProcessName 'EXCEL' -TitleNeedle @([IO.Path]::GetFileNameWithoutExtension($Path)) -StateFile $StateFile -TimeoutSec 30
    }
  }
  'close' { Close-TestAppWindow -StateFile $StateFile }
  'force-close' {
    $s = Read-TestState $StateFile
    if (-not $s -or -not $s.owned) { [ordered]@{ ok = $false; reason = 'not task-owned' } }
    else {
      $cmd = ''
      try { $cmd = [string](Get-CimInstance Win32_Process -Filter ('ProcessId=' + [int]$s.pid) -ErrorAction Stop).CommandLine } catch { }
      if ($cmd -and ($cmd.IndexOf([string]$Path, [StringComparison]::OrdinalIgnoreCase) -ge 0)) {
        try { Stop-Process -Id ([int]$s.pid) -Force; [ordered]@{ ok = $true; reason = 'terminated test-owned pid' } }
        catch { [ordered]@{ ok = $false; reason = $_.Exception.Message } }
      } else {
        [ordered]@{ ok = $false; reason = 'pid/command-line mismatch (refusing to kill)' }
      }
    }
  }
  'geometry' { Get-S4ExcelCellPoints -Path $Path -Hwnd $Hwnd }
  'cells' { Get-S4XlsxCells -Path $Path }
  default { [ordered]@{ ok = $false; reason = 'unknown action' } }
}
$r | ConvertTo-Json -Compress -Depth 8
`, 'utf8')

const mod = await import(pathToFileURL(join(root, 'index.js')).href)
const plugin = mod.default
const services = {
  attachments: { imageLimits: { maxImageBytes: 5e6, maxImagePixels: 4e7, maxImagesPerMessage: 20, maxMessageImageBytes: 1e8, mediaTypes: ['image/png'] }, async saveImage(i) { return { attachmentId: 'x', mediaType: i.mediaType, bytes: i.data.byteLength, width: 1, height: 1, name: i.name } }, async validateImage() {}, async readImage() { return { data: new Uint8Array([1]) } } },
  llm: { async resolveModelInfo(p, m) { return { provider: p, id: m, inputModalities: ['text', 'image'] } }, async * stream() { throw new Error('stub') } },
  approval: { async request() { return 'allowed-once' } },
}
const registered = new Map()
const ctx = { get: (n) => services[n], logger: { info() {}, error() {} }, tools: { register(d) { registered.set(d.name, d); return () => registered.delete(d.name) } }, toolsRuntime: null }
plugin.apply(ctx, { ttlMs: 60000, maxElements: 400, deliveryMode: 'auto', nativeImage: 'auto', passwordScan: 'off' })
const defs = new Map(mod.toolDefinitions().map((d) => [d.name, d]))
const agent = { options: { provider: 'p', model: 'm' }, session: { requestHeader: () => ({ config: { provider: 'p', model: 'm' } }) } }
async function call(name, args = {}) {
  const def = defs.get(name)
  if (!def) throw new Error('tool not defined: ' + name)
  const exec = { agent, signal: new AbortController().signal, get signalSet() { return true } }
  return await def.execute(args, exec)
}

const checks = []
function record(name, status, detail = '') {
  checks.push({ name, status, detail })
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : status === 'LEFT_OVER' ? '⚠️' : '⛔'
  console.log(`${icon} ${name}${detail ? ' — ' + detail : ''}`)
}
const pass = (name, ok, detail = '') => record(name, ok ? 'PASS' : 'FAIL', detail)
const blocked = (name, detail = '') => record(name, 'BLOCKED', detail)

function runPs(script, args = [], opts = {}) {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], { encoding: 'utf8', timeout: opts.timeout || 30000, windowsHide: true })
    return String(out).trim()
  } catch (err) {
    return String(err?.stdout || '').trim()
  }
}
function jsonLine(text) {
  const line = text.split(/\r?\n/).filter((l) => l.trim().startsWith('{')).pop()
  try { return line ? JSON.parse(line) : null } catch { return null }
}
const stateFile = join(work, 'explorer.json')
function openExplorer() { return jsonLine(runPs(helperPath, ['open', sandbox, leaf, stateFile])) }
function closeExplorer() { return jsonLine(runPs(helperPath, ['close', '', '', stateFile])) }
const ctrlDown = () => runPs(keyPath) === '1'

async function waitFile(p, ms = 6000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (existsSync(p)) return true
    await delay(300)
  }
  return false
}

function findItem(els, re) {
  const matches = els.filter((e) => re.test(String(e.label || '')) || re.test(String(e.name || '')) || re.test(String(e.value || '')))
  return matches.find((e) => !/树项|tree item/i.test(String(e.role || ''))) || matches[0]
}

let hwnd = 0
try {
  if (skipExplorer) throw Object.assign(new Error('skip explorer'), { skip: true })
  const opened = openExplorer()
  if (!opened?.ok) {
    blocked('explorer window opened', `reason=${opened?.reason || 'unknown'}`)
    throw new Error('no explorer')
  }
  hwnd = Number(opened.hwnd)
  pass('explorer window opened', hwnd > 0, `hwnd=${hwnd} title=${opened.title}`)

  const obs = await call('screen_observe', { window_id: hwnd, mode: 'native' })
  const els = obs?.elements || []
  const src = findItem(els, /^payload(\.txt)?$/i)
  const dst = findItem(els, /^dest$/i)
  if (!src || !dst) {
    console.log('explorer elements:', JSON.stringify(els.map((e) => ({ i: e.index, r: e.role, l: e.label, x: e.x, y: e.y })).slice(0, 60)))
    console.log('matching items:', JSON.stringify(els.filter((e) => /payload|dest/i.test(String(e.label || ''))).map((e) => ({ i: e.index, r: e.role, l: e.label, x: e.x, y: e.y }))))
    blocked('payload and dest visible', `payload=${Boolean(src)} dest=${Boolean(dst)} elements=${els.length}`)
    throw new Error('items missing')
  }
  pass('payload and dest visible', true, `src=${src.x},${src.y} dst=${dst.x},${dst.y}`)

  // 1) Ctrl+drag -> copy
  const copy = await call('computer_drag', {
    from_x: Number(src.x), from_y: Number(src.y), to_x: Number(dst.x), to_y: Number(dst.y),
    modifier: ['ctrl'], steps: 30, duration_ms: 800, dwell_ms: 400,
  })
  const copiedPath = join(destDir, 'payload.txt')
  const copied = await waitFile(copiedPath)
  const srcStill = existsSync(join(sandbox, 'payload.txt'))
  const copiedText = copied ? readFileSync(copiedPath, 'utf8').trim() : ''
  pass('ctrl+drag copied file', copy?.ok === true && copied && srcStill && copiedText === payload,
    `ok=${copy?.ok} copied=${copied} srcStill=${srcStill} text=${copiedText === payload} result=${String(copy?.result || '').slice(0, 90)}`)

  // 2) modifier released
  await delay(300)
  const stuckKey = ctrlDown()
  const stuckReceipt = /未释放|stuck/i.test(String(copy?.result || ''))
  pass('ctrl modifier released after drop', !stuckKey && !stuckReceipt, `keyDown=${stuckKey} receiptStuck=${stuckReceipt}`)

  // 3) plain drag -> move (reopen Explorer so the view is fresh)
  const closed = closeExplorer()
  if (!closed?.closed) record('explorer close before move', 'LEFT_OVER', `reason=${closed?.reason || 'unknown'}`)
  if (copied) rmSync(copiedPath, { force: true })
  const reopened = openExplorer()
  if (!reopened?.ok) {
    blocked('explorer reopened for move', `reason=${reopened?.reason || 'unknown'}`)
    throw new Error('reopen failed')
  }
  hwnd = Number(reopened.hwnd)
  let obs2 = null
  let els2 = []
  let src2 = null
  let dst2 = null
  for (let i = 0; i < 6; i += 1) {
    obs2 = await call('screen_observe', { window_id: hwnd, mode: 'native' })
    els2 = obs2?.elements || []
    src2 = findItem(els2, /^payload(\.txt)?$/i)
    dst2 = findItem(els2, /^dest$/i)
    if (src2 && dst2) break
    await delay(500)
  }
  if (!src2 || !dst2) {
    blocked('move targets visible', `payload=${Boolean(src2)} dest=${Boolean(dst2)}`)
    throw new Error('move targets missing')
  }
  const move = await call('computer_drag', {
    from_x: Number(src2.x), from_y: Number(src2.y), to_x: Number(dst2.x), to_y: Number(dst2.y),
    steps: 30, duration_ms: 800, dwell_ms: 400,
  })
  const moved = await waitFile(copiedPath)
  const srcGone = !existsSync(join(sandbox, 'payload.txt'))
  pass('plain drag moved file', move?.ok === true && moved && srcGone,
    `ok=${move?.ok} moved=${moved} srcGone=${srcGone} result=${String(move?.result || '').slice(0, 90)}`)
} catch (err) {
  if (!err?.skip && !['no explorer', 'items missing', 'reopen failed', 'move targets missing'].includes(String(err?.message || err))) {
    pass('probe completed', false, String(err.message || err))
  }
} finally {
  const closed = closeExplorer()
  if (!closed?.closed) {
    console.log(`⚠️ explorer close not confirmed: ${closed?.reason || 'unknown'}`)
  }
  if (!process.env.S4_KEEP) { try { rmSync(work, { recursive: true, force: true }) } catch {} }
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function findCell(els, name) {
  const re = new RegExp(`^${escapeRe(name)}$`, 'i')
  return els.find((e) => re.test(String(e.label || '')) || re.test(String(e.name || '')) || re.test(String(e.value || '')))
}

// Excel UIA exposes cells as DataItem labels like `"A" 2` (localized quotes
// included); accept both `"A" 2` and `A2`/`A 2` shapes.
function findCellByAddress(els, address) {
  const m = /^([A-Z]+)([0-9]+)$/i.exec(String(address || ''))
  if (!m) return null
  const re = new RegExp(`^"?${m[1]}"?[\\s]*${m[2]}$`, 'i')
  return els.find((e) => re.test(String(e.label || '').trim()) || re.test(String(e.name || '').trim()))
}

async function runExcel() {
  const excelState = join(excelWork, 'excel-state.json')
  const xlsx = join(excelWork, 'drag-grid.xlsx')
  const found = jsonLine(runPs(excelHelperPath, ['find', '', '', '', '0']))
  if (!found?.ok) {
    blocked('Excel installed', found?.reason || 'EXCEL.EXE not found')
    return
  }
  pass('Excel installed', true, found.exe)

  const made = jsonLine(runPs(excelHelperPath, ['make', xlsx, payload, '', '0'], { timeout: 60000 }))
  if (!made?.ok) {
    blocked('Excel 测试工作簿创建', made?.reason || 'Excel COM create failed')
    return
  }
  pass('Excel 测试工作簿创建', true, xlsx)
  runPs(excelHelperPath, ['unblock', xlsx, '', '', '0'])

  const opened = jsonLine(runPs(excelHelperPath, ['open', xlsx, '', excelState, '0'], { timeout: 60000 }))
  if (!opened?.ok || !Number(opened.hwnd)) {
    blocked('Excel 窗口打开', opened?.reason || 'no new Excel HWND')
    return
  }
  const hwnd = Number(opened.hwnd)
  pass('Excel 窗口打开', hwnd > 0, `hwnd=${hwnd} title=${opened.title || ''} pid=${opened.pid || 0}`)

  try {
    await call('computer_activate', { window_id: hwnd })
    let obs = null
    let els = []
    for (let i = 0; i < 10; i += 1) {
      obs = await call('screen_observe', { window_id: hwnd, mode: 'native' })
      els = obs?.elements || []
      if (els.length > 0) break
      await delay(500)
    }
    let a2 = findCellByAddress(els, 'A2') || findCell(els, 'A2')
    let e2 = findCellByAddress(els, 'E2') || findCell(els, 'E2')
    let b2 = findCellByAddress(els, 'B2') || findCell(els, 'B2')
    let a3 = findCellByAddress(els, 'A3') || findCell(els, 'A3')
    let usedUia = Boolean(a2?.x !== undefined && a2?.y !== undefined && e2?.x !== undefined && e2?.y !== undefined)
    let geom = null
    if (!usedUia) {
      geom = jsonLine(runPs(excelHelperPath, ['geometry', xlsx, '', '', String(hwnd)], { timeout: 30000 }))
      if (geom?.ok && geom.points?.A2 && geom.points?.E2) {
        a2 = geom.points.A2
        e2 = geom.points.E2
        usedUia = false
      }
    }
    if (!a2 || !e2) {
      const interesting = els.filter((e) => /DataItem|Cell|Grid|Table|S4-DRAG|^[A-Z]+[0-9]+$/i.test(`${e.role} ${e.label} ${e.name} ${e.value}`))
      console.log('excel cell candidates:', JSON.stringify(interesting.slice(0, 80).map((e) => ({
        i: e.index, r: e.role, l: e.label, n: e.name, v: e.value, x: e.x, y: e.y,
      }))))
      blocked('Excel A2/E2 几何', `uia=${usedUia} geom=${JSON.stringify(geom)} elements=${els.length}`)
      return
    }
    if (!usedUia && geom?.window) {
      const w = geom.window
      const inside = (p) => p.x >= w.left - 2 && p.x <= w.right + 2 && p.y >= w.top - 2 && p.y <= w.bottom + 2
      if (!inside(a2) || !inside(e2)) {
        blocked('Excel A2/E2 几何', `COM 坐标落在窗口外 window=${JSON.stringify(w)} A2=${JSON.stringify(a2)} E2=${JSON.stringify(e2)}`)
        return
      }
    }
    const org = obs?.screenOrigin
    if (!usedUia && (!org || !Number.isFinite(Number(org.x)))) {
      blocked('Excel 坐标原点', 'screen_observe 未返回 screenOrigin，无法把 COM 屏幕坐标换成窗口坐标')
      return
    }
    if (usedUia && a2.index !== undefined) {
      // Excel starts a move/copy only from the border of a selected cell. Select
      // A2 first, then re-observe so the drag uses a fresh snapshot.
      const selected = await call('computer_click', { element: Number(a2.index) })
      pass('Excel A2 选中', selected?.ok === true, `ok=${selected?.ok} result=${String(selected?.result || '').slice(0, 120)}`)
      await delay(300)
      const obsSel = await call('screen_observe', { window_id: hwnd, mode: 'native' })
      const selEls = obsSel?.elements || []
      a2 = findCellByAddress(selEls, 'A2') || a2
      e2 = findCellByAddress(selEls, 'E2') || e2
      b2 = findCellByAddress(selEls, 'B2') || b2
      a3 = findCellByAddress(selEls, 'A3') || a3
    }
    const from = usedUia ? { x: Number(a2.x), y: Number(a2.y) } : { x: Number(a2.x) - Number(org.x), y: Number(a2.y) - Number(org.y) }
    const to = usedUia ? { x: Number(e2.x), y: Number(e2.y) } : { x: Number(e2.x) - Number(org.x), y: Number(e2.y) - Number(org.y) }
    if (usedUia) {
      // Excel only starts a cell move/copy when the drag begins on the cell
      // border, not in the middle (middle = range selection). Use the A/B
      // border; fall back to half a standard column when B2 is not exposed.
      const b2x = Number(b2?.x)
      // One pixel inside the right border of A2 (the border hit zone is narrow;
      // the exact midpoint can land on B2's side or the gridline).
      from.x = Number.isFinite(b2x) ? Math.round((Number(a2.x) + b2x) / 2) - 1 : Number(a2.x) + 51
      from.y = Number(a2.y)
    }
    pass('Excel A2/E2 几何', true, `source=${usedUia ? 'uia' : 'com'} from=${JSON.stringify(from)} E2=${JSON.stringify(to)}`)

    // Let Excel see the pointer dwell on the cell border (4-way arrow) before
    // the drag; otherwise it may treat the gesture as a range selection.
    if (usedUia && org && Number.isFinite(Number(org.x))) {
      await call('computer_hover', { real: true, x: Number(org.x) + from.x, y: Number(org.y) + from.y })
      await delay(400)
    }

    const drag = await call('computer_drag', {
      from_x: from.x, from_y: from.y, to_x: to.x, to_y: to.y,
      modifier: ['ctrl'], steps: 30, duration_ms: 800,
    })
    pass('Excel ctrl+drag 投递', drag?.ok === true, `ok=${drag?.ok} result=${String(drag?.result || '').slice(0, 160)}`)
    await delay(1200)

    // The private drag restores the pre-drag foreground; bring Excel back before
    // Ctrl+S, otherwise the key is delivered to the terminal/other window.
    const activated = await call('computer_activate', { window_id: hwnd })
    console.log('excel activate after drag:', String(activated?.result || JSON.stringify(activated)).slice(0, 240))
    await delay(800)
    // Re-observe after the drag: settleAction consumed the previous snapshot.
    await call('screen_observe', { window_id: hwnd, mode: 'native' })
    const saved = await call('computer_key', { key: 'ctrl+s' })
    console.log('excel save result:', String(saved?.result || '').slice(0, 500))
    if (saved?.ok === true) {
      pass('Excel ctrl+s 保存', true, `result=${String(saved?.result || '').slice(0, 160)}`)
    } else if (/foreground_unavailable/.test(String(saved?.result || ''))) {
      blocked('Excel ctrl+s 保存', `前台切换被 Windows 拒绝（环境）：${String(saved?.result || '').slice(0, 200)}`)
    } else {
      pass('Excel ctrl+s 保存', false, `ok=${saved?.ok} result=${String(saved?.result || '').slice(0, 160)}`)
    }
    await delay(1500)

    let cells = null
    for (let i = 0; i < 3; i += 1) {
      cells = jsonLine(runPs(excelHelperPath, ['cells', xlsx, '', '', '0'], { timeout: 30000 }))
      if (cells?.ok) break
      await delay(500)
    }
    if (!cells?.ok) {
      blocked('Excel OOXML 读取', cells?.reason || 'Read-XlsxManifest failed')
      return
    }
    const a2v = String(cells.cells?.A2 ?? '')
    const e2v = String(cells.cells?.E2 ?? '')
    if (a2v === payload && e2v === payload) {
      pass('Excel ctrl+drag 复制单元格', true, `A2=${a2v} E2=${e2v} source_kept=true`)
    } else if (a2v === '' && e2v === payload) {
      pass('Excel ctrl+drag 复制单元格', false, `A2 被清空、E2=${e2v}：Ctrl 未生效，实际是移动`)
    } else {
      blocked('Excel ctrl+drag 复制单元格', `A2=${JSON.stringify(a2v)} E2=${JSON.stringify(e2v)}（可能是对话框/保护视图）`)
    }
  } finally {
    const closed = jsonLine(runPs(excelHelperPath, ['close', '', '', excelState, '0'], { timeout: 30000 }))
    if (closed?.closed) {
      record('Excel 关闭测试工作簿', 'PASS', 'exact HWND closed')
    } else {
      // Last resort for a test-owned workbook: verify the PID's command line
      // contains this temp xlsx, then terminate that exact PID. Never kill by
      // process name; a user's Excel instance never has this temp path.
      const forced = jsonLine(runPs(excelHelperPath, ['force-close', xlsx, '', excelState, '0'], { timeout: 30000 }))
      if (forced?.ok) record('Excel 关闭测试工作簿', 'PASS', `HWND close failed (${closed?.reason || 'unknown'}); ${forced.reason}`)
      else record('Excel 关闭测试工作簿', 'LEFT_OVER', `HWND close failed: ${closed?.reason || 'unknown'}; force-close: ${forced?.reason || 'unknown'}`)
    }
  }
}

if (process.argv.includes('--excel')) {
  try {
    await runExcel()
  } catch (err) {
    pass('Excel probe completed', false, String(err?.message || err).slice(0, 300))
  }
}
if (excelWork && !process.env.S4_KEEP) {
  try { rmSync(excelWork, { recursive: true, force: true }) } catch { /* ignore */ }
}

const passes = checks.filter((c) => c.status === 'PASS').length
const left = checks.filter((c) => c.status === 'LEFT_OVER').length
const blocks = checks.filter((c) => c.status === 'BLOCKED').length
const fails = checks.filter((c) => c.status === 'FAIL').length
console.log(`\n结果：PASS ${passes}/${checks.length}，LEFT_OVER ${left}，BLOCKED ${blocks}，FAIL ${fails}`)
const strictBlocked = process.argv.includes('--strict-blocked')
process.exit(fails ? 1 : (strictBlocked && blocks ? 2 : 0))
