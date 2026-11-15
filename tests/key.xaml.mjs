/**
 * computer_key / XAML 组合键专项测试（2026-11-14 t01 复盘）。
 *
 * 覆盖：
 * - XAML 无 AcceleratorKey：默认只给可执行指引，不重复按键、不透传 get_window_state；
 * - xamlKeyFallback=auto：只在唯一标签下执行“菜单栏项 → 菜单项”两次 token 点击；
 * - 歧义/缺失/非白名单/非 XAML 不回退；
 * - foreground/background 投递失败不再 ok:true；suspected_noop 附注记。
 *
 * 运行：node tests/key.xaml.mjs
 */
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { makeWorkCopy, writeStubDriver, loadPlugin, makeCtx, makeChecks, cleanupWork } from './lib/harness.mjs'

const work = makeWorkCopy('keyxaml')
writeStubDriver(work, `
export const CUA_BIN = 'stub'
export const CUA_SESSION = 'keyxaml'
export const withSession = (a = {}) => a
export function normalizeMcp(v) { return v }
export function isBackgroundUnavailable(v) {
  const s = typeof v === 'string' ? v : JSON.stringify(v || {})
  return /background_unavailable|background unavailable/i.test(s)
}
export function isForegroundUnavailable(v) {
  const s = typeof v === 'string' ? v : JSON.stringify(v || {})
  return /foreground_unavailable|foreground unavailable/i.test(s)
}
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

export const clicks = []
export const clickPayloads = []
export const presses = []
let popup = ''
export function resetAll() { clicks.length = 0; clickPayloads.length = 0; presses.length = 0; popup = '' }
const mode = () => process.env.CUA_KEY_MODE || 'xaml-throw'

export async function cuaDeliver(tool, payload) {
  if (tool === 'hotkey') {
    const m = mode()
    if (m === 'xaml-throw' || m === 'ambiguous' || m === 'no-menu' || m === 'menu-open') {
      throw new Error('cua-driver hotkey 返回非 JSON: hotkey on a modern XAML / UWP target (pid 42, hwnd 7) could not find a UIA AcceleratorKey or (Ctrl+X)-style name hint matching ctrl+s')
    }
    if (m === 'xaml-error') {
      return { value: { error: 'hotkey on a modern XAML / UWP target ... could not find a UIA AcceleratorKey ...' }, note: '' }
    }
    if (m === 'foreground') return { value: { code: 'foreground_unavailable', detail: 'stub lock' }, note: '' }
    if (m === 'background') return { value: { code: 'background_unavailable', detail: 'stub' }, note: '' }
    if (m === 'suspected') return { value: { effect: 'suspected_noop', code: 'x', reason: 'no change' }, note: '' }
    if (m === 'other') throw new Error('some other driver failure')
    return { value: { ok: true, effect: 'confirmed', delivery: { mode: 'background' } }, note: '' }
  }
  if (tool === 'click') {
    clicks.push(payload.element_token)
    clickPayloads.push(payload)
    if (payload.element_token === 'm-file') popup = 'file'
    if (payload.element_token === 'm-edit') popup = 'edit'
    return { value: { ok: true, effect: 'confirmed', delivery: { mode: 'background' } }, note: '' }
  }
  if (tool === 'press_key') {
    presses.push(payload)
    if (process.env.CUA_KEY_PRESS_FAIL === '1') return { value: { code: 'foreground_unavailable', detail: 'stub lock' }, note: '' }
    return { value: { ok: true, effect: 'confirmed', delivery: { mode: 'foreground' } }, note: '' }
  }
  return { value: await cuaCall(tool, payload), note: '' }
}

export async function cuaCall(tool, args = {}) {
  switch (tool) {
    case 'check_permissions': return { elevated: false, integrity_level: 'Medium', uia: true, postmessage: true }
    case 'list_windows': {
      const wins = [{ pid: 42, window_id: 7, app_name: 'Stub', title: 'Doc - Stub', bounds: { x: 100, y: 100, width: 800, height: 600 }, z_index: 5, is_on_screen: true }]
      if (popup) {
        wins.push({ pid: 42, window_id: 9, app_name: 'Stub', title: popup === 'edit' ? 'Edit Popup' : 'File Popup', bounds: { x: 200, y: 200, width: 260, height: 300 }, z_index: 9, is_on_screen: true })
      }
      return { windows: wins }
    }
    case 'get_window_state': {
      if (Number(args.window_id) === 9) {
        const items = popup === 'edit'
          ? [{ element_index: 0, element_token: 'm-selectall', role: '菜单项', label: '全选', enabled: true, frame: { x: 210, y: 250, w: 60, h: 20 } }]
          : mode() === 'ambiguous'
            ? [{ element_index: 0, element_token: 'm-save1', role: '菜单项', label: '保存', enabled: true, frame: { x: 210, y: 250, w: 60, h: 20 } },
               { element_index: 1, element_token: 'm-save2', role: '菜单项', label: '保存', enabled: true, frame: { x: 210, y: 280, w: 60, h: 20 } }]
            : [{ element_index: 0, element_token: 'm-save', role: '菜单项', label: '保存', enabled: true, frame: { x: 210, y: 250, w: 60, h: 20 } }]
        return { window: { pid: 42, window_id: 9, app_name: 'Stub', title: popup === 'edit' ? 'Edit Popup' : 'File Popup' }, elements: items, element_count: items.length, screenshot_width: 260, screenshot_height: 300, snapshot_id: 's00000009' }
      }
      const els = mode() === 'no-menu'
        ? [{ element_index: 0, element_token: 'doc', role: 'Document', label: 'text', enabled: true, frame: { x: 120, y: 160, w: 300, h: 300 } }]
        : [
            { element_index: 0, element_token: 'm-file', role: '菜单项', label: '文件', enabled: true, frame: { x: 110, y: 110, w: 50, h: 20 } },
            { element_index: 1, element_token: 'm-edit', role: '菜单项', label: '编辑', enabled: true, frame: { x: 170, y: 110, w: 50, h: 20 } },
            ...(mode() === 'menu-open'
              ? [
                  { element_index: 2, element_token: 'm-new', role: '菜单项', label: '新建', enabled: true, frame: { x: 120, y: 140, w: 60, h: 20 } },
                  { element_index: 3, element_token: 'm-open', role: '菜单项', label: '打开', enabled: true, frame: { x: 120, y: 165, w: 60, h: 20 } },
                  { element_index: 4, element_token: 'm-save-m', role: '菜单项', label: '保存', enabled: true, frame: { x: 120, y: 190, w: 60, h: 20 } },
                ]
              : []),
          ]
      return { window: { pid: 42, window_id: 7, app_name: 'Stub', title: 'Doc - Stub', bounds: { x: 100, y: 100, width: 800, height: 600 } }, elements: els, element_count: els.length, screenshot_width: 800, screenshot_height: 600, snapshot_id: 's00000007' }
    }
    case 'get_desktop_state': return { screenshot_width: 800, screenshot_height: 600 }
    default: return { ok: true }
  }
}
`)

