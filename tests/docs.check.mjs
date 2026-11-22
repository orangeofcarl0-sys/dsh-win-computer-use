/**
 * 文档一致性检查（无第三方依赖）。
 *
 * 目的：把“文档漂移”变成可失败的检查，而不是靠发布前人工 grep。
 * 检查：工具名/数量、Config 键/数量、方括号错误码、相对链接、过期数字、
 *       关键事实值、标题编号、机器特定绝对路径。
 *
 * 运行：node tests/docs.check.mjs（npm run docs:check）
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const facts = JSON.parse(readFileSync(join(root, 'tests/docs.facts.json'), 'utf8'))
let failures = 0
let checks = 0

function ok(name, detail = '') {
  checks++
  console.log(`✅ ${name}${detail ? ` — ${detail}` : ''}`)
}
function fail(name, detail = '') {
  checks++
  failures++
  console.log(`❌ ${name}${detail ? ` — ${detail}` : ''}`)
}
function read(rel) {
  return readFileSync(join(root, rel), 'utf8')
}
function walkMarkdown(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === '.dsh-test' || name === 'headless-runs' || name === 'verify-runs') continue
    const abs = join(dir, name)
    const st = statSync(abs)
    if (st.isDirectory()) walkMarkdown(abs, out)
    else if (name.endsWith('.md')) out.push(abs)
  }
  return out
}
function stripFences(text) {
  return text.replace(/```[\s\S]*?```/g, '')
}
function lineOf(text, index) {
  return text.slice(0, index).split('\n').length
}

// ── 1. 工具名与数量 ────────────────────────────────────────────────
const indexJs = read('index.js')
const toolNames = [...new Set([...indexJs.matchAll(/name:\s*'((?:screen|computer|app)_[a-z0-9_]+)'/g)].map((m) => m[1]))].sort()
if (toolNames.length === facts.toolCount) ok('工具数量', `${toolNames.length} 个`)
else fail('工具数量', `期望 ${facts.toolCount}，实际 ${toolNames.length}：${toolNames.join(', ')}`)

const toolsDoc = read('docs/TOOLS.md')
const missingTools = toolNames.filter((n) => !toolsDoc.includes(n))
if (missingTools.length === 0) ok('TOOLS.md 覆盖全部工具名', `${toolNames.length} 个`)
else fail('TOOLS.md 缺少工具', missingTools.join(', '))

const dispatcherJs = read('lib/dispatcher.js')
const arr = (name) => {
  const m = dispatcherJs.match(new RegExp(`${name}\\s*=\\s*(?:Object\\.freeze\\()?\\[([\\s\\S]*?)\\]`, 's'))
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : []
}
const stable = arr('STABLE_TOOLS')
const hot = arr('HOT_TOOLS')
if (stable.length === facts.dispatcherVisible && hot.length === 5) ok('dispatcher/hybrid 常量', `stable ${stable.length} / hot ${hot.length}`)
else fail('dispatcher/hybrid 常量', `stable ${stable.length} / hot ${hot.length}`)
const hiddenDispatcher = toolNames.length - stable.length
const hiddenHybrid = toolNames.length - stable.length - hot.length
if (hiddenDispatcher === facts.dispatcherHidden && hiddenHybrid === facts.hybridHidden) {
  ok('可见/隐藏计数', `dispatcher 2/${hiddenDispatcher}，hybrid ${stable.length + hot.length}/${hiddenHybrid}`)
} else {
  fail('可见/隐藏计数', `dispatcher 2/${hiddenDispatcher}，hybrid ${stable.length + hot.length}/${hiddenHybrid}`)
}
for (const [label, re] of [
  ['TOOLS.md dispatcher 21', /21/],
  ['TOOLS.md hybrid 16', /16/],
]) {
  if (re.test(toolsDoc)) ok(label)
  else fail(label)
}

// ── 2. Config 键与数量 ─────────────────────────────────────────────
const cfgBlock = indexJs.match(/export const Config = z\.object\(\{([\s\S]*?)\n\}\)/)?.[1] || ''
const cfgKeys = [...new Set([...cfgBlock.matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9_]*):\s*z\./gm)].map((m) => m[1]))]
if (cfgKeys.length === facts.configKeys) ok('Config 键数量', `${cfgKeys.length} 个`)
else fail('Config 键数量', `期望 ${facts.configKeys}，实际 ${cfgKeys.length}：${cfgKeys.join(', ')}`)
const cfgDoc = read('docs/CONFIGURATION.md')
const missingCfg = cfgKeys.filter((k) => !cfgDoc.includes(k))
if (missingCfg.length === 0) ok('CONFIGURATION.md 覆盖全部键')
else fail('CONFIGURATION.md 缺少键', missingCfg.join(', '))

// ── 3. 方括号错误码 ───────────────────────────────────────────────
const runtimeFiles = ['index.js', ...readdirSync(join(root, 'lib'), { recursive: true })
  .filter((f) => String(f).endsWith('.js'))
  .map((f) => join('lib', String(f)))]
const codeRe = /\[((?:snapshot|index|zoom|pointer|private_drag|input|repeat|stale|policy|relative|model)_[a-z0-9_]+)\]/g
const codes = new Set()
for (const rel of runtimeFiles) {
  const text = readFileSync(join(root, rel), 'utf8')
  for (const m of text.matchAll(codeRe)) codes.add(m[1])
}
const errorsDoc = read('docs/ERRORS.md')
const missingCodes = [...codes].filter((c) => !errorsDoc.includes(c))
if (missingCodes.length === 0) ok('ERRORS.md 覆盖全部插件错误码', `${codes.size} 个`)
else fail('ERRORS.md 缺少错误码', missingCodes.join(', '))

// ── 4. 相对链接与发布包边界 ────────────────────────────────────────
const publishRoots = ['README.md', 'VERIFICATION.md', 'PERMISSIONS.md', 'LICENSE', 'docs/', 'assets/', 'index.js', 'lib/', 'tools/', 'cordis.patch.yml', 'verify-runtime.mjs']
const isPublished = (abs) => {
  const rel = relative(root, abs).split(sep).join('/')
  return publishRoots.some((p) => (p.endsWith('/') ? rel.startsWith(p) : rel === p))
}
const mdFiles = walkMarkdown(root)
const linkFailures = []
for (const abs of mdFiles) {
  const text = stripFences(readFileSync(abs, 'utf8'))
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const target = m[1]
    if (!target || target.startsWith('#') || /^(https?:|mailto:|tel:)/i.test(target)) continue
    const clean = target.split('#')[0]
    if (!clean) continue
    const dest = resolve(dirname(abs), clean)
    if (!existsSync(dest)) {
      linkFailures.push(`${relative(root, abs)}:${lineOf(text, m.index)} -> ${target}`)
      continue
    }
    const relTarget = relative(root, dest).split(sep).join('/')
    if (isPublished(abs) && !isPublished(dest) && !relTarget.startsWith('evals/')) {
      linkFailures.push(`${relative(root, abs)}:${lineOf(text, m.index)} 发布包内链接指向未打包文件 ${relTarget}`)
    }
  }
}
if (linkFailures.length === 0) ok('相对链接可解析且发布包边界正确')
else fail('链接问题', `\n  ${linkFailures.join('\n  ')}`)

// ── 5. 过期数字（当前文档） ────────────────────────────────────────
const currentDocs = [
  'README.md', 'docs/README.md', 'docs/INSTALL.md', 'docs/TOOLS.md', 'docs/CONFIGURATION.md',
  'docs/ERRORS.md', 'docs/TROUBLESHOOTING.md', 'docs/SECURITY.md', 'docs/COMPATIBILITY.md',
  'docs/ARCHITECTURE.md', 'docs/RUNTIME-PIPELINE.md', 'docs/DRIVER-SDK.md', 'docs/WINDOWS.md',
  'docs/BACKGROUND-INPUT.md',
  'docs/TESTING.md', 'VERIFICATION.md', 'PERMISSIONS.md', 'docs/store-evidence.md',
  'MAINTAINING.md', 'PUBLISH.md', 'ROADMAP.md',
]
const stalePatterns = [
  ['隐藏 20', /隐藏\s*20(?!\d)/],
  ['隐藏 15', /隐藏\s*15(?!\d)/],
  ['2 可见/20', /2\s*可见\s*\/\s*20/],
  ['20 hidden', /20\s*hidden/i],
  ['629 项', /629\s*项/],
  ['17/17', /17\/17/],
  ['555', /\b555\b/],
  ['32 文件', /32\s*文件/],
  ['21 个 Config', /21\s*个\s*Config/],
  ['21 键', /21\s*键/],
]
const staleHits = []
for (const rel of currentDocs) {
  const text = read(rel)
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/当时|历史|EVIDENCE|CHANGELOG/.test(line)) continue
    for (const [label, re] of stalePatterns) {
      if (re.test(line)) staleHits.push(`${rel}:${i + 1} ${label}: ${line.trim().slice(0, 100)}`)
    }
  }
}
if (staleHits.length === 0) ok('当前文档无已知过期数字')
else fail('过期数字', `\n  ${staleHits.join('\n  ')}`)

// ── 6. 关键事实值 ─────────────────────────────────────────────────
const factsChecks = [
  ['docs/TOOLS.md', facts.toolCount, '工具数'],
  ['docs/TOOLS.md', facts.dispatcherHidden, 'dispatcher 隐藏数'],
  ['docs/TOOLS.md', facts.hybridHidden, 'hybrid 隐藏数'],
  ['docs/CONFIGURATION.md', facts.configKeys, '配置键数'],
  ['docs/TESTING.md', facts.offlineChecks, '离线检查数'],
  ['docs/TESTING.md', facts.runtimeChecks, 'runtime 检查数'],
  ['VERIFICATION.md', facts.offlineChecks, '离线检查数'],
  ['VERIFICATION.md', String(facts.runtimeChecks) + '/18', 'runtime 结果'],
  ['docs/store-evidence.md', facts.offlineChecks, '离线检查数'],
  ['docs/store-evidence.md', '18/18', 'runtime 结果'],
  ['docs/store-evidence.md', `${facts.packFiles} 文件`, '打包文件数'],
  ['ROADMAP.md', facts.evalTasks, '评测任务数'],
  ['README.md', `${facts.toolCount} 个工具`, '工具数'],
]
const factMissing = factsChecks.filter(([rel, val]) => !read(rel).includes(String(val)))
if (factMissing.length === 0) ok('关键事实值存在', `${factsChecks.length} 项`)
else fail('关键事实值缺失', factMissing.map(([rel, val, label]) => `${rel} ${label}=${val}`).join('; '))

// ── 7. 标题编号 ───────────────────────────────────────────────────
const headingIssues = []
for (const rel of currentDocs) {
  const lines = read(rel).split('\n')
  const h2 = new Map()
  const h3 = new Map()
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const m2 = line.match(/^## (\d+)\.\s+/)
    if (m2) {
      if (h2.has(m2[1])) headingIssues.push(`${rel}:${i + 1} 重复 ## ${m2[1]}`)
      h2.set(m2[1], i + 1)
    }
    if (/^## \d+\.\d+/.test(line)) headingIssues.push(`${rel}:${i + 1} H2 使用子编号：${line.trim()}`)
    const m3 = line.match(/^### (\d+)\.(\d+)\s+/)
    if (m3) {
      if (h3.has(`${m3[1]}.${m3[2]}`)) headingIssues.push(`${rel}:${i + 1} 重复 ### ${m3[1]}.${m3[2]}`)
      h3.set(`${m3[1]}.${m3[2]}`, i + 1)
      if (!h2.has(m3[1])) headingIssues.push(`${rel}:${i + 1} 子标题父级不存在：### ${m3[1]}.${m3[2]}`)
    }
  }
}
if (headingIssues.length === 0) ok('标题编号无重复/层级错误')
else fail('标题编号问题', `\n  ${headingIssues.join('\n  ')}`)

// ── 8. 机器特定绝对路径 ───────────────────────────────────────────
const pathHits = []
for (const rel of currentDocs) {
  const lines = read(rel).split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.includes('<user>') || line.includes('<repo>') || line.includes('<path>')) continue
    if (/F:\\Codex_Work_Space|C:\\Users\\[^<]|\/Users\/[^<]/.test(line)) {
      pathHits.push(`${rel}:${i + 1} ${line.trim().slice(0, 100)}`)
    }
  }
}
if (pathHits.length === 0) ok('当前文档无机器特定绝对路径')
else fail('机器特定绝对路径', `\n  ${pathHits.join('\n  ')}`)

// ── 汇总 ─────────────────────────────────────────────────────────
console.log(`\n结果：${failures ? `❌ ${failures} 项失败` : '✅ 全部通过'}（${checks} 项检查）`)
process.exit(failures ? 1 : 0)
