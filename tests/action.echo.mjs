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
export function isUnverified() { return false }
export function deliveryFailure() { return null }

export const es = { title: 's4-t01-seed.txt - Notepad', status: '0 个字符' }
export const clicks = []
const WINDOW = () => ({
  pid: 42, window_id: 7, app_name: 'Notepad', title: es.title,
  bounds: { x: 0, y: 0, width: 800, height: 600 }, z_index: 5, is_on_screen: true,
})
export async function cuaDeliver(tool, payload) {
  clicks.push({ tool, payload })
  return { value: { ok: true, effect: 'confirmed', delivery: { mode: payload.delivery_mode || 'background' } }, note: '' }
}
export async function cuaCall(tool, args = {}) {
  switch (tool) {
    case 'check_permissions': return { elevated: false, integrity_level: 'Medium', uia: true, postmessage: true }
    case 'list_windows': return { windows: [WINDOW()] }
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

cleanupWork(work)
process.exit(checkState.failures > 0 ? 1 : 0)