const plugin = await loadPlugin(work)
const stub = await import(pathToFileURL(join(work, 'lib', 'cua.js')).href)
const { check, state: checkState } = makeChecks()

async function fresh(cfgExtra = {}) {
  const { reg, ctx, exec } = makeCtx()
  plugin.apply(ctx, {
    ttlMs: 60000, maxElements: 120, observeDedup: 'off', passwordScan: 'off',
    surfaceMode: 'hybrid', deliveryMode: 'auto', xamlKeyFallback: 'off', xamlPressFallback: 'off', ...cfgExtra,
  })
  const call = (name, args = {}) => reg.get(name).execute(args, exec)
  await call('screen_observe', { window: '42', mode: 'ax' })
  return call
}
const reset = (mode) => {
  stub.resetAll()
  process.env.CUA_KEY_MODE = mode
  delete process.env.CUA_KEY_PRESS_FAIL
}

// 1. 默认 off：只给指引，不点击，不透传 get_window_state
reset('xaml-throw')
let call = await fresh({ xamlKeyFallback: 'off' })
let r = await call('computer_key', { key: 'ctrl+s' })
check('K1: XAML 无加速键 → ok:false', r.ok === false, r.result)
check('K2: 指引要求不要重复按键', /不要重复按 ctrl\+s/i.test(r.result || ''), r.result)
check('K3: 指引包含文件/保存控件路径', /文件/.test(r.result || '') && /保存/.test(r.result || ''), r.result)
check('K4: 不再透传 get_window_state', !/get_window_state/.test(r.result || ''), r.result)
check('K5: off 模式零额外点击', stub.clicks.length === 0, stub.clicks.join(','))

// 2. auto：菜单栏项 → 弹出菜单保存项
reset('xaml-throw')
call = await fresh({ xamlKeyFallback: 'auto' })
r = await call('computer_key', { key: 'ctrl+s' })
check('K6: auto 回退成功回执', r.ok === true && /自动回退/.test(r.result || ''), r.result)
check('K7: 只点菜单栏项 + 保存项', stub.clicks.join(',') === 'm-file,m-save', stub.clicks.join(','))
check('K7b: 菜单栏/弹出项点击带各自 window_id', stub.clickPayloads[0]?.window_id === 7
  && stub.clickPayloads[1]?.window_id === 9, JSON.stringify(stub.clickPayloads.map((p) => p.window_id)))
check('K8: 回执要求 screen_observe 确认', /screen_observe/.test(r.result || ''), r.result)

