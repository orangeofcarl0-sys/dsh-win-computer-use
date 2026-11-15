/**
 * analyze-trajectory.mjs —— 读取 lib/trajectory.js 产出的 JSONL，输出 CU 行为摘要。
 *
 * 用法：
 *   node evals/analyze-trajectory.mjs [file] [--json]
 * 不传 file 时取 evals/headless-runs 下最新的 *.trajectory.jsonl。
 *
 * 只看轨迹，不读截图/文档正文；文本类事件已在写入端简化成 len/hash。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const jsonOut = args.includes('--json')
const fileArg = args.find((a) => !a.startsWith('--'))
const root = join(dirname(fileURLToPath(import.meta.url)), 'headless-runs')

function latest() {
  const runs = readdirSync(root).map((d) => join(root, d)).filter((d) => statSync(d).isDirectory())
  runs.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  for (const d of runs) {
    const fs = readdirSync(d).filter((f) => f.endsWith('.trajectory.jsonl')).map((f) => join(d, f))
    fs.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    if (fs.length) return fs[0]
  }
  return null
}

const file = fileArg || latest()
if (!file) { console.error('no trajectory file found'); process.exit(1) }
const events = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => {
  try { return JSON.parse(l) } catch { return null }
}).filter(Boolean)

const toolCounts = {}
const driverCounts = {}
let moves = 0
let moveDistance = 0
let last = null
let errors = 0
let refusals = 0
let deliveryFailures = 0
let stale = 0
let observes = 0
let actions = 0
let loops = []
let start = null
let end = null

for (const e of events) {
  if (e.type === 'session_start') start = e.ms
  if (e.type === 'session_end') end = e.ms
  if (e.type === 'tool_end') {
    toolCounts[e.name] = (toolCounts[e.name] || 0) + 1
    // computer_do 是路由壳；为避免同一动作的错误/计数翻倍，统计只算隐藏工具。
    if (e.name !== 'computer_do') {
      if (!e.ok) errors++
      if (e.refusal) refusals++
      if (e.deliveryFailure) deliveryFailures++
      if (e.snapshotMismatch) stale++
      if (e.name === 'screen_observe' || e.name === 'screen_zoom') observes++
      else actions++
    }
  }
  if (e.type === 'driver') {
    driverCounts[e.tool] = (driverCounts[e.tool] || 0) + 1
    if (e.tool === 'move_cursor' && e.ok && e.args) {
      const x = Number(e.args.x)
      const y = Number(e.args.y)
      if (Number.isFinite(x) && Number.isFinite(y)) {
        if (last) moveDistance += Math.hypot(x - last.x, y - last.y)
        last = { x, y }
        moves++
      }
    }
  }
  if (e.type === 'loop') loops.push(e)
}

const summary = {
  file,
  events: events.length,
  durationMs: start != null ? (end != null ? end - start : (events.at(-1)?.ms || 0) - start) : null,
  tools: toolCounts,
  drivers: driverCounts,
  observes,
  actions,
  observeActionRatio: actions ? +(observes / actions).toFixed(2) : null,
  errors,
  refusals,
  deliveryFailures,
  staleSnapshots: stale,
  moves,
  moveDistancePx: Math.round(moveDistance),
  loops: loops.map((l) => ({ kind: l.kind, tool: l.tool, signature: l.signature, count: l.count, ratio: l.ratio })),
}

if (jsonOut) {
  console.log(JSON.stringify(summary, null, 2))
  process.exit(0)
}

console.log('trajectory:', file)
console.log('events:', summary.events, 'duration:', summary.durationMs != null ? (summary.durationMs / 1000).toFixed(1) + 's' : '?')
console.log('tools:', Object.entries(toolCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ') || '(none)')
console.log('observes=', observes, 'actions=', actions, 'ratio=', summary.observeActionRatio)
console.log('drivers:', Object.entries(driverCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ') || '(none)')
console.log('pointer: moves=', moves, 'distance=', summary.moveDistancePx + 'px')
console.log('errors=', errors, 'refusals=', refusals, 'deliveryFailures=', deliveryFailures, 'staleSnapshots=', stale)
if (loops.length) {
  console.log('loops:')
  for (const l of loops) {
    const what = l.signature || l.tool || ''
    const detail = l.count ? `x${l.count}` : (l.ratio ? `ratio=${l.ratio}` : '')
    console.log(`  - ${l.kind} ${what} ${detail}`.trim())
  }
} else {
  console.log('loops: none')
}
