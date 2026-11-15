/**
 * 动作回执真实性 + 重复点击抑制专项测试（2026-11-15 t01 复盘）：
 * - 坐标点击回显“最近元素”，让模型发现 (465,171) 其实是“否(N)”而不是“是”；
 * - 元素点击回显编号/角色/标签；
 * - 同目标 5s 内重复且观察未报告变化 → repeat_suppressed；
 * - 观察到变化后放行；actionGuard=off 放行；double_click 不拦。
 *
 * 运行：node tests/action.echo.mjs
 */
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { makeWorkCopy, writeStubDriver, loadPlugin, makeCtx, makeChecks, cleanupWork } from './lib/harness.mjs'

const work = makeWorkCopy('echo')
writeStubDriver(work, `
export const CUA_BIN = 'stub'
export const CUA_SESSION = 'echo'
export const withSession = (a = {}) => a
export function normalizeMcp(v) { return v }
export function isBackgroundUnavailable() { return false }
export function isForegroundUnavailable() { return false }
export function isUnverified(v) {
  const s = typeof v === 'string' ? v : JSON.stringify(v || {})
  return /unverifiable|delivery_failed/i.test(s)
}
export function deliveryFailure() { return null }

export const es = { title: 's4-t01-seed.txt - Notepad', status: '0 个字符' }
export const clicks = []
const WINDOW = () => ({
  pid: 42, window_id: 7, app_name: 'Notepad', title: es.title,
  bounds: { x: 0, y: 0, width: 800, height: 600 }, z_index: 5, is_on_screen: true,
})
export async function cuaDeliver(tool, payload) {
  clicks.push({ tool, payload })
  if (tool === 'click' && process.env.CUA_STALE_CLICK === '1') {
    return { value: { refusal: { code: 'stale_element_token', message: 'element_token is stale' } }, note: '' }
  }
  if (tool === 'click' && process.env.CUA_UNVERIFIED === '1') {
    return { value: { ok: true, effect: 'unverifiable', delivery: { mode: payload.delivery_mode || 'background' } }, note: '' }
  }
  return { value: { ok: true, effect: 'confirmed', delivery: { mode: payload.delivery_mode || 'background' } }, note: '' }
}
export async function cuaCall(tool, args = {}) {
  switch (tool) {
    case 'check_permissions': return { elevated: false, integrity_level: 'Medium', uia: true, postmessage: true }
    case 'list_windows': return { windows: [WINDOW()] }
    case 'launch_app': return { pid: 123, running: true, active: false }
    case 'bring_to_front': {
      if (process.env.CUA_LAUNCH_MODE === 'refused') return { ok: true, effect: 'refused', code: 'foreground_unavailable' }
      return { ok: true, effect: 'confirmed' }
    }
    case 'get_window_state': {
      const els = [
        { element_index: 0, element_token: 'save', role: 'Button', label: '保存(S)', frame: { x: 700, y: 500, w: 0, h: 0 }, enabled: true },
        { element_index: 1, element_token: 'yes', role: 'Button', label: '是(Y)', frame: { x: 357, y: 171, w: 0, h: 0 }, enabled: true },
        { element_index: 2, element_token: 'no', role: 'Button', label: '否(N)', frame: { x: 465, y: 171, w: 0, h: 0 }, enabled: true },
        { element_index: 3, element_token: 'name', role: 'Edit', label: '文件名:', value: 's4-t01-seed.txt', frame: { x: 400, y: 300, w: 200, h: 30 }, enabled: true },
        { element_index: 4, element_token: 'status', role: 'Text', label: es.status, frame: { x: 100, y: 550, w: 100, h: 20 } },
      ]
      return {
        window: WINDOW(), elements: els, element_count: els.length,
        screenshot_width: 800, screenshot_height: 600, snapshot_id: 's' + String(Date.now()),
      }
    }
    case 'get_desktop_state': return { screenshot_width: 800, screenshot_height: 600 }
    default: return { ok: true }
  }
}
`)

const plugin = await loadPlugin(work)
const { check, state: checkState } = makeChecks()
const raw = (o) => String(o?.result || '')

async function fresh(cfgExtra = {}) {
  const { reg, ctx, exec } = makeCtx()
  plugin.apply(ctx, {
    ttlMs: 60000, maxElements: 120, observeDedup: 'off', passwordScan: 'off',
    surfaceMode: 'hybrid', deliveryMode: 'background', cursorMotion: 'off', ...cfgExtra,
  })
  const call = (name, args = {}) => reg.get(name).execute(args, exec)
  const obs = await call('screen_observe', { window_id: 7, mode: 'ax' })
  return { call, obs }
}

// 1. 坐标点击回显最近元素
let { call, obs } = await fresh()
let r = await call('computer_click', { x: 465, y: 171, snapshot_id: obs.snapshotId })
check('E1: 坐标点击回显最近元素', /目标 ≈ \[2\] 按钮 "否\(N\)" @\(465,171\)/.test(raw(r)), raw(r))
check('E2: 坐标点击 ok', r.ok === true, raw(r))

