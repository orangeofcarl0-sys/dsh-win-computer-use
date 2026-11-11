/**
 * evals/headless-run.mjs — S4 的 headless 直跑器（dsh 0.2.2+ 的可用通道）。
 *
 * 为什么不复用 run.mjs：run.mjs 驱动 Web UI（CDP），其选择器/发送路径基于 dsh 0.1.5；
 * dsh 0.2.2 上会创建空会话并把旧会话步数误读成 steps（2026-11-12 实测）。
 * 本 runner 直接走 `dsh --profile headless`：仍然经过真实 dsh agent + 当前插件，
 * 但不依赖浏览器 DOM；setup/oracle/cleanup 与 S4 任务集完全复用。
 *
 * 用法：
 *   node evals/headless-run.mjs --tier smoke --timeout-min 10
 *   node evals/headless-run.mjs --tasks t01,t04 --repeats 3 --timeout-min 12
 *   node evals/headless-run.mjs --tier all --timeout-min 10 --report evals/report-last-headless.json
 *
 * 前置：
 *   - headless profile 的 node_modules 里可解析 dsh-win-computer-use；
 *   - DSH_BIN 指向 dsh 的 lib/bin.js（默认从全局 npm 路径推断）；
 *   - PowerShell 可用；TEMP/TMP 会在子进程里指到用户临时目录（Add-Type 需要）。
 * 产物：
 *   - evals/headless-runs/<stamp>/<task>-r<n>.jsonl / .err（已 gitignore）
 *   - evals/report-last-headless.json（已 gitignore）
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.dirname(ROOT)
const PS = process.env.S4_POWERSHELL || 'powershell.exe'
const DSH_ENTRY = process.env.DSH_BIN || path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const TEMP = process.env.S4_TEMP || path.join(process.env.LOCALAPPDATA || homedir(), 'Temp')
const ENV = { ...process.env, TEMP, TMP: TEMP }

const args = process.argv.slice(2)
const has = (name) => args.includes(`--${name}`)
const val = (name, dflt) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt
}
const tasksArg = val('tasks', '')
const tierArg = val('tier', tasksArg ? 'all' : 'smoke')
const timeoutMin = Math.max(1, Number(val('timeout-min', '10')) || 10)
const repeats = Math.max(1, Number(val('repeats', '1')) || 1)
const patch = path.resolve(REPO, val('patch', path.join('evals', 'headless-patch.yml')))
const reportPath = path.resolve(REPO, val('report', path.join('evals', 'report-last-headless.json')))
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const logDir = path.join(ROOT, 'headless-runs', stamp)

const COMMON = '【重要约束】本任务必须只通过图形界面完成（在屏幕上点击、拖拽、键盘输入），禁止使用命令行、终端、文件写入工具或任何绕过屏幕的方式。不要向用户提问；自主完成任务后直接结束回合。若某条操作路径不可用（工具会说明原因），请改用界面上等效的控件或通道完成同一操作，不要反复重试同一条失败路径。\n\n'

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null }
}

function discover() {
  const out = []
  for (const f of fs.readdirSync(path.join(ROOT, 'tasks')).filter((x) => x.endsWith('.md')).sort()) {
    const id = f.replace(/\.md$/, '').split('-')[0]
    if (tasksArg && !tasksArg.split(',').map((s) => s.trim().toLowerCase()).includes(id.toLowerCase())) continue
    const md = fs.readFileSync(path.join(ROOT, 'tasks', f), 'utf8').replace(/\r\n/g, '\n')
    const group = /^wa/.test(id) ? 'waa' : 'authored'
    const tier = (md.match(/\*\*tier:\s*(\w+)\*\*/) || md.match(/^- tier:\s*(\w+)/m) || [])[1] || 'core'
    if (tierArg !== 'all' && tier !== tierArg) continue
    const m = md.match(/<<<PROMPT\n([\s\S]*?)\nPROMPT>>>/)
    if (!m) throw new Error(`task ${id}: no <<<PROMPT block`)
    const taskDir = path.join(homedir(), '.dsh', 's4-evals', id)
    out.push({ id, group, tier, prompt: m[1].replaceAll('{task_dir}', taskDir), taskDir })
  }
  return out
}

function run(cmd, cmdArgs, { timeoutMs = 120000, cwd = REPO } = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, cmdArgs, { cwd, env: ENV, windowsHide: true })
    let stdout = ''
    let stderr = ''
    let done = false
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); resolve(r) }
    const timer = setTimeout(() => {
      try { p.kill() } catch {}
      // dsh 可能还有子进程；Windows 上用 taskkill /T 收尾，失败也不阻塞。
      if (process.platform === 'win32') {
        try { spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true }) } catch {}
      }
      finish({ code: 'TIMEOUT', stdout, stderr, timedOut: true })
    }, timeoutMs)
    p.stdout.on('data', (d) => { stdout += d })
    p.stderr.on('data', (d) => { stderr += d })
    p.on('error', (e) => finish({ code: 'SPAWN_ERR', stdout, stderr: String(e) }))
    p.on('close', (code) => finish({ code, stdout, stderr }))
  })
}

async function ps(kind, id) {
  const r = await run(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, kind, `${id}.ps1`), id], { timeoutMs: 120000 })
  let json = null
  for (const line of r.stdout.split(/\r?\n/)) {
    if (!line.trim().startsWith('{')) continue
    try { json = JSON.parse(line) } catch {}
  }
  return { code: r.code, json, stderr: r.stderr }
}

