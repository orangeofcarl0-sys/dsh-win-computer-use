/**
 * P0 行为边界测试（2026-11-09）——用真实 guard/actions/observe/receipt，桩只替换 cua.js。
 *
 * 覆盖：
 *  P0-1/2：无快照时 type/key 被守卫拒绝；有快照时绑定 pid+window_id，不再 scope=desktop。
 *  P0-3：scroll/drag payload 透传 window_id。
 *  P0-4：suspected_noop 终态 ok:false，附“先观察”注记，并标记快照可疑。
 *  P0-5：指定窗口未匹配时 fail-closed、不建立快照、给候选列表。
 *  P1-A：computer_set_value 注册且 payload 走 element_token + value。
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { makeWorkCopy, writeStubDriver, loadPlugin, makeServices, makeCtx, makeChecks, cleanupWork } from './lib/harness.mjs'

const work = makeWorkCopy('bounds')

// 受控引擎：记录所有动作参数；观察返回一个固定窗口 + 一个可编辑元素。
writeStubDriver(work, `
export const CUA_BIN = 'stub'
export const CUA_SESSION = 'bounds'
export const withSession = (a = {}) => a
export function normalizeMcp(v) { return v }
export function isBackgroundUnavailable() { return false }
export function isForegroundUnavailable() { return false }
export function isUnverified(v) { return Boolean(v && v.effect === 'unverifiable') }

export function deliveryFailure(v) {
  const s = typeof v === 'string' ? v : JSON.stringify(v || {})
  if (/foreground_unavailable|foreground unavailable/i.test(s)) return 'foreground'
  if (/background_unavailable|background unavailable/i.test(s)) return 'background'
  if (/delivery_failed|delivery failed/i.test(s)) return 'delivery_failed'
  return null
}

export const calls = []
const WINDOW = { pid: 42, window_id: 7, app_name: 'Stub', title: 'Stub', bounds: { x: 100, y: 100, width: 800, height: 600 }, z_index: 5 }
const ELEMENTS = [
  { element_index: 0, element_token: 'tok-0', role: 'Edit', label: 'body', value: 'hello', frame: { x: 120, y: 150, w: 300, h: 30 }, enabled: true, actions: ['ValuePattern'] },
  { element_index: 1, element_token: 'tok-1', role: 'Button', label: 'Save', frame: { x: 120, y: 200, w: 60, h: 24 }, enabled: true, actions: ['Invoke'] },
]

export async function cuaCall(tool, args = {}) {
  calls.push({ tool, args })
  switch (tool) {
    case 'check_permissions': return { elevated: false, integrity_level: 'Medium', uia: true, postmessage: true }
    case 'list_windows': return { windows: [WINDOW] }
    case 'get_window_state': return {
      window: WINDOW, elements: ELEMENTS, element_count: ELEMENTS.length, total_element_count: ELEMENTS.length,
      screenshot_width: 800, screenshot_height: 600, snapshot_id: 's00000001',
    }
    case 'get_desktop_state': return { screenshot_width: 800, screenshot_height: 600 }
    default: return { ok: true, effect: 'confirmed' }
  }
}
export async function cuaDeliver(tool, payload) { return { value: await cuaCall(tool, payload), note: '' } }
`)

writeFileSync(join(work, 'lib', 'privateDrag.js'), `
export const calls = []
export async function privateDrag(req) {
  calls.push(req)
  return { ok: true, sent: 42, foregroundRestored: true, stuckButton: false, stuckModifiers: '' }
}
export function stopPrivateDrag() {}
`)

const plugin = await loadPlugin(work)
const { check, state } = makeChecks()
const lib = (name) => import(pathToFileURL(join(work, 'lib', name)).href)
const { clearSnapshot, getSnapshot, setSnapshot, freshnessIssueParts } = await lib('snapshot.js')
const { settleAction } = await lib('receipt.js')
const { calls } = await lib('cua.js')
const { noteZoom, clearZoom } = await lib('observe.js')
const priv = await lib('privateDrag.js')

const cfg = {
  ttlMs: 60000, maxElements: 120, observeDedup: 'off', verboseReceipts: false,
  taskTimeoutMin: 5, maxTaskCalls: 3, supersession: 'note', allowedApps: [], cursorTheme: '',
  nativeImage: 'auto', visionProvider: 'p', visionModel: 'm', extremePatterns: [],
  passwordScan: 'off', deliveryMode: 'auto',
}

const { reg, ctx, exec } = makeCtx({ services: makeServices() })
plugin.apply(ctx, cfg)
const call = (name, args = {}) => {
  const direct = reg.get(name)
  if (direct) return direct.execute(args, exec)
  return reg.get('computer_do').execute({ action: 'call', tool: name, args }, exec)
}

// ── P0-1/2：无快照 → 守卫拒绝 ───────────────────────────────────────
clearSnapshot()
let r = await call('computer_type', { text: 'hi' })
check('P0-1 无快照 type 被拒', r.ok === false && /观察快照/.test(String(r.result)), String(r.result).slice(0, 50))
r = await call('computer_key', { key: 'return' })
check('P0-2 无快照 key 被拒', r.ok === false && /观察快照/.test(String(r.result)), String(r.result).slice(0, 50))
r = await call('computer_set_value', { element: 0, value: 'x' })
check('P1-A 无快照 set_value 被拒', r.ok === false && /观察快照/.test(String(r.result)), String(r.result).slice(0, 50))

// ── 建立快照 ────────────────────────────────────────────────────────
r = await call('screen_observe', { window: 'Stub' })
check('前置：观察成功并建立快照', r.ok === true && getSnapshot() !== null, String(r.result).slice(0, 60))

// ── P0-1/2：有快照 → 绑定 pid+window_id，不再 desktop ────────────────
calls.length = 0
r = await call('computer_type', { text: 'hello' })
const typeCall = calls.find((c) => c.tool === 'type_text')
check('P0-1 type 绑定快照窗口', r.ok === true && typeCall?.args.pid === 42 && typeCall?.args.window_id === 7,
  JSON.stringify(typeCall?.args || {}))
check('P0-1 type 不再发 scope=desktop', typeCall?.args.scope !== 'desktop', `scope=${typeCall?.args.scope}`)

calls.length = 0
r = await call('computer_key', { key: 'return' })
const keyCall = calls.find((c) => c.tool === 'press_key')
check('P0-2 key 绑定快照窗口', r.ok === true && keyCall?.args.pid === 42 && keyCall?.args.window_id === 7,
  JSON.stringify(keyCall?.args || {}))
check('P0-2 key 不再发 scope=desktop', keyCall?.args.scope !== 'desktop', `scope=${keyCall?.args.scope}`)

calls.length = 0
r = await call('computer_key', { key: 'ctrl+c' })
const hotkeyCall = calls.find((c) => c.tool === 'hotkey')
check('P0-2 组合键走 hotkey 且绑定窗口', r.ok === true && hotkeyCall?.args.window_id === 7 && hotkeyCall?.args.keys?.join('+') === 'ctrl+c',
  JSON.stringify(hotkeyCall?.args || {}))

// ── P0-3：scroll/drag 透传 window_id ────────────────────────────────
calls.length = 0
r = await call('computer_scroll', { direction: 'down', amount: 1 })
const scrollCall = calls.find((c) => c.tool === 'scroll')
check('P0-3 scroll 透传 window_id', r.ok === true && scrollCall?.args.window_id === 7, JSON.stringify(scrollCall?.args || {}))

calls.length = 0
r = await call('computer_drag', { from_x: 10, from_y: 10, to_x: 20, to_y: 20 })
const dragCall = calls.find((c) => c.tool === 'drag')
check('P0-3 drag 透传 window_id', r.ok === true && dragCall?.args.window_id === 7, JSON.stringify(dragCall?.args || {}))

// ── 手势参数：drag steps / duration_ms=0 / from_zoom ────────────────
calls.length = 0
r = await call('computer_drag', {
  from_x: 10, from_y: 10, to_x: 20, to_y: 20, steps: 30, duration_ms: 0,
})
const dragOpts = calls.find((c) => c.tool === 'drag')
check('D1 drag 透传 steps/duration_ms=0', r.ok === true
  && dragOpts?.args.steps === 30 && dragOpts?.args.duration_ms === 0
  && dragOpts?.args.from_zoom === undefined, JSON.stringify(dragOpts?.args || {}))

noteZoom(42, 7, { imageW: 280, imageH: 140 })
calls.length = 0
r = await call('computer_drag', {
  from_x: 10, from_y: 20, to_x: 30, to_y: 40, from_zoom: true,
})
const dragZoom = calls.find((c) => c.tool === 'drag')
check('D2 drag from_zoom 透传图内坐标', r.ok === true
  && dragZoom?.args.from_zoom === true && dragZoom?.args.from_x === 10 && dragZoom?.args.to_x === 30,
  JSON.stringify(dragZoom?.args || {}))

clearZoom(42)
calls.length = 0
r = await call('computer_drag', { from_x: 1, from_y: 2, to_x: 3, to_y: 4, from_zoom: true })
check('D3 drag 无 zoom → zoom_missing', r.ok === false && /\[zoom_missing\]/.test(String(r.result))
  && !calls.some((c) => c.tool === 'drag'), String(r.result).slice(0, 90))

const snapNow = getSnapshot()
const savedAt = snapNow.at
noteZoom(42, 7, { imageW: 280, imageH: 140 })
snapNow.at = Date.now() + 1000
calls.length = 0
r = await call('computer_drag', { from_x: 1, from_y: 2, to_x: 3, to_y: 4, from_zoom: true })
check('D4 drag 旧 zoom → zoom_stale', r.ok === false && /\[zoom_stale\]/.test(String(r.result))
  && !calls.some((c) => c.tool === 'drag'), String(r.result).slice(0, 90))
snapNow.at = savedAt
clearZoom(42)

for (const bad of [{ steps: 0 }, { steps: 201 }, { duration_ms: -1 }, { duration_ms: 10001 }]) {
  calls.length = 0
  r = await call('computer_drag', { from_x: 1, from_y: 2, to_x: 3, to_y: 4, ...bad })
  check(`D5 drag 非法 ${JSON.stringify(bad)} 被拒`, r.ok === false && !calls.some((c) => c.tool === 'drag'),
    String(r.result).slice(0, 80))
}
calls.length = 0
r = await call('computer_drag', { from_x: null, from_y: 2, to_x: 3, to_y: 4 })
check('D6 drag null 坐标被拒', r.ok === false && !calls.some((c) => c.tool === 'drag'),
  String(r.result).slice(0, 80))

// D7-D9：modifier 走私有 SendInput；私有路径不复刻 from_zoom，且需要 screenOrigin
priv.calls.length = 0
calls.length = 0
r = await call('computer_drag', {
  from_x: 10, from_y: 10, to_x: 20, to_y: 20, modifier: ['control', 'CTRL'],
})
const privCall = priv.calls[0]
check('D7 modifier drag 走私有 SendInput 并映射屏幕坐标', r.ok === true
  && priv.calls.length === 1
  && privCall?.modifier?.join(',') === 'ctrl'
  && privCall?.fromX === 110 && privCall?.fromY === 110
  && privCall?.toX === 120 && privCall?.toY === 120
  && !calls.some((c) => c.tool === 'drag')
  && /私有 SendInput/.test(String(r.result)), JSON.stringify(privCall || {}))

priv.calls.length = 0
calls.length = 0
r = await call('computer_drag', {
  from_x: 10, from_y: 10, to_x: 20, to_y: 20, dwell_ms: 500,
})
check('D7b dwell_ms 无 modifier 也走私有路径', r.ok === true
  && priv.calls.length === 1 && priv.calls[0]?.dwellMs === 500
  && Array.isArray(priv.calls[0]?.modifier) && priv.calls[0].modifier.length === 0
  && !calls.some((c) => c.tool === 'drag'), JSON.stringify(priv.calls[0] || {}))

noteZoom(42, 7, { imageW: 280, imageH: 140 })
priv.calls.length = 0
calls.length = 0
r = await call('computer_drag', {
  from_x: 10, from_y: 10, to_x: 20, to_y: 20, from_zoom: true, modifier: ['ctrl'],
})
check('D8 modifier+from_zoom 明确拒绝', r.ok === false
  && /private_drag_zoom_unsupported/.test(String(r.result))
  && priv.calls.length === 0 && !calls.some((c) => c.tool === 'drag'),
  String(r.result).slice(0, 100))
clearZoom(42)

// G1：scroll/drag 也必须校验显式 snapshot_id（之前 schema 接受但实现忽略）
calls.length = 0
r = await call('computer_scroll', { direction: 'down', snapshot_id: 's-wrong' })
check('G1 scroll 的 snapshot_id 不匹配被拒',
  r.ok === false && /\[snapshot_mismatch\]/.test(String(r.result)) && !calls.some((c) => c.tool === 'scroll'),
  String(r.result).slice(0, 70))
calls.length = 0
r = await call('computer_drag', { from_x: 1, from_y: 1, to_x: 2, to_y: 2, snapshot_id: 's-wrong' })
check('G1 drag 的 snapshot_id 不匹配被拒',
  r.ok === false && /\[snapshot_mismatch\]/.test(String(r.result)) && !calls.some((c) => c.tool === 'drag'),
  String(r.result).slice(0, 70))

// D9：私有拖拽需要 screenOrigin/截图尺寸
setSnapshot({
  at: Date.now(), ttlMs: cfg.ttlMs, pid: 42, windowId: 7, appName: 'Stub', snapshotId: 's-noframe',
  entries: new Map(),
})
priv.calls.length = 0
r = await call('computer_drag', { from_x: 1, from_y: 2, to_x: 3, to_y: 4, modifier: ['ctrl'] })
check('D9 无 screenOrigin → private_drag_no_frame', r.ok === false
  && /private_drag_no_frame/.test(String(r.result)) && priv.calls.length === 0,
  String(r.result).slice(0, 100))
await call('screen_observe', { window: 'Stub' })

// ── P1-A：set_value 走 element_token + value ────────────────────────
calls.length = 0
r = await call('computer_set_value', { element: 0, value: 'world' })
const svCall = calls.find((c) => c.tool === 'set_value')
check('P1-A set_value 使用 element_token + value', r.ok === true && svCall?.args.pid === 42 && svCall?.args.element_token === 'tok-0' && svCall?.args.value === 'world',
  JSON.stringify(svCall?.args || {}))

// set_value 与 type 同属自动输入：密码框必须硬拒，不能只给注记。
setSnapshot({
  at: Date.now(), ttlMs: cfg.ttlMs, pid: 42, windowId: 7, appName: 'Stub', snapshotId: 's-pw',
  entries: new Map([[9, { token: 'tok-pw', role: 'Edit', label: '密码', is_password: true }]]),
})
r = await call('computer_set_value', { element: 9, value: 'secret' })
check('P1-A set_value 密码框硬拒', r.ok === false && /密码框拒绝自动输入/.test(String(r.result)), String(r.result).slice(0, 60))

// ── P0-4：suspected_noop 终止为失败 + 标记可疑 ───────────────────────
setSnapshot({
  at: Date.now(), ttlMs: cfg.ttlMs, pid: 42, windowId: 7, appName: 'Stub', snapshotId: 's1',
  entries: new Map([[0, { token: 'tok-0', role: 'Edit', label: 'body' }]]),
})
const noop = settleAction('click', { effect: 'suspected_noop', code: 'no_visible_change', reason: 'AX accepted but UI unchanged' }, { label: '点击' })
check('P0-4 suspected_noop 报失败', noop.ok === false && /suspected_noop/.test(noop.result), String(noop.result).slice(0, 90))
check('P0-4 附“先观察”注记', /先 screen_observe|先观察/.test(noop.result), String(noop.result).slice(0, 100))
check('P0-4 快照被标记可疑', freshnessIssueParts().some((s) => /不可验证/.test(s)), freshnessIssueParts().join('；'))

// ── P0-5：指定窗口未匹配 → fail-closed、不建快照 ─────────────────────
clearSnapshot()
r = await call('screen_observe', { window: 'does-not-exist' })
check('P0-5 未匹配窗口 fail-closed', r.ok === false && /未找到指定窗口/.test(String(r.result)), String(r.result).slice(0, 70))
check('P0-5 给出候选窗口', /Stub · Stub · pid=42/.test(String(r.result)), String(r.result).slice(0, 100))
check('P0-5 未建立快照', getSnapshot() === null)

if (!state.failures) cleanupWork(work)
console.log(`\n结果：${state.failures ? '❌ ' + state.failures + ' 项失败' : '✅ 全部通过'}`)
process.exit(state.failures ? 1 : 0)
