/**
 * ab-summary.mjs —— 汇总 A/B 报告 + trajectory，输出策略分布与稳健统计。
 *
 * 用法：
 *   node evals/ab-summary.mjs [--dir evals/headless-runs/ab] [--tasks t01,t05]
 *     [--arms off,auto] [--out evals/headless-runs/ab/summary.json] [--json]
 *
 * 只读 report/trajectory；不输出正文/截图/剪贴板内容。产物默认只打 stdout；
 * --out 建议放在 evals/headless-runs/（已被 .gitignore 覆盖），不要提交测量结果。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { analyzeTrajectory } from './analyze-trajectory.mjs'

const REPO = dirname(dirname(fileURLToPath(import.meta.url)))

function argsOf(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const k = a.slice(2)
    const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true
    out[k] = v
  }
  return out
}

const median = (xs) => {
  const a = xs.filter((x) => Number.isFinite(x)).slice().sort((x, y) => x - y)
  if (a.length === 0) return null
  const m = Math.floor(a.length / 2)
  return a.length % 2 ? a[m] : +((a[m - 1] + a[m]) / 2).toFixed(1)
}
const quantile = (xs, q) => {
  const a = xs.filter((x) => Number.isFinite(x)).slice().sort((x, y) => x - y)
  if (a.length === 0) return null
  const i = Math.min(a.length - 1, Math.max(0, Math.ceil(q * a.length) - 1))
  return a[i]
}
const stats = (xs) => {
  const n = xs.filter((x) => Number.isFinite(x)).length
  return {
    n,
    median: median(xs),
    p10: quantile(xs, 0.1),
    p90: quantile(xs, 0.9),
    iqr: n ? +(quantile(xs, 0.75) - quantile(xs, 0.25)).toFixed(1) : null,
    min: n ? Math.min(...xs.filter((x) => Number.isFinite(x))) : null,
    max: n ? Math.max(...xs.filter((x) => Number.isFinite(x))) : null,
    p90Unstable: n < 8,
  }
}

function main() {
  const a = argsOf(process.argv.slice(2))
  const dir = resolve(REPO, String(a.dir || join('evals', 'headless-runs', 'ab')))
  const tasks = String(a.tasks || '').split(',').map((s) => s.trim()).filter(Boolean)
  const arms = String(a.arms || 'off,auto').split(',').map((s) => s.trim()).filter(Boolean)
  const jsonOut = a.json === true
  if (!existsSync(dir)) {
    console.error(`目录不存在：${dir}`)
    process.exit(1)
  }

  const rows = []
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json') && !x.endsWith('.summary.json')).sort()) {
    const m = f.match(/^(off|auto)-(.+)-r(\d+)\.json$/)
    if (!m) continue
    const [, arm, task, repeat] = m
    if (!arms.includes(arm)) continue
    if (tasks.length && !tasks.includes(task)) continue
    let report
    try { report = JSON.parse(readFileSync(join(dir, f), 'utf8')) } catch { continue }
    const run = report.runs?.[0]
    if (!run) continue
    const traj = run.trajectory || report.trajectory
    if (!traj || !existsSync(traj)) continue
    const s = analyzeTrajectory(traj)
    rows.push({
      task,
      arm,
      repeat: Number(repeat),
      file: f,
      verdict: run.verdict,
      stepsTop: run.steps ?? null,
      innerSteps: s.innerSteps,
      durationS: s.durationMs != null ? +(s.durationMs / 1000).toFixed(1) : null,
      strategy: s.strategy,
      toolErrors: run.toolErrors ?? null,
      unverified: s.unverified,
      errors: s.errors,
      dirty: Boolean(run.dirty),
      timedOut: Boolean(run.timedOut),
      markers: {
        typeCalls: s.typeCalls,
        retypeSame: s.retypeSame,
        retypeDiff: s.retypeDiff,
        native: s.nativeObserves,
        force: s.forceObserves,
        query: s.queryObserves,
        zoom: s.zoomCalls,
        clipboard: s.clipboardCalls,
        drag: s.dragCalls,
        menu: s.menuCalls,
        appLaunch: s.appLaunchCalls,
        activate: s.activateCalls,
        observes: s.observes,
        actions: s.actions,
        snapshotMismatch: s.snapshotMismatch,
        repeatSuppressed: s.repeatSuppressed,
        loops: s.loops.length,
      },
    })
  }

  if (rows.length === 0) {
    console.error('没有匹配的 A/B 报告（off|auto-<task>-rN.json）')
    process.exit(1)
  }

  const groups = []
  for (const task of [...new Set(rows.map((r) => r.task))].sort()) {
    for (const arm of arms) {
      const rs = rows.filter((r) => r.task === task && r.arm === arm)
      if (rs.length === 0) continue
      const pass = rs.filter((r) => r.verdict === 'pass').length
      const failed = rs.filter((r) => r.verdict === 'fail').length
      const error = rs.filter((r) => r.verdict === 'error').length
      const dirty = rs.filter((r) => r.verdict === 'dirty').length
      const strategies = {}
      for (const r of rs) strategies[r.strategy] = (strategies[r.strategy] || 0) + 1
      groups.push({
        task,
        arm,
        n: rs.length,
        pass,
        fail: failed,
        error,
        dirty,
        timeout: rs.filter((r) => r.timedOut).length,
        stepsTop: stats(rs.map((r) => r.stepsTop)),
        innerSteps: stats(rs.map((r) => r.innerSteps)),
        durationS: stats(rs.map((r) => r.durationS)),
        strategies,
        markersMedian: {
          retypeSame: median(rs.map((r) => r.markers.retypeSame)),
          zoom: median(rs.map((r) => r.markers.zoom)),
          clipboard: median(rs.map((r) => r.markers.clipboard)),
          drag: median(rs.map((r) => r.markers.drag)),
          menu: median(rs.map((r) => r.markers.menu)),
          appLaunch: median(rs.map((r) => r.markers.appLaunch)),
          activate: median(rs.map((r) => r.markers.activate)),
          native: median(rs.map((r) => r.markers.native)),
          force: median(rs.map((r) => r.markers.force)),
          query: median(rs.map((r) => r.markers.query)),
          observes: median(rs.map((r) => r.markers.observes)),
          loops: median(rs.map((r) => r.markers.loops)),
        },
      })
    }
  }

  // paired delta：同 task + repeat 的 auto - off
  const paired = []
  for (const task of [...new Set(rows.map((r) => r.task))].sort()) {
    const repeats = [...new Set(rows.filter((r) => r.task === task).map((r) => r.repeat))].sort((x, y) => x - y)
    for (const rep of repeats) {
      const off = rows.find((r) => r.task === task && r.arm === 'off' && r.repeat === rep)
      const auto = rows.find((r) => r.task === task && r.arm === 'auto' && r.repeat === rep)
      if (!off || !auto) continue
      paired.push({
        task,
        repeat: rep,
        dStepsTop: auto.stepsTop != null && off.stepsTop != null ? auto.stepsTop - off.stepsTop : null,
        dInnerSteps: auto.innerSteps - off.innerSteps,
        dDurationS: auto.durationS != null && off.durationS != null ? +(auto.durationS - off.durationS).toFixed(1) : null,
        autoStrategy: auto.strategy,
        offStrategy: off.strategy,
      })
    }
  }

  const result = { dir, generatedAt: new Date().toISOString(), rows, groups, paired }
  if (a.out) {
    const out = resolve(REPO, String(a.out))
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, JSON.stringify(result, null, 2))
  }
  if (jsonOut) {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  console.table(rows.map((r) => ({
    task: r.task,
    arm: r.arm,
    rep: r.repeat,
    verdict: r.verdict,
    stepsTop: r.stepsTop,
    inner: r.innerSteps,
    durS: r.durationS,
    strategy: r.strategy,
    type: r.markers.typeCalls,
    retype: r.markers.retypeSame,
    zoom: r.markers.zoom,
    clip: r.markers.clipboard,
    drag: r.markers.drag,
    menu: r.markers.menu,
    launch: r.markers.appLaunch,
    activate: r.markers.activate,
    obs: r.markers.observes,
    loops: r.markers.loops,
  })))
  console.table(groups.map((g) => ({
    task: g.task,
    arm: g.arm,
    n: g.n,
    pass: g.pass,
    err: g.error,
    dirty: g.dirty,
    stepsMed: g.stepsTop.median,
    stepsP90: g.stepsTop.p90,
    innerMed: g.innerSteps.median,
    durMed: g.durationS.median,
    durP90: g.durationS.p90,
    fast: g.strategies.fast || 0,
    direct: g.strategies.direct || 0,
    expl: g.strategies.exploratory || 0,
    other: g.strategies.other || 0,
    p90Unstable: g.stepsTop.p90Unstable,
  })))
  if (paired.length) console.table(paired)
  console.log('提示：n<8 时 p90 不稳定；策略阈值见 evals/analyze-trajectory.mjs；原始产物不要入库。')
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) main()
