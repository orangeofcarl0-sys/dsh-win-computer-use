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
 *   node evals/headless-run.mjs --tasks t21,t22,a11y01 --variants 3 --timeout-min 10
 *   node evals/headless-run.mjs --tier all --timeout-min 10 --report evals/report-last-headless.json
 *
 * 参数化：任务 md 声明 `variants: N` 时，`--variants N` 会把该任务跑 1..N；
 * 未声明的任务只跑 variant 1。每个 run 通过 `S4_VARIANT` 传给 setup/oracle/
 * simulate/cleanup；prompt 中的 `{{key}}` 由 evals/variants/<id>.json 渲染。
 *
 * 前置：
 *   - headless profile 的 node_modules 里可解析 dsh-win-computer-use；
 *   - DSH_BIN 指向 dsh 的 lib/bin.js（默认从全局 npm 路径推断）；
 *   - PowerShell 可用；TEMP/TMP 会在子进程里指到用户临时目录（Add-Type 需要）。
 * 产物：
 *   - evals/headless-runs/<stamp>/<task>-v<n>-r<n>.jsonl / .err（已 gitignore）
 *   - evals/report-last-headless.json（已 gitignore）
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { homedir, release } from 'node:os'
import { fileURLToPath } from 'node:url'
import { runProcess } from './lib/run.mjs'

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
const isolationArg = val('isolation', '')
const isolationFilter = isolationArg && isolationArg !== 'all' ? isolationArg.toLowerCase() : ''
if (isolationFilter && !['clean', 'dirty'].includes(isolationFilter)) {
  console.error(`invalid --isolation: ${isolationArg} (expected clean|dirty)`)
  process.exit(2)
}
const variantsArg = val('variants', '1')
const variantsRequested = Number(variantsArg)
if (!Number.isInteger(variantsRequested) || variantsRequested < 1 || variantsRequested > 9) {
  console.error(`invalid --variants: ${variantsArg} (expected integer 1..9)`)
  process.exit(2)
}
const timeoutMin = Math.max(1, Number(val('timeout-min', '10')) || 10)
const repeats = Math.max(1, Number(val('repeats', '1')) || 1)
const patch = path.resolve(REPO, val('patch', path.join('evals', 'headless-patch.yml')))
const patchSha256 = fs.existsSync(patch)
  ? createHash('sha256').update(fs.readFileSync(patch)).digest('hex').slice(0, 16)
  : null
const reportPath = path.resolve(REPO, val('report', path.join('evals', 'report-last-headless.json')))
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const logDir = path.join(ROOT, 'headless-runs', stamp)

const COMMON = '【重要约束】本任务必须只通过图形界面完成（在屏幕上点击、拖拽、键盘输入），禁止使用命令行、终端、文件写入工具或任何绕过屏幕的方式。不要向用户提问；自主完成任务后直接结束回合。若某条操作路径不可用（工具会说明原因），请改用界面上等效的控件或通道完成同一操作，不要反复重试同一条失败路径。观察时显式指定任务相关窗口（标题子串/pid/window_id）；不要依赖无目标的“最前窗口”，也不要跟随无关的前台窗口。\n\n'

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

function parseList(value) {
  return String(value || '').split(',').map((s) => s.trim()).filter(Boolean)
}

function normalizeIsolation(value) {
  const v = String(value || 'notepad').toLowerCase()
  return v === 'notepad' ? 'clean' : v
}

function supportsIsolation(raw, mode) {
  const v = normalizeIsolation(raw)
  return v === 'both' || v === mode
}

function effectiveIsolation(raw) {
  if (isolationFilter) return isolationFilter
  const v = normalizeIsolation(raw)
  return v === 'both' ? 'clean' : v
}

