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
check('ES1: 没有按 Notepad 进程名 Stop-Process', killers.length === 0, killers.join(', '))

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
check('ES2: Close-TaskWindows 只按显式模式关闭', badCalls.length === 0, badCalls.join(' | '))

// 3. Close-TaskWindows 源码不得含默认 Notepad/无标题/记事本 needles
const common = readFileSync(join(evals, 'lib', 'common.ps1'), 'utf8')
const fn = (common.match(/function Close-TaskWindows\s*\{[\s\S]*?\n\}/) || [''])[0]
check('ES3: Close-TaskWindows 无默认 Notepad 宽匹配', fn.length > 0
  && !/@\('Notepad'/.test(fn)
  && !/\$untitled/.test(fn)
  && !/\$jishiben/.test(fn), fn.slice(0, 120))

// 4. Notepad 生命周期走 Open/Close-TestNotepad
for (const id of ['t01', 't05', 't06', 't07']) {
  const setup = readFileSync(join(evals, 'setup', `${id}.ps1`), 'utf8')
  const cleanup = readFileSync(join(evals, 'cleanup', `${id}.ps1`), 'utf8')
  check(`ES4: ${id} setup 使用 Open-TestNotepad`, /Open-TestNotepad/.test(setup))
  check(`ES5: ${id} cleanup 使用 Close-TestNotepad`, /Close-TestNotepad/.test(cleanup))
}

// 5. t10 双文件也走 Open/Close-TestNotepad，且不再无参数 Close-TaskWindows
const t10s = readFileSync(join(evals, 'setup', 't10.ps1'), 'utf8')
const t10c = readFileSync(join(evals, 'cleanup', 't10.ps1'), 'utf8')
check('ES6: t10 setup 使用 Open-TestNotepad 两次', (t10s.match(/Open-TestNotepad/g) || []).length >= 2)
check('ES7: t10 cleanup 使用 Close-TestNotepad', /Close-TestNotepad/.test(t10c))

// 6. 标签级安全：必须有纯分类器、UIA 枚举、Open/Close 双重复核
check('ES8: 存在标签枚举与纯分类器', /function Get-NotepadTabs/.test(common) && /function Test-NotepadTabLabels/.test(common))
check('ES9: Open/Close 都复核标签集合', (common.match(/Test-NotepadTabSet\s+-Hwnd/g) || []).length >= 2)
for (const id of ['t01', 't05', 't06', 't07', 't10']) {
  const setup = readFileSync(join(evals, 'setup', `${id}.ps1`), 'utf8')
  check(`ES10: ${id} setup 显式 ExpectedTabs`, /-ExpectedTabs/.test(setup))
}

// 7. 模态对话框：只关 owned（GW_OWNER），且在最终 WM_CLOSE 之前
check('ES11: 存在 owned 对话框枚举', /function Get-OwnedWindows/.test(common) && /GetWindow\(\[IntPtr\]\$h, 4\)/.test(common))
const closeFn = (common.match(/function Close-TestNotepad\s*\{[\s\S]*?\n\}/) || [''])[0]
check('ES12: Close-TestNotepad 先关模态/owned 对话框', /Get-(ModalTest|Owned)Windows/.test(closeFn)
  && closeFn.indexOf('Get-ModalTestWindows') < closeFn.lastIndexOf('PostMessage'))
check('ES13: 关闭走 UIA WindowPattern，WM_CLOSE 仅兜底', /function Close-WindowUia/.test(common)
  && /WindowPattern/.test(common) && closeFn.indexOf('Close-WindowUia') < closeFn.lastIndexOf('PostMessage'))
for (const id of ['t01', 't05', 't06', 't07', 't10']) {
  const cleanup = readFileSync(join(evals, 'cleanup', `${id}.ps1`), 'utf8')
  check(`ES14: ${id} cleanup 允许丢弃测试标签修改`, /-AllowDiscardTestOnlyModified/.test(cleanup))
}
const openFn = (common.match(/function Open-TestNotepad\s*\{[\s\S]*?\n\}/) || [''])[0]
check('ES15: Open-TestNotepad 先 preflight 再启动', /existing Notepad window/.test(openFn)
  && openFn.indexOf('existing Notepad window') < openFn.indexOf('Start-Process'))
check('ES15b: Open-TestNotepad 把 AllowExistingHwnd 传给 orphan 清理', /Close-OrphanTestNotepads\s+-ProtectHwnd/.test(openFn))
check('ES15c: orphan 不再仅凭 evalOwned 关通用窗口', /function Close-OrphanTestNotepads/.test(common)
  && /-ProtectHwnd/.test(common) && !/-not \$hasSeed -and -not \$evalOwned/.test(common))

// 8. Paint/Explorer 状态化：禁止按进程名杀，禁止宽 Close-TaskWindows
const paintKillers = []
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  if (/Get-Process\s+-Name\s+['"]mspaint['"][\s\S]{0,300}?Stop-Process/i.test(src)) paintKillers.push(relative(root, f))
}
check('ES16: 没有按 mspaint 进程名 Stop-Process', paintKillers.length === 0, paintKillers.join(', '))
for (const id of ['t09']) {
  const setup = readFileSync(join(evals, 'setup', `${id}.ps1`), 'utf8')
  const cleanup = readFileSync(join(evals, 'cleanup', `${id}.ps1`), 'utf8')
  check('ES17: t09 使用 Open/Close-TestPaint', /Open-TestPaint/.test(setup) && /Close-TestPaint/.test(cleanup))
}
for (const id of ['t03', 'wa2']) {
  const setup = readFileSync(join(evals, 'setup', `${id}.ps1`), 'utf8')
  const cleanup = readFileSync(join(evals, 'cleanup', `${id}.ps1`), 'utf8')
  check(`ES18: ${id} 使用 Open/Close-TestExplorer`, /Open-TestExplorer/.test(setup)
    && /Close-TestExplorer/.test(cleanup) && !/Close-TaskWindows/.test(setup + cleanup))
}
const t10Setup = readFileSync(join(evals, 'setup', 't10.ps1'), 'utf8')
check('ES19: t10 失败返回前先写 state', /Write-TestState/.test(t10Setup)
  && t10Setup.indexOf('Persist cleanup state BEFORE') >= 0
  && t10Setup.indexOf('Persist cleanup state BEFORE') < t10Setup.indexOf("if (-not ($t1.ok -and $t2.ok))"))
const t04Setup = readFileSync(join(evals, 'setup', 't04.ps1'), 'utf8')
check('ES20: t04 setup 建目录并写 calculator state', /New-TaskDir/.test(t04Setup)
  && /test-calculator\.json/.test(t04Setup) && /Write-TestState/.test(t04Setup))

// 9. 同 pid 模态对话框：必须证明归属，不能按标题/pid 裸关
const modalFn = (common.match(/function Get-ModalTestWindows[^{]*\{[\s\S]*?\n\}/) || [''])[0]
check('ES21: 存在 Get-ModalTestWindows 且含 pid + 模态证明', modalFn.length > 0
  && /GetWindowThreadProcessId/.test(modalFn)
  && /IsWindowEnabled/.test(modalFn)
  && /GetLastActivePopup/.test(modalFn)
  && /GetWindow\(\[IntPtr\]\$owner, 4\)/.test(modalFn), modalFn.slice(0, 120))
check('ES22: Close-TestNotepad 使用模态窗口判定', /Get-ModalTestWindows/.test(closeFn)
  && closeFn.indexOf('Get-ModalTestWindows') < closeFn.lastIndexOf('PostMessage'))
check('ES23: 模态判定不按标题单独关窗', modalFn.length > 0
  && !/另存为|Save As|保存/.test(modalFn))
const dismissFn = (common.match(/function Dismiss-TestSavePrompt[^{]*\{[\s\S]*?\n\}/) || [''])[0]
check('ES24: 保存提示只处理已证明模态窗', /Get-ModalTestWindows/.test(dismissFn)
  && /noSave|Don.t Save/.test(dismissFn))

// 10. dirty-desktop tasks: new app/process names, state-scoped helpers, no broad closes
const dirtyKillers = []
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  if (/Get-Process\s+-Name\s+['"](?:mspaint|POWERPNT|EXCEL|msedge|chrome)['"][\s\S]{0,300}?Stop-Process/i.test(src)) {
    dirtyKillers.push(relative(root, f))
  }
}
check('ES25: 不按 Paint/Office/浏览器进程名 Stop-Process', dirtyKillers.length === 0, dirtyKillers.join(', '))

const broadCloses = []
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  if (/Close-TaskWindows\s+@\([^\n]*(?:Paint|PowerPoint|Excel|Chrome|Edge)/i.test(src)) broadCloses.push(relative(root, f))
}
check('ES26: 不宽匹配关闭 Paint/Office/浏览器', broadCloses.length === 0, broadCloses.join(', '))

const taskSrc = (id, kind) => readFileSync(join(evals, kind, `${id}.ps1`), 'utf8')
check('ES27a: t11 使用 PaintDoc/Browser state helpers', /Open-TestPaintDoc/.test(taskSrc('t11', 'setup'))
  && /Close-TestPaintDoc/.test(taskSrc('t11', 'cleanup'))
  && /Open-TestBrowserWindow/.test(taskSrc('t11', 'setup'))
  && /Close-TestBrowserWindow/.test(taskSrc('t11', 'cleanup')))
check('ES27b: t12 使用 Office/Browser state helpers', /Open-TestAppWindow/.test(taskSrc('t12', 'setup'))
  && /Close-TestAppWindow/.test(taskSrc('t12', 'cleanup'))
  && /Open-TestBrowserWindow/.test(taskSrc('t12', 'setup'))
  && /Close-TestBrowserWindow/.test(taskSrc('t12', 'cleanup')))
check('ES27c: t13 使用 Browser state + hash cleanup', /Open-TestBrowserWindow/.test(taskSrc('t13', 'setup'))
  && /Close-TestBrowserWindow/.test(taskSrc('t13', 'cleanup'))
  && /Remove-S4MatchedDownloads/.test(taskSrc('t13', 'cleanup')))
check('ES27d: t14 使用 Excel state helpers', /Open-TestAppWindow/.test(taskSrc('t14', 'setup'))
  && /Close-TestAppWindow/.test(taskSrc('t14', 'cleanup')))
check('ES27e: t15 使用 Explorer state helpers', /Open-TestExplorer/.test(taskSrc('t15', 'setup'))
  && /Close-TestExplorer/.test(taskSrc('t15', 'cleanup')))
check('ES27f: t16 使用 form server + Browser state helpers', /Start-TestFormServer/.test(taskSrc('t16', 'setup'))
  && /Open-TestBrowserWindow/.test(taskSrc('t16', 'setup'))
  && /Close-TestBrowserWindow/.test(taskSrc('t16', 'cleanup'))
  && /Stop-TestFormServer/.test(taskSrc('t16', 'cleanup')))
check('ES27g: t17 使用 Browser + Excel state helpers', /Open-TestBrowserWindow/.test(taskSrc('t17', 'setup'))
  && /Open-TestAppWindow/.test(taskSrc('t17', 'setup'))
  && /Close-TestBrowserWindow/.test(taskSrc('t17', 'cleanup'))
  && /Close-TestAppWindow/.test(taskSrc('t17', 'cleanup')))

for (const id of ['t11', 't12', 't13', 't14', 't16', 't17']) {
  const c = taskSrc(id, 'cleanup')
  check(`ES28: ${id} cleanup 可 dirty/leftover`, /-Dirty/.test(c) && /Save-LeftoverState/.test(c))
}
check('ES29: 新 app/browser helper 记录并复核 pid/start', /processStart/.test(common)
  && /Test-ProcessIdentity/.test(common)
  && /function Close-TestAppWindow[^{]*\{[\s\S]*?Test-ProcessIdentity/.test(common)
  && /function Open-TestAppWindow[^{]*\{[\s\S]*?processStart/.test(common))
check('ES30: t13 不宽删 Downloads', !/Remove-Item[^\n]*Downloads/i.test(taskSrc('t13', 'cleanup'))
  && !/Get-ChildItem[^\n]*Downloads[^\n]*Remove-Item/i.test(taskSrc('t13', 'cleanup')))

for (const id of ['t11', 't12', 't13', 't14', 't15', 't16', 't17']) {
  const md = readFileSync(join(evals, 'tasks', `${id}-${({ t11: 'paint-replica', t12: 'ppt-replica', t13: 'paper-download', t14: 'excel-chart', t15: 'explorer-organize', t16: 'browser-form', t17: 'pdf-excerpt' })[id]}.md`), 'utf8')
  check(`ES31: ${id} 标记 dirty isolation`, /\*\*isolation:\s*dirty\*\*/.test(md))
}

console.log(`\n结果：${checks.length === 0 ? '✅ 全部通过' : `❌ ${checks.length} 项失败`}`)
process.exit(checks.length === 0 ? 0 : 1)
