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
  logDriverCall('click', { delivery_mode: 'foreground' }, 2, { ok: true }, null)
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
// dispatcher 外壳透明：外层 computer_do 不记事件，只记内层真实工具
await runTool('computer_do', { action: 'call', tool: 'computer_key', args: { key: 'return' } }, async () => {
  await runTool('computer_key', { key: 'return' }, async () => ({ ok: true, result: '按键完成 · unverifiable' }))
  return { ok: true, result: '[computer_key] 按键完成' }
})
await runTool('screen_observe', { window: 'Notepad', mode: 'ax' }, async () => ({
  ok: true, result: '状态未变（快照 s1）', changedSinceLast: false, window: { pid: 1, windowId: 2 },
}))
// 动作后复核观察（changedSinceLast=true）不是 repeat_observe
for (let i = 0; i < 3; i++) {
  await runTool('screen_observe', { window: 'Notepad', mode: 'ax', query: 'changed' }, async () => ({
    ok: true, result: '窗口树（有变化）', changedSinceLast: true, window: { pid: 1, windowId: 2 },
  }))
}
// 连续未变化观察才是 repeat_observe
for (let i = 0; i < 3; i++) {
  await runTool('screen_observe', { window: 'Notepad', mode: 'ax', query: 'same' }, async () => ({
    ok: true, result: '状态未变（快照 s1）', changedSinceLast: false, window: { pid: 1, windowId: 2 },
  }))
}
// 被 guard 抑制的动作不算“真实重复动作”，也不应触发 repeat_action loop
for (let i = 0; i < 3; i++) {
  await runTool('computer_click', { element: 99 }, async () => ({ ok: false, result: '✗ [repeat_suppressed] 与 1s 前的相同点击重复' }))
}
// 观察回执里的“delivery_failed/丢字”提示不是观察本身的投递失败/未验证
await runTool('screen_observe', { window: 'Notepad', mode: 'ax', query: 'hint' }, async () => ({
  ok: true, result: '文档窗口提示：无 element 的焦点输入在 WinUI 可能 delivery_failed/丢字', window: { pid: 1, windowId: 2 },
}))
// XAML 加速键拒绝的“按键未送达（XAML…）”不是投递失败
await runTool('computer_key', { key: 'ctrl+a' }, async () => ({
  ok: false, result: '按键未送达（XAML/WinUI 目标没有可匹配的 UIA 加速键）',
}))
// modifier 点击的 loop 签名必须与普通点击分开
for (let i = 0; i < 3; i++) {
  await runTool('computer_click', { element: 7, modifier: ['ctrl'] }, async () => ({ ok: true, result: '点击完成' }))
}
// driver 层手势参数必须保留，否则真实轨迹看不到细节
logDriverCall('click', { pid: 1, window_id: 2, x: 10, y: 20, modifier: ['ctrl'] }, 3, { ok: true }, null)
logDriverCall('drag', {
  pid: 1, window_id: 2, from_x: 10, from_y: 20, to_x: 30, to_y: 40,
  duration_ms: 0, steps: 30, from_zoom: true,
}, 12, { ok: true, effect: 'confirmed' }, null)
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
check('T8: summary 计数正确', summary && summary.actions >= 5 && summary.observes === 9 && summary.moveCount === 1)
check('T9: computer_do 外壳透明', !lines.some((e) => e.type === 'tool_start' && e.name === 'computer_do') && summary.tools === 21,
  `tools=${summary.tools}`)
check('T10: unverified / observeStub 计数', summary.unverified === 1 && summary.observeStubs === 4,
  `unverified=${summary.unverified} stubs=${summary.observeStubs}`)
check('T10b: 观察提示不伪造 delivery/unverified', summary.deliveryFailures === 0 && summary.unverified === 1,
  `deliveryFailures=${summary.deliveryFailures} unverified=${summary.unverified}`)
check('T11: movesPerClick / deliveryModes', summary.movesPerClick === 0.5 && summary.deliveryModes.foreground === 1,
  JSON.stringify({ movesPerClick: summary.movesPerClick, deliveryModes: summary.deliveryModes }))
check('T12: suppressed 不触发 repeat_action', summary.suppressed === 3
  && !lines.some((e) => e.type === 'loop' && e.signature === 'act:computer_click:el:99:bg'), `suppressed=${summary.suppressed}`)
check('T13: 有变化的复核观察不触发 repeat_observe', !lines.some((e) => e.type === 'loop'
  && e.kind === 'repeat_observe' && /changed/.test(e.signature || '')), JSON.stringify(summary.loops))
check('T14: 连续未变化观察触发 repeat_observe', lines.some((e) => e.type === 'loop'
  && e.kind === 'repeat_observe' && /same/.test(e.signature || '') && e.count >= 3), JSON.stringify(summary.loops))
check('T15: modifier click 的 loop 签名含 mod:ctrl', lines.some((e) => e.type === 'loop'
  && e.kind === 'repeat_action' && /mod:ctrl/.test(e.signature || '')), JSON.stringify(summary.loops))
const clickDrv = lines.find((e) => e.type === 'driver' && e.tool === 'click' && e.args?.modifier)
check('T16: driver click 保留 modifier', Boolean(clickDrv)
  && JSON.stringify(clickDrv.args.modifier) === JSON.stringify(['ctrl']), JSON.stringify(clickDrv?.args || {}))
const dragDrv = lines.find((e) => e.type === 'driver' && e.tool === 'drag')
check('T17: driver drag 保留 from/steps/from_zoom', Boolean(dragDrv)
  && dragDrv.args.from_x === 10 && dragDrv.args.to_y === 40
  && dragDrv.args.steps === 30 && dragDrv.args.duration_ms === 0
  && dragDrv.args.from_zoom === true, JSON.stringify(dragDrv?.args || {}))

rmSync(dir, { recursive: true, force: true })
console.log(`\n结果：${checks.length === 0 ? '✅ 全部通过' : '❌ ' + checks.length + ' 项失败'}`)
process.exit(checks.length === 0 ? 0 : 1)