// 3. 结构化 error 形态也识别
reset('xaml-error')
call = await fresh({ xamlKeyFallback: 'off' })
r = await call('computer_key', { key: 'ctrl+s' })
check('K9: 结构化 error 也走 XAML 指引', r.ok === false && /XAML\/WinUI/.test(r.result || ''), r.result)

// 4. 歧义菜单项 → 停，不点保存
reset('ambiguous')
call = await fresh({ xamlKeyFallback: 'auto' })
r = await call('computer_key', { key: 'ctrl+s' })
check('K10: 歧义菜单项 → 失败', r.ok === false && /不唯一|歧义|停止/.test(r.result || ''), r.result)
check('K11: 歧义时不点保存项', !stub.clicks.includes('m-save1') && !stub.clicks.includes('m-save2'), stub.clicks.join(','))

// 5. 没有菜单栏项 → 不盲点
reset('no-menu')
call = await fresh({ xamlKeyFallback: 'auto' })
r = await call('computer_key', { key: 'ctrl+s' })
check('K12: 找不到菜单栏项 → 失败', r.ok === false && /没有找到|未执行/.test(r.result || ''), r.result)
check('K13: 找不到菜单栏项时不点击', stub.clicks.length === 0, stub.clicks.join(','))

// 6. 非白名单组合不回退
reset('xaml-throw')
call = await fresh({ xamlKeyFallback: 'auto' })
r = await call('computer_key', { key: 'ctrl+w' })
check('K14: 非白名单组合只给指引', r.ok === false && stub.clicks.length === 0, r.result)

// 7. 非 XAML 错误不吞（wrap 统一转成 ✗ 回执，不能被误当成 XAML 指引）
reset('other')
call = await fresh({ xamlKeyFallback: 'auto' })
r = await call('computer_key', { key: 'ctrl+s' })
check('K15: 非 XAML 错误保持原样报错', r.ok === false && /some other driver failure/.test(r.result || '') && !/XAML\/WinUI/.test(r.result || ''), r.result)

// 8. 投递层失败不再 ok:true
for (const [mode, needle] of [['foreground', /前台锁/], ['background', /后台投递/]]) {
  reset(mode)
  call = await fresh({ xamlKeyFallback: 'off' })
  r = await call('computer_key', { key: 'ctrl+s' })
  check(`K16: ${mode}_unavailable → ok:false`, r.ok === false && needle.test(r.result || ''), r.result)
}

// 9. suspected_noop 附注记
reset('suspected')
call = await fresh({ xamlKeyFallback: 'off' })
r = await call('computer_key', { key: 'ctrl+s' })
check('K17: suspected_noop → ok:false + 先观察注记', r.ok === false && /可能未生效/.test(r.result || ''), r.result)

// 10. 正常 Win32 hotkey 仍成功
reset('ok')
call = await fresh({ xamlKeyFallback: 'auto' })
r = await call('computer_key', { key: 'ctrl+s' })
check('K18: 正常 hotkey 成功不受影响', r.ok === true && /已确认/.test(r.result || ''), r.result)

// 11. 对话框（无菜单栏）+ 已前台：实验性 press_key 回退
reset('no-menu')
call = await fresh({ xamlKeyFallback: 'auto' })
r = await call('computer_key', { key: 'ctrl+a', foreground: true })
check('K19: 对话框 ctrl+a 已前台 → press_key 回退', r.ok === true && /press_key/.test(r.result || ''), r.result)
check('K20: press_key 带 ctrl + window_id', stub.presses.length === 1
  && stub.presses[0].key === 'a'
  && Array.isArray(stub.presses[0].modifiers) && stub.presses[0].modifiers.includes('ctrl')
  && stub.presses[0].window_id === 7, JSON.stringify(stub.presses[0] || null))

// 12. 对话框未显式前台：也尝试一次 press_key（避免“点击→Ctrl+A 被拒”循环）
reset('no-menu')
call = await fresh({ xamlKeyFallback: 'auto' })
r = await call('computer_key', { key: 'ctrl+a' })
check('K21: 对话框未显式前台也尝试 press_key', r.ok === true
  && /press_key/.test(r.result || '') && stub.presses.length === 1, r.result)

// 13. press_key 仍失败：如实失败，不再建议刚试过的 foreground=true
reset('no-menu')
process.env.CUA_KEY_PRESS_FAIL = '1'
call = await fresh({ xamlKeyFallback: 'auto' })
r = await call('computer_key', { key: 'ctrl+a' })
check('K22: press_key 失败 → 明确失败、不再建议 foreground=true', r.ok === false
  && /前台 press_key 也未能发送/.test(r.result || '')
  && !/foreground=true/.test(r.result || '')
  && stub.presses.length === 1, r.result)

