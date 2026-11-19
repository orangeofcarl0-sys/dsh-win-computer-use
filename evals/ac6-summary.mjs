/**
 * ac6-summary.mjs — per-task token/step cost summary for AC6.
 *
 * Reads one or more headless-run reports (evals/report-last-headless.json by
 * default) and prints medians/p90 for steps, inner steps, wall time and token
 * usage. Token fields come from dsh `status/step_end.usage`:
 *   input (non-cached prompt), output, cacheRead, cacheWrite, total
 * `total` is provider-reported and includes cacheRead; `billable` is
 * input + output + cacheWrite (a conservative non-cache estimate).
 *
 * Usage:
 *   node evals/ac6-summary.mjs [--reports a.json,b.json] [--tasks t01,t05]
 *     [--json] [--out evals/headless-runs/ac6/summary.json]
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = dirname(dirname(fileURLToPath(import.meta.url)))

function argsOf(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) { out._.push(a); continue }
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
    p90: quantile(xs, 0.9),
    min: n ? Math.min(...xs.filter((x) => Number.isFinite(x))) : null,
    max: n ? Math.max(...xs.filter((x) => Number.isFinite(x))) : null,
    p90Unstable: n < 8,
  }
}

function routeOf(report) {
  const r = report.modelRoute || {}
  if (r.provider || r.model) return `${r.provider || '?'}/${r.model || '?'}`
  if (report.patchSha256) return `patch:${report.patchSha256}`
  return 'unknown'
}

function main() {
  const a = argsOf(process.argv.slice(2))
  const tasks = String(a.tasks || '').split(',').map((s) => s.trim()).filter(Boolean)
  const reportsArg = a.reports ? String(a.reports) : (a._.length ? a._.join(',') : join('evals', 'report-last-headless.json'))
  const paths = reportsArg.split(',').map((s) => resolve(REPO, s.trim())).filter(Boolean)
  const rows = []
  for (const p of paths) {
    if (!existsSync(p)) { console.error(`report not found: ${p}`); continue }
    let report
    try { report = JSON.parse(readFileSync(p, 'utf8')) } catch (err) { console.error(`bad report ${p}: ${err.message}`); continue }
    for (const run of report.runs || []) {
      if (tasks.length && !tasks.includes(run.id)) continue
      const t = run.tokens || null
      const billable = t ? (Number(t.input) || 0) + (Number(t.output) || 0) + (Number(t.cacheWrite) || 0) : null
      rows.push({
        report: p,
        task: run.id,
        route: routeOf(report),
        repeat: run.repeat ?? null,
        verdict: run.verdict,
        timeout: run.verdict === 'timeout' || Boolean(run.budgetExhausted),
        budgetExhausted: Boolean(run.budgetExhausted),
        noFinal: Boolean(run.noFinal),
        steps: run.steps ?? null,
        innerSteps: run.innerSteps ?? null,
        wallS: run.wallMs != null ? +(run.wallMs / 1000).toFixed(1) : null,
        tokens: t ? {
          input: t.input ?? null,
          output: t.output ?? null,
          cacheRead: t.cacheRead ?? null,
          cacheWrite: t.cacheWrite ?? null,
          total: t.total ?? null,
          billable,
          steps: t.steps ?? null,
        } : null,
      })
    }
  }
  if (!rows.length) {
    console.error('no runs matched (missing report or --tasks filter)')
    process.exit(1)
  }

  const groups = []
  const keys = [...new Set(rows.map((r) => `${r.task}\u0000${r.route}`))]
  for (const key of keys.sort()) {
    const [task, route] = key.split('\u0000')
    const rs = rows.filter((r) => r.task === task && r.route === route)
    const tokenRows = rs.filter((r) => r.tokens)
    const pick = (f) => tokenRows.map((r) => r.tokens[f])
    groups.push({
      task,
      route,
      n: rs.length,
      pass: rs.filter((r) => r.verdict === 'pass').length,
      fail: rs.filter((r) => r.verdict === 'fail').length,
      env: rs.filter((r) => r.verdict === 'env').length,
      error: rs.filter((r) => r.verdict === 'error').length,
      timeout: rs.filter((r) => r.timeout).length,
      budgetExhausted: rs.filter((r) => r.budgetExhausted).length,
      noFinal: rs.filter((r) => r.noFinal).length,
      dirty: rs.filter((r) => r.verdict === 'dirty').length,
      steps: stats(rs.map((r) => r.steps)),
      innerSteps: stats(rs.map((r) => r.innerSteps)),
      wallS: stats(rs.map((r) => r.wallS)),
      tokens: {
        n: tokenRows.length,
        input: stats(pick('input')),
        output: stats(pick('output')),
        cacheRead: stats(pick('cacheRead')),
        cacheWrite: stats(pick('cacheWrite')),
        total: stats(pick('total')),
        billable: stats(pick('billable')),
      },
    })
  }

  const result = { generatedAt: new Date().toISOString(), reports: paths, rows, groups }
  if (a.out) {
    const out = resolve(REPO, String(a.out))
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, JSON.stringify(result, null, 2))
  }
  if (a.json === true) {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  console.table(groups.map((g) => ({
    task: g.task,
    route: g.route,
    n: g.n,
    pass: g.pass,
    fail: g.fail,
    env: g.env,
    err: g.error,
    timeout: g.timeout,
    budget: g.budgetExhausted,
    noFinal: g.noFinal,
    dirty: g.dirty,
    stepsMed: g.steps.median,
    stepsP90: g.steps.p90,
    innerMed: g.innerSteps.median,
    wallMedS: g.wallS.median,
    tokN: g.tokens.n,
    inMed: g.tokens.input.median,
    outMed: g.tokens.output.median,
    cacheReadMed: g.tokens.cacheRead.median,
    totalMed: g.tokens.total.median,
    billableMed: g.tokens.billable.median,
    totalP90: g.tokens.total.p90,
  })))
  console.log('提示：n<8 时 p90 不稳定；total 含 cacheRead，billable=input+output+cacheWrite；原始报告不要入库。')
}

main()