/** 从 overlay 读取 agent-default-model 的 provider/model（不读取任何密钥）。 */
function readModelRoute(file) {
  try {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
    let inBlock = false
    let provider = ''
    let model = ''
    for (const line of lines) {
      if (/^\s*-\s*id:\s*agent-default-model\b/.test(line)) { inBlock = true; continue }
      if (inBlock && /^\s*-\s*[A-Za-z]/.test(line) && !/^\s+/.test(line)) break
      if (!inBlock) continue
      const p = /^\s*provider:\s*(\S+)/.exec(line)
      if (p) provider = p[1]
      const m = /^\s*model:\s*(\S+)/.exec(line)
      if (m) model = m[1]
    }
    return provider || model ? { provider: provider || null, model: model || null } : null
  } catch { return null }
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
    // clean/notepad = 任务沙箱；both = 两种模式都支持。缺省按 clean 处理。
    const isolation = field(md, 'isolation') || 'notepad'
    const isolationEffective = effectiveIsolation(isolation)
    const stages = parseStages(field(md, 'stages') || field(md, 'stage'))
    const ac2 = field(md, 'ac2') || 'full'
    const requireTool = field(md, 'require_tool')
    const requireTools = parseList(field(md, 'require_tools'))
    if (requireTool && !requireTools.includes(requireTool)) requireTools.unshift(requireTool)
    const apps = parseList(field(md, 'app'))
    const hotspot = field(md, 'hotspot')
    const requires = parseList(field(md, 'requires'))
    const security = parseList(field(md, 'security'))
    const securityExpect = field(md, 'security_expect')
    const taskPatchRaw = field(md, 'patch')
    const taskPatch = taskPatchRaw ? path.resolve(REPO, taskPatchRaw) : patch
    const variants = Math.max(1, Number(field(md, 'variants')) || 1)
    const variantsPath = path.join(ROOT, 'variants', `${id}.json`)
    if (variants > 1 && !fs.existsSync(variantsPath)) {
      throw new Error(`task ${id}: variants=${variants} but ${variantsPath} is missing`)
    }
    if (isolationFilter && !supportsIsolation(isolation, isolationFilter)) continue
    if (stageFilter.length && !stages.some((s) => stageFilter.includes(s))) continue
    if (tierArg !== 'all' && tier !== tierArg) continue
    const m = md.match(/<<<PROMPT\n([\s\S]*?)\nPROMPT>>>/)
    if (!m) throw new Error(`task ${id}: no <<<PROMPT block`)
    const taskDir = path.join(homedir(), '.dsh', 's4-evals', id)
    out.push({ id, group, tier, isolation, isolationEffective, stages, ac2, requireTool, requireTools, apps, hotspot, requires, security, securityExpect, patch: taskPatch, promptTemplate: m[1], taskDir, variants, variantsPath })
  }
  return out
}

/** 读取 evals/variants/<id>.json 的某一项；未声明 variants 的任务返回空对象。 */
function loadVariantData(task, variant) {
  if (!task.variantsPath || !fs.existsSync(task.variantsPath)) return {}
  const all = readJsonSafe(task.variantsPath)
  const data = all?.[String(variant)]
  if (!data || typeof data !== 'object') {
    throw new Error(`task ${task.id}: variant ${variant} missing in ${task.variantsPath}`)
  }
  return data
}

/** 渲染 prompt 的 `{{key}}` 与 `{task_dir}`；缺 key 直接报错，不把占位符发给模型。 */
function renderPrompt(task, variant) {
  const data = loadVariantData(task, variant)
  const text = task.promptTemplate.replace(/\{\{([A-Za-z0-9_.-]+)\}\}/g, (_, key) => {
    if (!(key in data)) throw new Error(`task ${task.id}: variant ${variant} missing key ${key}`)
    return String(data[key])
  })
  return text.replaceAll('{task_dir}', task.taskDir)
}

/** 统一注入 eval 的 cwd/env；超时与 720s 边界语义在 lib/run.mjs。 */
function run(cmd, cmdArgs, opts = {}) {
  return runProcess(cmd, cmdArgs, { cwd: REPO, env: ENV, ...opts })
}

async function ps(kind, id, isolation = 'clean', variant = 1) {
  const started = Date.now()
  const r = await run(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, kind, `${id}.ps1`), id], {
    timeoutMs: 120000,
    env: { ...ENV, S4_ISOLATION: isolation, S4_VARIANT: String(variant) },
  })
  let json = null
  for (const line of r.stdout.split(/\r?\n/)) {
    if (!line.trim().startsWith('{')) continue
    try { json = JSON.parse(line) } catch {}
  }
  return { code: r.code, json, stderr: r.stderr, durMs: Date.now() - started }
}

