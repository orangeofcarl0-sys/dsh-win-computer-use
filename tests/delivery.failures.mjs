/**
 * 投递失败语义专项测试（2026-11-15）：
 * background_unavailable / foreground_unavailable / delivery_failed 不得再报 ok:true。
 * 纯 unverifiable 仍是“已送达但未验证”，保持 ok:true + 注记。
 *
 * 运行：node tests/delivery.failures.mjs
 */
import { makeWorkCopy, writeStubDriver, loadPlugin, makeCtx, makeChecks, cleanupWork } from './lib/harness.mjs'

const work = makeWorkCopy('delivery')
writeStubDriver(work, `
export const CUA_BIN = 'stub'
export const CUA_SESSION = 'delivery'
export const withSession = (a = {}) => a
export function normalizeMcp(v) { return v }
export function isBackgroundUnavailable(v) { return /background_unavailable/i.test(JSON.stringify(v || {})) }
export function isForegroundUnavailable(v) { return /foreground_unavailable/i.test(JSON.stringify(v || {})) }
export function isUnverified(v) { return /unverifiable|delivery_failed/i.test(JSON.stringify(v || {})) }
export function deliveryFailure(v) {
  const s = typeof v === 'string' ? v : JSON.stringify(v || {})
  if (/foreground_unavailable/i.test(s)) return 'foreground'
  if (/background_unavailable/i.test(s)) return 'background'
  if (/\\bdelivery_failed\\b/i.test(s)) return 'delivery_failed'
  return null
}
const WINDOW = { pid: 42, window_id: 7, app_name: 'Stub', title: 'Stub', bounds: { x: 100, y: 100, width: 800, height: 600 }, z_index: 5, is_on_screen: true }
function failure() {
  const mode = process.env.CUA_DELIVERY_MODE || 'background'
  if (mode === 'background') return { code: 'background_unavailable', detail: 'stub' }
  if (mode === 'foreground') return { code: 'foreground_unavailable', detail: 'stub' }
  if (mode === 'delivery_failed') return { effect: 'unverifiable', delivery: { mode: 'background' }, escalation: { reason: 'delivery_failed', target: 'foreground' } }
  if (mode === 'background_delivery_failed') return { effect: 'unverifiable', delivery: { mode: 'background' }, escalation: { reason: 'background_delivery_failed', target: 'foreground' } }
  if (mode === 'unverified') return { effect: 'unverifiable', delivery: { mode: 'background' } }
  return { ok: true, effect: 'confirmed', delivery: { mode: 'background' } }
}
export async function cuaDeliver() {
  if (process.env.CUA_DELIVERY_MODE === 'timeout') {
    const err = new Error('cua-driver click timeout after 30000ms')
    err.kind = 'timeout'
    err.timeoutMs = 30000
    throw err
  }
  return { value: failure(), note: '' }
}
export async function cuaCall(tool, args = {}) {
  switch (tool) {
    case 'check_permissions': return { elevated: false, integrity_level: 'Medium', uia: true, postmessage: true }
    case 'list_windows': return { windows: [WINDOW] }
    case 'get_window_state': {
      const els = [{ element_index: 0, element_token: 'tok0', role: 'Button', label: 'Save', frame: { x: 140, y: 160, w: 60, h: 24 }, enabled: true }]
      return { window: WINDOW, elements: els, element_count: 1, screenshot_width: 800, screenshot_height: 600, snapshot_id: 's00000001' }
    }
    case 'get_desktop_state': return { screenshot_width: 800, screenshot_height: 600 }
    case 'set_value': return failure()
    default: return { ok: true }
  }
}
`)

const plugin = await loadPlugin(work)
const { check, state: checkState } = makeChecks()

async function fresh() {
  const { reg, ctx, exec } = makeCtx()
  plugin.apply(ctx, {
    ttlMs: 60000, maxElements: 120, observeDedup: 'off', passwordScan: 'off',
    surfaceMode: 'hybrid', deliveryMode: 'auto', cursorMotion: 'off',
  })
  const call = (name, args = {}) => reg.get(name).execute(args, exec)
  const o = await call('screen_observe', { window_id: 7, mode: 'ax' })
  return { call, obs: o }
}

