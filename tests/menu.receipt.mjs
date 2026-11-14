/**
 * computer_menu 回执专项测试（2026-11-14 t01 复盘）。
 *
 * 驱动对 invoke_menu 可能返回 effect:"unverifiable"（只受理、没证明菜单打开）。
 * 旧实现把它当成功“已调用菜单路径”，模型据此继续下一步 → 菜单没开也去点菜单项。
 * 新契约：只有 effect:"confirmed" 才算成功；unverifiable 必须 ok:false 并提示先观察。
 *
 * 运行：node tests/menu.receipt.mjs
 */
import { makeWorkCopy, writeStubDriver, loadPlugin, makeCtx, makeChecks, cleanupWork } from './lib/harness.mjs'

const work = makeWorkCopy('menu')
writeStubDriver(work, `
export const CUA_BIN = 'stub'
export const CUA_SESSION = 'menu'
export const withSession = (a = {}) => a
export function normalizeMcp(v) { return v }
export function isBackgroundUnavailable() { return false }
export function isForegroundUnavailable() { return false }
export function isUnverified(v) {
  const s = typeof v === 'string' ? v : JSON.stringify(v || {})
  return /unverifiable|delivery_failed|delivery failed/i.test(s) && !/background_unavailable/i.test(s)
}

export function deliveryFailure(v) {
  const s = typeof v === 'string' ? v : JSON.stringify(v || {})
  if (/foreground_unavailable|foreground unavailable/i.test(s)) return 'foreground'
  if (/background_unavailable|background unavailable/i.test(s)) return 'background'
  if (/delivery_failed|delivery failed/i.test(s)) return 'delivery_failed'
  return null
}
export async function cuaDeliver(tool, payload) { return { value: await cuaCall(tool, payload), note: '' } }
export async function cuaCall(tool, args = {}) {
  if (tool !== 'invoke_menu') return { ok: true }
  const mode = process.env.CUA_MENU_MODE || 'confirmed'
  if (mode === 'refusal') return { refusal: { code: 'menu_path_unavailable', message: 'no such path (stub)' } }
  if (mode === 'unverified') return { ok: true, effect: 'unverifiable', delivery: { mode: 'background' }, route: 'accessibility' }
  return { ok: true, effect: 'confirmed', delivery: { mode: 'background' }, route: 'accessibility' }
}
`)

const plugin = await loadPlugin(work)
const { check, state: checkState } = makeChecks()
const { reg, ctx, exec } = makeCtx()
plugin.apply(ctx, {
  ttlMs: 60000, maxElements: 120, observeDedup: 'off', passwordScan: 'off',
  surfaceMode: 'hybrid', deliveryMode: 'background', xamlKeyFallback: 'off',
})
const call = (name, args = {}) => reg.get(name).execute(args, exec)
const callMenu = (args) => call('computer_do', { action: 'call', tool: 'computer_menu', args })

process.env.CUA_MENU_MODE = 'confirmed'
let r = await callMenu({ pid: 42, window_id: 7, path: JSON.stringify(['File', 'Save']) })
check('M1: effect=confirmed → ok:true + 已调用', r.ok === true && /已调用菜单路径/.test(r.result || ''), r.result)

process.env.CUA_MENU_MODE = 'unverified'
r = await callMenu({ pid: 42, window_id: 7, path: JSON.stringify(['File']) })
check('M2: effect=unverifiable → ok:false', r.ok === false, r.result)
check('M3: 未确认回执要求先 screen_observe', /未确认/.test(r.result || '') && /screen_observe/.test(r.result || ''), r.result)
check('M4: 未确认回执警告不要重复调用', /不要重复调用/.test(r.result || ''), r.result)
check('M5: 未确认回执不再声称已调用', !/已调用菜单路径/.test(r.result || ''), r.result)

process.env.CUA_MENU_MODE = 'refusal'
r = await callMenu({ pid: 42, window_id: 7, path: JSON.stringify(['File']) })
check('M6: 驱动拒绝仍走 refusalReceipt', r.ok === false && /被引擎拒绝/.test(r.result || ''), r.result)

process.env.CUA_MENU_MODE = 'confirmed'
r = await callMenu({ pid: 42, window_id: 7, path: ['File', 'Save'] })
check('M7: path 数组可直接使用（不必先转 JSON 字符串）', r.ok === true && /File › Save/.test(r.result || ''), r.result)

delete process.env.CUA_MENU_MODE
cleanupWork(work)
process.exit(checkState.failures > 0 ? 1 : 0)