/**
 * 每个 run 前清掉上一轮 eval 写入的 Notepad TabState bins。
 * 只有 marker 存在（用户 TabState 已备份）时才删；否则绝不碰用户会话。
 * 用 JS 实现而不是新增 tabstate.ps1 动作，避免 PowerShell 解析/作用域坑。
 */
function clearEvalTabState() {
  const marker = path.join(homedir(), '.dsh', 's4-evals', '_tabstate-active.json')
  if (!fs.existsSync(marker)) return { ok: true, skipped: true, removed: 0 }
  const stateDir = path.join(process.env.LOCALAPPDATA || '',
    'Packages', 'Microsoft.WindowsNotepad_8wekyb3d8bbwe', 'LocalState', 'TabState')
  if (!fs.existsSync(stateDir)) return { ok: true, removed: 0 }
  let removed = 0
  for (const f of fs.readdirSync(stateDir)) {
    if (!f.endsWith('.bin')) continue
    try { fs.rmSync(path.join(stateDir, f)); removed++ } catch { /* 单个 bin 失败不阻断 */ }
  }
  return { ok: true, removed }
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
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, steps: 0 }
  for (const e of events) {
    if (e.type !== 'status' || e.phase !== 'step_end' || !e.usage) continue
    tokens.steps++
    tokens.input += Number(e.usage.inputTokens) || 0
    tokens.output += Number(e.usage.outputTokens) || 0
    tokens.cacheRead += Number(e.usage.cacheReadTokens) || 0
    tokens.cacheWrite += Number(e.usage.cacheWriteTokens) || 0
    tokens.total += Number(e.usage.totalTokens) || 0
  }
  const end = [...events].reverse().find((e) => e.type === 'turn_end')
  const final = [...events].reverse().find((e) => e.type === 'final')
  return {
    toolCalls: toolCalls.length,
    toolErrors,
    unverified,
    tokens,
    turn: end?.reason?.kind || null,
    final: final?.text || '',
    noFinal: !final,
    calls: toolCalls.map((c) => `${c.tool}${c.input?.tool ? ':' + c.input.tool : ''}`),
  }
}