// 2. 元素点击回显编号/标签
;({ call, obs } = await fresh())
r = await call('computer_click', { element: 2, snapshot_id: obs.snapshotId })
check('E3: 元素点击回显编号/标签', /目标 \[2\] 按钮 "否\(N\)" @\(465,171\)/.test(raw(r)), raw(r))

// 3. 同目标连续点击 → 抑制
;({ call, obs } = await fresh())
const first = await call('computer_click', { element: 2, snapshot_id: obs.snapshotId })
const second = await call('computer_click', { element: 2, snapshot_id: obs.snapshotId })
check('E4: 同目标第二次点击被抑制', first.ok === true && second.ok === false
  && /repeat_suppressed/.test(raw(second)) && /否\(N\)/.test(raw(second)), raw(second))

// 4. 观察未变 → 仍抑制
const same = await call('screen_observe', { window_id: 7, mode: 'ax' })
const third = await call('computer_click', { element: 2, snapshot_id: same.snapshotId })
check('E5: 观察未变后仍抑制', same.changedSinceLast === false && third.ok === false
  && /repeat_suppressed/.test(raw(third)), raw(third))

// 5. 观察到变化 → 放行
const stub = await import(pathToFileURL(join(work, 'lib', 'cua.js')).href)
stub.es.title = '*s4-t01-seed.txt - Notepad'
const changed = await call('screen_observe', { window_id: 7, mode: 'ax' })
const fourth = await call('computer_click', { element: 2, snapshot_id: changed.snapshotId })
check('E6: 观察到变化后放行', changed.changedSinceLast === true && fourth.ok === true, raw(fourth))

// 6. actionGuard=off → 放行
;({ call, obs } = await fresh({ actionGuard: 'off' }))
const a = await call('computer_click', { element: 2, snapshot_id: obs.snapshotId })
const b = await call('computer_click', { element: 2, snapshot_id: obs.snapshotId })
check('E7: actionGuard=off 不抑制', a.ok === true && b.ok === true, `${raw(a)} / ${raw(b)}`)

// 7. double_click 语义明确，不拦（hybrid 下经 dispatcher 路由）
;({ call, obs } = await fresh())
const hidden = (tool, args) => call('computer_do', { action: 'call', tool, args })
const d1 = await hidden('computer_double_click', { element: 2, snapshot_id: obs.snapshotId })
const d2 = await hidden('computer_double_click', { element: 2, snapshot_id: obs.snapshotId })
check('E8: double_click 连续两次不抑制', d1.ok === true && d2.ok === true, `${raw(d1)} / ${raw(d2)}`)

// 8. app_launch 前置被拒：不能写“已前置”
;({ call } = await fresh())
process.env.CUA_LAUNCH_MODE = 'refused'
const launched = await call('computer_do', {
  action: 'call', tool: 'app_launch', args: { name: 'Stub', bring_to_front: true },
})
check('E9: app_launch 前置被拒 → ok:false + 前置未确认', launched.ok === false
  && /前置未确认/.test(raw(launched)) && !/已前置/.test(raw(launched)), raw(launched))
delete process.env.CUA_LAUNCH_MODE

// 9. stale_element_token：清空旧快照，下一次动作必须重新观察
;({ call, obs } = await fresh({ actionGuard: 'off' }))
process.env.CUA_STALE_CLICK = '1'
const stale = await call('computer_click', { element: 2, snapshot_id: obs.snapshotId })
check('E10: stale_element_token → 清快照 + 明确指引', stale.ok === false
  && /stale_element_token/.test(raw(stale)) && /旧快照已清空/.test(raw(stale)), raw(stale))
delete process.env.CUA_STALE_CLICK
const after = await call('computer_click', { element: 2, snapshot_id: obs.snapshotId })
check('E11: stale 后旧编号被拒绝', after.ok === false
  && /没有可用的观察快照|snapshot_missing/.test(raw(after)), raw(after))

// 10. verifyAfterAction=auto：unverifiable 后抓一次状态差分
;({ call, obs } = await fresh({ verifyAfterAction: 'auto', actionGuard: 'off' }))
stub.es.status = '1 个字符'
process.env.CUA_UNVERIFIED = '1'
const v1 = await call('computer_click', { element: 2, snapshot_id: obs.snapshotId })
delete process.env.CUA_UNVERIFIED
check('E12: verifyAfterAction 回执带复核差分', v1.ok === true
  && /动作后复核/.test(raw(v1)) && /1 个字符|文本/.test(raw(v1)), raw(v1))

;({ call, obs } = await fresh({ verifyAfterAction: 'auto', actionGuard: 'off' }))
process.env.CUA_UNVERIFIED = '1'
const v2 = await call('computer_click', { element: 2, snapshot_id: obs.snapshotId })
delete process.env.CUA_UNVERIFIED
check('E13: 未变化复核提示不要重复', v2.ok === true
  && /动作后复核/.test(raw(v2)) && /未观察到变化/.test(raw(v2)), raw(v2))

cleanupWork(work)
process.exit(checkState.failures > 0 ? 1 : 0)
