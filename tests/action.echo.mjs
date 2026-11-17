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

export const es = { title: 's4-t01-seed.txt - Notepad', status: '0 个字符', role: 'Button', body: '' }
export const clicks = []
export const frontCalls = []
const WINDOW = () => ({
  pid: 42, window_id: 7, app_name: 'Notepad', title: es.title,
  bounds: { x: 0, y: 0, width: 800, height: 600 }, z_index: 5, is_on_screen: true,
})
export async function cuaDeliver(tool, payload) {
  clicks.push({ tool, payload })
  if (tool === 'click' && process.env.CUA_CLICK_CODE) {
    return { value: { code: process.env.CUA_CLICK_CODE, reason: 'no_screenshot' }, note: '' }
  }
  if (tool === 'click' && process.env.CUA_STALE_CLICK === '1') {
    return { value: { refusal: { code: 'stale_element_token', message: 'element_token is stale' } }, note: '' }
  }
  if (tool === 'click' && process.env.CUA_UNVERIFIED === '1') {
    return { value: { ok: true, effect: 'unverifiable', delivery: { mode: payload.delivery_mode || 'background' } }, note: '' }
  }
  if (tool === 'type_text') {
    const mode = process.env.CUA_INPUT_MODE || 'good'
    if (mode === 'good') es.body = String(payload.text || '')
    else if (mode === 'corrupt') es.body = String(payload.text || '').replace('line ', ' ')
    // mode=none: 保持原正文，模拟部分/未送达
    const unverified = process.env.CUA_UNVERIFIED === '1' || mode !== 'good'
    return {
      value: unverified
        ? { ok: true, effect: 'unverifiable', delivery: { mode: payload.delivery_mode || 'background' } }
        : { ok: true, effect: 'confirmed', delivery: { mode: payload.delivery_mode || 'background' } },
      note: '',
    }
  }
  return { value: { ok: true, effect: 'confirmed', delivery: { mode: payload.delivery_mode || 'background' } }, note: '' }
}
export async function cuaCall(tool, args = {}) {
  switch (tool) {
    case 'check_permissions': return { elevated: false, integrity_level: 'Medium', uia: true, postmessage: true }
    case 'list_windows': return { windows: [WINDOW()] }
    case 'launch_app': return {
      pid: 123, running: true, active: false,
      windows: [
        { window_id: 78, is_on_screen: false, minimized: true, title: 'hidden' },
        { window_id: 77, is_on_screen: true, minimized: false, title: 'main' },
      ],
    }
    case 'bring_to_front': {
      frontCalls.push(args)
      if (process.env.CUA_LAUNCH_MODE === 'refused') return { ok: true, effect: 'refused', code: 'foreground_unavailable' }
      return { ok: true, effect: 'confirmed' }
    }
    case 'get_window_state': {
      const allEls = [
        { element_index: 0, element_token: 'save', role: 'Button', label: '保存(S)', frame: { x: 700, y: 500, w: 0, h: 0 }, enabled: true },
        { element_index: 1, element_token: 'yes', role: 'Button', label: '是(Y)', frame: { x: 357, y: 171, w: 0, h: 0 }, enabled: true },
        { element_index: 2, element_token: 'no', role: es.role, label: '否(N)', frame: { x: 465, y: 171, w: 0, h: 0 }, enabled: true },
        { element_index: 3, element_token: 'name', role: 'Edit', label: '文件名:', value: 's4-t01-seed.txt', frame: { x: 400, y: 300, w: 200, h: 30 }, enabled: true },
        { element_index: 4, element_token: 'status', role: 'Text', label: es.status, frame: { x: 100, y: 550, w: 100, h: 20 } },
        { element_index: 5, element_token: 'doc', role: 'Document', label: '文本编辑器', value: es.body, frame: { x: 100, y: 100, w: 600, h: 400 } },
        { element_index: 6, element_token: 'file-menu', role: 'MenuItem', label: '文件', frame: { x: 100, y: 100, w: 60, h: 20 }, enabled: true },
        ...(process.env.CUA_MENU_POPUP === '1'
          ? [
              { element_index: 7, element_token: 'm-new', role: 'MenuItem', label: '新建', frame: { x: 110, y: 130, w: 60, h: 20 }, enabled: true },
              { element_index: 8, element_token: 'm-open', role: 'MenuItem', label: '打开', frame: { x: 110, y: 155, w: 60, h: 20 }, enabled: true },
              { element_index: 9, element_token: 'm-save', role: 'MenuItem', label: '保存', frame: { x: 110, y: 180, w: 60, h: 20 }, enabled: true },
            ]
          : []),
      ]
      const els = process.env.CUA_NO_DOC === '1'
        ? allEls.filter((e) => String(e.role) !== 'Document')
        : allEls
      return {
        window: WINDOW(), elements: els, element_count: els.length,
        screenshot_width: 800, screenshot_height: 600, snapshot_id: 's' + String(Date.now()),
      }
    }
    case 'get_desktop_state': return { screenshot_width: 800, screenshot_height: 600 }
    case 'set_value': {
      const mode = process.env.CUA_INPUT_MODE || 'good'
      if (mode === 'good') es.body = String(args.value || '')
      else if (mode === 'corrupt') es.body = String(args.value || '').slice(0, -2)
      return { ok: true, effect: process.env.CUA_UNVERIFIED === '1' ? 'unverifiable' : 'confirmed' }
    }
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
const ctrlClick = await call('computer_click', { element: 2, snapshot_id: same.snapshotId, modifier: ['ctrl'] })
check('E5b: 同目标 Ctrl+click 不被普通点击抑制', ctrlClick.ok === true
  && /modifier 需前台注入/.test(raw(ctrlClick)), raw(ctrlClick))
const ctrlClick2 = await call('computer_click', { element: 2, snapshot_id: same.snapshotId, modifier: ['ctrl'] })
check('E5c: 同目标相同 Ctrl+click 仍抑制', ctrlClick2.ok === false
  && /repeat_suppressed/.test(raw(ctrlClick2)), raw(ctrlClick2))

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
check('E9: app_launch 启动成功但前置被拒 → ok:true + 前置未确认', launched.ok === true
  && /启动成功，但前置未确认/.test(raw(launched)) && !/已前置/.test(raw(launched)), raw(launched))
check('E9b: app_launch 前置带可见主窗 window_id', stub.frontCalls[0]?.window_id === 77,
  JSON.stringify(stub.frontCalls[0] || null))
delete process.env.CUA_LAUNCH_MODE

// 8b. computer_activate：显式前置，带 window_id+pid；不产生额外恢复调用
;({ call } = await fresh())
const frontBefore = stub.frontCalls.length
const act = await call('computer_do', {
  action: 'call', tool: 'computer_activate', args: { window_id: 7 },
})
check('E9c: computer_activate 透传 window_id/pid', act.ok === true
  && /已激活窗口 window_id=7 pid=42/.test(raw(act))
  && stub.frontCalls.length === frontBefore + 1
  && stub.frontCalls[frontBefore]?.pid === 42
  && stub.frontCalls[frontBefore]?.window_id === 7,
  `${raw(act)} calls=${JSON.stringify(stub.frontCalls.slice(frontBefore))}`)
const actMiss = await call('computer_do', {
  action: 'call', tool: 'computer_activate', args: { window_id: 999 },
})
check('E9d: 未知 window_id 明确失败', actMiss.ok === false
  && /未找到 window_id=999/.test(raw(actMiss)), raw(actMiss))

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

// 9b. 裸 code 拒绝（0.52 的 screenshot_context_missing）不能当成功
;({ call, obs } = await fresh({ actionGuard: 'off' }))
process.env.CUA_CLICK_CODE = 'screenshot_context_missing'
const bareCode = await call('computer_click', { x: 5, y: 5, snapshot_id: obs.snapshotId })
check('E31: screenshot_context_missing 按拒绝上报', bareCode.ok === false
  && /screenshot_context_missing/.test(raw(bareCode)), raw(bareCode))
delete process.env.CUA_CLICK_CODE

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

;({ call, obs } = await fresh({ verifyAfterAction: 'auto', actionGuard: 'off' }))
process.env.CUA_UNVERIFIED = '1'
stub.es.role = 'Edit'
const v3 = await call('computer_click', { element: 2, snapshot_id: obs.snapshotId })
delete process.env.CUA_UNVERIFIED
stub.es.role = 'Button'
const afterStruct = await call('computer_click', { element: 2 })
check('E14: 复核发现同编号 role 变化 → 清快照', /界面结构已变化/.test(raw(v3))
  && afterStruct.ok === false && /snapshot_missing/.test(String(afterStruct.result || '')), raw(v3))

// 11. 输入回读 + 保存门禁（t01 r2 类：部分/错字输入后不能保存）
const TEXT = 'S4-T01 line one.\nS4-T01 line two.'
;({ call, obs } = await fresh({ actionGuard: 'off' }))
process.env.CUA_UNVERIFIED = '1'
process.env.CUA_INPUT_MODE = 'good'
const typedGood = await call('computer_type', { text: TEXT })
delete process.env.CUA_INPUT_MODE
delete process.env.CUA_UNVERIFIED
const saveAfterGood = await call('computer_click', { element: 0 })
check('E15: 输入回读一致 → 可保存', typedGood.ok === true && /输入回读：一致/.test(raw(typedGood))
  && saveAfterGood.ok === true, raw(typedGood))

;({ call, obs } = await fresh({ actionGuard: 'off' }))
process.env.CUA_UNVERIFIED = '1'
process.env.CUA_INPUT_MODE = 'corrupt'
const typedBad = await call('computer_type', { text: TEXT })
const saveBad = await call('computer_click', { element: 0 })
const keyBad = await call('computer_key', { key: 'ctrl+s' })
const menuBad = await call('computer_do', { action: 'call', tool: 'computer_menu', args: { window_id: 7, path: ['文件', '保存'] } })
const axObs = await call('screen_observe', { window_id: 7, mode: 'ax' })
const saveAfterAx = await call('computer_click', { element: 0 })
delete process.env.CUA_INPUT_MODE
delete process.env.CUA_UNVERIFIED
check('E16: 输入回读不一致 → 保存类动作被拒', typedBad.ok === true && /输入回读：不一致/.test(raw(typedBad))
  && saveBad.ok === false && /input_unconfirmed/.test(raw(saveBad))
  && keyBad.ok === false && /input_unconfirmed/.test(raw(keyBad))
  && menuBad.ok === false && /input_unconfirmed/.test(raw(menuBad)), raw(saveBad))
check('E17: 普通 ax observe 不清除输入门禁', axObs.ok === true && saveAfterAx.ok === false && /input_unconfirmed/.test(raw(saveAfterAx)), raw(saveAfterAx))

;({ call, obs } = await fresh({ actionGuard: 'off' }))
process.env.CUA_UNVERIFIED = '1'
process.env.CUA_INPUT_MODE = 'corrupt'
await call('computer_type', { text: TEXT })
process.env.CUA_INPUT_MODE = 'good'
const corrected = await call('computer_type', { text: TEXT })
const saveCorrected = await call('computer_click', { element: 0 })
delete process.env.CUA_INPUT_MODE
delete process.env.CUA_UNVERIFIED
check('E18: 修正后回读一致 → 解除保存门禁', corrected.ok === true && /输入回读：一致/.test(raw(corrected))
  && saveCorrected.ok === true, raw(corrected))

;({ call, obs } = await fresh({ actionGuard: 'off' }))
process.env.CUA_UNVERIFIED = '1'
process.env.CUA_INPUT_MODE = 'corrupt'
const svBad = await call('computer_do', { action: 'call', tool: 'computer_set_value', args: { element: 5, value: 'abc' } })
const saveAfterSv = await call('computer_click', { element: 0 })
delete process.env.CUA_INPUT_MODE
delete process.env.CUA_UNVERIFIED
check('E19: set_value 回读不一致 → 保存被拒', svBad.ok === true && /输入回读：不一致/.test(raw(svBad))
  && saveAfterSv.ok === false && /input_unconfirmed/.test(raw(saveAfterSv)), raw(svBad))

;({ call, obs } = await fresh({ actionGuard: 'off' }))
process.env.CUA_UNVERIFIED = '1'
process.env.CUA_INPUT_MODE = 'good'
const svGood = await call('computer_do', { action: 'call', tool: 'computer_set_value', args: { element: 5, value: 'abc' } })
delete process.env.CUA_INPUT_MODE
delete process.env.CUA_UNVERIFIED
const saveAfterSvGood = await call('computer_click', { element: 0 })
check('E19b: set_value 回读一致 → 可保存', /输入回读：一致/.test(raw(svGood))
  && saveAfterSvGood.ok === true, raw(svGood))

// 12. Document 正文不出现在模型可见树/回执
;({ call, obs } = await fresh())
stub.es.body = 'SECRET-BODY-123'
const docObs = await call('screen_observe', { window_id: 7, mode: 'ax', force: true })
check('E20: Document 正文不泄露到 observation', docObs.ok === true && !/SECRET-BODY-123/.test(raw(docObs)), raw(docObs).slice(0, 160))

// 13. 菜单栏点击专用反馈（后台点击常 unverified）
;({ call, obs } = await fresh({ actionGuard: 'off' }))
process.env.CUA_UNVERIFIED = '1'
const menuClick = await call('computer_click', { element: 6 })
delete process.env.CUA_UNVERIFIED
check('E21: 菜单栏点击 unverified → 菜单专用注记', menuClick.ok === true
  && /菜单栏点击未验证/.test(raw(menuClick))
  && !/（未验证：先 screen_observe 一次/.test(raw(menuClick)), raw(menuClick))

;({ call, obs } = await fresh({ actionGuard: 'off', verifyAfterAction: 'auto' }))
process.env.CUA_UNVERIFIED = '1'
process.env.CUA_MENU_POPUP = '1'
const menuAuto = await call('computer_click', { element: 6 })
delete process.env.CUA_MENU_POPUP
delete process.env.CUA_UNVERIFIED
check('E22: auto 复核检测到弹出菜单项', menuAuto.ok === true
  && /动作后复核：检测到弹出菜单项/.test(raw(menuAuto)), raw(menuAuto))

;({ call, obs } = await fresh({ actionGuard: 'off', verifyAfterAction: 'auto' }))
process.env.CUA_UNVERIFIED = '1'
const menuNo = await call('computer_click', { element: 6 })
delete process.env.CUA_UNVERIFIED
check('E23: auto 复核未检测到弹出项 → 提示可能已关/独立窗口', menuNo.ok === true
  && /未检测到弹出菜单项/.test(raw(menuNo)) && /独立弹出窗口/.test(raw(menuNo)), raw(menuNo))

;({ call, obs } = await fresh({ actionGuard: 'off' }))
process.env.CUA_UNVERIFIED = '1'
const menuCoord = await call('computer_click', { x: 130, y: 110 })
delete process.env.CUA_UNVERIFIED
check('E24: 坐标命中菜单栏项 → 菜单专用注记', menuCoord.ok === true
  && /菜单栏点击未验证/.test(raw(menuCoord)), raw(menuCoord))

// 14. 文档输入“不置脏”提示（少量静态注记，不加驱动调用）
;({ call, obs } = await fresh())
const typeDoc = await call('computer_type', { element: 5, text: 'hello' })
check('E25: type 到 Document → 不置脏提示', typeDoc.ok === true
  && /文档输入说明/.test(raw(typeDoc)) && /不置“未保存”标记/.test(raw(typeDoc))
  && !/SECRET-BODY/.test(raw(typeDoc)), raw(typeDoc))
const typeEdit = await call('computer_type', { element: 3, text: 'x' })
check('E26: type 到 Edit → 不出现文档提示', typeEdit.ok === true
  && !/文档输入说明/.test(raw(typeEdit)), raw(typeEdit))
const typeFocus = await call('computer_type', { text: 'y' })
check('E27: 无 element + 快照有 Document → 文档提示', typeFocus.ok === true
  && /文档输入说明/.test(raw(typeFocus)), raw(typeFocus))

;({ call, obs } = await fresh())
const svNote = await call('computer_do', { action: 'call', tool: 'computer_set_value', args: { element: 5, value: 'abc' } })
check('E28: set_value 成功 → 不置脏语义', svNote.ok === true
  && /设值说明/.test(raw(svNote)) && /不要据此判断失败/.test(raw(svNote)), raw(svNote))

// 15. 无 Document 的聚焦输入：保留窗口快照，连续按键可继续（t14 逐格输入 churn）
process.env.CUA_NO_DOC = '1'
;({ call, obs } = await fresh({ actionGuard: 'off' }))
process.env.CUA_UNVERIFIED = '1'
const typedGrid = await call('computer_type', { text: 'Month' })
const tabAfterGrid = await call('computer_key', { key: 'tab' })
delete process.env.CUA_NO_DOC
delete process.env.CUA_UNVERIFIED
check('E29: 无可回读文本控件 → 不清快照，Tab 可继续', typedGrid.ok === true
  && /未刷新快照/.test(raw(typedGrid)) && tabAfterGrid.ok === true
  && !/snapshot_missing/.test(raw(tabAfterGrid)), raw(typedGrid).slice(0, 220))

// 16. 有 Document 的输入仍走逐字回读，不被上面的优化绕过
;({ call, obs } = await fresh({ actionGuard: 'off' }))
process.env.CUA_UNVERIFIED = '1'
const typedDocStill = await call('computer_type', { text: 'x' })
delete process.env.CUA_UNVERIFIED
check('E30: 有 Document 仍走输入回读', typedDocStill.ok === true
  && /输入回读/.test(raw(typedDocStill)) && !/未刷新快照/.test(raw(typedDocStill)), raw(typedDocStill).slice(0, 220))

cleanupWork(work)
process.exit(checkState.failures > 0 ? 1 : 0)