function parseEvents(text) {
  const events = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    try { events.push(JSON.parse(line)) } catch {}
  }
  return events
}

function analyze(events) {
  const toolCalls = events.filter((e) => e.type === 'tool_call')
  const toolResults = events.filter((e) => e.type === 'tool_result')
  let toolErrors = 0
  let unverified = 0
  for (const r of toolResults) {
    const s = String(r.result || '')
    if ((r.status && r.status !== 'completed') || /✗|\[snapshot_missing\]|\[snapshot_expired\]|\[snapshot_mismatch\]|refused|suspected_noop/.test(s)) toolErrors++
    else if (/unverifiable/i.test(s)) unverified++
  }
  const end = [...events].reverse().find((e) => e.type === 'turn_end')
  const final = [...events].reverse().find((e) => e.type === 'final')
  return {
    toolCalls: toolCalls.length,
    toolErrors,
    unverified,
    turn: end?.reason?.kind || null,
    final: final?.text || '',
    calls: toolCalls.map((c) => `${c.tool}${c.input?.tool ? ':' + c.input.tool : ''}`),
  }
}

async function runOne(task) {
  const rec = {
    id: task.id, group: task.group, tier: task.tier,
    verdict: 'error', steps: 0, toolErrors: 0, unverified: 0,
    timedOut: false, turn: null, final: '', oracle: null,
    setup: null, cleanup: null, notes: [],
  }
  const cl0 = await ps('cleanup', task.id)
  const su = await ps('setup', task.id)
  rec.setup = su.json || { code: su.code }
  if (su.code !== 0) {
    rec.notes.push('setup: ' + String(su.json?.envError || su.stderr || su.code).slice(0, 300))
    rec.cleanup = (await ps('cleanup', task.id)).json
    return rec
  }

  fs.mkdirSync(logDir, { recursive: true })
  const base = path.join(logDir, `${task.id}-r${runOne.round}`)
  const dr = await run(process.execPath, [
    DSH_ENTRY, '--profile', 'headless', '--patch', patch,
    '--permission-mode', 'read-only', '--approval-policy', 'never', '--json',
    COMMON + task.prompt,
  ], { timeoutMs: timeoutMin * 60000 })
  fs.writeFileSync(`${base}.jsonl`, dr.stdout)
  fs.writeFileSync(`${base}.err`, dr.stderr)
  const a = analyze(parseEvents(dr.stdout))
  rec.steps = a.toolCalls
  rec.toolErrors = a.toolErrors
  rec.unverified = a.unverified
  rec.timedOut = Boolean(dr.timedOut)
  rec.turn = a.turn
  rec.final = a.final.slice(0, 400)
  rec.calls = a.calls
  if (dr.code === 'SPAWN_ERR') rec.notes.push('dsh spawn: ' + dr.stderr.slice(0, 300))
  if (dr.timedOut) rec.notes.push(`timeout ${timeoutMin}min`)

  const orc = await ps('oracle', task.id)
  rec.oracle = orc.json || { code: orc.code }
  rec.verdict = orc.code === 0 ? 'pass' : orc.code === 1 ? 'fail' : 'error'
  rec.cleanup = (await ps('cleanup', task.id)).json
  return rec
}
runOne.round = 1

const tasks = discover()
if (!tasks.length) {
  console.error('no tasks matched')
  process.exit(1)
}
if (!fs.existsSync(DSH_ENTRY)) {
  console.error(`dsh entry not found: ${DSH_ENTRY}\nset DSH_BIN to .../@deepseek-ai/dsh/lib/bin.js`)
  process.exit(1)
}
if (!fs.existsSync(patch)) {
  console.error(`patch not found: ${patch}`)
  process.exit(1)
}

console.log(`headless S4: ${tasks.length} tasks, tier=${tierArg}, repeats=${repeats}, timeout=${timeoutMin}min`)
console.log(`dsh=${DSH_ENTRY}`)
console.log(`logs=${logDir}`)

const runs = []
for (let r = 0; r < repeats; r++) {
  runOne.round = r + 1
  for (const task of tasks) {
    const rec = await runOne(task)
    rec.repeat = r + 1
    runs.push(rec)
    console.log(`\n== ${task.id} r${r + 1} -> ${rec.verdict} steps=${rec.steps} err=${rec.toolErrors} unverified=${rec.unverified}${rec.timedOut ? ' timeout' : ''}${rec.turn ? ' turn=' + rec.turn : ''}`)
    if (rec.oracle?.checks) console.log('   oracle:', rec.oracle.checks.map((c) => `${c.name}=${c.ok}`).join(' '))
  }
}

const summary = {
  startedAt: stamp,
  dshVersion: readJsonSafe(path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))?.version || 'unknown',
  pluginVersion: readJsonSafe(path.join(REPO, 'package.json'))?.version || 'unknown',
  tier: tierArg,
  timeoutMin,
  repeats,
  runs,
}
fs.mkdirSync(path.dirname(reportPath), { recursive: true })
fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2))

const scored = runs.filter((r) => r.verdict === 'pass' || r.verdict === 'fail')
const pass = scored.filter((r) => r.verdict === 'pass').length
const fail = scored.filter((r) => r.verdict === 'fail').length
const errors = runs.filter((r) => r.verdict === 'error').length
const timeouts = runs.filter((r) => r.timedOut).length
console.log(`\nheadless S4: pass=${pass} fail=${fail} error=${errors} total=${runs.length} timeout=${timeouts}`)
console.log(`report -> ${reportPath}`)
process.exit(errors ? 1 : 0)
