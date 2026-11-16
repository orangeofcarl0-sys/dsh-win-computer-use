/**
 * analyze-trajectory.mjs —— 读取 lib/trajectory.js 产出的 JSONL，输出 CU 行为摘要。
 *
 * 用法：
 *   node evals/analyze-trajectory.mjs [file] [--json]
 * 不传 file 时取 evals/headless-runs 下最新的 *.trajectory.jsonl。
 *
 * 只看轨迹，不读截图/文档正文；文本类事件已在写入端简化成 len/hash。
 * 新增探索 markers / strategy，用于解释“同一任务步数方差”：
 *   - retypeSame/retypeDiff：同一或不同文本的重复 type；
 *   - native/force/query observe、zoom/clipboard/drag/menu；
 *   - snapshotMismatch/repeatSuppressed/loops；
 *   - strategy：fast / direct / exploratory / other（阈值在下方固定声明）。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** 读取轨迹并返回摘要（CLI 与 ab-summary 共用）。 */
export function analyzeTrajectory(file) {
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
  let unverified = 0
  let observeStubs = 0
  let changedObserves = 0
  let suppressed = 0
  let observes = 0
  let actions = 0
  let loops = []
  let start = null
  let end = null
  let clicks = 0
  const toolMs = {}
  const toolCountsRaw = {}
  const deliveryModes = {}
  const toolNameById = new Map()
  const snapshotReadsByTool = {}

  // 探索 markers（只统计，不输出文本原文）
  const typeHashes = []
  let nativeObserves = 0
  let forceObserves = 0
  let queryObserves = 0
  let zoomCalls = 0
  let clipboardCalls = 0
  let dragCalls = 0
  let menuCalls = 0
  let snapshotMismatch = 0
  let repeatSuppressed = 0
  const suppressedByTool = {}

  for (const e of events) {
    if (e.type === 'session_start') start = e.ms
    if (e.type === 'session_end') end = e.ms
    if (e.type === 'tool_start' && e.id) {
      toolNameById.set(e.id, e.name)
      if (e.name === 'computer_type') typeHashes.push(e.args?.text?.hash || null)
      if (e.name === 'screen_observe') {
        if (e.args?.mode === 'native') nativeObserves++
        if (e.args?.force === true) forceObserves++
        if (e.args?.query) queryObserves++
      }
      if (e.name === 'screen_zoom') zoomCalls++
      if (e.name === 'computer_clipboard') clipboardCalls++
      if (e.name === 'computer_drag') dragCalls++
      if (e.name === 'computer_menu') menuCalls++
    }
    if (e.type === 'tool_end') {
      // computer_do 是路由壳；新轨迹已不记录外壳，这里保留兼容过滤。
      if (e.name !== 'computer_do') {
        toolCounts[e.name] = (toolCounts[e.name] || 0) + 1
        toolCountsRaw[e.name] = (toolCountsRaw[e.name] || 0) + 1
        toolMs[e.name] = (toolMs[e.name] || 0) + (Number(e.dur) || 0)
        if (!e.ok) errors++
        if (e.refusal) refusals++
        if (e.deliveryFailure) deliveryFailures++
        if (e.snapshotMismatch) {
          stale++
          snapshotMismatch++
        }
        if (e.unverified) unverified++
        if (e.observeStub) observeStubs++
        if (e.changedSinceLast === true) changedObserves++
        if (e.suppressed) {
          suppressed++
          repeatSuppressed++
          suppressedByTool[e.name] = (suppressedByTool[e.name] || 0) + 1
        }
        if (e.name === 'screen_observe' || e.name === 'screen_zoom') observes++
        else actions++
        if (/click/.test(e.name)) clicks++
      }
    }
    if (e.type === 'driver') {
      driverCounts[e.tool] = (driverCounts[e.tool] || 0) + 1
      // get_window_state 的归属：观察 / verifyAfterAction 复核 / 输入回读 / XAML 回退扫描。
      if (e.tool === 'get_window_state') {
        const owner = toolNameById.get(e.parent) || 'unknown'
        snapshotReadsByTool[owner] = (snapshotReadsByTool[owner] || 0) + 1
      }
      if (['click', 'type_text', 'set_value', 'hotkey', 'press_key', 'scroll', 'drag'].includes(e.tool)
        && e.args && typeof e.args.delivery_mode === 'string') {
        deliveryModes[e.args.delivery_mode] = (deliveryModes[e.args.delivery_mode] || 0) + 1
      }
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

  // 同一文本重复输入 / 不同文本改动，解释“重输/强制置脏”类探索。
  const seenHashes = new Set()
  let retypeSame = 0
  let retypeDiff = 0
  for (let i = 0; i < typeHashes.length; i++) {
    const h = typeHashes[i]
    if (!h) continue
    if (seenHashes.has(h)) retypeSame++
    else if (i > 0 && h !== typeHashes[0]) retypeDiff++
    seenHashes.add(h)
  }

  const loopSummary = loops.map((l) => ({
    kind: l.kind, tool: l.tool, signature: l.signature, count: l.count, ratio: l.ratio,
  }))
  const innerSteps = Object.values(toolCounts).reduce((a, b) => a + b, 0)

  const summary = {
    file,
    events: events.length,
    durationMs: start != null ? (end != null ? end - start : (events.at(-1)?.ms || 0) - start) : null,
    tools: toolCounts,
    drivers: driverCounts,
    snapshotReadsByTool,
    innerSteps,
    observes,
    actions,
    observeActionRatio: actions ? +(observes / actions).toFixed(2) : null,
    errors,
    refusals,
    deliveryFailures,
    staleSnapshots: stale,
    snapshotMismatch,
    unverified,
    observeStubs,
    changedObserves,
    suppressed,
    repeatSuppressed,
    suppressedByTool,
    deliveryModes,
    toolAvgMs: Object.fromEntries(Object.entries(toolMs).map(([k, v]) => [k, Math.round(v / (toolCountsRaw[k] || 1))])),
    moves,
    moveDistancePx: Math.round(moveDistance),
    movesPerClick: clicks ? +(moves / clicks).toFixed(1) : null,
    loops: loopSummary,
    // 探索 markers
    typeCalls: typeHashes.length,
    retypeSame,
    retypeDiff,
    nativeObserves,
    forceObserves,
    queryObserves,
    zoomCalls,
    clipboardCalls,
    dragCalls,
    menuCalls,
    clicks,
  }
  summary.strategy = strategyOf(summary)
  return summary
}

/**
 * 策略分类（阈值在看到新数据前固定声明）：
 *   fast         = 1 次 type + <=2 click + <=5 observe，且无 zoom/clipboard/drag/menu/重输/loop
 *   exploratory  = 重输/zoom/clipboard/drag/menu>=2/observe>=12/native>=3/force>=3/query>=3/loop>=2
 *   direct       = 不满足 fast/exploratory，但仍在 2 type/4 click/8 observe 的小范围内
 *   other        = 其余
 */
function strategyOf(s) {
  const fast = s.typeCalls <= 1 && s.clicks <= 2 && s.observes <= 5
    && s.nativeObserves <= 1 && s.forceObserves <= 1 && s.queryObserves === 0
    && s.zoomCalls === 0 && s.clipboardCalls === 0 && s.dragCalls === 0
    && s.menuCalls === 0 && s.retypeSame === 0 && s.loops.length === 0
  if (fast) return 'fast'
  const exploratory = s.retypeSame >= 1 || s.zoomCalls >= 1 || s.clipboardCalls >= 1
    || s.dragCalls >= 1 || s.menuCalls >= 2 || s.observes >= 12 || s.nativeObserves >= 3
    || s.forceObserves >= 3 || s.queryObserves >= 3 || s.loops.length >= 2
  if (exploratory) return 'exploratory'
  const direct = s.typeCalls <= 2 && s.clicks <= 4 && s.observes <= 8 && s.zoomCalls <= 1
    && s.clipboardCalls === 0 && s.dragCalls === 0 && s.menuCalls <= 1
    && s.retypeSame === 0 && s.loops.length <= 1
  return direct ? 'direct' : 'other'
}

function latest(root) {
  const runs = readdirSync(root).map((d) => join(root, d)).filter((d) => statSync(d).isDirectory())
  runs.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  for (const d of runs) {
    const fs = readdirSync(d).filter((f) => f.endsWith('.trajectory.jsonl')).map((f) => join(d, f))
    fs.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    if (fs.length) return fs[0]
  }
  return null
}

function main() {
  const args = process.argv.slice(2)
  const jsonOut = args.includes('--json')
  const fileArg = args.find((a) => !a.startsWith('--'))
  const root = join(dirname(fileURLToPath(import.meta.url)), 'headless-runs')
  const file = fileArg || latest(root)
  if (!file) { console.error('no trajectory file found'); process.exit(1) }
  const summary = analyzeTrajectory(file)

  if (jsonOut) {
    console.log(JSON.stringify(summary, null, 2))
    process.exit(0)
  }

  console.log('trajectory:', file)
  console.log('events:', summary.events, 'duration:', summary.durationMs != null ? (summary.durationMs / 1000).toFixed(1) + 's' : '?')
  console.log('tools:', Object.entries(summary.tools).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ') || '(none)')
  console.log('observes=', summary.observes, 'actions=', summary.actions, 'ratio=', summary.observeActionRatio,
    'stubs=', summary.observeStubs, 'changedObserves=', summary.changedObserves,
    'unverified=', summary.unverified, 'suppressed=', summary.suppressed)
  console.log('drivers:', Object.entries(summary.drivers).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ') || '(none)')
  console.log('snapshot-reads:', Object.entries(summary.snapshotReadsByTool).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ') || '(none)')
  console.log('pointer: moves=', summary.moves, 'distance=', summary.moveDistancePx + 'px', 'moves/click=', summary.movesPerClick)
  console.log('delivery:', Object.entries(summary.deliveryModes).map(([k, v]) => `${k}:${v}`).join(' ') || '(none)')
  console.log('tool-avg-ms:', Object.entries(summary.toolAvgMs).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ') || '(none)')
  console.log('errors=', summary.errors, 'refusals=', summary.refusals, 'deliveryFailures=', summary.deliveryFailures,
    'staleSnapshots=', summary.staleSnapshots, 'snapshotMismatch=', summary.snapshotMismatch)
  console.log('markers:', JSON.stringify({
    typeCalls: summary.typeCalls,
    retypeSame: summary.retypeSame,
    retypeDiff: summary.retypeDiff,
    native: summary.nativeObserves,
    force: summary.forceObserves,
    query: summary.queryObserves,
    zoom: summary.zoomCalls,
    clipboard: summary.clipboardCalls,
    drag: summary.dragCalls,
    menu: summary.menuCalls,
    repeatSuppressed: summary.repeatSuppressed,
    loops: summary.loops.length,
  }), 'strategy=', summary.strategy)
  if (summary.loops.length) {
    console.log('loops:')
    for (const l of summary.loops) {
      const what = l.signature || l.tool || ''
      const detail = l.count ? `x${l.count}` : (l.ratio ? `ratio=${l.ratio}` : '')
      console.log(`  - ${l.kind} ${what} ${detail}`.trim())
    }
  } else {
    console.log('loops: none')
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) main()
