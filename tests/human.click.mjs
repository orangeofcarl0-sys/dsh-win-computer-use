/**
 * 元素点击专项测试（2026-11-15）：
 * - 快照条目坐标 = 窗口截图空间（不是屏幕坐标）；
 * - 元素点击受 TTL 约束；
 * - background 不滑行，foreground 保留滑行但目标是点击空间；
 * - 近距离只做一次终点移动；
 * - tokenless 元素回退到正确的窗口坐标。
 *
 * 运行：node tests/human.click.mjs
 */
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { makeWorkCopy, writeStubDriver, loadPlugin, makeCtx, makeChecks, cleanupWork } from './lib/harness.mjs'

const work = makeWorkCopy('click')
writeStubDriver(work, `
export const CUA_BIN = 'stub'
export const CUA_SESSION = 'click'
export const withSession = (a = {}) => a
export function normalizeMcp(v) { return v }
export function isBackgroundUnavailable() { return false }
export function isForegroundUnavailable() { return false }
export function isUnverified() { return false }
export function deliveryFailure() { return null }
export const moves = []
export const clicks = []
const WINDOW = { pid: 42, window_id: 7, app_name: 'Stub', title: 'Stub', bounds: { x: 100, y: 100, width: 800, height: 600 }, z_index: 5, is_on_screen: true }
export async function cuaDeliver(tool, payload) {
  if (tool === 'click') { clicks.push(payload); return { value: { ok: true, effect: 'confirmed', delivery: { mode: payload.delivery_mode || 'background' } }, note: '' } }
  return { value: await cuaCall(tool, payload), note: '' }
}
export async function cuaCall(tool, args = {}) {
  switch (tool) {
    case 'check_permissions': return { elevated: false, integrity_level: 'Medium', uia: true, postmessage: true }
    case 'list_windows': return { windows: [WINDOW] }
    case 'get_cursor_position': return { x: Number(process.env.CUA_CURSOR_X || 0), y: Number(process.env.CUA_CURSOR_Y || 0) }
    case 'move_cursor': moves.push({ x: args.x, y: args.y }); return { ok: true }
    case 'get_window_state': {
      const els = [
        { element_index: 0, element_token: 'tok0', role: 'Button', label: 'Save', frame: { x: 140, y: 160, w: 60, h: 24 }, enabled: true },
        { element_index: 1, role: 'Button', label: 'Tokenless', frame: { x: 200, y: 200, w: 10, h: 10 }, enabled: true },
      ]
      return { window: WINDOW, elements: els, element_count: els.length, screenshot_width: 800, screenshot_height: 600, snapshot_id: 's00000001' }
    }
    case 'get_desktop_state': return { screenshot_width: 800, screenshot_height: 600 }
    default: return { ok: true }
  }
}
`)

const plugin = await loadPlugin(work)
const stub = await import(pathToFileURL(join(work, 'lib', 'cua.js')).href)
const snapMod = await import(pathToFileURL(join(work, 'lib', 'snapshot.js')).href)
const { check, state: checkState } = makeChecks()

async function fresh(cfgExtra = {}) {
  stub.moves.length = 0
  stub.clicks.length = 0
  const { reg, ctx, exec } = makeCtx()
  plugin.apply(ctx, {
    ttlMs: 60000, maxElements: 120, observeDedup: 'off', passwordScan: 'off',
    surfaceMode: 'hybrid', deliveryMode: 'auto', cursorMotion: 'auto', ...cfgExtra,
  })
  const call = (name, args = {}) => reg.get(name).execute(args, exec)
  const obs = await call('screen_observe', { window_id: 7, mode: 'ax' })
  return { call, obs }
}

// 1. background：不滑行，token 点击
let { call, obs } = await fresh({ deliveryMode: 'background' })
let r = await call('computer_click', { element: 0, snapshot_id: obs.snapshotId })
check('H1: background 点击成功', r.ok === true, r.result)
check('H2: background 零 move_cursor', stub.moves.length === 0, `moves=${stub.moves.length}`)
check('H3: token 点击不传 x/y', stub.clicks.length === 1 && stub.clicks[0].element_token === 'tok0' && stub.clicks[0].x === undefined, JSON.stringify(stub.clicks[0]))

// 2. foreground：滑行目标是窗口截图坐标（70,72），不是屏幕坐标（170,172）
;({ call, obs } = await fresh({ deliveryMode: 'foreground' }))
r = await call('computer_click', { element: 0, snapshot_id: obs.snapshotId })
const last = stub.moves[stub.moves.length - 1]
check('H4: foreground 保留 5 段滑行', stub.moves.length === 5, `moves=${stub.moves.length}`)
check('H5: 滑行终点 = 窗口截图坐标', last && last.x === 70 && last.y === 72, JSON.stringify(last))

// 3. 近距离：只移动一次
process.env.CUA_CURSOR_X = '70'
process.env.CUA_CURSOR_Y = '72'
;({ call, obs } = await fresh({ deliveryMode: 'foreground' }))
r = await call('computer_click', { element: 0, snapshot_id: obs.snapshotId })
check('H6: 近距离只做一次终点移动', stub.moves.length === 1 && stub.moves[0].x === 70 && stub.moves[0].y === 72, JSON.stringify(stub.moves))
delete process.env.CUA_CURSOR_X
delete process.env.CUA_CURSOR_Y

// 4. tokenless：像素回退使用点击空间
;({ call, obs } = await fresh({ deliveryMode: 'background' }))
r = await call('computer_click', { element: 1, snapshot_id: obs.snapshotId })
const c = stub.clicks[0] || {}
check('H7: tokenless 回退窗口坐标（105,105）', c.x === 105 && c.y === 105 && c.window_id === 7, JSON.stringify(c))

// 5. 元素点击 TTL：快照过期必须拒绝
;({ call, obs } = await fresh({ deliveryMode: 'background' }))
const snap = snapMod.getSnapshot()
snap.at = Date.now() - 120000
r = await call('computer_click', { element: 0, snapshot_id: obs.snapshotId })
check('H8: 元素点击过期拒绝', r.ok === false && /\[snapshot_expired\]/.test(r.result || ''), r.result)

cleanupWork(work)
process.exit(checkState.failures > 0 ? 1 : 0)
