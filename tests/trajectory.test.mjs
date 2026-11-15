/**
 * trajectory 监控器专项测试（2026-11-15）：
 * - 文本不落原文（只留 len/hash）；
 * - 驱动调用归属到工具；
 * - 重复动作触发 loop 事件；
 * - session_end 带摘要。
 *
 * 运行：node tests/trajectory.test.mjs
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { logDriverCall, runTool, trajectoryStart, trajectoryStop } from '../lib/trajectory.js'

const dir = mkdtempSync(join(tmpdir(), 'dsh-cu-traj-'))
const file = join(dir, 'trajectory.jsonl')
const checks = []
const check = (name, ok, detail = '') => {
  if (!ok) checks.push(name + (detail ? ': ' + detail : ''))
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

trajectoryStart({ file, meta: { test: true } })

await runTool('computer_type', { text: 'TOP-SECRET-TEXT', element: 0 }, async () => {
  logDriverCall('move_cursor', { x: 10, y: 20 }, 3, { ok: true }, null)
  return { ok: true, result: '输入完成' }
})
await runTool('screen_observe', { window: 'Notepad', mode: 'ax' }, async () => {
  logDriverCall('get_window_state', { pid: 1, window_id: 2, max_elements: 10 }, 8, {
    elements: [{}, {}, {}], snapshot_id: 's1', screenshot_png_b64: 'x',
  }, null)
  return { ok: true, result: '窗口树', snapshotId: 's1', elementCount: 3, mode: 'ax' }
})
for (let i = 0; i < 3; i++) {
  await runTool('computer_click', { element: 0, snapshot_id: 's1' }, async () => ({ ok: true, result: '点击完成' }))
}
const summary = trajectoryStop()
const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l))
const text = readFileSync(file, 'utf8')

check('T1: 轨迹文件写入事件', lines.length >= 8, `lines=${lines.length}`)
check('T2: 文本原文不落盘', !text.includes('TOP-SECRET-TEXT'))
check('T3: 文本参数变成 len/hash', lines.some((e) => e.type === 'tool_start' && e.args?.text?.len === 15 && e.args?.text?.hash))
check('T4: 驱动调用归属工具', lines.some((e) => e.type === 'driver' && e.tool === 'move_cursor' && e.parent))
check('T5: 驱动结果摘要不含 AX 树', lines.some((e) => e.type === 'driver' && e.tool === 'get_window_state' && e.elementCount === 3 && !e.elements))
check('T6: 重复动作触发 loop', lines.some((e) => e.type === 'loop' && e.kind === 'repeat_action' && e.count >= 3))
check('T7: session_end 带摘要', lines.some((e) => e.type === 'session_end' && e.tools >= 5))
check('T8: summary 计数正确', summary && summary.actions >= 4 && summary.observes === 1 && summary.moveCount === 1)

rmSync(dir, { recursive: true, force: true })
console.log(`\n结果：${checks.length === 0 ? '✅ 全部通过' : '❌ ' + checks.length + ' 项失败'}`)
process.exit(checks.length === 0 ? 0 : 1)