// 14. xamlPressFallback：alt+f 默认 off 只给指引
reset('xaml-throw')
call = await fresh({ xamlKeyFallback: 'off', xamlPressFallback: 'off' })
r = await call('computer_key', { key: 'alt+f' })
check('K23: alt+f 默认 off → 零 press，只给文件菜单指引', r.ok === false
  && stub.presses.length === 0 && /文件/.test(r.result || '')
  && /不要重复按/.test(r.result || ''), r.result)

// 15. alt+f opt-in：前台 press_key 打开文件菜单
reset('xaml-throw')
call = await fresh({ xamlKeyFallback: 'off', xamlPressFallback: 'auto' })
r = await call('computer_key', { key: 'alt+f' })
check('K24: alt+f opt-in → 前台 press_key', r.ok === true
  && /press_key/.test(r.result || '') && /未验证/.test(r.result || '')
  && stub.presses.length === 1 && stub.presses[0].key === 'f'
  && Array.isArray(stub.presses[0].modifiers) && stub.presses[0].modifiers.includes('alt')
  && stub.presses[0].pid === 42 && stub.presses[0].window_id === 7,
  JSON.stringify(stub.presses[0] || null))
const afterAltF = await call('computer_click', { element: 0 })
check('K25: alt+f 成功后清快照', afterAltF.ok === false
  && /snapshot_missing|没有可用的观察快照/.test(afterAltF.result || ''), afterAltF.result)

// 16. ctrl+a 只开 press 回退：不走菜单点击
reset('xaml-throw')
call = await fresh({ xamlKeyFallback: 'off', xamlPressFallback: 'auto' })
r = await call('computer_key', { key: 'ctrl+a' })
check('K26: ctrl+a 仅 press 回退 → 零菜单点击', r.ok === true
  && /press_key/.test(r.result || '') && stub.presses.length === 1
  && stub.presses[0].key === 'a' && stub.presses[0].modifiers.includes('ctrl')
  && stub.clicks.length === 0, JSON.stringify(stub.presses[0] || null))

// 17. 两者 auto：ctrl+a 仍菜单优先（编辑→全选）
reset('xaml-throw')
call = await fresh({ xamlKeyFallback: 'auto', xamlPressFallback: 'auto' })
r = await call('computer_key', { key: 'ctrl+a' })
check('K27: 两者 auto → ctrl+a 菜单优先、零 press', r.ok === true
  && /自动回退/.test(r.result || '')
  && stub.clicks.join(',') === 'm-edit,m-selectall' && stub.presses.length === 0,
  JSON.stringify({ clicks: stub.clicks, presses: stub.presses.length }))

// 18. 非白名单组合不因新开关回退
reset('xaml-throw')
call = await fresh({ xamlKeyFallback: 'off', xamlPressFallback: 'auto' })
r = await call('computer_key', { key: 'ctrl+c' })
check('K28: ctrl+c 不在 press 白名单 → 零 press', r.ok === false
  && stub.presses.length === 0 && /不要重复按/.test(r.result || ''), r.result)

// 19. alt+f press 仍失败：明确失败，不假报成功
reset('xaml-throw')
process.env.CUA_KEY_PRESS_FAIL = '1'
call = await fresh({ xamlKeyFallback: 'off', xamlPressFallback: 'auto' })
r = await call('computer_key', { key: 'alt+f' })
check('K29: alt+f press 失败 → ok:false + 不误导', r.ok === false
  && /前台 press_key 也未能发送/.test(r.result || '')
  && !/foreground=true/.test(r.result || '')
  && stub.presses.length === 1, r.result)

// 20. 非 XAML 错误不吞、不触发 press 回退
reset('other')
call = await fresh({ xamlKeyFallback: 'off', xamlPressFallback: 'auto' })
r = await call('computer_key', { key: 'alt+f' })
check('K30: 非 XAML 错误保持原样、零 press', r.ok === false
  && /some other driver failure/.test(r.result || '') && stub.presses.length === 0, r.result)

// 21. 结构化 XAML error 也走 press 回退
reset('xaml-error')
call = await fresh({ xamlKeyFallback: 'off', xamlPressFallback: 'auto' })
r = await call('computer_key', { key: 'alt+f' })
check('K31: 结构化 XAML error → press 回退', r.ok === true && stub.presses.length === 1, r.result)

// 22. 快照已显示弹出菜单：拒绝 alt+f，避免把菜单关掉
reset('menu-open')
call = await fresh({ xamlKeyFallback: 'off', xamlPressFallback: 'auto' })
r = await call('computer_key', { key: 'alt+f' })
check('K32: 菜单可能已打开 → 拒绝 alt+f', r.ok === false
  && /菜单可能已打开/.test(r.result || '') && stub.presses.length === 0, r.result)

delete process.env.CUA_KEY_MODE
cleanupWork(work)
process.exit(checkState.failures > 0 ? 1 : 0)
