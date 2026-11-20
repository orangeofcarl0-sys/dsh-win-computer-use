/**
 * 原生 Win32/WinForms Button 触发测试（实验性，默认 off）。
 *
 * 覆盖：
 *  - 插件接入：off 不调用；Button element 命中；非 Button/坐标/多击/modifier/foreground 不触发；
 *  - 回退/拒绝：pre-delivery 失败回退 driver；owner_disabled 不回退；latch/未知不回退；
 *  - 真模块：10s latch、reset、sidecar 参数、timeout/unknown、pre-delivery null。
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { EventEmitter } from 'node:events'
import { makeWorkCopy, writeStubDriver, loadPlugin, makeCtx, makeChecks, cleanupWork } from './lib/harness.mjs'

const work = makeWorkCopy('native-button')

writeStubDriver(work, `
export const CUA_BIN = 'stub'
export const CUA_SESSION = 'native-button-test'
export const withSession = (a = {}) => a
export function normalizeMcp(v) { return v }
export function isBackgroundUnavailable() { return false }
export function isForegroundUnavailable() { return false }
export function isUnverified(v) { return Boolean(v && v.effect === 'unverifiable') }
export function deliveryFailure() { return null }
export const state = { deliverCalls: [], getWindowStateCalls: 0 }
const WINDOW = { pid: 42, window_id: 200, app_name: 'Stub', title: 'Confirm', bounds: { x: 100, y: 100, width: 400, height: 300 }, z_index: 5, is_on_screen: true }
export async function cuaDeliver(tool, args) {
  state.deliverCalls.push({ tool, args })
  return { value: { ok: true, effect: 'confirmed', delivery: { mode: 'background' } }, note: '' }
}
export async function cuaCall(tool, args = {}) {
  switch (tool) {
    case 'check_permissions': return { elevated: false, integrity_level: 'Medium', uia: true, postmessage: true }
    case 'list_windows': return { windows: [WINDOW] }
    case 'get_window_state':
      state.getWindowStateCalls++
      return {
        window: WINDOW,
        elements: [
          { element_index: 0, element_token: 't0', role: 'Button', label: 'Delete', value: '', frame: { x: 140, y: 120, w: 80, h: 30 } },
          { element_index: 1, element_token: 't1', role: 'Edit', label: 'Name', value: '', frame: { x: 140, y: 200, w: 200, h: 28 } },
        ],
        element_count: 2, total_element_count: 2, snapshot_id: null, screenshot_width: 400, screenshot_height: 300,
      }
    case 'start_session': return { ok: true }
    case 'set_agent_cursor_theme': return { ok: true }
    default: return { ok: true }
  }
}
`)

writeFileSync(join(work, 'lib', 'nativeButtonTrigger.js'), `
export const state = { calls: [], result: null, resets: 0 }
export async function tryNativeButtonClick(args, opts) {
  state.calls.push({ args, opts })
  return state.result
}
export function resetNativeButtonTrigger() { state.resets++ }
`, 'utf8')

const plugin = await loadPlugin(work)
const native = await import(pathToFileURL(join(work, 'lib', 'nativeButtonTrigger.js')).href)
const snapMod = await import(pathToFileURL(join(work, 'lib', 'snapshot.js')).href)
const driver = await import(pathToFileURL(join(work, 'lib', 'cua.js')).href)
const real = await import(pathToFileURL(join(process.cwd(), 'lib', 'nativeButtonTrigger.js')).href)
const { check, state: checkState } = makeChecks()

const success = {
  value: {
    ok: true, effect: 'unverifiable', delivery: { mode: 'win32-control' },
    route: 'win32-native-button', method: 'BM_CLICK', button_hwnd: 1001,
  },
  note: '（原生 Win32 按钮：BM_CLICK 异步投递，未验证；等待 1–3s；不要重复。）',
  unverifiedNote: '（原生按钮：BM_CLICK 只证明消息已投递。）',
  refusalNote: '',
}
const ownerDisabled = {
  value: {
    ok: false, code: 'native_button_owner_disabled', error: 'owner disabled',
    delivery: { mode: 'win32-control' }, route: 'win32-native-button', delivered: false,
  },
  note: '', unverifiedNote: '',
  refusalNote: '（目标窗口已被模态禁用；先观察同 pid 对话框。）',
}

function resetStub() {
  native.state.calls.length = 0
  native.state.result = success
  native.state.resets = 0
}

async function fresh(cfgExtra = {}) {
  resetStub()
  driver.state.deliverCalls.length = 0
  const { reg, ctx, exec } = makeCtx()
  plugin.apply(ctx, {
    ttlMs: 60000, maxElements: 120, observeDedup: 'off', passwordScan: 'off',
    nativeDialogs: 'off', nativeMenus: 'off', nativeButtonTrigger: 'auto',
    surfaceMode: 'hybrid', deliveryMode: 'auto', cursorMotion: 'off',
    ...cfgExtra,
  })
  const call = (name, args) => reg.get(name).execute(args, exec)
  const obs = await call('screen_observe', { window_id: 200, mode: 'ax' })
  return { call, obs, reg, exec }
}

let r
try {
  // A. 成功：不走 driver
  {
    r = await fresh()
    const c = await r.call('computer_click', { element: 0 })
    check('N1: Button element → 原生触发，不走 driver', native.state.calls.length === 1
      && driver.state.deliverCalls.length === 0 && c.ok === true
      && /原生 Win32 按钮/.test(c.result || '') && /未验证/.test(c.result || ''), c.result)
    check('N2: 快照 consumed + suspect', snapMod.isConsumed() === true
      && Boolean(snapMod.getSnapshot()?.suspect), JSON.stringify(snapMod.getSnapshot()?.suspect))
  }

  // B. off：零调用
  {
    r = await fresh({ nativeButtonTrigger: 'off' })
    const c = await r.call('computer_click', { element: 0 })
    check('N3: nativeButtonTrigger=off 不调用原生', native.state.calls.length === 0
      && driver.state.deliverCalls.length === 1 && c.ok === true, c.result)
  }

  // C. 非 Button / 坐标 / 多击 / modifier / foreground 不触发
  {
    r = await fresh()
    await r.call('computer_click', { element: 1 })
    await r.call('computer_click', { x: 10, y: 20 })
    await r.call('computer_click', { element: 0, count: 2 })
    await r.call('computer_click', { element: 0, modifier: ['ctrl'] })
    await r.call('computer_click', { element: 0, foreground: true })
    check('N4: 非 Button/坐标/count/modifier/foreground 不触发', native.state.calls.length === 0
      && driver.state.deliverCalls.length === 5, JSON.stringify({ calls: native.state.calls.length, driver: driver.state.deliverCalls.length }))
  }

  // D. driver 回退：pre-delivery null
  {
    r = await fresh()
    native.state.result = null
    const c = await r.call('computer_click', { element: 0 })
    check('N5: pre-delivery 未匹配 → 回退 driver', native.state.calls.length === 1
      && driver.state.deliverCalls.length === 1 && c.ok === true, c.result)
  }

  // E. owner_disabled：不回退 driver
  {
    r = await fresh()
    native.state.result = ownerDisabled
    const c = await r.call('computer_click', { element: 0 })
    check('N6: owner_disabled → 拒绝且不回退 driver', native.state.calls.length === 1
      && driver.state.deliverCalls.length === 0 && c.ok === false
      && /模态禁用|同 pid 对话框/.test(c.result || ''), c.result)
  }

  // F. 真模块：success/latch/reset/sidecar 参数
  {
    const calls = []
    const fakeSpawn = (cmd, args) => {
      calls.push(args)
      const child = new EventEmitter()
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.kill = () => {}
      setTimeout(() => {
        child.stdout.emit('data', JSON.stringify({ ok: true, method: 'BM_CLICK', buttonHwnd: 1001, rootHwnd: 200, className: 'Button', label: 'Delete' }) + '\n')
        child.emit('close', 0)
      }, 10)
      return child
    }
    const cfg = { nativeButtonTrigger: 'auto' }
    const a = await real.tryNativeButtonClick({ pid: 42, hwnd: 200, title: 'Confirm', label: 'Delete', x: 180, y: 135, element: 0 }, { cfg, spawnFn: fakeSpawn })
    const b = await real.tryNativeButtonClick({ pid: 42, hwnd: 200, title: 'Confirm', label: 'Delete', x: 180, y: 135, element: 0 }, { cfg, spawnFn: fakeSpawn })
    check('N7: 真模块成功 + 10s latch', a?.value?.ok === true && calls.length === 1
      && b?.value?.code === 'native_button_latched', JSON.stringify({ a: a?.value, b: b?.value, calls: calls.length }))
    const args = calls[0]
    check('N8: sidecar 传 LabelB64/TitleB64/ScreenX/Y', args.includes('-LabelB64')
      && Buffer.from(args[args.indexOf('-LabelB64') + 1], 'base64').toString('utf8') === 'Delete'
      && Buffer.from(args[args.indexOf('-TitleB64') + 1], 'base64').toString('utf8') === 'Confirm'
      && args[args.indexOf('-ScreenX') + 1] === '180' && args[args.indexOf('-ScreenY') + 1] === '135', JSON.stringify(args))
    real.resetNativeButtonTrigger()
    const c = await real.tryNativeButtonClick({ pid: 42, hwnd: 200, title: 'Confirm', label: 'Delete', x: 180, y: 135, element: 0 }, { cfg, spawnFn: fakeSpawn })
    check('N9: reset 清 latch', c?.value?.ok === true && calls.length === 2, JSON.stringify(c?.value))
  }

  // G. 真模块：pre-delivery / owner_disabled / timeout
  {
    const mkSpawn = (payload) => () => {
      const child = new EventEmitter()
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.kill = () => {}
      setTimeout(() => { child.stdout.emit('data', JSON.stringify(payload) + '\n'); child.emit('close', 0) }, 10)
      return child
    }
    real.resetNativeButtonTrigger()
    const nm = await real.tryNativeButtonClick({ pid: 42, hwnd: 200, label: 'Delete', x: 1, y: 2, element: 1 }, {
      cfg: { nativeButtonTrigger: 'auto' }, spawnFn: mkSpawn({ ok: false, code: 'no_match' }),
    })
    check('N10: no_match → null（交给 driver）', nm === null)
    real.resetNativeButtonTrigger()
    const od = await real.tryNativeButtonClick({ pid: 42, hwnd: 200, label: 'Delete', x: 1, y: 2, element: 2 }, {
      cfg: { nativeButtonTrigger: 'auto' }, spawnFn: mkSpawn({ ok: false, code: 'owner_disabled' }),
    })
    check('N11: owner_disabled → 拒绝不回退', od?.value?.code === 'native_button_owner_disabled'
      && od?.refusalNote, JSON.stringify(od?.value))
    real.resetNativeButtonTrigger()
    const timeoutSpawn = () => { const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.kill = () => {}; return c }
    const to = await real.tryNativeButtonClick({ pid: 42, hwnd: 200, label: 'Delete', x: 1, y: 2, element: 3 }, {
      cfg: { nativeButtonTrigger: 'auto' }, spawnFn: timeoutSpawn, timeoutMs: 60,
    })
    check('N12: helper 超时 → 未知（不回退）', to?.value?.ok === true
      && to?.value?.warning_code === 'native_button_unknown' && /不要重复/.test(to?.note || ''), JSON.stringify(to?.value))
  }
} finally {
  cleanupWork(work)
}

console.log(`\n结果：${checkState.failures === 0 ? '✅ 全部通过' : `❌ ${checkState.failures} 项失败`}`)
process.exit(checkState.failures === 0 ? 0 : 1)
