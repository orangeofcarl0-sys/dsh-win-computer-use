/**
 * 语法检查（跨平台）：index.js + lib 下所有 JS（含 driver 子目录）逐个 node --check；
 * install.sh / uninstall.sh 有 bash 时跑 bash -n。
 * 运行：node tests/syntax.check.mjs（npm run check）
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const node = process.execPath
let failed = 0

const libFiles = readdirSync(join(root, 'lib'), { recursive: true })
  .filter((f) => String(f).endsWith('.js'))
  .map((f) => join('lib', String(f)))
// 评测 runner 与任务校验器不在 lib/ 下，但属于每次发布前必须能解析的入口。
const extraFiles = [
  'evals/headless-run.mjs',
  'evals/verify-oracles.mjs',
  'evals/lib/form-server.mjs',
  'evals/lib/run.mjs',
  'evals/probe-safety-runtime.mjs',
  'evals/probe-scroll.mjs',
  'evals/probe-ops.mjs',
  'evals/probe-launch.mjs',
  'evals/probe-modifier-drop.mjs',
  'evals/probe-modal-timeout.mjs',
  'evals/probe-modal-escapes.mjs',
  'evals/probe-native-dialog.mjs',
  'evals/probe-common-dialogs.mjs',
  'evals/probe-gesture-truth.mjs',
  'evals/probe-wpf-dialog.mjs',
  'evals/probe-chromium-dialogs.mjs',
  'evals/probe-cross-il.mjs',
  'evals/probe-background-input.mjs',
  'evals/probe-b2-elevated.mjs',
  'evals/probe-native-button.mjs',
  'evals/probe-display.mjs',
  'evals/probe-win-gaps.mjs',
  'evals/probe-platform.mjs',
  'evals/oracle-mutation.mjs',
  'evals/ac6-summary.mjs',
  'tests/tasks.check.mjs',
]
const jsFiles = ['index.js', ...libFiles, ...extraFiles]
for (const rel of jsFiles) {
  const abs = join(root, rel)
  if (!existsSync(abs)) { console.log(`❌ missing: ${rel}`); failed++; continue }
  try {
    execFileSync(node, ['--check', abs], { stdio: 'pipe' })
  } catch (e) {
    console.log(`❌ ${rel}: ${String(e.stderr || e.message).split('\n')[0]}`)
    failed++
  }
}
console.log(`${failed ? '❌' : '✅'} 语法检查：${jsFiles.length - failed}/${jsFiles.length} 个 JS 文件通过`)

for (const sh of ['install.sh', 'uninstall.sh']) {
  const abs = join(root, sh)
  if (!existsSync(abs)) continue
  try {
    execFileSync('bash', ['-n', abs], { stdio: 'pipe' })
    console.log(`✅ bash -n ${sh}`)
  } catch (e) {
    const msg = String(e.message || '')
    if (/ENOENT/.test(msg)) { console.log(`⚠️  跳过 ${sh}（本机无 bash）`); continue }
    console.log(`❌ bash -n ${sh}: ${msg.split('\n')[0]}`)
    failed++
  }
}

process.exit(failed ? 1 : 0)
