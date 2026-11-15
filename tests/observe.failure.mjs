/**
 * 观察失败/降级/可疑快照专项测试（2026-11-15）：
 * - 未找到窗口、桌面降级后旧快照必须失效，动作不能继续落到旧窗口；
 * - 快照被标 suspect 后，去重不得再回“状态未变” stub，必须给全量树。
 *
 * 运行：node tests/observe.failure.mjs
 */
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { makeWorkCopy, writeStubDriver, loadPlugin, makeCtx, makeChecks, cleanupWork } from './lib/harness.mjs'

const work = makeWorkCopy('obsfail')
writeStubDriver(work, `
export const CUA_BIN = 'stub'
export const CUA_SESSION = 'obsfail'
export const withSession = (a = {}) => a
export function normalizeMcp(v) { return v }
export function isBackgroundUnavailable() { return false }
export function isForegroundUnavailable() { return false }
export function isUnverified() { return false }
export function deliveryFailure() { return null }
export const history = []
const WINDOW = { pid: 42, window_id: 7, app_name: 'Stub', title: 'Stub', bounds: { x: 100, y: 100, width: 800, height: 600 }, z_index: 5, is_on_screen: true }
const OTHER = { pid: 43, window_id: 9, app_name: 'Other', title: 'Other', bounds: { x: 0, y: 0, width: 400, height: 300 }, z_index: 4, is_on_screen: true }
const OVERLAY = { pid: 99, window_id: 99, app_name: 'cua-driver.exe', title: 'Cua.AgentCursorOverlay.default', bounds: { x: 0, y: 0, width: 100, height: 100 }, z_index: 50, is_on_screen: true }
export async function cuaDeliver(tool, payload) { history.push({ tool, payload }); return { value: { ok: true, effect: 'confirmed', delivery: { mode: 'background' } }, note: '' } }
export async function cuaCall(tool, args = {}) {
  history.push({ tool, args })
  switch (tool) {
    case 'check_permissions': return { elevated: false, integrity_level: 'Medium', uia: true, postmessage: true }
    case 'list_windows': return { windows: [WINDOW, OTHER, OVERLAY] }
    case 'get_window_state':
      if (process.env.CUA_THROW_STATE === '1' && Number(args.window_id) === 7) throw new Error('window-level observation denied (stub)')
      if (Number(args.window_id) === 9) {
        return { window: OTHER, elements: [{ element_index: 0, element_token: 'tok9', role: 'Button', label: 'Other', frame: { x: 10, y: 20, w: 30, h: 20 }, enabled: true }], element_count: 1, screenshot_width: 400, screenshot_height: 300, snapshot_id: 's00000009' }
      }
      return { window: WINDOW, elements: [{ element_index: 0, element_token: 'tok0', role: 'Button', label: 'Save', frame: { x: 140, y: 160, w: 60, h: 24 }, enabled: true }], element_count: 1, screenshot_width: 800, screenshot_height: 600, snapshot_id: 's00000001' }
    case 'get_desktop_state': return { screenshot_png_b64: 'aGVsbG8=', screenshot_width: 800, screenshot_height: 600 }
    default: return { ok: true }
  }
}
`)

const plugin = await loadPlugin(work)
const snap = await import(pathToFileURL(join(work, 'lib', 'snapshot.js')).href)
const { check, state: checkState } = makeChecks()

async function fresh() {
  const { reg, ctx, exec } = makeCtx()
  plugin.apply(ctx, {
    ttlMs: 60000, maxElements: 120, observeDedup: 'summary', passwordScan: 'off',
    surfaceMode: 'hybrid', deliveryMode: 'background', cursorMotion: 'off',
  })
  const call = (name, args = {}) => reg.get(name).execute(args, exec)
  return { call }
}

// 1. 未找到“其它”窗口 → 保留旧快照 → 原窗口动作仍可用
{
  const { call } = await fresh()
  const o1 = await call('screen_observe', { window: '42', mode: 'ax' })
  const o2 = await call('screen_observe', { window: 'does-not-exist', mode: 'ax' })
  const c = await call('computer_click', { element: 0, snapshot_id: o1.snapshotId })
  check('O1: 未找到窗口返回 ok:false', o2.ok === false && /未找到指定窗口/.test(o2.result || ''), o2.result)
  check('O2: 未找到其它窗口不清空旧快照', c.ok === true && /点击完成/.test(c.result || ''), c.result)
  check('O2b: notFound 候选不列 agent overlay', !/AgentCursorOverlay/.test(o2.result || ''), String(o2.result || '').slice(-160))
}

// 1b. 显式观察 overlay → 专门拒绝，旧快照保留
{
  const { call } = await fresh()
  await call('screen_observe', { window: '42', mode: 'ax' })
  const o = await call('screen_observe', { window: 'Cua.AgentCursorOverlay.default', mode: 'ax' })
  const c = await call('computer_click', { element: 0 })
  check('O2c: overlay 目标被专门拒绝', o.ok === false && /覆盖层/.test(o.result || ''), o.result)
  check('O2d: overlay 拒绝后旧快照仍可用', c.ok === true && /点击完成/.test(c.result || ''), c.result)
}

// 2. 桌面降级 → 清快照 → 动作拒绝
{
  process.env.CUA_THROW_STATE = '1'
  try {
    const { call } = await fresh()
    await call('screen_observe', { window: '42', mode: 'ax' })
    const o = await call('screen_observe', { window: '42', mode: 'ax' })
    const c = await call('computer_click', { element: 0 })
    check('O3: 桌面降级仍返回观察结果', o.ok === true && /desktop|桌面|visualOnly|原生/.test(o.result || ''), String(o.result || '').slice(0, 120))
    check('O4: 桌面降级后旧快照失效', c.ok === false && /快照|snapshot_missing/.test(c.result || ''), c.result)
  } finally {
    delete process.env.CUA_THROW_STATE
  }
}

// 2b. 不同窗口的桌面降级 → 旧快照保留
{
  process.env.CUA_THROW_STATE = '1'
  try {
    const { call } = await fresh()
    await call('screen_observe', { window: 'Other', mode: 'ax' })
    const o = await call('screen_observe', { window: '42', mode: 'ax' })
    const c = await call('computer_click', { element: 0 })
    check('O4b: 不同窗口降级仍返回观察结果', o.ok === true && /观测降级/.test(o.result || ''), String(o.result || '').slice(0, 120))
    check('O4c: 不同窗口降级不清旧快照', c.ok === true && /点击完成/.test(c.result || ''), c.result)
  } finally {
    delete process.env.CUA_THROW_STATE
  }
}

// 3. suspect 快照 → 去重不得回 stub
{
  const { call } = await fresh()
  await call('screen_observe', { window: '42', mode: 'ax' })
  snap.markSuspect('test')
  const o = await call('screen_observe', { window: '42', mode: 'ax' })
  check('O5: suspect 后观察为全量树', o.ok === true && !/状态未变/.test(o.result || '') && /\[0\]/.test(o.result || ''), String(o.result || '').slice(0, 160))
}

cleanupWork(work)
process.exit(checkState.failures > 0 ? 1 : 0)