async function runOne(task, variant = 1) {
  // Render before any setup/cleanup so a bad variant file leaves no fixture behind.
  const renderedPrompt = renderPrompt(task, variant)
  const rec = {
    id: task.id, group: task.group, tier: task.tier,
    variant, variantsDeclared: task.variants,
    variantData: task.variants > 1 ? loadVariantData(task, variant) : null,
    stages: task.stages, isolation: task.isolation,
    isolationTask: task.isolation, isolationEffective: task.isolationEffective,
    apps: task.apps, hotspot: task.hotspot, requires: task.requires,
    security: task.security, securityExpect: task.securityExpect || null,
    patch: task.patch,
    ac2: task.ac2,
    requireTool: task.requireTool || null,
    requireTools: task.requireTools,
    requireToolUsed: null, requireToolsUsed: null,
    verdict: 'error', steps: 0, innerSteps: 0, toolErrors: 0, unverified: 0,
    tokens: null, timedOut: false, budgetExhausted: false, noFinal: false,
    wallMs: 0, turn: null, final: '', oracle: null,
    setup: null, cleanup: null, dirty: false, notes: [],
    setupMs: 0, initialCleanupMs: 0, oracleMs: 0, cleanupMs: 0,
  }
  const psTask = (kind) => ps(kind, task.id, task.isolationEffective, variant)
  const cl0 = await psTask('cleanup')
  rec.initialCleanupMs = cl0.durMs
  if (cl0.code !== 0 || cl0.json?.ok === false) {
    rec.notes.push(`initial cleanup failed: ${cl0.code} ${JSON.stringify(cl0.json?.checks || []).slice(0, 200)}`)
  }
  if (cl0.json?.dirty) {
    rec.dirty = true
    rec.notes.push('initial cleanup dirty: ' + JSON.stringify(cl0.json?.checks || []).slice(0, 200))
  }
  // 上一轮 eval 的 TabState bins 会让下一轮 Notepad 恢复旧标签（t19 r2 实证）。
  // 只有 clean 模式才清；dirty 模式不碰用户 Notepad 会话。
  if (task.isolationEffective === 'clean') {
    const tclear = clearEvalTabState()
    if (tclear.removed > 0) rec.notes.push(`tabstate clear-eval removed=${tclear.removed}`)
  }
  const su = await psTask('setup')
  rec.setupMs = su.durMs
  rec.setup = su.json || { code: su.code }
  if (su.code !== 0) {
    const envBlocked = su.code === 2 || Boolean(su.json?.envError)
    rec.envError = envBlocked ? String(su.json?.envError || 'setup env blocked').slice(0, 300) : null
    rec.notes.push('setup: ' + String(su.json?.envError || su.stderr || su.code).slice(0, 300))
    const cl = await psTask('cleanup')
    rec.cleanupMs = cl.durMs
    rec.cleanup = cl.json || { code: cl.code }
    if (cl.json?.dirty) {
      rec.dirty = true
      rec.notes.push('cleanup dirty after setup failure')
    }
    rec.verdict = envBlocked ? 'env' : 'error'
    return rec
  }

  fs.mkdirSync(logDir, { recursive: true })
  const base = path.join(logDir, `${task.id}-v${variant}-r${runOne.round}`)
  const trajFile = `${base}.trajectory.jsonl`
  rec.trajectory = trajFile
  const runStarted = Date.now()
  const dr = await run(process.execPath, [
    DSH_ENTRY, '--profile', 'headless', '--patch', task.patch,
    '--permission-mode', 'read-only', '--approval-policy', 'never', '--json',
    COMMON + renderedPrompt,
  ], {
    timeoutMs: timeoutMin * 60000,
    env: { ...ENV, DSH_CU_TRAJECTORY_FILE: trajFile, S4_VARIANT: String(variant) },
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
  rec.tokens = a.tokens
  rec.timedOut = Boolean(dr.timedOut)
  rec.noFinal = a.noFinal
  rec.budgetExhausted = Boolean(dr.timedOut
    || (rec.wallMs >= timeoutMin * 60000 - 2000 && a.noFinal))
  rec.turn = a.turn
  rec.final = a.final.slice(0, 400)
  rec.calls = a.calls
  if (task.requireTools.length) {
    // dispatcher 模式下隐藏工具记为 `computer_do:computer_task`；直接调用记为原名。
    rec.requireToolsUsed = Object.fromEntries(task.requireTools.map((t) => [
      t,
      a.calls.some((c) => c === t || c.endsWith(':' + t)),
    ]))
    const missing = task.requireTools.filter((t) => !rec.requireToolsUsed[t])
    if (missing.length) rec.notes.push(`required tools not called: ${missing.join(',')}`)
    rec.requireToolUsed = task.requireTool ? rec.requireToolsUsed[task.requireTool] : null
  }
  if (dr.code === 'SPAWN_ERR') {
    rec.notes.push('dsh spawn: ' + dr.stderr.slice(0, 300))
    const cl = await psTask('cleanup')
    rec.cleanupMs = cl.durMs
    rec.cleanup = cl.json || { code: cl.code }
    if (cl.json?.dirty) { rec.dirty = true; rec.notes.push('cleanup dirty after spawn failure') }
    rec.verdict = 'error'
    return rec
  }
  if (rec.budgetExhausted) {
    rec.notes.push(dr.timedOut
      ? `timeout ${timeoutMin}min; oracle skipped`
      : `wall clock reached ${Math.round(rec.wallMs / 1000)}s with no final; treated as budget exhausted; oracle skipped`)
    const cl = await psTask('cleanup')
    rec.cleanupMs = cl.durMs
    rec.cleanup = cl.json || { code: cl.code }
    if (cl.json?.dirty) { rec.dirty = true; rec.notes.push('cleanup dirty after budget exhaustion') }
    rec.verdict = 'timeout'
    return rec
  }

  const orc = await psTask('oracle')
  rec.oracleMs = orc.durMs
  rec.oracle = orc.json || { code: orc.code }
  if (orc.code === 2 || orc.json?.envError) {
    rec.envError = String(orc.json?.envError || 'oracle env blocked').slice(0, 300)
    rec.verdict = 'env'
  } else {
    rec.verdict = orc.code === 0 ? 'pass' : orc.code === 1 ? 'fail' : 'error'
  }
  if (rec.verdict === 'pass' && task.requireTools.length) {
    const missing = task.requireTools.filter((t) => !rec.requireToolsUsed?.[t])
    if (missing.length) {
      rec.verdict = 'fail'
      rec.notes.push(`oracle passed but required tools were not called: ${missing.join(',')}`)
    }
  }
  const cl1 = await psTask('cleanup')
  rec.cleanupMs = cl1.durMs
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
const plannedRuns = tasks.reduce((n, t) => n + Math.min(variantsRequested, t.variants), 0) * repeats
if (!fs.existsSync(DSH_ENTRY)) {
  console.error(`dsh entry not found: ${DSH_ENTRY}\nset DSH_BIN to .../@deepseek-ai/dsh/lib/bin.js`)
  process.exit(1)
}
if (!fs.existsSync(patch)) {
  console.error(`patch not found: ${patch}`)
  process.exit(1)
}

console.log(`headless eval: ${tasks.length} tasks, runs=${plannedRuns}, stage=${stagesArg || 'all'}, tier=${tierArg}, isolation=${isolationFilter || 'mixed'}, variants=${variantsRequested}, repeats=${repeats}, timeout=${timeoutMin}min`)
console.log(`dsh=${DSH_ENTRY}`)
console.log(`logs=${logDir}`)

// TabState 隔离只对 clean 任务需要：否则 Win11 Notepad 会把上一个任务的
// seed/draft/workfile 恢复进下一个任务的窗口。dirty 任务不碰 Notepad，
// 允许用户保持现有 Notepad 标签，不备份/不清空用户 TabState。
const needsTabState = tasks.some((t) => t.isolationEffective === 'clean')
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
      const variantCount = Math.min(variantsRequested, task.variants)
      for (let variant = 1; variant <= variantCount; variant++) {
        const rec = await runOne(task, variant)
        rec.repeat = r + 1
        runs.push(rec)
        console.log(`\n== ${task.id} v${variant} r${r + 1} -> ${rec.verdict} steps=${rec.steps} inner=${rec.innerSteps} err=${rec.toolErrors} unverified=${rec.unverified}${rec.timedOut ? ' timeout' : ''}${rec.dirty ? ' dirty' : ''}${rec.turn ? ' turn=' + rec.turn : ''}`)
        if (rec.oracle?.checks) console.log('   oracle:', rec.oracle.checks.map((c) => `${c.name}=${c.ok}`).join(' '))
      }
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
  isolation: isolationFilter || 'mixed',
  isolationFilter: isolationFilter || null,
  timeoutMin,
  repeats,
  variants: variantsRequested,
  patchPath: patch,
  patchSha256,
  modelRoute: readModelRoute(patch),
  env: {
    platform: process.platform,
    release: release(),
    arch: process.arch,
    node: process.version,
    powershell: PS,
    temp: TEMP,
    dshEntry: DSH_ENTRY,
  },
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
const timeouts = runs.filter((r) => r.verdict === 'timeout' || r.budgetExhausted).length
const dirty = runs.filter((r) => r.dirty).length
const restoreOk = Boolean(tr.json?.ok)
console.log(`\nheadless eval: pass=${pass} fail=${fail} env=${envs} error=${errors} timeout=${timeouts} dirty=${dirty} total=${runs.length} tabstate=${restoreOk ? (tr.json?.skipped ? 'skipped' : 'restored') : 'RESTORE_FAILED'}`)
console.log(`report -> ${reportPath}`)
process.exit(errors || timeouts || dirty || !restoreOk ? 1 : 0)
