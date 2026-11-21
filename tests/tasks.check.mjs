/**
 * 评测任务静态校验：S1-S4 阶段元数据、脚本四件套、AC2 一致性、计数与 P0 判定绑定。
 * 2026-11-21：新增 coverage.json、app/hotspot/security/isolation/require_tools 校验。
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
const coveragePath = join(root, 'evals', 'coverage.json')
const STAGES = ['S1', 'S2', 'S3', 'S4']
const ISOLATIONS = ['notepad', 'clean', 'dirty', 'both']
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

function listField(md, name) {
  return field(md, name).split(',').map((s) => s.trim()).filter(Boolean)
}

let coverage = null
try { coverage = JSON.parse(readFileSync(coveragePath, 'utf8')) } catch { coverage = null }
check('coverage.json 可读', Boolean(coverage))
const majorApps = coverage?.majorApps || []
const hotspots = coverage?.hotspots || {}
const securityGuarantees = coverage?.security || {}

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
  const requireTools = listField(md, 'require_tools')
  if (requireTool && !requireTools.includes(requireTool)) requireTools.unshift(requireTool)
  const apps = listField(md, 'app')
  const hotspot = field(md, 'hotspot')
  const requires = listField(md, 'requires')
  const security = listField(md, 'security')
  const securityExpect = field(md, 'security_expect')
  const patch = field(md, 'patch')

  check(`${id}: stages 非空且合法`, stages.length > 0 && stages.every((s) => STAGES.includes(s)), stages.join(',') || '(missing)')
  check(`${id}: stages 无重复`, new Set(stages).size === stages.length, stages.join(','))
  check(`${id}: S4 ⇔ isolation=dirty|both`, stages.includes('S4') === (isolation === 'dirty' || isolation === 'both'), `stages=${stages.join(',')} isolation=${isolation}`)
  check(`${id}: tier 合法`, ['smoke', 'core'].includes(tier), tier)
  check(`${id}: isolation 合法`, ISOLATIONS.includes(isolation), isolation)
  check(`${id}: ac2 合法`, ['full', 'none'].includes(ac2), ac2)
  check(`${id}: app 非空且已知`, apps.length > 0 && apps.every((a) => majorApps.includes(a) || a === 'other'), apps.join(',') || '(missing)')
  check(`${id}: hotspot 非空且已知`, Boolean(hotspot) && (hotspot === 'other' || Boolean(hotspots[hotspot])), hotspot || '(missing)')
  check(`${id}: both 需要 ac2=full`, isolation !== 'both' || ac2 === 'full', `isolation=${isolation} ac2=${ac2}`)
  check(`${id}: require_tools 合法`, requireTools.every((t) => t === 'computer_task' || t.startsWith('computer_')), requireTools.join(',') || '(none)')
  if (patch) check(`${id}: task patch 存在`, existsSync(join(root, patch)), patch)
  if (security.length) {
    check(`${id}: security 已知`, security.every((s) => Boolean(securityGuarantees[s])), security.join(','))
    check(`${id}: security_expect 合法`, ['refuse', 'allow'].includes(securityExpect), securityExpect || '(missing)')
    check(`${id}: security 任务声明 require_tools`, requireTools.length > 0, requireTools.join(',') || '(missing)')
  }

  const prompt = (md.match(/<<<PROMPT\n([\s\S]*?)\nPROMPT>>>/) || [null, ''])[1]
  check(`${id}: prompt 块存在`, /<<<PROMPT\n[\s\S]*?\nPROMPT>>>/.test(md))
  if (id === 't19') {
    check('t19: prompt 明确允许 Notepad 另存为', /Save As|Notepad/i.test(prompt), prompt.slice(0, 120))
    check('t19: prompt 禁止 Win+R 并指向 app_launch/开始菜单',
      /Do not use Win\+R/i.test(prompt) && /app_launch|Start menu/i.test(prompt), prompt.slice(0, 200))
  }
  if (id === 't20') {
    check('t20: prompt 允许键盘选择对话框按钮', /Tab|Enter|Escape/i.test(prompt)
      && !/Do not use keyboard shortcuts/i.test(prompt), prompt.slice(0, 160))
  }
  check(`${id}: ID 唯一`, !ids.has(id), id)
  ids.add(id)

  for (const kind of ['setup', 'oracle', 'cleanup']) {
    const p = join(root, 'evals', kind, `${id}.ps1`)
    check(`${id}: ${kind} 脚本存在`, existsSync(p), p.replace(root + '\\', ''))
  }
  const sim = join(root, 'evals', 'simulate', `${id}.ps1`)
  check(`${id}: simulate 与 ac2 一致`, ac2 === 'full' ? existsSync(sim) : !existsSync(sim), `ac2=${ac2} simulate=${existsSync(sim)}`)

  if (requireTool) {
    check(`${id}: require_tool 已知`, requireTool === 'computer_task' || requireTool.startsWith('computer_'), requireTool)
  }

  // 任务题面不能把本机绝对路径写死；`C:\Users\<you>` 这类占位符允许。
  const machinePath = /F:\\Codex_Work_Space|C:\\Users\\(?!<you>)|(^|[^A-Za-z])\/Users\//.test(md)
  check(`${id}: 无本机绝对路径`, !machinePath)

  tasks.push({ id, file: f, md, stages, tier, isolation, ac2, requireTool, requireTools, apps, hotspot, requires, security, securityExpect })
}

const unique = tasks.length
const counts = Object.fromEntries(STAGES.map((s) => [s, tasks.filter((t) => t.stages.includes(s)).length]))
const memberships = tasks.reduce((n, t) => n + t.stages.length, 0)

check('任务总数 == 40', unique === 40, String(unique))
check('S1 成员 == 10', counts.S1 === 10, String(counts.S1))
check('S2 成员 == 5', counts.S2 === 5, String(counts.S2))
check('S3 成员 == 25', counts.S3 === 25, String(counts.S3))
check('S4 成员 == 17', counts.S4 === 17, String(counts.S4))
check('阶段成员合计 == 57', memberships === 57, String(memberships))

// 每个主要应用至少两条任务（正常 + 边界/失败/组合）。
for (const app of majorApps) {
  const n = tasks.filter((t) => t.apps.includes(app)).length
  check(`major app ${app} >= 2 tasks`, n >= 2, `actual=${n}`)
}

// coverage 证据 ID：t* 必须是任务；probe/test/eval 前缀必须是现有脚本。
function evidenceExists(ref) {
  if (ids.has(ref)) return true
  if (ref.startsWith('probe:')) return existsSync(join(root, 'evals', `${ref.slice(6)}.mjs`))
  if (ref.startsWith('test:')) return existsSync(join(root, 'tests', `${ref.slice(5)}.mjs`))
  if (ref.startsWith('eval:')) return existsSync(join(root, 'evals', `${ref.slice(5)}.mjs`))
  return false
}
for (const [slug, entry] of Object.entries(hotspots)) {
  const pos = Array.isArray(entry.positive) ? entry.positive : []
  const neg = Array.isArray(entry.negative) ? entry.negative : []
  check(`hotspot ${slug}: positive 非空`, pos.length > 0)
  check(`hotspot ${slug}: negative 非空`, neg.length > 0)
  check(`hotspot ${slug}: positive 证据存在`, pos.every(evidenceExists), pos.join(','))
  check(`hotspot ${slug}: negative 证据存在`, neg.every(evidenceExists), neg.join(','))
}
for (const [slug, refs] of Object.entries(securityGuarantees)) {
  check(`security ${slug}: 证据存在`, Array.isArray(refs) && refs.length > 0 && refs.every(evidenceExists), (refs || []).join(','))
}

let facts = null
try { facts = JSON.parse(readFileSync(factsPath, 'utf8')) } catch { facts = null }
check('docs.facts.json 可读', Boolean(facts))
if (facts) {
  check('facts.evalTasks == 40', facts.evalTasks === unique, `facts=${facts.evalTasks} actual=${unique}`)
  for (const s of STAGES) {
    const key = `stage${s}`
    check(`facts.${key} == ${counts[s]}`, facts[key] === counts[s], `facts=${facts[key]} actual=${counts[s]}`)
  }
  check('facts.stageMemberships == 57', facts.stageMemberships === memberships, `facts=${facts.stageMemberships} actual=${memberships}`)
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
check('P0 t05: oracle 检查 src 无 out-ansi.txt 残留', /src\\out-ansi\.txt/.test(t05Oracle))

const t07Oracle = src('oracle', 't07')
check('P0 t07: oracle 按 state HWND 读取', /test-notepad\.json/.test(t07Oracle) && /Get-Placement/.test(t07Oracle))

const x1 = tasks.find((t) => t.id === 'x1')
check('P0 x1: 声明 require_tool', x1?.requireTool === 'computer_task', x1?.requireTool || '')
check('P0 x1: prompt 不再允许自己操作', Boolean(x1) && !/你也可以自己操作/.test(x1.md))
const runner = readFileSync(join(root, 'evals', 'headless-run.mjs'), 'utf8')
check('P0 x1: runner 执行 require_tool', /requireToolUsed|requireToolsUsed/.test(runner) && /required tool/.test(runner))

// 文档/退役/阻塞清单一致性：这些是人工最容易漂移的入口。
const evalsReadme = readFileSync(join(root, 'evals', 'README.md'), 'utf8')
check('docs: evals/README 阶段计数', /S1 10 \/ S2 5 \/ S3 25 \/ S4 17/.test(evalsReadme)
  && /成员合计 \*\*57\*\*/.test(evalsReadme) && /唯一任务 \*\*40\*\*/.test(evalsReadme))
check('docs: evals/README simulate 39', /simulate\/\s+39 个/.test(evalsReadme))
check('docs: RETIRED 记录 t02/t08', existsSync(join(root, 'evals', 'RETIRED.md'))
  && /`t02`/.test(readFileSync(join(root, 'evals', 'RETIRED.md'), 'utf8'))
  && /`t08`/.test(readFileSync(join(root, 'evals', 'RETIRED.md'), 'utf8')))
check('docs: BLOCKED 清单存在', existsSync(join(root, 'evals', 'BLOCKED.md')))
const taskNames = readdirSync(join(root, 'evals', 'tasks'))
check('docs: 退役任务未回到 tasks/', !taskNames.some((f) => /^t0[28]-/.test(f)))

const failed = checks.filter((c) => !c.ok)
console.log(`\n结果：${failed.length === 0 ? '✅ 全部通过' : `❌ ${failed.length} 项失败`}（${checks.length} 项检查）`)
process.exit(failed.length === 0 ? 0 : 1)
