/**
 * eval 脚本安全静态检查（2026-11-14 t01 复盘）。
 *
 * 共享机器上的硬约束：
 * - 任何 setup/cleanup 都不能按进程名杀 Notepad（Win11 记事本多标签，会带走用户文档）；
 * - Close-TaskWindows 只能按显式模式关闭，不能有默认的 Notepad/无标题/记事本宽匹配；
 * - t01/t05/t06 的 Notepad 生命周期必须走 HWND/ownership 作用域的 Open/Close-TestNotepad。
 *
 * 运行：node tests/eval-safety.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const evals = join(root, 'evals')

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) out.push(...walk(p))
    else if (name.endsWith('.ps1')) out.push(p)
  }
  return out
}

const files = walk(evals)
const checks = []
const check = (name, ok, detail = '') => {
  if (!ok) checks.push({ name, detail })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

// 1. 任何脚本都不得“按 Notepad 进程名杀进程”
const killers = []
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  if (/Get-Process\s+-Name\s+['"]Notepad['"][\s\S]{0,300}?Stop-Process/i.test(src)) killers.push(relative(root, f))
}
check('S1: 没有按 Notepad 进程名 Stop-Process', killers.length === 0, killers.join(', '))

// 2. Close-TaskWindows 调用必须带显式模式
const badCalls = []
for (const f of files) {
  if (f.endsWith('common.ps1')) continue
  const lines = readFileSync(f, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    if (!/Close-TaskWindows/.test(line)) continue
    if (/^\s*#/.test(line)) continue
    if (!/Close-TaskWindows\s+@\(/.test(line)) badCalls.push(`${relative(root, f)}: ${line.trim()}`)
  }
}
check('S2: Close-TaskWindows 只按显式模式关闭', badCalls.length === 0, badCalls.join(' | '))

// 3. Close-TaskWindows 源码不得含默认 Notepad/无标题/记事本 needles
const common = readFileSync(join(evals, 'lib', 'common.ps1'), 'utf8')
const fn = (common.match(/function Close-TaskWindows\s*\{[\s\S]*?\n\}/) || [''])[0]
check('S3: Close-TaskWindows 无默认 Notepad 宽匹配', fn.length > 0
  && !/@\('Notepad'/.test(fn)
  && !/\$untitled/.test(fn)
  && !/\$jishiben/.test(fn), fn.slice(0, 120))

// 4. Notepad 生命周期走 Open/Close-TestNotepad
for (const id of ['t01', 't05', 't06', 't07']) {
  const setup = readFileSync(join(evals, 'setup', `${id}.ps1`), 'utf8')
  const cleanup = readFileSync(join(evals, 'cleanup', `${id}.ps1`), 'utf8')
  check(`S4: ${id} setup 使用 Open-TestNotepad`, /Open-TestNotepad/.test(setup))
  check(`S5: ${id} cleanup 使用 Close-TestNotepad`, /Close-TestNotepad/.test(cleanup))
}

// 5. t10 双文件也走 Open/Close-TestNotepad，且不再无参数 Close-TaskWindows
const t10s = readFileSync(join(evals, 'setup', 't10.ps1'), 'utf8')
const t10c = readFileSync(join(evals, 'cleanup', 't10.ps1'), 'utf8')
check('S6: t10 setup 使用 Open-TestNotepad 两次', (t10s.match(/Open-TestNotepad/g) || []).length >= 2)
check('S7: t10 cleanup 使用 Close-TestNotepad', /Close-TestNotepad/.test(t10c))

// 6. 标签级安全：必须有纯分类器、UIA 枚举、Open/Close 双重复核
check('S8: 存在标签枚举与纯分类器', /function Get-NotepadTabs/.test(common) && /function Test-NotepadTabLabels/.test(common))
check('S9: Open/Close 都复核标签集合', (common.match(/Test-NotepadTabSet\s+-Hwnd/g) || []).length >= 2)
for (const id of ['t01', 't05', 't06', 't07', 't10']) {
  const setup = readFileSync(join(evals, 'setup', `${id}.ps1`), 'utf8')
  check(`S10: ${id} setup 显式 ExpectedTabs`, /-ExpectedTabs/.test(setup))
}

// 7. 模态对话框：只关 owned（GW_OWNER），且在最终 WM_CLOSE 之前
check('S11: 存在 owned 对话框枚举', /function Get-OwnedWindows/.test(common) && /GetWindow\(\[IntPtr\]\$h, 4\)/.test(common))
const closeFn = (common.match(/function Close-TestNotepad\s*\{[\s\S]*?\n\}/) || [''])[0]
check('S12: Close-TestNotepad 先关 owned 对话框', /Get-OwnedWindows/.test(closeFn)
  && closeFn.indexOf('Get-OwnedWindows') < closeFn.lastIndexOf('PostMessage'))
check('S13: 关闭走 UIA WindowPattern，WM_CLOSE 仅兜底', /function Close-WindowUia/.test(common)
  && /WindowPattern/.test(common) && closeFn.indexOf('Close-WindowUia') < closeFn.lastIndexOf('PostMessage'))
for (const id of ['t01', 't05', 't06', 't07', 't10']) {
  const cleanup = readFileSync(join(evals, 'cleanup', `${id}.ps1`), 'utf8')
  check(`S14: ${id} cleanup 允许丢弃测试标签修改`, /-AllowDiscardTestOnlyModified/.test(cleanup))
}
const openFn = (common.match(/function Open-TestNotepad\s*\{[\s\S]*?\n\}/) || [''])[0]
check('S15: Open-TestNotepad 先 preflight 再启动', /existing Notepad window/.test(openFn)
  && openFn.indexOf('existing Notepad window') < openFn.indexOf('Start-Process'))

console.log(`\n结果：${checks.length === 0 ? '✅ 全部通过' : `❌ ${checks.length} 项失败`}`)
process.exit(checks.length === 0 ? 0 : 1)
