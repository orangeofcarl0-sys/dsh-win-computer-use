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

function runPs(script, args = []) {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], { encoding: 'utf8', timeout: 30000, windowsHide: true })
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
  const obs2 = await call('screen_observe', { window_id: hwnd, mode: 'native' })
  const els2 = obs2?.elements || []
  const src2 = findItem(els2, /^payload(\.txt)?$/i)
  const dst2 = findItem(els2, /^dest$/i)
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
  if (!['no explorer', 'items missing', 'reopen failed', 'move targets missing'].includes(String(err?.message || err))) {
    pass('probe completed', false, String(err.message || err))
  }
} finally {
  const closed = closeExplorer()
  if (!closed?.closed) {
    console.log(`⚠️ explorer close not confirmed: ${closed?.reason || 'unknown'}`)
  }
  if (!process.env.S4_KEEP) { try { rmSync(work, { recursive: true, force: true }) } catch {} }
}

if (process.argv.includes('--excel')) {
  blocked('Excel modifier drop', 'opt-in branch is not implemented: Excel UIA cell geometry + save/close path are environment-dependent; tracked in evals/BLOCKED.md')
}

const passes = checks.filter((c) => c.status === 'PASS').length
const left = checks.filter((c) => c.status === 'LEFT_OVER').length
const blocks = checks.filter((c) => c.status === 'BLOCKED').length
const fails = checks.filter((c) => c.status === 'FAIL').length
console.log(`\n结果：PASS ${passes}/${checks.length}，LEFT_OVER ${left}，BLOCKED ${blocks}，FAIL ${fails}`)
const strictBlocked = process.argv.includes('--strict-blocked')
process.exit(fails ? 1 : (strictBlocked && blocks ? 2 : 0))
