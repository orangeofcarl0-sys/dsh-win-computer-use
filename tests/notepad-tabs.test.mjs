/**
 * Notepad tab classifier smoke (2026-11-15).
 *
 * The eval ownership bug came from trusting "new HWND" without checking tabs.
 * The pure classifier is exercised with exact/extra/modified/unknown/count cases;
 * this does not open Notepad or touch the desktop.
 *
 * 运行：node tests/notepad-tabs.test.mjs（非 Windows 自动跳过）
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

if (process.platform !== 'win32') {
  console.log('⏭️  notepad-tabs: skipped (Windows-only)')
  process.exit(0)
}

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const ps = process.env.S4_POWERSHELL || 'powershell.exe'
const temp = process.env.S4_TEMP || join(process.env.LOCALAPPDATA || '', 'Temp')
const r = spawnSync(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'tests', 'lib', 'notepad-tabs.ps1')], {
  cwd: root,
  encoding: 'utf8',
  timeout: 120000,
  env: { ...process.env, TEMP: temp, TMP: temp },
})

if (r.error) { console.error('❌ notepad-tabs spawn:', r.error.message); process.exit(1) }
if (r.status !== 0) { console.error('❌ notepad-tabs exit', r.status, r.stderr || r.stdout); process.exit(1) }

const lines = String(r.stdout || '').split(/\r?\n/).filter((l) => l.trim().startsWith('['))
let rows = null
try { rows = JSON.parse(lines[lines.length - 1]) } catch {}
if (!Array.isArray(rows) || rows.length === 0) { console.error('❌ notepad-tabs: no JSON output', r.stdout, r.stderr); process.exit(1) }

let failures = 0
for (const row of rows) {
  const ok = row.actual === row.expected
  if (!ok) failures++
  console.log(`${ok ? '✅' : '❌'} ${row.name} — expected=${row.expected} actual=${row.actual}${row.reason ? ' (' + row.reason + ')' : ''}`)
}
console.log(`\n结果：${failures === 0 ? '✅ 全部通过' : `❌ ${failures} 项失败`}`)
process.exit(failures ? 1 : 0)
