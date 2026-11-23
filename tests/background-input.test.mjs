/**
 * 实验性后台输入路由测试（B0/B1/B2/B3）。
 *
 * 覆盖：
 *  - 插件接入：click/type/key 命中插件通道后不进 cuaDeliver；off/foreground/modifier/组合键回退 driver；
 *  - 回执：新的 delivery 标签、未验证注记、拒绝不重复；
 *  - 真模块：client 就绪/超时/坏响应/stop；分类器/坐标/VK；
 *  - 路由：B1 优先、B1 遮挡不降级、B2/B3、合规闸门。
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { EventEmitter } from 'node:events'
import { makeWorkCopy, writeStubDriver, loadPlugin, makeCtx, makeChecks, cleanupWork } from './lib/harness.mjs'

const work = makeWorkCopy('background')
writeStubDriver(work, `
export const CUA_BIN = 'stub'
export const CUA_SESSION = 'background-test'
export const withSession = (a = {}) => a
export function normalizeMcp(v) { return v }
export function isBackgroundUnavailable() { return false }
export function isForegroundUnavailable() { return false }
export function isUnverified(v) { return Boolean(v && v.effect === 'unverifiable') }
export function deliveryFailure() { return null }
export const state = { deliverCalls: [], getWindowStateCalls: 0 }
const WINDOW = { pid: 42, window_id: 200, app_name: 'Stub', title: 'Canvas', bounds: { x: 100, y: 200, width: 400, height: 200 }, z_index: 5, is_on_screen: true }
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

writeFileSync(join(work, 'lib', 'backgroundInput.js'), `
export const state = {
  clickCalls: [],
  typeCalls: [],
  keyCalls: [],
  resetCalls: 0,
  stopCalls: 0,
  clickResult: null,
  typeResult: null,
  keyResult: null,
}
export function screenPointOfTarget(target, snap) {
  if (!target || target.fromZoom) return null
  const org = snap?.screenOrigin || { x: 0, y: 0 }
  return { x: Math.round(Number(org.x) + Number(target.x)), y: Math.round(Number(org.y) + Number(target.y)) }
}
export async function tryBackgroundClick(args) {
  const cfg = args.cfg || {}
  const on = cfg.backgroundInput === 'auto' || cfg.syntheticPointer === 'auto'
    || (cfg.anchoredInput && cfg.anchoredInput !== 'off')
  if (!on) return null
  state.clickCalls.push(args)
  return state.clickResult
}
export async function tryBackgroundType(args) { state.typeCalls.push(args); return state.typeResult }
export async function tryBackgroundKey(args) { state.keyCalls.push(args); return state.keyResult }
export async function stopBackgroundInput() { state.stopCalls++ }
export function resetBackgroundInput() { state.resetCalls++ }
export async function showWindowNative() { return { ok: false, code: 'unavailable', error: 'stub' } }
`, 'utf8')

const plugin = await loadPlugin(work)
const bg = await import(pathToFileURL(join(work, 'lib', 'backgroundInput.js')).href)
const snapMod = await import(pathToFileURL(join(work, 'lib', 'snapshot.js')).href)
const driver = await import(pathToFileURL(join(work, 'lib', 'cua.js')).href)
const real = await import(pathToFileURL(join(process.cwd(), 'lib', 'backgroundInput.js')).href)
const realCua = await import(pathToFileURL(join(process.cwd(), 'lib', 'cua.js')).href)

const { check, state: checkState } = makeChecks()

const clickValue = {
  value: {
    ok: true, effect: 'unverifiable', delivery: { mode: 'background-message' },
    route: 'plugin-background-input', background_level: 'B0',
  },
  note: '（B0 后台消息：已投递）',
  unverifiedNote: '（B0 未验证：先观察）',
  refusalNote: '',
}
const typeValue = {
  value: {
    ok: true, effect: 'unverifiable', delivery: { mode: 'background-message' },
    route: 'plugin-background-input', background_level: 'B0', method: 'wm_char',
  },
  note: '（B0 文本：wm_char 已投递）',
  unverifiedNote: '',
  refusalNote: '',
}
const keyValue = {
  value: {
    ok: true, effect: 'unverifiable', delivery: { mode: 'background-message' },
    route: 'plugin-background-input', background_level: 'B0', method: 'wm_key',
  },
  note: '（B0 按键：WM_KEY 已投递）',
  unverifiedNote: '',
  refusalNote: '',
}

function resetStub() {
  bg.state.clickCalls.length = 0
  bg.state.typeCalls.length = 0
  bg.state.keyCalls.length = 0
  bg.state.resetCalls = 0
  bg.state.stopCalls = 0
  bg.state.clickResult = clickValue
  bg.state.typeResult = typeValue
  bg.state.keyResult = keyValue
}

async function fresh(cfgExtra = {}) {
  resetStub()
  driver.state.deliverCalls.length = 0
  const { reg, ctx, exec } = makeCtx()
  plugin.apply(ctx, {
    ttlMs: 60000, maxElements: 120, observeDedup: 'off', passwordScan: 'off',
    nativeDialogs: 'off', surfaceMode: 'hybrid', deliveryMode: 'auto', cursorMotion: 'off',
    backgroundInput: 'auto', syntheticPointer: 'off', anchoredInput: 'off',
    ...cfgExtra,
  })
  const call = (name, args) => reg.get(name).execute(args, exec)
  const obs = await call('screen_observe', { window_id: 200, mode: 'ax' })
  return { call, obs, reg, exec }
}

let r
try {
  // A. click 命中插件通道，不进 driver
  {
    r = await fresh()
    const c = await r.call('computer_click', { x: 10, y: 20 })
    check('A1: background click 命中插件通道', bg.state.clickCalls.length === 1
      && bg.state.clickCalls[0].tool === 'click'
      && bg.state.clickCalls[0].target.pid === 42
      && bg.state.clickCalls[0].target.windowId === 200
      && driver.state.deliverCalls.length === 0, c.result)
    check('A2: click 回执含后台消息/未验证，快照已消费', c.ok === true
      && /后台消息/.test(c.result || '') && /未验证/.test(c.result || '')
      && snapMod.isConsumed() === true, c.result)
  }

  // B. 默认 off 不改行为
  {
    r = await fresh({ backgroundInput: 'off' })
    const c = await r.call('computer_click', { x: 10, y: 20 })
    check('B1: backgroundInput=off 不调用插件通道', bg.state.clickCalls.length === 0
      && driver.state.deliverCalls.length === 1 && c.ok === true, c.result)
  }

  // C. foreground/modifier 不接管
  {
    r = await fresh()
    const fg = await r.call('computer_click', { x: 10, y: 20, foreground: true })
    const md = await r.call('computer_click', { x: 10, y: 20, modifier: ['ctrl'] })
    check('C1: foreground/modifier 跳过插件通道', bg.state.clickCalls.length === 0
      && driver.state.deliverCalls.length >= 1 && fg.ok === true && md.ok === true,
      JSON.stringify([fg.result, md.result]))
  }

  // D. type/key 命中；组合键回退
  {
    r = await fresh()
    const t = await r.call('computer_type', { text: 'abc' })
    const k = await r.call('computer_key', { key: 'return' })
    check('D1: type 命中插件通道', bg.state.typeCalls.length === 1
      && /后台消息/.test(t.result || '') && /输入未验证/.test(t.result || ''), t.result)
    check('D2: key 命中插件通道', bg.state.keyCalls.length === 1
      && /后台消息/.test(k.result || ''), k.result)
    driver.state.deliverCalls.length = 0
    const combo = await r.call('computer_key', { key: 'ctrl+c' })
    check('D3: 组合键不接管，继续 driver hotkey', bg.state.keyCalls.length === 1
      && driver.state.deliverCalls.length === 1 && combo.ok === true, combo.result)
  }

  // E. 拒绝不重试、不调 driver
  {
    r = await fresh()
    bg.state.clickResult = {
      value: {
        ok: false, code: 'background_input_occluded', error: 'occluded',
        delivery: { mode: 'synthetic-pointer' }, route: 'plugin-background-input', background_level: 'B1',
      },
      note: '',
      refusalNote: '（合成触控遮挡：失败关闭）',
    }
    driver.state.deliverCalls.length = 0
    const c = await r.call('computer_click', { x: 10, y: 20 })
    check('E1: 插件通道拒绝 → ok:false，不调 driver', c.ok === false
      && /occluded/.test(c.result || '') && /遮挡/.test(c.result || '')
      && driver.state.deliverCalls.length === 0, c.result)
  }

  // F. double/right 走插件通道
  {
    r = await fresh()
    const d = await r.call('computer_do', { action: 'call', tool: 'computer_double_click', args: { x: 10, y: 20 } })
    const rc = await r.call('computer_do', { action: 'call', tool: 'computer_right_click', args: { x: 10, y: 20 } })
    check('F1: double/right 交给插件路由', bg.state.clickCalls.length === 2
      && bg.state.clickCalls[0].tool === 'double_click'
      && bg.state.clickCalls[1].tool === 'right_click'
      && driver.state.deliverCalls.length === 0, JSON.stringify([d.result, rc.result]))
  }

  // G. 真模块分类/坐标/VK
  {
    const mkSnap = (entries = [], extra = {}) => ({
      elementCount: entries.length, backend: 'ax', screenOrigin: { x: 100, y: 200, width: 400, height: 200 },
      screenshotWidth: 200, screenshotHeight: 100, entries: new Map(entries.map((e, i) => [i, e])), appName: 'Game', ...extra,
    })
    const baseProfile = {
      className: 'Notepad', touchWindow: false, integrityRank: 1, currentIntegrityRank: 1,
      sameSession: true, secureDesktop: false, visible: true, iconic: false,
    }
    check('G1: 无可交互 UIA → message', real.classifyTarget({ snap: mkSnap(), profile: baseProfile }) === 'message')
    check('G2: 有 Button → uia', real.classifyTarget({ snap: mkSnap([{ role: 'Button' }]), profile: baseProfile }) === 'uia'
      && real.hasNoActionableUia(mkSnap([{ role: 'Button' }])) === false)
    check('G3: native-dialog 不接管', real.classifyTarget({ snap: mkSnap([], { backend: 'native-dialog' }), profile: baseProfile }) === 'native-dialog')
    check('G4: Unity 类 → pointer', real.classifyTarget({ snap: mkSnap(), profile: { ...baseProfile, className: 'UnityWndClass' } }) === 'pointer')
    check('G5: 安全桌面/高完整性 → secure/uipi',
      real.classifyTarget({ snap: mkSnap(), profile: { ...baseProfile, secureDesktop: true } }) === 'secure'
      && real.classifyTarget({ snap: mkSnap(), profile: { ...baseProfile, integrityRank: 2, currentIntegrityRank: 1 } }) === 'uipi')
    check('G5b: background_uipi_blocked → deliveryFailure=uipi（不冒充未验证）',
      realCua.deliveryFailure({ effect: 'unverifiable', escalation: { reason: 'background_uipi_blocked' } }) === 'uipi'
      && realCua.isUipiBlocked({ code: 'background_uipi_blocked' }) === true)
    const pt = real.screenPointOfTarget({ x: 10, y: 20 }, mkSnap())
    check('G6: 截图坐标 → 屏幕物理像素（含 scale）', pt.x === 120 && pt.y === 240, JSON.stringify(pt))
    check('G7: VK 映射', real.virtualKeyOf('return').vk === 13
      && real.virtualKeyOf('a').vk === 65
      && real.virtualKeyOf('left').extended === true
      && real.virtualKeyOf('ctrl') === null)
    const chromeSnap = mkSnap([
      { role: 'TitleBar', x: 100, y: 10 },
      { role: 'MenuItem', x: 12, y: 19 },
      { role: 'Button', x: 180, y: 12 },
    ], { titleBarRect: { x: 0, y: 0, w: 200, h: 32 } })
    check('G8: 仅标题栏/关闭按钮 → 仍视为无可交互 UIA', real.hasNoActionableUia(chromeSnap) === true
      && real.classifyTarget({ snap: chromeSnap, profile: baseProfile }) === 'message')
    const clientBtn = mkSnap([{ role: 'Button', x: 100, y: 100 }], { titleBarRect: { x: 0, y: 0, w: 200, h: 32 } })
    check('G9: 客户区 Button → uia', real.hasNoActionableUia(clientBtn) === false
      && real.classifyTarget({ snap: clientBtn, profile: baseProfile }) === 'uia')
    const axSnap = mkSnap()
    axSnap.screenshotWidth = null
    axSnap.screenshotHeight = null
    const axPt = real.screenPointOfTarget({ x: 10, y: 20 }, axSnap)
    check('G10: ax 无截图尺寸 → origin 1:1 映射', axPt.x === 110 && axPt.y === 220, JSON.stringify(axPt))

  }

  // H. 真模块 client：ready/probe/timeout/bad response/stop
  {
    const requests = []
    const makeChild = (respond) => {
      const child = new EventEmitter()
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.stdout.setEncoding = () => {}
      child.stderr.setEncoding = () => {}
      child.stdin = {
        write(line) {
          const req = JSON.parse(line)
          requests.push(req)
          const resp = respond(req)
          if (resp !== undefined) setImmediate(() => child.stdout.emit('data', JSON.stringify(resp) + '\n'))
        },
        end() {},
      }
      child.kill = () => setImmediate(() => child.emit('exit', 0, null))
      setImmediate(() => child.stdout.emit('data', '{"ready":true}\n'))
      return child
    }
    const client = real.createBackgroundInputClient({
      platform: 'win32', scriptPath: 'fake.ps1', exists: () => true,
      spawnFn: () => makeChild((req) => {
        if (req.cmd === 'probe') return { ok: true, hwnd: 200, pid: 42, className: 'X' }
        if (req.cmd === 'show') {
          return {
            ok: true, dispatched: true, windowId: req.hwnd, foregroundChanged: false,
            effect: 'confirmed', warning_code: 'show_incomplete',
          }
        }
        return { ok: true }
      }),
    })
    const p = await client.probe({ hwnd: 200, pid: 42 })
    check('H1: client ready + probe', client.available === true && p.ok === true && p.pid === 42, JSON.stringify(p))
    const show = await client.showWindow({ hwnd: 200, pid: 42 })
    const showReq = requests.find((x) => x.cmd === 'show')
    check('H1b: client show 发送 hwnd/pid', show?.ok === true && showReq?.hwnd === 200 && showReq?.pid === 42,
      JSON.stringify({ show, showReq }))
    check('H1c: client show 原样透传 native 字段',
      show?.dispatched === true && show?.windowId === 200 && show?.foregroundChanged === false
        && show?.effect === 'confirmed' && show?.warning_code === 'show_incomplete',
      JSON.stringify(show))
    await client.stop()
    check('H2: stop 发送 restore/shutdown', requests.some((x) => x.cmd === 'restore') && requests.some((x) => x.cmd === 'shutdown'))

    const timeoutClient = real.createBackgroundInputClient({
      platform: 'win32', scriptPath: 'fake.ps1', exists: () => true,
      spawnFn: () => makeChild(() => undefined),
    })
    const to = await timeoutClient.probe({ hwnd: 1, pid: 1 }, { timeoutMs: 60 })
    check('H3: 超时 → background_input_timeout', to && to.ok === false && to.code === 'background_input_timeout', JSON.stringify(to))
    await timeoutClient.stop()

    const badClient = real.createBackgroundInputClient({
      platform: 'win32', scriptPath: 'fake.ps1', exists: () => true,
      spawnFn: () => makeChild(() => null),
    })
    const bad = await badClient.probe({ hwnd: 1, pid: 1 })
    check('H4: 非对象响应 → bad_response', bad && bad.ok === false && bad.code === 'background_input_bad_response', JSON.stringify(bad))
    await badClient.stop()

    const emptyClient = real.createBackgroundInputClient({ platform: 'linux', scriptPath: 'x', exists: () => true })
    const none = await emptyClient.probe({ hwnd: 1, pid: 1 })
    check('H5: 非 Windows → null/零 spawn', none === null)

    // 旧子进程的 exit 不得误杀新子进程（generation guard）。
    {
      const kids = []
      let spawnCount = 0
      const genClient = real.createBackgroundInputClient({
        platform: 'win32', scriptPath: 'fake.ps1', exists: () => true,
        spawnFn: () => {
          const idx = spawnCount++
          const child = makeChild((req) => (idx === 0 ? undefined : (req.cmd === 'probe' ? { ok: true, pid: 42 } : { ok: true })))
          if (idx === 0) child.kill = () => {}
          kids.push(child)
          return child
        },
      })
      const first = await genClient.probe({ hwnd: 1, pid: 1 }, { timeoutMs: 40 })
      const secondPromise = genClient.probe({ hwnd: 2, pid: 2 }, { timeoutMs: 2000 })
      await new Promise((r) => setTimeout(r, 20))
      kids[0].emit('exit', 0, null) // late exit from the timed-out old child
      const second = await secondPromise
      check('H6: 旧子进程 exit 不影响新请求', first.code === 'background_input_timeout'
        && second.ok === true && second.pid === 42, JSON.stringify({ first, second }))
      await genClient.stop()
    }

    // ready 之后的坏响应立即拒绝，不等到请求超时。
    {
      const child = new EventEmitter()
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.stdout.setEncoding = () => {}
      child.stderr.setEncoding = () => {}
      child.stdin = {
        write() { setImmediate(() => child.stdout.emit('data', 'not-json\n')) },
        end() {},
      }
      child.kill = () => {}
      const badProto = real.createBackgroundInputClient({
        platform: 'win32', scriptPath: 'fake.ps1', exists: () => true,
        spawnFn: () => { setImmediate(() => child.stdout.emit('data', '{"ready":true}\n')); return child },
      })
      const br = await badProto.probe({ hwnd: 1, pid: 1 }, { timeoutMs: 2000 })
      check('H7: ready 后非 JSON → 立即 bad_response', br.code === 'background_input_bad_response', JSON.stringify(br))
      await badProto.stop()
    }
  }

  // K. showWindowNative 工厂：平台/空响应/透传
  {
    const linux = real.createShowWindowNative({ platform: 'linux' })
    const lr = await linux({ pid: 1, hwnd: 2 })
    check('K1: showWindowNative 非 Windows → unavailable', lr.ok === false && lr.code === 'unavailable', JSON.stringify(lr))
    const missing = real.createShowWindowNative({ client: { showWindow: async () => null } })
    const mr = await missing({ pid: 1, hwnd: 2 })
    check('K2: showWindowNative helper 不可用 → unavailable', mr.ok === false && mr.code === 'unavailable', JSON.stringify(mr))
    let seen = null
    const fake = real.createShowWindowNative({
      client: {
        async showWindow(payload, opts) {
          seen = { payload, opts }
          return { ok: true, dispatched: true, effect: 'unverifiable', warning_code: 'show_incomplete' }
        },
      },
    })
    const fr = await fake({ pid: 1, hwnd: 2 }, { timeoutMs: 7 })
    check('K3: showWindowNative 原样透传', fr.effect === 'unverifiable' && fr.warning_code === 'show_incomplete'
      && seen?.payload?.hwnd === 2 && seen?.opts?.timeoutMs === 7, JSON.stringify({ fr, seen }))
  }

  // J. 回执字段/错误码/fail-closed 语义
  {
    const profile = {
      ok: true, hwnd: 200, pid: 42,
      className: 'Game', touchWindow: false, integrityRank: 1, currentIntegrityRank: 1,
      sameSession: true, secureDesktop: false, visible: true, iconic: false,
    }
    const snap = {
      pid: 42, windowId: 200, elementCount: 0, backend: 'ax', screenOrigin: { x: 100, y: 200, width: 400, height: 200 },
      screenshotWidth: 400, screenshotHeight: 200, entries: new Map(), appName: 'Game',
    }
    const target = { pid: 42, windowId: 200, x: 10, y: 20 }
    const baseCfg = { backgroundInput: 'auto', syntheticPointer: 'off', anchoredInput: 'off', deliveryMode: 'auto', allowedApps: [] }
    const client = {
      available: true,
      probe: async () => profile,
      postMouse: async () => ({ ok: true, delivered: true, method: 'posted', effect: 'unverifiable' }),
      syntheticClick: async () => ({ ok: true, delivered: true, method: 'synthetic_touch', effect: 'unverifiable' }),
      cursorClick: async () => ({ ok: true, delivered: true, method: 'cursor_anchored', effect: 'unverifiable', inputBlockedMs: 60 }),
      windowClick: async () => ({ ok: true, delivered: true, method: 'window_anchored', effect: 'unverifiable' }),
    }
    check('J1: elementCount=0 但 entries 有 Button → 不接管',
      real.hasNoActionableUia({ ...snap, entries: new Map([[1, { role: 'Button', x: 200, y: 100 }]]) }) === false
      && real.classifyTarget({ snap: { ...snap, entries: new Map([[1, { role: 'Button', x: 200, y: 100 }]]) }, profile }) === 'uia')
    check('J2: 完整性未知(99) → unknown/不接管',
      real.classifyTarget({ snap, profile: { ...profile, integrityRank: 99 } }) === 'unknown'
      && real.classifyTarget({ snap, profile: { ...profile, currentIntegrityRank: 99 } }) === 'unknown')

    real.clearProfileCache()
    const bm = await real.tryBackgroundClick({
      tool: 'click', target, snap, args: {}, cfg: baseCfg,
      client: { ...client, postMouse: async () => ({ ok: true, delivered: true, method: 'bm_click', effect: 'unverifiable' }) },
    })
    check('J3: BM_CLICK → win32-control + 控件文案', bm.value.delivery.mode === 'win32-control'
      && /控件消息/.test(bm.note || ''), JSON.stringify(bm))

    real.clearProfileCache()
    const b2 = await real.tryBackgroundClick({
      tool: 'click', target, snap, args: {}, cfg: { ...baseCfg, backgroundInput: 'off', anchoredInput: 'cursor', allowedApps: ['Game'] },
      client: {
        ...client,
        cursorClick: async () => ({
          ok: true, delivered: true, method: 'cursor_anchored', effect: 'unverifiable',
          inputBlockedMs: 60, cursorRestored: false, inputUnblocked: false,
          complete: false, warning_code: 'cursor_restore_failed',
        }),
      },
    })
    check('J4: B2 还原失败字段/文案', b2.value.cursor_restored === false
      && b2.value.input_blocked_ms === 60 && b2.value.complete === false
      && b2.value.warning_code === 'cursor_restore_failed'
      && /还原失败/.test(b2.note || '') && /解除输入阻塞失败/.test(b2.note || ''), JSON.stringify(b2.value))

    real.clearProfileCache()
    const clip = await real.tryBackgroundClick({
      tool: 'click', target, snap, args: {}, cfg: { ...baseCfg, backgroundInput: 'off', anchoredInput: 'cursor-clip', allowedApps: ['Game'] },
      client: {
        ...client,
        cursorClick: async () => ({
          ok: true, delivered: true, method: 'clip_anchored', effect: 'unverifiable',
          clipAnchored: true, clipRestored: false, inputBlocked: false, cursorRestored: true,
          inputBlockedMs: 80, complete: false, warning_code: 'clip_restore_failed',
        }),
      },
    })
    check('J4b: cursor-clip 回执字段/文案', clip.value.clip_anchored === true
      && clip.value.clip_restored === false && clip.value.input_blocked === false
      && /cursor-clip/.test(clip.note || '') && /裁剪区还原失败/.test(clip.note || ''),
      JSON.stringify(clip.value))

    real.clearProfileCache()
    const b1 = await real.tryBackgroundClick({
      tool: 'click', target, snap, args: {},
      cfg: { ...baseCfg, backgroundInput: 'off', syntheticPointer: 'auto', allowedApps: ['Game'] },
      client: {
        ...client,
        probe: async () => ({ ...profile, className: 'UnityWndClass', touchWindow: true }),
        syntheticClick: async () => ({ ok: true, delivered: true, method: 'synthetic_touch', effect: 'unverifiable', complete: false, warning_code: 'inject_up_failed' }),
      },
    })
    check('J5: B1 incomplete 字段/文案', b1.value.complete === false
      && /未完整完成/.test(b1.note || '') && /inject_up_failed/.test(b1.note || ''), JSON.stringify(b1.value))

    const partial = await real.tryBackgroundType({
      args: { text: 'abc' }, snap, cfg: baseCfg,
      client: { ...client, postText: async () => ({ ok: false, code: 'send_failed', delivered: true, partial: true, sentChars: 2, error: 'failed after 2 chars' }) },
    })
    check('J6: 部分文本 → partial_delivery，保留已发送字符数', partial.value.ok === false
      && partial.value.code === 'background_input_partial_delivery'
      && partial.value.partial === true && partial.value.sent_chars === 2
      && partial.value.delivered === true, JSON.stringify(partial.value))

    const blocked = await real.tryBackgroundClick({
      tool: 'click', target, snap, args: {}, cfg: { ...baseCfg, backgroundInput: 'off', anchoredInput: 'cursor', allowedApps: ['Game'] },
      client: { ...client, cursorClick: async () => ({ ok: false, code: 'block_input_failed', delivered: false, error: 'BlockInput failed' }) },
    })
    check('J7: BlockInput 拒绝 → 专用码', blocked.value.code === 'background_input_block_input_denied'
      && /不要重试 B2/.test(blocked.refusalNote || ''), JSON.stringify(blocked.value))

    real.clearProfileCache()
    const denied = await real.tryBackgroundClick({
      tool: 'click', target, snap, args: {}, cfg: { ...baseCfg, backgroundInput: 'off', anchoredInput: 'cursor', allowedApps: ['Game'] },
      client: {
        ...client,
        cursorClick: async () => ({
          ok: false, code: 'block_input_failed', delivered: false, error: 'BlockInput failed',
          win32Error: 5, diagnostics: { helperElevated: false, helperUIAccess: false, helperSessionId: 3 },
        }),
      },
    })
    check('J7b: BlockInput 诊断透传', denied.value.code === 'background_input_block_input_denied'
      && denied.value.win32_error === 5
      && denied.value.diagnostics?.helperElevated === false
      && denied.value.diagnostics?.helperUIAccess === false, JSON.stringify(denied.value))

    real.clearProfileCache()
    const busy = await real.tryBackgroundClick({
      tool: 'click', target, snap, args: {}, cfg: { ...baseCfg, backgroundInput: 'off', anchoredInput: 'cursor', allowedApps: ['Game'] },
      client: { ...client, cursorClick: async () => ({ ok: false, code: 'desktop_busy', delivered: false, error: 'busy', drift: 7 }) },
    })
    check('J7c: desktop_busy → 专用码 + drift', busy.value.code === 'background_input_desktop_busy'
      && busy.value.drift === 7 && /静止|脏桌面/.test(busy.refusalNote || ''), JSON.stringify(busy.value))

    real.clearProfileCache()
    const clipFail = await real.tryBackgroundClick({
      tool: 'click', target, snap, args: {}, cfg: { ...baseCfg, backgroundInput: 'off', anchoredInput: 'cursor-clip', allowedApps: ['Game'] },
      client: { ...client, cursorClick: async () => ({ ok: false, code: 'clip_anchor_failed', delivered: false, error: 'ClipCursor failed', win32Error: 5 }) },
    })
    check('J7d: clip_anchor_failed → 专用码', clipFail.value.code === 'background_input_clip_anchor_failed'
      && clipFail.value.win32_error === 5, JSON.stringify(clipFail.value))

    real.clearProfileCache()
    const unavailable = await real.tryBackgroundClick({
      tool: 'click', target, snap, args: {}, cfg: baseCfg,
      client: { ...client, postMouse: async () => ({ ok: false, code: 'unavailable', delivered: false, error: 'minimized' }) },
    })
    check('J8: helper unavailable → window_not_available', unavailable.value.code === 'background_input_window_not_available',
      JSON.stringify(unavailable.value))
  }

  // I. 真模块路由：B0/B1/B2/B3/遮挡不降级
  {
    const calls = { post: [], syn: [], cur: [], win: [] }
    const profile = {
      ok: true, hwnd: 200, pid: 42,
      className: 'Game', touchWindow: false, integrityRank: 1, currentIntegrityRank: 1,
      sameSession: true, secureDesktop: false, visible: true, iconic: false,
    }
    const client = {
      available: true,
      probe: async () => profile,
      postMouse: async (p) => { calls.post.push(p); return { ok: true, delivered: true, method: 'posted', effect: 'unverifiable' } },
      syntheticClick: async (p) => { calls.syn.push(p); return { ok: true, delivered: true, method: 'synthetic_touch', effect: 'unverifiable' } },
      cursorClick: async (p) => { calls.cur.push(p); return { ok: true, delivered: true, method: 'cursor_anchored', effect: 'unverifiable', inputBlockedMs: 60 } },
      windowClick: async (p) => { calls.win.push(p); return { ok: true, delivered: true, method: 'window_anchored', effect: 'unverifiable' } },
    }
    const snap = {
      pid: 42, windowId: 200, elementCount: 0, backend: 'ax', screenOrigin: { x: 100, y: 200, width: 400, height: 200 },
      screenshotWidth: 400, screenshotHeight: 200, entries: new Map(), appName: 'Game',
    }
    const target = { pid: 42, windowId: 200, x: 10, y: 20 }
    const baseCfg = { backgroundInput: 'auto', syntheticPointer: 'off', anchoredInput: 'off', deliveryMode: 'auto', allowedApps: [] }
    const b0 = await real.tryBackgroundClick({ tool: 'click', target, snap, args: {}, cfg: baseCfg, client })
    check('I1: B0 默认 message → postMouse 屏幕坐标', calls.post.length === 1
      && calls.post[0].x === 110 && calls.post[0].y === 220
      && b0.value.delivery.mode === 'background-message', JSON.stringify(calls.post[0]))

    calls.post.length = 0; calls.syn.length = 0
    real.clearProfileCache()
    const b1cfg = { ...baseCfg, syntheticPointer: 'auto', allowedApps: ['Game'] }
    const b1 = await real.tryBackgroundClick({ tool: 'click', target, snap, args: {}, cfg: b1cfg, client: { ...client, probe: async () => ({ ...profile, className: 'UnityWndClass', touchWindow: true }) } })
    check('I2: B1 显式开启 → syntheticClick，不走 postMouse', calls.syn.length === 1 && calls.post.length === 0
      && b1.value.delivery.mode === 'synthetic-pointer', JSON.stringify(calls))

    calls.syn.length = 0; calls.post.length = 0
    real.clearProfileCache()
    const promoteCfg = { ...baseCfg, backgroundInput: 'off', syntheticPointer: 'promote', allowedApps: ['Game'] }
    const promote = await real.tryBackgroundClick({
      tool: 'click', target, snap, args: {}, cfg: promoteCfg,
      client: {
        ...client,
        syntheticClick: async (p) => {
          calls.syn.push(p)
          return { ok: true, delivered: true, method: 'synthetic_touch_promote', anchorUsed: false, effect: 'unverifiable', cursorDrift: 0 }
        },
      },
    })
    check('I2b: B1 promote 普通窗口 → anchor=false + 鼠标提升文案', calls.syn.length === 1
      && calls.syn[0].anchor === false && calls.post.length === 0
      && promote?.value?.method === 'synthetic_touch_promote'
      && promote?.value?.anchor_used === false
      && /鼠标提升/.test(promote?.note || ''), JSON.stringify({ calls, value: promote?.value, note: promote?.note }))

    real.clearProfileCache()
    const promotePointer = await real.tryBackgroundClick({
      tool: 'click', target, snap, args: {}, cfg: promoteCfg,
      client: { ...client, probe: async () => ({ ...profile, className: 'UnityWndClass' }) },
    })
    check('I2c: B1 promote 不接管 pointer 契约', promotePointer === null)

    real.clearProfileCache()
    const occludedClient = {
      ...client,
      probe: async () => ({ ...profile, className: 'UnityWndClass', touchWindow: true }),
      syntheticClick: async () => ({ ok: false, code: 'occluded', delivered: false, error: 'occluded' }),
    }
    const oc = await real.tryBackgroundClick({ tool: 'click', target, snap, args: {}, cfg: b1cfg, client: occludedClient })
    check('I3: B1 遮挡 → background_input_occluded，不降级 B0', oc.value.ok === false
      && oc.value.code === 'background_input_occluded' && oc.refusalNote, JSON.stringify(oc.value))

    calls.cur.length = 0
    const b2cfg = { ...baseCfg, backgroundInput: 'off', anchoredInput: 'cursor', allowedApps: ['Game'] }
    const b2 = await real.tryBackgroundClick({ tool: 'click', target, snap, args: {}, cfg: b2cfg, client })
    check('I4: B2 cursor 路由', calls.cur.length === 1 && b2.value.delivery.mode === 'cursor-anchored'
      && /光标锚定/.test(b2.note || ''), JSON.stringify(calls.cur[0]))

    calls.cur.length = 0
    real.clearProfileCache()
    const clipCfg = { ...baseCfg, backgroundInput: 'off', anchoredInput: 'cursor-clip', allowedApps: ['Game'] }
    const clip = await real.tryBackgroundClick({ tool: 'click', target, snap, args: {}, cfg: clipCfg, client })
    check('I4b: B2 cursor-clip 路由传 anchor=clip', calls.cur.length === 1
      && calls.cur[0].anchor === 'clip' && clip.value.delivery.mode === 'cursor-anchored',
      JSON.stringify(calls.cur[0]))

    calls.win.length = 0
    const b3cfg = { ...baseCfg, backgroundInput: 'off', anchoredInput: 'window', allowedApps: ['Game'] }
    const b3 = await real.tryBackgroundClick({ tool: 'click', target, snap, args: {}, cfg: b3cfg, client })
    check('I5: B3 window 路由传客户区坐标', calls.win.length === 1
      && calls.win[0].clientX === 10 && calls.win[0].clientY === 20
      && b3.value.delivery.mode === 'window-anchored', JSON.stringify(calls.win[0]))

    calls.win.length = 0
    real.clearProfileCache()
    const ext = await real.tryBackgroundClick({
      tool: 'click', target, snap, args: {}, cfg: b3cfg,
      client: {
        ...client,
        windowClick: async () => ({
          ok: true, delivered: true, method: 'window_anchored', effect: 'unverifiable',
          windowMoved: true, windowRestored: false, complete: false,
          warning_code: 'window_changed_externally',
        }),
      },
    })
    check('I5b: B3 外部移动 → 保留回执/警告，不宣称已还原', ext.value.window_restored === false
      && ext.value.warning_code === 'window_changed_externally'
      && /window_changed_externally/.test(ext.note || ''), JSON.stringify(ext.value))

    const fg = await real.tryBackgroundClick({ tool: 'click', target, snap, args: { foreground: true }, cfg: baseCfg, client })
    const md = await real.tryBackgroundClick({ tool: 'click', target, snap, args: {}, cfg: baseCfg, extra: { modifier: ['ctrl'] }, client })
    check('I6: foreground/modifier 不接管', fg === null && md === null)

    real.clearProfileCache()
    const highClient = { ...client, probe: async () => ({ ...profile, integrityRank: 2, currentIntegrityRank: 1 }) }
    const uipiClick = await real.tryBackgroundClick({ tool: 'click', target, snap, args: {}, cfg: baseCfg, client: highClient })
    const uipiType = await real.tryBackgroundType({ args: { text: 'abc' }, snap, cfg: baseCfg, client: highClient })
    const uipiKey = await real.tryBackgroundKey({ args: { key: 'return' }, snap, cfg: baseCfg, client: highClient })
    check('I6b: 高 IL 目标 → B0/B1/B2/B3 路由全部不接管',
      uipiClick === null && uipiType === null && uipiKey === null)

    real.clearProfileCache()
    const typeClient = { ...client, postText: async () => ({ ok: true, delivered: true, method: 'wm_char', verified: false }) }
    const ty = await real.tryBackgroundType({ args: { text: 'abc' }, snap, cfg: baseCfg, client: typeClient })
    const keyClient = { ...client, postKey: async () => ({ ok: true, delivered: true, method: 'wm_key', focusedHwnd: 1 }) }
    const ky = await real.tryBackgroundKey({ args: { key: 'return' }, snap, cfg: baseCfg, client: keyClient })
    check('I7: B0 type/key 路由', ty.value.delivery.mode === 'background-message'
      && ky.value.delivery.mode === 'background-message', JSON.stringify([ty.value, ky.value]))

    const pw = await real.tryBackgroundType({ args: { text: 'x' }, snap, cfg: baseCfg, client: { ...client, postText: async () => ({ ok: false, code: 'password_denied', delivered: false }) } })
    check('I8: 密码框 → background_input_password_denied', pw.value.ok === false
      && pw.value.code === 'background_input_password_denied', JSON.stringify(pw.value))
  }
} finally {
  cleanupWork(work)
}

console.log(`\n结果：${checkState.failures === 0 ? '✅ 全部通过' : `❌ ${checkState.failures} 项失败`}`)
process.exit(checkState.failures === 0 ? 0 : 1)
