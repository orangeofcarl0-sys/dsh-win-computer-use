/**
 * 评测任务静态校验：S1-S4 阶段元数据、脚本四件套、AC2 一致性、计数与 P0 判定绑定。
 *
 * 不执行 PowerShell、不联网、不写文件；由 `npm run check` 调用。
 * 运行：node tests/tasks.check.mjs
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const tasksDir = join(root, 'evals', 'tasks')
const factsPath = join(root, 'tests', 'docs.facts.json')
const STAGES = ['S1', 'S2', 'S3', 'S4']
const checks = []

function check(name, ok, detail = '') {
  checks.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

/** 读取任务 md 的 `- **name: value**` 或 `- name: value` 字段。 */
function field(md, name) {
  const re = new RegExp(`^\\s*-\\s*\\*\\*${name}:\\s*([^*\\n]+?)\\s*\\*\\*`, 'm')
  const plain = new RegExp(`^\\s*-\\s*${name}:\\s*([^\\n]+)`, 'm')
  const m = md.match(re) || md.match(plain)
  return m ? m[1].trim() : ''
}

const files = readdirSync(tasksDir).filter((f) => f.endsWith('.md')).sort()
const tasks = []
const ids = new Set()

for (const f of files) {
  const id = f.replace(/\.md$/, '').split('-')[0]
  const md = readFileSync(join(tasksDir, f), 'utf8').replace(/\r\n/g, '\n')
  const stages = (field(md, 'stages') || field(md, 'stage'))
    .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
  const tier = field(md, 'tier') || 'core'
  const isolation = field(md, 'isolation') || 'notepad'
  const ac2 = field(md, 'ac2') || 'full'
  const requireTool = field(md, 'require_tool')

  check(`${id}: stages 非空且合法`, stages.length > 0 && stages.every((s) => STAGES.includes(s)), stages.join(',') || '(missing)')
  check(`${id}: stages 无重复`, new Set(stages).size === stages.length, stages.join(','))
  check(`${id}: S4 ⇔ isolation=dirty`, stages.includes('S4') === (isolation === 'dirty'), `stages=${stages.join(',')} isolation=${isolation}`)
  check(`${id}: tier 合法`, ['smoke', 'core'].includes(tier), tier)
  check(`${id}: isolation 合法`, ['notepad', 'dirty'].includes(isolation), isolation)
  check(`${id}: ac2 合法`, ['full', 'none'].includes(ac2), ac2)
  check(`${id}: prompt 块存在`, /<<<PROMPT\n[\s\S]*?\nPROMPT>>>/.test(md))
  check(`${id}: ID 唯一`, !ids.has(id), id)
  ids.add(id)

  for (const kind of ['setup', 'oracle', 'cleanup']) {
    const p = join(root, 'evals', kind, `${id}.ps1`)
    check(`${id}: ${kind} 脚本存在`, existsSync(p), p.replace(root + '\\', ''))
  }
  const sim = join(root, 'evals', 'simulate', `${id}.ps1`)
  check(`${id}: simulate 与 ac2 一致`, ac2 === 'full' ? existsSync(sim) : !existsSync(sim), `ac2=${ac2} simulate=${existsSync(sim)}`)

  if (requireTool) {
    check(`${id}: require_tool 已知`, requireTool === 'computer_task', requireTool)
  }

  // 任务题面不能把本机绝对路径写死；`C:\Users\<you>` 这类占位符允许。
  const machinePath = /F:\\Codex_Work_Space|C:\\Users\\(?!<you>)|(^|[^A-Za-z])\/Users\//.test(md)
  check(`${id}: 无本机绝对路径`, !machinePath)

  tasks.push({ id, file: f, md, stages, tier, isolation, ac2, requireTool })
}

const unique = tasks.length
const counts = Object.fromEntries(STAGES.map((s) => [s, tasks.filter((t) => t.stages.includes(s)).length]))
const memberships = tasks.reduce((n, t) => n + t.stages.length, 0)

check('任务总数 == 17', unique === 17, String(unique))
check('S1 成员 == 9', counts.S1 === 9, String(counts.S1))
check('S2 成员 == 1', counts.S2 === 1, String(counts.S2))
check('S3 成员 == 7', counts.S3 === 7, String(counts.S3))
check('S4 成员 == 7', counts.S4 === 7, String(counts.S4))
check('阶段成员合计 == 24', memberships === 24, String(memberships))

let facts = null
try { facts = JSON.parse(readFileSync(factsPath, 'utf8')) } catch { facts = null }
check('docs.facts.json 可读', Boolean(facts))
if (facts) {
  check('facts.evalTasks == 17', facts.evalTasks === unique, `facts=${facts.evalTasks} actual=${unique}`)
  for (const s of STAGES) {
    const key = `stage${s}`
    check(`facts.${key} == ${counts[s]}`, facts[key] === counts[s], `facts=${facts[key]} actual=${counts[s]}`)
  }
  check('facts.stageMemberships == 24', facts.stageMemberships === memberships, `facts=${facts.stageMemberships} actual=${memberships}`)
}

// P0 判定绑定：这些检查保证修复不会被后续编辑悄悄回退。
const src = (kind, id) => {
  const p = join(root, 'evals', kind, `${id}.ps1`)
  return existsSync(p) ? readFileSync(p, 'utf8') : ''
}
const t03Setup = src('setup', 't03')
const t03Oracle = src('oracle', 't03')
check('P0 t03: setup 有 keep.txt 哨兵', /keep\.txt/.test(t03Setup))
check('P0 t03: oracle 检查目录无多余文件', /keep\.txt/.test(t03Oracle) && /Get-ChildItem/.test(t03Oracle))

const t04Setup = src('setup', 't04')
const t04Oracle = src('oracle', 't04')
check('P0 t04: setup 记录 owned Calculator state', /test-calculator\.json/.test(t04Setup) && /owned/.test(t04Setup))
check('P0 t04: oracle 按 state HWND 读取', /test-calculator\.json/.test(t04Oracle) && /FromHandle/.test(t04Oracle))

const t05Setup = src('setup', 't05')
const t05Oracle = src('oracle', 't05')
const t05Sim = src('simulate', 't05')
check('P0 t05: payload 含非 ASCII', /0x00E9/.test(t05Setup) && /0x00E9/.test(t05Oracle) && /0x00E9/.test(t05Sim))
check('P0 t05: oracle 用 Encoding.Default', /Encoding\]::Default/.test(t05Oracle))

const t07Oracle = src('oracle', 't07')
check('P0 t07: oracle 按 state HWND 读取', /test-notepad\.json/.test(t07Oracle) && /Get-Placement/.test(t07Oracle))

const x1 = tasks.find((t) => t.id === 'x1')
check('P0 x1: 声明 require_tool', x1?.requireTool === 'computer_task', x1?.requireTool || '')
check('P0 x1: prompt 不再允许自己操作', Boolean(x1) && !/你也可以自己操作/.test(x1.md))
const runner = readFileSync(join(root, 'evals', 'headless-run.mjs'), 'utf8')
check('P0 x1: runner 执行 require_tool', /requireToolUsed/.test(runner) && /required tool not called/.test(runner))

const failed = checks.filter((c) => !c.ok)
console.log(`\n结果：${failed.length === 0 ? '✅ 全部通过' : `❌ ${failed.length} 项失败`}（${checks.length} 项检查）`)
process.exit(failed.length === 0 ? 0 : 1)