const hidden = (call, tool, args) => call('computer_do', { action: 'call', tool, args })
const actions = [
  ['click', (call, s) => call('computer_click', { element: 0, snapshot_id: s })],
  ['type', (call, s) => call('computer_type', { text: 'x', snapshot_id: s })],
  ['scroll', (call, s) => call('computer_scroll', { direction: 'down', snapshot_id: s })],
  ['drag', (call, s) => hidden(call, 'computer_drag', { from_x: 1, from_y: 2, to_x: 3, to_y: 4, snapshot_id: s })],
  ['set_value', (call, s) => hidden(call, 'computer_set_value', { element: 0, value: 'x', snapshot_id: s })],
]

for (const mode of ['background', 'foreground', 'delivery_failed']) {
  process.env.CUA_DELIVERY_MODE = mode
  for (const [name, fn] of actions) {
    const { call, obs } = await fresh()
    const r = await fn(call, obs.snapshotId)
    check(`D-${mode}-${name}: ok:false + 未送达`, r.ok === false && /未送达/.test(r.result || ''), r.result)
  }
}

process.env.CUA_DELIVERY_MODE = 'foreground'
{
  const { call, obs } = await fresh()
  const r = await call('computer_click', { element: 0, snapshot_id: obs.snapshotId })
  check('D-foreground-hint: 前台锁提示包含 observe/activate 指引',
    r.ok === false && /被其他窗口\/对话框覆盖/.test(r.result || ''), r.result)
}

process.env.CUA_DELIVERY_MODE = 'timeout'
{
  const { call, obs } = await fresh()
  const r = await call('computer_click', { element: 0, snapshot_id: obs.snapshotId })
  check('D-timeout-click: ok:false + 模态/观察指引',
    r.ok === false && /超时/.test(r.result || '') && /对话框/.test(r.result || '')
      && /screen_observe/.test(r.result || '') && /不要重复点击/.test(r.result || ''), r.result)
}
{
  const { call, obs } = await fresh()
  const r = await call('computer_type', { text: 'x', snapshot_id: obs.snapshotId })
  check('D-timeout-type: 部分写入警告 + 不要重复输入',
    r.ok === false && /可能已部分写入/.test(r.result || '') && /不要重复输入/.test(r.result || ''), r.result)
}
{
  const { call, obs } = await fresh()
  const r = await call('computer_key', { key: 'escape', snapshot_id: obs.snapshotId })
  check('D-timeout-key: 按键结果未知 + 不要重复按',
    r.ok === false && /按键结果未知/.test(r.result || '') && /不要重复按/.test(r.result || ''), r.result)
}

process.env.CUA_DELIVERY_MODE = 'unverified'
for (const [name, fn] of actions) {
  const { call, obs } = await fresh()
  const r = await fn(call, obs.snapshotId)
  check(`D-unverified-${name}: 仍为 ok:true`, r.ok === true, r.result)
}

process.env.CUA_DELIVERY_MODE = 'background_delivery_failed'
{
  const { call, obs } = await fresh()
  const r = await call('computer_type', { text: 'x', snapshot_id: obs.snapshotId })
  check('D-bg-delivery-failed-type: 仍为 ok:true 且不报未送达',
    r.ok === true && !/未送达/.test(r.result || '') && /未验证/.test(r.result || ''), r.result)
}

process.env.CUA_DELIVERY_MODE = 'ok'
for (const [name, fn] of actions) {
  const { call, obs } = await fresh()
  const r = await fn(call, obs.snapshotId)
  check(`D-ok-${name}: 正常成功`, r.ok === true, r.result)
}

delete process.env.CUA_DELIVERY_MODE
cleanupWork(work)
process.exit(checkState.failures > 0 ? 1 : 0)
