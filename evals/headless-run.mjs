/**
 * evals/headless-run.mjs — eval（S1-S4）的 headless 直跑器（dsh 0.2.2+ 的可用通道）。
 *
 * 为什么不复用 run.mjs：run.mjs 驱动 Web UI（CDP），其选择器/发送路径基于 dsh 0.1.5；
 * dsh 0.2.2 上会创建空会话并把旧会话步数误读成 steps（2026-11-12 实测）。
 * 本 runner 直接走 `dsh --profile headless`：仍然经过真实 dsh agent + 当前插件，
 * 但不依赖浏览器 DOM；setup/oracle/cleanup 与 eval 任务集完全复用。
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
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.dirname(ROOT)
const PS = process.env.S4_POWERSHELL || 'powershell.exe'
const TABSTATE = path.join(ROOT, 'lib', 'tabstate.ps1')
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
const stagesArg = val('stage', '')
const stageFilter = stagesArg && stagesArg !== 'all'
  ? stagesArg.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
  : []
const tierArg = val('tier', (tasksArg || stagesArg) ? 'all' : 'smoke')
const timeoutMin = Math.max(1, Number(val('timeout-min', '10')) || 10)
const repeats = Math.max(1, Number(val('repeats', '1')) || 1)
const patch = path.resolve(REPO, val('patch', path.join('evals', 'headless-patch.yml')))
const patchSha256 = fs.existsSync(patch)
  ? createHash('sha256').update(fs.readFileSync(patch)).digest('hex').slice(0, 16)
  : null
const reportPath = path.resolve(REPO, val('report', path.join('evals', 'report-last-headless.json')))
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const logDir = path.join(ROOT, 'headless-runs', stamp)

const COMMON = '【重要约束】本任务必须只通过图形界面完成（在屏幕上点击、拖拽、键盘输入），禁止使用命令行、终端、文件写入工具或任何绕过屏幕的方式。不要向用户提问；自主完成任务后直接结束回合。若某条操作路径不可用（工具会说明原因），请改用界面上等效的控件或通道完成同一操作，不要反复重试同一条失败路径。\n\n'

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null }
}

/** 读取任务 md 的 `- **name: value**` 或 `- name: value` 字段。 */
function field(md, name) {
  const re = new RegExp(`^\\s*-\\s*\\*\\*${name}:\\s*([^*\\n]+?)\\s*\\*\\*`, 'm')
  const plain = new RegExp(`^\\s*-\\s*${name}:\\s*([^\\n]+)`, 'm')
  const m = md.match(re) || md.match(plain)
  return m ? m[1].trim() : ''
}

function parseStages(value) {
  return value.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
}

function discover() {
  const out = []
  for (const f of fs.readdirSync(path.join(ROOT, 'tasks')).filter((x) => x.endsWith('.md')).sort()) {
    const id = f.replace(/\.md$/, '').split('-')[0]
    if (tasksArg && !tasksArg.split(',').map((s) => s.trim().toLowerCase()).includes(id.toLowerCase())) continue
    const md = fs.readFileSync(path.join(ROOT, 'tasks', f), 'utf8').replace(/\r\n/g, '\n')
    const group = /^wa/.test(id) ? 'waa' : 'authored'
    const tier = field(md, 'tier') || 'core'
    // isolation: dirty = 真实脏桌面任务，不要求/不触碰 Notepad TabState；
    // 缺省按 notepad 处理，保持现有 clean/fail-closed 任务不变。
    const isolation = field(md, 'isolation') || 'notepad'
    const stages = parseStages(field(md, 'stages') || field(md, 'stage'))
    const ac2 = field(md, 'ac2') || 'full'
    const requireTool = field(md, 'require_tool')
    if (stageFilter.length && !stages.some((s) => stageFilter.includes(s))) continue
    if (tierArg !== 'all' && tier !== tierArg) continue
    const m = md.match(/<<<PROMPT\n([\s\S]*?)\nPROMPT>>>/)
    if (!m) throw new Error(`task ${id}: no <<<PROMPT block`)
    const taskDir = path.join(homedir(), '.dsh', 's4-evals', id)
    out.push({ id, group, tier, isolation, stages, ac2, requireTool, prompt: m[1].replaceAll('{task_dir}', taskDir), taskDir })
  }
  return out
}

