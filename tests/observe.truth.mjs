/**
 * 观察真实性专项测试（2026-11-15 t01 复盘）：
 * - 输入框当前值必须出现在文本与结构化 elements 中（另存为文件名盲区）；
 * - 密码值永不外显，差分只报“值变化（隐藏）”；
 * - 自上次观察的标题/值/状态栏差分要能让模型确认动作是否生效；
 * - 降噪 stub 仍带编号与关键控件；
 * - 同标题多窗口必须显式警告，而不是静默只取最前。
 *
 * 运行：node tests/observe.truth.mjs
 */
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { makeWorkCopy, writeStubDriver, loadPlugin, makeCtx, makeChecks, cleanupWork } from './lib/harness.mjs'

const work = makeWorkCopy('truth')
writeStubDriver(work, `
export const CUA_BIN = 'stub'
export const CUA_SESSION = 'truth'
export const withSession = (a = {}) => a
export function normalizeMcp(v) { return v }
export function isBackgroundUnavailable() { return false }
export function isForegroundUnavailable() { return false }
export function isUnverified() { return false }
export function deliveryFailure() { return null }

export const ws = {
  title: 's4-t01-seed.txt - Notepad',
  value: 's4-t01-seed.txt',
  status: '0 个字符',
  password: 'hunter2',
  extra: false,
  doc: 'SECRET-DOC-BODY',
  popup: false,
}

const WINDOW = () => ({
  pid: 42, window_id: 7, app_name: 'Notepad', title: ws.title,
  bounds: { x: 100, y: 100, width: 800, height: 600 }, z_index: 5, is_on_screen: true,
})

export async function cuaDeliver() {
  return { value: { ok: true, effect: 'confirmed', delivery: { mode: 'background' } }, note: '' }
}

export async function cuaCall(tool, args = {}) {
  switch (tool) {
    case 'check_permissions':
      return { elevated: false, integrity_level: 'Medium', uia: true, postmessage: true }
    case 'list_windows': {
      const wins = [WINDOW()]
      if (ws.extra) wins.push({ ...WINDOW(), window_id: 8, z_index: 4, title: ws.title })
      return { windows: wins }
    }
    case 'get_window_state': {
      const els = [
        { element_index: 0, element_token: 'save', role: 'Button', label: '保存(S)', frame: { x: 900, y: 700, w: 60, h: 24 }, enabled: true },
        { element_index: 1, element_token: 'name', role: 'Edit', label: '文件名:', value: ws.value, frame: { x: 600, y: 550, w: 300, h: 30 }, enabled: true },
        { element_index: 2, element_token: 'status', role: 'Text', label: ws.status, frame: { x: 180, y: 1130, w: 100, h: 20 } },
        { element_index: 3, element_token: 'pw', role: 'Edit', label: '密码:', value: ws.password, frame: { x: 600, y: 500, w: 300, h: 24 }, is_password: true },
        { element_index: 4, element_token: 'doc', role: 'Document', label: '', value: ws.doc, frame: { x: 160, y: 160, w: 600, h: 400 } },
        { element_index: 5, element_token: 'm-file', role: 'MenuItem', label: '文件', frame: { x: 110, y: 110, w: 50, h: 20 } },
        { element_index: 6, element_token: 'm-edit', role: 'MenuItem', label: '编辑', frame: { x: 160, y: 110, w: 50, h: 20 } },
        { element_index: 7, element_token: 'm-view', role: 'MenuItem', label: '查看', frame: { x: 210, y: 110, w: 50, h: 20 } },
        { element_index: 8, element_token: 'm-system', role: 'MenuItem', label: '系统', frame: { x: 90, y: 90, w: 30, h: 20 } },
        ...(ws.popup ? [
          { element_index: 9, element_token: 'p-save', role: 'MenuItem', label: '保存', frame: { x: 110, y: 130, w: 80, h: 20 } },
          { element_index: 10, element_token: 'p-saveas', role: 'MenuItem', label: '另存为', frame: { x: 110, y: 150, w: 80, h: 20 } },
          { element_index: 11, element_token: 'p-close', role: 'MenuItem', label: '退出', frame: { x: 110, y: 170, w: 80, h: 20 } },
        ] : []),
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
const stub = await import(pathToFileURL(join(work, 'lib', 'cua.js')).href)
const { check, state: checkState } = makeChecks()
const raw = (o) => String(o?.result || '')

const { reg, ctx, exec } = makeCtx()
plugin.apply(ctx, {
  ttlMs: 60000, maxElements: 120, observeDedup: 'summary', passwordScan: 'off',
  surfaceMode: 'hybrid', deliveryMode: 'auto', cursorMotion: 'off', actionGuard: 'off',
})
const call = (name, args = {}) => reg.get(name).execute(args, exec)

// 1. 输入值外显 + 首次观察无差分
const o1 = await call('screen_observe', { window_id: 7, mode: 'ax' })
check('T1: 文本显示输入框当前值', /值="s4-t01-seed\.txt"/.test(raw(o1)), raw(o1).split('\n').slice(0, 8).join(' | '))
check('T2: 结构化 elements 带 value', o1.elements?.[1]?.value === 's4-t01-seed.txt', JSON.stringify(o1.elements?.[1]))
check('T3: 首次观察 changedSinceLast=null', o1.changedSinceLast === null, String(o1.changedSinceLast))
check('T4: 密码值不外显', !raw(o1).includes('hunter2') && o1.elements?.[3]?.value === '', raw(o1).includes('hunter2') ? 'LEAK' : 'ok')

// 2. 标题/输入值/状态栏变化 → 差分
stub.ws.title = '*s4-t01-seed.txt - Notepad'
stub.ws.value = 'note.txt'
stub.ws.status = '33 个字符'
stub.ws.password = 'changed-secret'
const o2 = await call('screen_observe', { window_id: 7, mode: 'ax' })
check('T5: 标题变化被差分捕获', o2.changedSinceLast === true && /标题/.test(raw(o2)) && /\*s4-t01-seed/.test(raw(o2)), raw(o2).split('\n').slice(0, 8).join(' | '))
check('T6: 输入值变化被差分捕获', /\[1\] 输入框 “s4-t01-seed\.txt” → “note\.txt”/.test(raw(o2)), raw(o2).slice(0, 400))
check('T7: 状态栏字符数变化被差分捕获', /33 个字符/.test(raw(o2)), raw(o2).slice(0, 400))
check('T8: 密码变化只报隐藏', /值变化（隐藏）/.test(raw(o2)) && !raw(o2).includes('changed-secret') && !raw(o2).includes('hunter2'), raw(o2).slice(0, 500))

// 3. 未变 → 降噪 stub，但仍带编号/关键控件/差分
const o3 = await call('screen_observe', { window_id: 7, mode: 'ax' })
check('T9: 未变观察命中 stub', /状态未变/.test(raw(o3)) && o3.changedSinceLast === false, raw(o3).slice(0, 200))
check('T10: stub 带“无可见变化”', /自上次观察：无可见变化/.test(raw(o3)), raw(o3).slice(0, 300))
check('T11: stub 仍带关键控件', /关键控件/.test(raw(o3)) && /输入框/.test(raw(o3)), raw(o3).slice(0, 400))
check('T12: stub 结构化 elements 可复用', Array.isArray(o3.elements) && o3.elements.length > 0 && o3.elements[1]?.value === 'note.txt', `elements=${o3.elements?.length}`)

// 4. 时间/行列噪声不触发变化
stub.ws.status = '行 1，列 1'
await call('screen_observe', { window_id: 7, mode: 'ax' })
stub.ws.status = '行 2，列 2'
const o4 = await call('screen_observe', { window_id: 7, mode: 'ax' })
check('T13: 行列噪声仍判未变', /状态未变/.test(raw(o4)) && /无可见变化/.test(raw(o4)), raw(o4).slice(0, 200))

// 5. 同标题多窗口：显式警告
stub.ws.extra = true
const o5 = await call('screen_observe', { window: 'Notepad', mode: 'ax' })
check('T14: 同标题多窗口警告', /目标匹配 2 个窗口/.test(raw(o5)) && o5.window?.windowId === 7, raw(o5).split('\n').slice(0, 6).join(' | '))

// 6. 中文应用别名：Notepad.exe ←→ 记事本
stub.ws.extra = false
const alias = await call('screen_observe', { window: '记事本', mode: 'ax' })
check('T15: 中文别名匹配 Notepad', alias.ok === true && alias.window?.app === 'Notepad', raw(alias).split('\n')[0])
const exe = await call('screen_observe', { window: 'Notepad.exe', mode: 'ax' })
check('T16: .exe 别名匹配', exe.ok === true && exe.window?.pid === 42, raw(exe).split('\n')[0])

// 7. Document 正文不外显；顶层菜单栏不等于“菜单已打开”
const docObs = await call('screen_observe', { window_id: 7, mode: 'ax', force: true })
check('T17: Document 正文不泄露', docObs.ok === true && !/SECRET-DOC-BODY/.test(raw(docObs)), raw(docObs).slice(0, 160))
check('T18: 顶层菜单栏不误报“菜单已打开”', !/菜单已打开/.test(raw(docObs)), raw(docObs).split('\n').slice(0, 8).join(' | '))
stub.ws.popup = true
const popupObs = await call('screen_observe', { window_id: 7, mode: 'ax', force: true })
check('T19: 真正弹出菜单项才提示', /菜单已打开/.test(raw(popupObs)), raw(popupObs).split('\n').slice(0, 8).join(' | '))
stub.ws.popup = false

cleanupWork(work)
process.exit(checkState.failures > 0 ? 1 : 0)
