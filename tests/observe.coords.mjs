/**
 * observe 坐标一致性专项测试（2026-11-14 t01 复盘）。
 *
 * 契约：文本元素行里的 @(x,y)、结构化 elements.x/y、computer_click 的 x/y
 * 必须同为“窗口截图坐标”；driver frame 是屏幕物理坐标，输出时必须减窗口原点。
 * 旧实现只给结构化 elements 减了原点，文本行仍是屏幕坐标 → 模型照着点必打偏。
 *
 * 运行：node tests/observe.coords.mjs
 */
import { makeWorkCopy, writeStubDriver, loadPlugin, makeCtx, makeChecks, cleanupWork } from './lib/harness.mjs'

const work = makeWorkCopy('coords')
writeStubDriver(work, `
export const CUA_BIN = 'stub'
export const CUA_SESSION = 'coords'
export const withSession = (a = {}) => a
export function normalizeMcp(v) { return v }
export function isBackgroundUnavailable() { return false }
export function isForegroundUnavailable() { return false }
export function isUnverified() { return false }

export function deliveryFailure(v) {
  const s = typeof v === 'string' ? v : JSON.stringify(v || {})
  if (/foreground_unavailable|foreground unavailable/i.test(s)) return 'foreground'
  if (/background_unavailable|background unavailable/i.test(s)) return 'background'
  if (/delivery_failed|delivery failed/i.test(s)) return 'delivery_failed'
  return null
}
export async function cuaDeliver(tool, payload) { return { value: await cuaCall(tool, payload), note: '' } }

const DOC = { pid: 42, window_id: 8, app_name: 'Stub', title: 'Doc - Stub', bounds: { x: 100, y: 100, width: 800, height: 600 }, z_index: 5, is_on_screen: true }
const HELPER = { pid: 42, window_id: 7, app_name: 'Stub', title: 'Stub', bounds: { x: 0, y: 0, width: 223, height: 32 }, z_index: 0, is_on_screen: true }
const OVERLAY = { pid: 99, window_id: 99, app_name: 'cua-driver.exe', title: 'Cua.AgentCursorOverlay.default', bounds: { x: 0, y: 0, width: 5120, height: 1600 }, z_index: 99, is_on_screen: true }
const CODEX_OVERLAY = { pid: 98, window_id: 98, app_name: 'codex-computer-use.exe', title: 'Codex Computer Use Cursor Overlay', bounds: { x: 0, y: 0, width: 5120, height: 1600 }, z_index: 98, is_on_screen: true }

export async function cuaCall(tool, args = {}) {
  switch (tool) {
    case 'check_permissions': return { elevated: false, integrity_level: 'Medium', uia: true, postmessage: true }
    case 'list_windows': {
      const noBounds = process.env.CUA_NO_BOUNDS === '1'
      return { windows: [HELPER, noBounds ? { ...DOC, bounds: undefined } : DOC, OVERLAY, CODEX_OVERLAY] }
    }
    case 'get_window_state': {
      const win = Number(args.window_id) === Number(DOC.window_id) ? DOC : HELPER
      return {
        window: win,
        elements: [{ element_index: 0, element_token: 'tok0', role: 'Button', label: 'Save', frame: { x: 140, y: 160, w: 60, h: 24 }, enabled: true }],
        element_count: 1,
        screenshot_width: 800,
        screenshot_height: 600,
        snapshot_id: 's00000001',
      }
    }
    case 'get_desktop_state': return { screenshot_width: 800, screenshot_height: 600 }
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
    surfaceMode: 'hybrid', deliveryMode: 'auto', xamlKeyFallback: 'off',
  })
  return (name, args = {}) => reg.get(name).execute(args, exec)
}

// 1. 同一 pid 两窗口：默认应选 z_index 更高的文档窗口，而不是辅助窗口
let call = await fresh()
let o = await call('screen_observe', { window: '42', mode: 'ax' })
check('C1: 同 pid 多窗口按 z_index 选前（8 而非 7）', o.ok === true && o.window?.windowId === 8, `windowId=${o.window?.windowId}`)
check('C2: screenOrigin = 窗口 bounds 原点', o.screenOrigin?.x === 100 && o.screenOrigin?.y === 100)
check('C3: 结构化 elements 是窗口截图坐标（170-100=70,172-100=72）', o.elements?.[0]?.x === 70 && o.elements?.[0]?.y === 72, JSON.stringify(o.elements?.[0]))
check('C4: 文本行 @ 与结构化坐标一致', /@\(70,72\)/.test(String(o.result || '')), String(o.result || '').split('\n').find((l) => l.includes('Save')) || '')
check('C5: coordinateSpace = window-screenshot-px', o.coordinateSpace === 'window-screenshot-px', String(o.coordinateSpace))
check('C6: 头部声明与 computer_click 同空间', /与 computer_click 同空间/.test(String(o.result || '')))

// 2. window_id 精确匹配优先于 pid
call = await fresh()
o = await call('screen_observe', { window: '42', window_id: 7, mode: 'ax' })
check('C7: window_id 精确匹配辅助窗口', o.ok === true && o.window?.windowId === 7, `windowId=${o.window?.windowId}`)

// 3. 缺 bounds：不能假装仍是点击空间
process.env.CUA_NO_BOUNDS = '1'
try {
  call = await fresh()
  o = await call('screen_observe', { window: '42', mode: 'ax' })
  check('C8: 缺 bounds 时 screenOrigin=null', o.ok === true && o.screenOrigin === null)
  check('C9: 缺 bounds 时 coordinateSpace=screen-physical-px', o.coordinateSpace === 'screen-physical-px', String(o.coordinateSpace))
  check('C10: 缺 bounds 时头部警告不要直接点击', /屏幕物理像素/.test(String(o.result || '')) && /不要直接用于 computer_click/.test(String(o.result || '')))
  check('C11: 缺 bounds 时文本退回原始 frame（170,172）', /@\(170,172\)/.test(String(o.result || '')))
} finally {
  delete process.env.CUA_NO_BOUNDS
}

// 4. agent overlay 不是可选目标
call = await fresh()
o = await call('screen_observe', { mode: 'ax' })
check('C12: 无参数不选 agent overlay', o.ok === true && o.window?.windowId !== 99, `windowId=${o.window?.windowId}`)
o = await call('screen_observe', { window: 'Cua.AgentCursorOverlay.default', mode: 'ax' })
check('C13: 显式 overlay 被拒绝', o.ok === false && /覆盖层/.test(String(o.result || '')), String(o.result || '').slice(0, 80))
o = await call('screen_observe', { window: 'Codex Computer Use Cursor Overlay', mode: 'ax' })
check('C14: Codex overlay 也被拒绝', o.ok === false && /覆盖层/.test(String(o.result || '')), String(o.result || '').slice(0, 80))

cleanupWork(work)
process.exit(checkState.failures > 0 ? 1 : 0)
