/**
 * 原生 Win32 对话框后端测试（private implementation v1）。
 *
 * 覆盖：空 AX 树 → native-dialog 合成按钮；native element click 不走驱动；
 * 坐标/键盘/滚动/双击/右键拒绝；nativeDialogs off；非模态回退；
 * 点击失败不消费；allowedApps/snapshot_id 守卫；UIA 复核拒绝。
 * 另含 lib/nativeDialogs.js 的 JSON/base64/超时/参数单测。
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { EventEmitter } from 'node:events'
import { makeWorkCopy, writeStubDriver, loadPlugin, makeCtx, makeChecks, cleanupWork } from './lib/harness.mjs'

const work = makeWorkCopy('native')
writeStubDriver(work, `
export const CUA_BIN = 'stub'
export const CUA_SESSION = 'native-test'
export const withSession = (a = {}) => a
export function normalizeMcp(v) { return v }
export function isBackgroundUnavailable() { return false }
export function isForegroundUnavailable() { return false }
export function isUnverified(v) { return Boolean(v && v.effect === 'unverifiable') }
export function deliveryFailure() { return null }
export const state = { deliverCalls: [], getWindowStateCalls: 0 }
const WINDOW = { pid: 42, window_id: 200, app_name: 'Stub', title: 'Confirm', bounds: { x: 100, y: 100, width: 400, height: 200 }, z_index: 5, is_on_screen: true }
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
      return { window: WINDOW, elements: [], element_count: 0, total_element_count: 0, snapshot_id: null, screenshot_width: 400, screenshot_height: 200 }
    case 'start_session': return { ok: true }
    case 'set_agent_cursor_theme': return { ok: true }
    default: return { ok: true }
  }
}
`)

const nativeStub = `
export const IS_WINDOWS = true
function defaultScan() {
  return {
    ok: true,
    isDialog: true,
    modal: true,
    modalProof: 'owner-disabled',
    className: '#32770',
    title: 'Confirm',
    ownerHwnd: 100,
    ownerPid: 42,
    ownerEnabled: false,
    foreground: 0,
    buttons: [
      { hwnd: 1001, id: 6, className: 'Button', label: 'Yes', rect: { x: 220, y: 240, w: 80, h: 28 }, enabled: true, visible: true, default: true },
      { hwnd: 1002, id: 7, className: 'Button', label: 'No', rect: { x: 320, y: 240, w: 80, h: 28 }, enabled: true, visible: true, default: false },
    ],
    staticText: 'Delete this item?',
    hasEdit: false,
  }
}
export const state = {
  scans: 0,
  clicks: [],
  scanResult: defaultScan(),
  clickResult: { ok: true, method: 'BM_CLICK', dialogAlive: false, error: '' },
}
export async function scanNativeDialog() { state.scans++; return state.scanResult }
export async function clickNativeDialog(args) { state.clicks.push(args); return state.clickResult }
export function reset() {
  state.scans = 0
  state.clicks = []
  state.scanResult = defaultScan()
  state.clickResult = { ok: true, method: 'BM_CLICK', dialogAlive: false, error: '' }
}
`
writeFileSync(join(work, 'lib', 'nativeDialogs.js'), nativeStub, 'utf8')

const plugin = await loadPlugin(work)
const native = await import(pathToFileURL(join(work, 'lib', 'nativeDialogs.js')).href)
const snapMod = await import(pathToFileURL(join(work, 'lib', 'snapshot.js')).href)
const observeMod = await import(pathToFileURL(join(work, 'lib', 'observe.js')).href)
const driver = await import(pathToFileURL(join(work, 'lib', 'cua.js')).href)

const { check, state: checkState } = makeChecks()

async function fresh(cfgExtra = {}, beforeObserve = null) {
  native.reset()
  const { reg, ctx, exec } = makeCtx()
  plugin.apply(ctx, {
    ttlMs: 60000, maxElements: 120, observeDedup: 'off', passwordScan: 'off',
    surfaceMode: 'hybrid', deliveryMode: 'auto', cursorMotion: 'off',
    nativeDialogs: 'auto',
    ...cfgExtra,
  })
  const call = (name, args) => reg.get(name).execute(args, exec)
  if (beforeObserve) beforeObserve(native)
  const obs = await call('screen_observe', { window_id: 200, mode: 'ax' })
  return { call, obs, reg, exec }
}
const noButton = (obs) => (obs.elements || []).find((e) => /^No$|^否/.test(String(e.label || '')))

let r
try {
  // 1. 空 AX → native-dialog
  {
    r = await fresh()
    const no = noButton(r.obs)
    check('N1: 空 AX 树 → native-dialog', r.obs.ok === true && r.obs.mode === 'native-dialog'
      && (r.obs.elements || []).length === 2 && Boolean(no)
      && /原生对话框后端/.test(r.obs.result || '') && /BM_CLICK/.test(r.obs.result || ''), r.obs.result)
    check('N2: snapshot backend=native-dialog', snapMod.getSnapshot()?.backend === 'native-dialog'
      && snapMod.getSnapshot()?.entries?.get(no.index)?.native_control?.id === 7, JSON.stringify(snapMod.getSnapshot()?.entries?.get(no.index)))
  }

  // 2. native click 不走驱动
  {
    r = await fresh()
    const no = noButton(r.obs)
    driver.state.deliverCalls.length = 0
    const c = await r.call('computer_click', { element: no.index })
    check('N3: native click ok + 未验证 + 原生消息', c.ok === true
      && /原生/.test(c.result || '') && /未验证/.test(c.result || '') && /原生消息/.test(c.result || ''), c.result)
    check('N4: native click 传 controlId/label，不调用驱动 click',
      native.state.clicks.length === 1 && native.state.clicks[0].controlId === 7
      && native.state.clicks[0].label === 'No' && driver.state.deliverCalls.length === 0,
      JSON.stringify({ clicks: native.state.clicks, deliver: driver.state.deliverCalls.length }))
  }

  // 3. 原生快照上的坐标/键盘/滚动拒绝
  {
    r = await fresh()
    const no = noButton(r.obs)
    driver.state.deliverCalls.length = 0
    const coord = await r.call('computer_click', { x: 10, y: 10 })
    const type = await r.call('computer_type', { element: no.index, text: 'x' })
    const key = await r.call('computer_key', { key: 'enter' })
    const scroll = await r.call('computer_scroll', { element: no.index, direction: 'down' })
    check('N5: 坐标点击拒绝 native_dialog_unsupported',
      coord.ok === false && /native_dialog_unsupported/.test(coord.result || ''), coord.result)
    check('N6: type/key/scroll 拒绝 native_dialog_unsupported',
      [type, key, scroll].every((x) => x.ok === false && /native_dialog_unsupported/.test(x.result || ''))
      && driver.state.deliverCalls.length === 0,
      JSON.stringify([type.result, key.result, scroll.result]))
  }

  // 4. 双击/右键拒绝
  {
    r = await fresh()
    const no = noButton(r.obs)
    const dbl = await r.call('computer_do', { action: 'call', tool: 'computer_double_click', args: { element: no.index } })
    const right = await r.call('computer_do', { action: 'call', tool: 'computer_right_click', args: { element: no.index } })
    check('N7: double/right 拒绝“仅支持单次左键”',
      dbl.ok === false && right.ok === false
      && /仅支持/.test(dbl.result || '') && /单次左键/.test(dbl.result || '')
      && /仅支持/.test(right.result || '') && native.state.clicks.length === 0,
      JSON.stringify([dbl.result, right.result]))
  }

  // 5. nativeDialogs off
  {
    r = await fresh({ nativeDialogs: 'off' })
    check('N8: nativeDialogs=off 不扫描、不返回 native 按钮',
      native.state.scans === 0 && (r.obs.elements || []).length === 0
      && r.obs.mode !== 'native-dialog' && /无可用元素/.test(r.obs.result || ''), r.obs.result)
  }

  // 6. 非模态 → 回退
  {
    r = await fresh({}, (n) => { n.state.scanResult.modal = false })
    check('N9: scan 非模态 → 不采用原生按钮',
      native.state.scans === 1 && (r.obs.elements || []).length === 0
      && r.obs.mode !== 'native-dialog', r.obs.result)
  }

  // 7. 点击失败不消费快照
  {
    r = await fresh({}, (n) => { n.state.clickResult = { ok: false, method: '', dialogAlive: false, error: 'button_not_found' } })
    const no = noButton(r.obs)
    const c = await r.call('computer_click', { element: no.index })
    check('N10: native click 失败 → ok:false 且清空快照',
      c.ok === false && /未点击/.test(c.result || '') && snapMod.getSnapshot() === null, c.result)
  }

  // 8. allowedApps 在 native click 前拦截
  {
    r = await fresh({ allowedApps: ['Notepad'] })
    const no = noButton(r.obs)
    const c = await r.call('computer_click', { element: no.index })
    check('N11: allowedApps 在 native click 前拒绝',
      c.ok === false && /区域限制/.test(c.result || '') && native.state.clicks.length === 0, c.result)
  }

  // 9. snapshot_id mismatch
  {
    r = await fresh()
    const no = noButton(r.obs)
    const c = await r.call('computer_click', { element: no.index, snapshot_id: 'sNOPE' })
    check('N12: native snapshot_id mismatch 拒绝',
      c.ok === false && /snapshot_mismatch/.test(c.result || '') && native.state.clicks.length === 0, c.result)
  }

  // 10. refreshSnapshotState 拒绝 native 快照
  {
    r = await fresh()
    const before = driver.state.getWindowStateCalls
    const res = await observeMod.refreshSnapshotState({ ttlMs: 60000 }, 42, 200)
    check('N13: native 快照拒绝 UIA 复核',
      res.ok === false && /原生对话框/.test(res.reason || '')
      && driver.state.getWindowStateCalls === before, JSON.stringify(res))
  }

  // 11. 失败后重新观察可恢复
  {
    r = await fresh({ actionGuard: 'off' }, (n) => { n.state.clickResult = { ok: false, method: '', dialogAlive: false, error: 'button_not_found' } })
    const no = noButton(r.obs)
    await r.call('computer_click', { element: no.index })
    native.state.clickResult = { ok: true, method: 'BM_CLICK', dialogAlive: false, error: '' }
    const obs2 = await r.call('screen_observe', { window_id: 200, mode: 'ax' })
    check('N14: 失败清空后可重新观察并点击',
      obs2.ok === true && (obs2.elements || []).length === 2
      && (await r.call('computer_click', { element: noButton(obs2).index })).ok === true,
      obs2.result)
  }

  // 12. 真实 lib/nativeDialogs.js 单测（注入 fake spawn）
  {
    const real = await import(pathToFileURL(join(process.cwd(), 'lib', 'nativeDialogs.js')).href)
    const payload = {
      ok: true, isDialog: true, modal: true, modalProof: 'owner-disabled', className: '#32770', title: 'Confirm',
      ownerHwnd: 100, ownerPid: 42, ownerEnabled: false, foreground: 0,
      buttons: [{ hwnd: 1001, id: 6, className: 'Button', label: 'Yes', labelB64: Buffer.from('是', 'utf8').toString('base64'), rect: { x: 1, y: 2, w: 3, h: 4 }, enabled: true, visible: true, default: true }],
      staticText: 'x', staticTextB64: Buffer.from('x', 'utf8').toString('base64'), hasEdit: false,
    }
    const calls = []
    const fakeSpawn = (cmd, args) => {
      calls.push({ cmd, args })
      const child = new EventEmitter()
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.kill = () => {}
      setTimeout(() => {
        child.stdout.emit('data', JSON.stringify(payload) + '\n')
        child.emit('close', 0)
      }, 10)
      return child
    }
    const scan = await real.scanNativeDialog({ pid: 42, hwnd: 200 }, fakeSpawn)
    check('N15: 真实 nativeDialogs 扫描/base64 label',
      scan?.buttons?.[0]?.label === '是' && scan?.modal === true
      && calls[0]?.args?.includes('-Action') && calls[0]?.args?.includes('scan'), JSON.stringify(scan))

    const clickCalls = []
    const clickSpawn = (cmd, args) => {
      clickCalls.push(args)
      const child = new EventEmitter()
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.kill = () => {}
      setTimeout(() => {
        child.stdout.emit('data', JSON.stringify({ ok: true, method: 'BM_CLICK', dialogAlive: false, error: '' }) + '\n')
        child.emit('close', 0)
      }, 10)
      return child
    }
    const clicked = await real.clickNativeDialog({ pid: 42, hwnd: 200, controlId: 7, className: 'Button', label: '否' }, clickSpawn)
    check('N16: 真实 nativeDialogs click 传 LabelB64 并解析结果',
      clicked.ok === true && clicked.dialogAlive === false
      && clickCalls[0]?.includes('-LabelB64')
      && Buffer.from(clickCalls[0][clickCalls[0].indexOf('-LabelB64') + 1], 'base64').toString('utf8') === '否',
      JSON.stringify({ clicked, args: clickCalls[0] }))

    const timeoutSpawn = () => {
      const child = new EventEmitter()
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.kill = () => {}
      return child
    }
    const timed = await real.scanNativeDialog({ pid: 42, hwnd: 200, timeoutMs: 600 }, timeoutSpawn)
    check('N17: 真实 nativeDialogs 超时 → null', timed === null, String(timed))

    const badSpawn = (cmd, args) => {
      const child = new EventEmitter()
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.kill = () => {}
      setTimeout(() => child.emit('close', 1), 10)
      return child
    }
    const bad = await real.scanNativeDialog({ pid: 42, hwnd: 200 }, badSpawn)
    check('N18: 真实 nativeDialogs 非零退出 → null', bad === null, String(bad))
  }
} finally {
  cleanupWork(work)
}

console.log(`\n结果：${checkState.failures === 0 ? '✅ 全部通过' : `❌ ${checkState.failures} 项失败`}`)
process.exit(checkState.failures ? 1 : 0)
