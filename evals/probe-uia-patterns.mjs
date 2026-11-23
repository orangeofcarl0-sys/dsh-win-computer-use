/**
 * probe-uia-patterns.mjs —— 只读 UIA pattern 探针。
 *
 * 目的：在不注入任何输入的前提下，确认常见窗口里 ScrollPattern / TextPattern /
 * Invoke / ExpandCollapse / SelectionItem / Toggle 的覆盖，决定 PTC 桥接第二轮
 * 是否值得实现 scroll/selectText/performAction。
 *
 * 只读：list_windows + UIA 属性读取；不截图、不点击、不写仓库。
 *
 * 用法：
 *   node evals/probe-uia-patterns.mjs --window Notepad
 *   node evals/probe-uia-patterns.mjs --pid 4242 --window-id 77 --max 300
 *   node evals/probe-uia-patterns.mjs --json
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, 'probe-uia-patterns.ps1')

function arg(name, fallback = '') {
  const at = process.argv.indexOf(name)
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback
}
const asJson = process.argv.includes('--json')
const wantWindow = arg('--window', '')
const wantPid = Number(arg('--pid', '0')) || 0
const wantWindowId = Number(arg('--window-id', '0')) || 0
const max = Math.max(1, Math.min(2000, Number(arg('--max', '200')) || 200))
const hasPoint = process.argv.includes('--x') && process.argv.includes('--y')
const pointX = Number(arg('--x', '0')) || 0
const pointY = Number(arg('--y', '0')) || 0
const installedDriver = join(homedir(), '.cua-driver', 'packages', 'current', 'cua-driver.exe')
const driver = process.env.CUA_DRIVER_BIN
  || (process.platform === 'win32' && existsSync(installedDriver) ? installedDriver : 'cua-driver')
const powershell = process.env.DSH_POWERSHELL || 'powershell.exe'

function run(cmd, args, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, shell: false })
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
      if (code !== 0) reject(new Error(`${cmd} exit ${code}: ${stderr.slice(0, 600)}`))
      else resolve(stdout)
    })
  })
}

function parseJson(text) {
  const trimmed = String(text || '').trim()
  const at = trimmed.indexOf('{')
  if (at < 0) throw new Error(`no JSON object in output: ${trimmed.slice(0, 200)}`)
  return JSON.parse(trimmed.slice(at))
}

let windows = []
try {
  windows = parseJson(await run(driver, ['call', 'list_windows', '{}'])).windows || []
} catch (error) {
  console.error(`无法读取窗口列表：${error.message}`)
  process.exit(1)
}

const candidates = windows.filter((w) => {
  if (!w || !w.window_id) return false
  if (wantWindowId && Number(w.window_id) !== wantWindowId) return false
  if (wantPid && Number(w.pid) !== wantPid) return false
  if (wantWindow && !String(w.title || '').toLowerCase().includes(wantWindow.toLowerCase())
    && !String(w.app_name || '').toLowerCase().includes(wantWindow.toLowerCase())) return false
  return true
})
const target = candidates[0]
if (!target) {
  console.error(`没有匹配窗口（window=${wantWindow || '*'} pid=${wantPid || '*'} windowId=${wantWindowId || '*'}）`)
  process.exit(1)
}

if (!existsSync(script)) {
  console.error(`探针脚本不存在：${script}`)
  process.exit(1)
}

let report
try {
  const out = await run(powershell, [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', script,
    '-Hwnd', String(target.window_id),
    '-TargetPid', String(target.pid || 0),
    '-Max', String(max),
    ...(hasPoint ? ['-HasPoint', '-ScreenX', String(pointX), '-ScreenY', String(pointY)] : []),
  ], 30000)
  report = parseJson(out)
} catch (error) {
  console.error(`探针失败：${error.message}`)
  process.exit(1)
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2))
  process.exit(0)
}

const counts = report.patternCounts || {}
console.log(`窗口：${report.window?.name || ''}（pid=${report.pid} hwnd=${report.hwnd}）`)
console.log(`访问元素：${report.total}（max=${max}）`)
console.log('Pattern 覆盖：')
for (const key of ['Scroll', 'Text', 'Invoke', 'ExpandCollapse', 'SelectionItem', 'Toggle', 'Value']) {
  console.log(`  ${key.padEnd(16)} ${counts[key] || 0}`)
}
const noteworthy = (report.samples || []).filter((s) => s.patterns?.some((p) => ['Scroll', 'Text'].includes(p)))
if (noteworthy.length) {
  console.log('Scroll/Text 样本：')
  for (const s of noteworthy.slice(0, 8)) {
    const scroll = s.scroll
      ? ` vScroll=${s.scroll.verticallyScrollable} vPct=${s.scroll.verticalScrollPercent} hScroll=${s.scroll.horizontallyScrollable} hPct=${s.scroll.horizontalScrollPercent}`
      : ''
    const hit = s.containsPoint ? ' containsPoint' : ''
    console.log(`  ${s.role} "${String(s.name || '').slice(0, 40)}" ${s.patterns.join(',')}${scroll}${hit}`)
  }
}
console.log('提示：探针不注入输入；结果只用于决定第二轮是否实现 UIA scroll/selectText/performAction。')