function run(cmd, cmdArgs, { timeoutMs = 120000, cwd = REPO, env = ENV } = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, cmdArgs, { cwd, env, windowsHide: true })
    let stdout = ''
    let stderr = ''
    let done = false
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); resolve(r) }
    const timer = setTimeout(async () => {
      try { p.kill() } catch {}
      // dsh 可能还有子进程；Windows 上用 taskkill /T 收尾，并等待它完成，
      // 否则 oracle 会在旧进程树还在操作桌面时运行。
      if (process.platform === 'win32' && p.pid) {
        await new Promise((res) => {
          let settled = false
          const done = () => { if (!settled) { settled = true; res() } }
          try {
            const k = spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true })
            k.on('close', done)
            k.on('error', done)
          } catch { done() }
          setTimeout(done, 5000)
        })
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

/** Notepad TabState 隔离：备份用户会话，每个任务前清 eval bin，跑完恢复。 */
async function tabState(action) {
  const r = await run(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', TABSTATE, action], { timeoutMs: 60000 })
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
    stages: task.stages, isolation: task.isolation, ac2: task.ac2,
    requireTool: task.requireTool || null, requireToolUsed: null,
    verdict: 'error', steps: 0, innerSteps: 0, toolErrors: 0, unverified: 0,
    timedOut: false, wallMs: 0, turn: null, final: '', oracle: null,
    setup: null, cleanup: null, dirty: false, notes: [],
  }
  const cl0 = await ps('cleanup', task.id)
  if (cl0.code !== 0 || cl0.json?.ok === false) {
    rec.notes.push(`initial cleanup failed: ${cl0.code} ${JSON.stringify(cl0.json?.checks || []).slice(0, 200)}`)
  }
  if (cl0.json?.dirty) {
    rec.dirty = true
    rec.notes.push('initial cleanup dirty: ' + JSON.stringify(cl0.json?.checks || []).slice(0, 200))
  }
  const su = await ps('setup', task.id)
  rec.setup = su.json || { code: su.code }
  if (su.code !== 0) {
    const envBlocked = su.code === 2 || Boolean(su.json?.envError)
    rec.envError = envBlocked ? String(su.json?.envError || 'setup env blocked').slice(0, 300) : null
    rec.notes.push('setup: ' + String(su.json?.envError || su.stderr || su.code).slice(0, 300))
    const cl = await ps('cleanup', task.id)
    rec.cleanup = cl.json || { code: cl.code }
    if (cl.json?.dirty) {
      rec.dirty = true
      rec.notes.push('cleanup dirty after setup failure')
    }
    rec.verdict = envBlocked ? 'env' : 'error'
    return rec
  }

  fs.mkdirSync(logDir, { recursive: true })
  const base = path.join(logDir, `${task.id}-r${runOne.round}`)
  const trajFile = `${base}.trajectory.jsonl`
  rec.trajectory = trajFile
  const runStarted = Date.now()
  const dr = await run(process.execPath, [
    DSH_ENTRY, '--profile', 'headless', '--patch', patch,
    '--permission-mode', 'read-only', '--approval-policy', 'never', '--json',
    COMMON + task.prompt,
  ], {
    timeoutMs: timeoutMin * 60000,
    env: { ...ENV, DSH_CU_TRAJECTORY_FILE: trajFile },
  })
  rec.wallMs = Date.now() - runStarted
  fs.writeFileSync(`${base}.jsonl`, dr.stdout)
  fs.writeFileSync(`${base}.err`, dr.stderr)
  const a = analyze(parseEvents(dr.stdout))
  rec.steps = a.toolCalls
  // computer_do 无冒号 = dispatcher status/catalog 外壳；有冒号 = 一次内层调用。
  rec.innerSteps = a.calls.filter((c) => c !== 'computer_do').length
  rec.toolErrors = a.toolErrors
  rec.unverified = a.unverified
  rec.timedOut = Boolean(dr.timedOut)
  rec.turn = a.turn
  rec.final = a.final.slice(0, 400)
  rec.calls = a.calls
  if (task.requireTool) {
    // dispatcher 模式下隐藏工具记为 `computer_do:computer_task`；直接调用记为原名。
    rec.requireToolUsed = a.calls.some((c) => c === task.requireTool || c.endsWith(':' + task.requireTool))
    if (!rec.requireToolUsed) rec.notes.push(`required tool not called: ${task.requireTool}`)
  }
  if (dr.code === 'SPAWN_ERR') rec.notes.push('dsh spawn: ' + dr.stderr.slice(0, 300))
  if (dr.timedOut) {
    rec.notes.push(`timeout ${timeoutMin}min; oracle skipped`)
    const cl = await ps('cleanup', task.id)
    rec.cleanup = cl.json || { code: cl.code }
    if (cl.json?.dirty) { rec.dirty = true; rec.notes.push('cleanup dirty after timeout') }
    rec.verdict = 'error'
    return rec
  }

  const orc = await ps('oracle', task.id)
  rec.oracle = orc.json || { code: orc.code }
  if (orc.code === 2 || orc.json?.envError) {
    rec.envError = String(orc.json?.envError || 'oracle env blocked').slice(0, 300)
    rec.verdict = 'env'
  } else {
    rec.verdict = orc.code === 0 ? 'pass' : orc.code === 1 ? 'fail' : 'error'
  }
  if (rec.verdict === 'pass' && task.requireTool && rec.requireToolUsed === false) {
    rec.verdict = 'fail'
    rec.notes.push(`oracle passed but required tool was not called: ${task.requireTool}`)
  }
  const cl1 = await ps('cleanup', task.id)
  rec.cleanup = cl1.json || { code: cl1.code }
  if (cl1.code !== 0 || cl1.json?.ok === false) {
    rec.notes.push(`cleanup failed: ${cl1.code}`)
    if (rec.verdict === 'pass') rec.verdict = 'error'
  }
  if (rec.cleanup?.dirty) {
    // Cleanup refused to close an unsafe window/tab. The task may still have passed,
    // but the environment is contaminated; do not count it as a clean pass.
    rec.dirty = true
    const details = (rec.cleanup.checks || []).filter((c) => c && c.ok === false).map((c) => c.detail || c.name).join('; ')
    rec.notes.push(('cleanup dirty: ' + details).slice(0, 300))
    if (rec.verdict === 'pass') rec.verdict = 'dirty'
  }
  return rec
}
runOne.round = 1

const tasks = discover()
if (!tasks.length) {
  console.error(`no tasks matched (stage=${stagesArg || 'all'}, tier=${tierArg}, tasks=${tasksArg || 'all'})`)
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

console.log(`headless eval: ${tasks.length} tasks, stage=${stagesArg || 'all'}, tier=${tierArg}, repeats=${repeats}, timeout=${timeoutMin}min`)
console.log(`dsh=${DSH_ENTRY}`)
console.log(`logs=${logDir}`)

// TabState 隔离只对 Notepad 任务需要：否则 Win11 Notepad 会把上一个任务的
// seed/draft/workfile 恢复进下一个任务的窗口。全 dirty 任务不碰 Notepad，
// 允许用户保持现有 Notepad 标签，不备份/不清空用户 TabState。
const needsTabState = tasks.some((t) => t.isolation !== 'dirty')
let tb = { json: { ok: true, skipped: true } }
if (needsTabState) {
  tb = await tabState('backup')
  if (!tb.json?.ok) {
    console.error(`tabstate backup failed: ${tb.json?.reason || tb.stderr || tb.code}`)
    console.error('close all Notepad windows (including windowless Notepad processes) and retry')
    process.exit(2)
  }
  console.log(`tabstate backup: ${tb.json.backup || '(none)'} moved=${tb.json.moved ?? 0}${tb.json.already ? ' (already active)' : ''}`)
} else {
  console.log('tabstate: skipped (dirty tasks only; user Notepad untouched)')
}

const runs = []
let tr = null
try {
  for (let r = 0; r < repeats; r++) {
    runOne.round = r + 1
    for (const task of tasks) {
      const rec = await runOne(task)
      rec.repeat = r + 1
      runs.push(rec)
      console.log(`\n== ${task.id} r${r + 1} -> ${rec.verdict} steps=${rec.steps} inner=${rec.innerSteps} err=${rec.toolErrors} unverified=${rec.unverified}${rec.timedOut ? ' timeout' : ''}${rec.dirty ? ' dirty' : ''}${rec.turn ? ' turn=' + rec.turn : ''}`)
      if (rec.oracle?.checks) console.log('   oracle:', rec.oracle.checks.map((c) => `${c.name}=${c.ok}`).join(' '))
    }
  }
} finally {
  // 中途异常也必须 restore，避免 active backup 留给下一次运行。
  if (needsTabState) {
    tr = await tabState('restore')
    if (!tr.json?.ok) {
      console.error(`tabstate restore failed: ${tr.json?.reason || tr.stderr || tr.code}`)
      if (tr.json?.backup) console.error(`backup kept at: ${tr.json.backup}; close test Notepad windows then run: powershell -File evals/lib/tabstate.ps1 restore`)
    }
  } else {
    tr = { json: { ok: true, skipped: true } }
  }
}

const summary = {
  startedAt: stamp,
  dshVersion: readJsonSafe(path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))?.version || 'unknown',
  pluginVersion: readJsonSafe(path.join(REPO, 'package.json'))?.version || 'unknown',
  stage: stagesArg || null,
  stageFilter,
  tier: tierArg,
  timeoutMin,
  repeats,
  patchPath: patch,
  patchSha256,
  tabState: { backup: tb.json, restore: tr.json },
  runs,
}
fs.mkdirSync(path.dirname(reportPath), { recursive: true })
fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2))

const scored = runs.filter((r) => r.verdict === 'pass' || r.verdict === 'fail')
const pass = scored.filter((r) => r.verdict === 'pass').length
const fail = scored.filter((r) => r.verdict === 'fail').length
const errors = runs.filter((r) => r.verdict === 'error').length
const envs = runs.filter((r) => r.verdict === 'env').length
const timeouts = runs.filter((r) => r.timedOut).length
const dirty = runs.filter((r) => r.dirty).length
const restoreOk = Boolean(tr.json?.ok)
console.log(`\nheadless eval: pass=${pass} fail=${fail} env=${envs} error=${errors} dirty=${dirty} total=${runs.length} timeout=${timeouts} tabstate=${restoreOk ? (tr.json?.skipped ? 'skipped' : 'restored') : 'RESTORE_FAILED'}`)
console.log(`report -> ${reportPath}`)
process.exit(errors || dirty || !restoreOk ? 1 : 0)
