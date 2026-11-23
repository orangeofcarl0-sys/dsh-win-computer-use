/**
 * PTC 桥接测试（ptcBridge=off/on、raw 协议、facade、能力诊断、策略继承）。
 *
 * 用受控 cua.js 桩，不碰真实桌面。
 */
import { join } from 'node:path'
import { writeFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { EventEmitter } from 'node:events'
import { pathToFileURL } from 'node:url'
import {
  makeWorkCopy, writeStubDriver, loadPlugin, makeServices, makeCtx, makeChecks, cleanupWork, validateSchema,
} from './lib/harness.mjs'

const work = makeWorkCopy('ptc')

// native.js 是测试桩：不启动真实 PowerShell；show/scroll 的协议映射由这里控制。
writeFileSync(join(work, 'lib', 'ptc', 'native.js'), `
export async function showWindow(payload) {
  globalThis.__ptcShowCall = { ...payload }
  const mode = process.env.CUA_STUB_SHOW || ''
  if (mode === 'window_not_found') return { ok: false, code: 'window_not_found', error: 'window gone' }
  if (mode === 'uipi') return { ok: false, code: 'uipi', error: 'UIPI blocked' }
  if (mode === 'secure_desktop') return { ok: false, code: 'secure_desktop', error: 'secure desktop' }
  if (mode === 'unavailable') return { ok: false, code: 'unavailable', error: 'no helper' }
  if (mode === 'boom') return { ok: false, code: 'weird', error: 'boom' }
  if (mode === 'foreground') {
    return { ok: true, dispatched: true, windowId: payload.hwnd, foregroundChanged: true, effect: 'confirmed' }
  }
  if (mode === 'incomplete') {
    return { ok: true, dispatched: true, windowId: payload.hwnd, foregroundChanged: false,
      effect: 'unverifiable', warning_code: 'show_incomplete', minimized: true, visible: false }
  }
  return { ok: true, dispatched: true, windowId: payload.hwnd, foregroundChanged: false,
    effect: 'confirmed', minimized: false, visible: true }
}
export async function scrollAt(args) {
  globalThis.__ptcScrollCall = { ...args }
  const mode = process.env.CUA_STUB_SCROLL || ''
  if (mode === 'no_pattern') return { ok: false, code: 'no_scroll_pattern', error: 'no UIA ScrollPattern' }
  if (mode === 'not_scrollable') return { ok: false, code: 'not_scrollable', error: 'not scrollable' }
  if (mode === 'point_not_in_target') return { ok: false, code: 'point_not_in_target', error: 'point elsewhere' }
  if (mode === 'no_element') return { ok: false, code: 'no_element', error: 'no element' }
  if (mode === 'window_not_found') return { ok: false, code: 'window_not_found', error: 'window gone' }
  if (mode === 'pid_mismatch') return { ok: false, code: 'pid_mismatch', error: 'pid mismatch' }
  if (mode === 'timeout') return { ok: false, code: 'timeout', error: 'timeout' }
  if (mode === 'partial') return { ok: false, code: 'scroll_partial', error: 'partial', scrolled: 2 }
  if (mode === 'moved_false') {
    return { ok: false, code: 'scroll_no_effect', error: 'no effect', moved: false,
      axisMoved: { h: null, v: false },
      percentBefore: { h: -1, v: 0 }, percentAfter: { h: -1, v: 0 } }
  }
  if (mode === 'moved_null') {
    return { ok: true, code: 'scroll_unverified', moved: null,
      axisMoved: { h: null, v: null },
      percentBefore: { h: -1, v: -1 }, percentAfter: { h: -1, v: -1 } }
  }
  if (mode === 'subtree') {
    return { ok: false, code: 'no_scroll_pattern_in_subtree', error: 'no candidate',
      diagnostics: { scan: { visited: 10, sawSubtreePattern: true } } }
  }
  if (mode === 'moved_true') {
    return { ok: true, code: 'ok', moved: true, role: 'Pane', name: 'ScrollArea', source: 'subtree',
      attempted: 2, scrolled: 2,
      axisMoved: { h: null, v: true },
      percentBefore: { h: -1, v: 0 }, percentAfter: { h: -1, v: 10 } }
  }
  if (mode === 'unavailable') return { ok: false, code: 'unavailable', error: 'no helper' }
  if (mode === 'unavailable') return { ok: false, code: 'unavailable', error: 'no helper' }
  if (mode === 'scroll_failed') return { ok: false, code: 'scroll_failed', error: 'helper failed' }
  return { ok: true, scrolled: Math.max(Math.abs(args.deltaX), Math.abs(args.deltaY)) }
}
`)

writeStubDriver(work, `
export const CUA_BIN = 'stub'
export const CUA_SESSION = 'ptc'
export const withSession = (a = {}) => a
export function normalizeMcp(v) { return v }
export function isBackgroundUnavailable() { return false }
export function isForegroundUnavailable() { return false }
export function isUnverified() { return false }
export function deliveryFailure() { return null }

const PNG1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
const W1 = { pid: 4242, window_id: 77, app_name: 'Notepad', title: 'untitled - Notepad',
  bounds: { x: 100, y: 100, width: 800, height: 600 }, is_on_screen: true, minimized: false, z_index: 5 }
const W2 = { pid: 4242, window_id: 78, app_name: 'Notepad', title: 'second - Notepad',
  bounds: { x: 200, y: 200, width: 640, height: 480 }, is_on_screen: true, minimized: false, z_index: 3 }
const W3 = { pid: 5151, window_id: 91, app_name: 'Widget', title: 'Widget',
  bounds: { x: 300, y: 300, width: 500, height: 400 }, is_on_screen: true, minimized: false, z_index: 1 }
const W4 = { pid: 4243, window_id: 80, app_name: 'Mini', title: 'Mini',
  bounds: { x: 500, y: 500, width: 400, height: 300 }, is_on_screen: true, minimized: true, z_index: 1 }
const ELEMENTS = [
  { element_index: 0, element_token: 'tok-0', role: 'Button', label: 'Save',
    frame: { x: 120, y: 150, w: 60, h: 24 }, enabled: true, actions: ['Invoke'] },
  { element_index: 1, element_token: 'tok-1', role: 'Edit', label: 'body', value: 'hello',
    frame: { x: 140, y: 240, w: 300, h: 30 }, enabled: true, actions: ['ValuePattern.SetValue', 'TextPattern'] },
  { element_index: 2, element_token: 'tok-2', role: 'Pane', label: 'Canvas',
    frame: { x: 200, y: 300, w: 200, h: 100 }, enabled: true, actions: [] },
  { element_index: 3, element_token: 'tok-3', role: 'Edit', label: 'DriverValue', value: 'x',
    frame: { x: 240, y: 340, w: 200, h: 30 }, enabled: true, actions: ['set_value'] },
]
const APPS = [
  { name: 'Notepad', pid: 4242, running: true, active: true, bundle_id: null, launch_path: null },
  { name: 'Widget', pid: 0, running: false, active: false, bundle_id: 'C:\\\\Widget\\\\widget.exe',
    launch_path: 'C:\\\\Widget\\\\widget.exe' },
  { name: 'Twin', pid: 6001, running: true, active: false, bundle_id: null, launch_path: null },
  { name: 'Twin', pid: 6002, running: true, active: false, bundle_id: null, launch_path: null },
  { name: 'Mini', pid: 4243, running: true, active: false, bundle_id: null, launch_path: null },
  { name: 'Tool', pid: 7001, running: true, active: false, bundle_id: 'C:\\\\Tool\\\\tool.exe',
    launch_path: 'C:\\\\Tool\\\\tool.exe' },
]

export async function cuaCall(tool, args = {}) {
  globalThis.__ptcCalls = globalThis.__ptcCalls || []
  globalThis.__ptcCalls.push({ tool, args: { ...args } })
  const extra = process.env.CUA_STUB_PTC_EXTRA === '1'
  if (tool === 'check_permissions') return { elevated: false, integrity_level: 'Medium', uia: true, postmessage: true }
  if (tool === 'list_apps') return { apps: extra ? APPS : APPS.slice(0, 4) }
  if (tool === 'list_windows') {
    const all = extra ? [W1, W2, W3, W4] : [W1, W2, W3]
    return { windows: args.pid ? all.filter((w) => Number(w.pid) === Number(args.pid)) : all }
  }
  if (tool === 'get_window_state') {
    const one = [W1, W2, W3, W4].find((w) => Number(w.window_id) === Number(args.window_id)) || W1
    const captureOnly = args.include_accessibility_tree === false && args.include_screenshot === true
    if (captureOnly && process.env.CUA_STUB_CAPTURE === 'none') {
      return {
        window: one, elements: [], element_count: 0, total_element_count: 0,
        screenshot_width: 0, screenshot_height: 0, snapshot_id: 'capture-only',
      }
    }
    const resized = captureOnly && process.env.CUA_STUB_CAPTURE === 'dims'
    return {
      window: one, elements: ELEMENTS, element_count: ELEMENTS.length, total_element_count: ELEMENTS.length,
      screenshot_png_b64: PNG1x1, screenshot_mime_type: 'image/png',
      screenshot_width: resized ? 640 : one.bounds.width,
      screenshot_height: resized ? 480 : one.bounds.height,
      snapshot_id: 's00000001',
    }
  }
  if (tool === 'launch_app') return { pid: 5151, running: true, windows: [W3] }
  if (tool === 'get_desktop_state') return {
    screenshot_png_b64: PNG1x1, screenshot_mime_type: 'image/png', screenshot_width: 2560, screenshot_height: 1600,
  }
  if (tool === 'zoom') return { screenshot_png_b64: PNG1x1, width: 200, height: 150 }
  return { ok: true, effect: 'confirmed', delivery: { mode: 'background' } }
}
export async function cuaDeliver(tool, payload) { return { value: await cuaCall(tool, payload), note: '' } }
`)

const plugin = await loadPlugin(work)
const pluginMod = await import(pathToFileURL(join(work, 'index.js')).href)
const snapshotMod = await import(pathToFileURL(join(work, 'lib', 'snapshot.js')).href)
const { check, state } = makeChecks()
const t = await import('@deepseek-ai/dsh-tools')

function session(overrides = {}, { services, agent } = {}) {
  const agentInfo = agent || {
    id: `ptc-${Math.random()}`,
    options: { provider: 'p', model: 'm' },
    session: { requestHeader: () => ({ config: { provider: 'p', model: 'm' } }) },
  }
  const { reg, ctx, exec, registrations } = makeCtx({
    services: services || makeServices(),
    agent: agentInfo,
  })
  plugin.apply(ctx, {
    ttlMs: 60000,
    maxElements: 120,
    observeDedup: 'off',
    passwordScan: 'off',
    deliveryMode: 'auto',
    ptcBridge: 'off',
    ...overrides,
  })
  return { reg, ctx, exec, registrations }
}

/** 临时环境变量；无论成功/失败都恢复，避免跨 section 污染。 */
async function withEnv(name, value, fn) {
  const prev = process.env[name]
  process.env[name] = value
  try {
    return await fn()
  } finally {
    if (prev === undefined) delete process.env[name]
    else process.env[name] = prev
  }
}

const call = (s, name, args = {}) => {
  const def = s.reg.get(name) || [...s.reg.values()].find((d) => d.name === name)
  if (!def) return Promise.resolve({ ok: false, result: `[not-registered] ${name}` })
  return def.execute(args, s.exec)
}

async function cuaCall(s, method, params = {}) {
  const def = s.reg.get('computer_cua')
  if (!def) throw new Error('computer_cua 未注册')
  try {
    return await def.execute({ method, params }, s.exec)
  } catch (error) {
    return { __error: error }
  }
}

function errorCode(result) {
  return result?.__error?.code || ''
}

// ── A. 默认 off ──────────────────────────────────────────────────────
{
  const s = session()
  check('A1 off：仍只注册 computer_do + screen_observe', [...s.reg.keys()].sort().join(',') === 'computer_do,screen_observe', [...s.reg.keys()].join(','))
  check('A2 off：toolDefinitions 仍是 23', pluginMod.toolDefinitions().length === 23, String(pluginMod.toolDefinitions().length))
  check('A3 off：computer_cua 不存在', !s.reg.has('computer_cua'))
}

// ── B. on：注册与 schema ─────────────────────────────────────────────
{
  const s = session({ ptcBridge: 'on' })
  const cua = s.reg.get('computer_cua')
  check('B1 on：注册 computer_cua', Boolean(cua))
  check('B2 on：直接可见 3 个', s.reg.size === 3, [...s.reg.keys()].join(','))
  check('B3 on：toolDefinitions = 24', pluginMod.toolDefinitions().length === 24, String(pluginMod.toolDefinitions().length))
  let schemaOk = true
  try { t.assertSupportedJsonSchema(cua.output.schema) } catch { schemaOk = false }
  check('B4 on：computer_cua 输出 schema 通过宿主断言', schemaOk)
  const cat = await call(s, 'computer_do', { action: 'catalog' })
  check('B5 on：catalog 仍 21，且不含 computer_cua', (cat.tools || []).length === 21 && !(cat.tools || []).includes('computer_cua'), String((cat.tools || []).length))
  const routed = await call(s, 'computer_do', { action: 'call', tool: 'computer_cua', args: { method: 'getCapabilities', params: {} } })
  check('B6 on：computer_do 不能路由 computer_cua', routed.ok === false && /未知工具/.test(routed.result), String(routed.result).slice(0, 80))
  const caps = await cuaCall(s, 'getCapabilities')
  check('B7 capabilities：methods 含 show/scroll/performAction', Array.isArray(caps.methods)
    && caps.methods.includes('screenshot') && caps.methods.includes('show')
    && caps.methods.includes('scroll') && caps.methods.includes('performAction')
    && !caps.methods.includes('selectText'), JSON.stringify(caps.methods))
  check('B8 capabilities：缺口诊断只剩 selectText/paste/sendKeyEvent',
    caps.methodSupport?.selectText?.status === 'probe'
      && caps.methodSupport?.paste?.status === 'probe'
      && caps.methodSupport?.sendKeyEvent?.status === 'probe'
      && caps.methodSupport?.show?.status === 'core'
      && caps.methodSupport?.scroll?.status === 'core'
      && caps.methodSupport?.performAction?.status === 'core',
    JSON.stringify({ show: caps.methodSupport?.show, scroll: caps.methodSupport?.scroll, performAction: caps.methodSupport?.performAction }))
  check('B9 capabilities：systemPointer=false / appLevel=false', caps.systemPointer === false && caps.appLevelAccessibility === false)
  const sampleIssues = validateSchema(cua.output.schema, caps)
  check('B10 capabilities 值通过输出 schema', sampleIssues.length === 0, sampleIssues.join(' | '))
}

// ── B2. preset gating（host 只对 PTC Agent 声明 computer_cua）─────────
{
  const presets = { composedPreset: (ctx) => ctx?.preset }
  const s = session({ ptcBridge: 'on' }, { services: makeServices({ agentPresets: presets }) })
  const entry = s.registrations.find((r) => r.def.name === 'computer_cua')
  check('B11 agentPresets：computer_cua 注册带 when', typeof entry?.options?.when === 'function', JSON.stringify(entry?.options))
  check('B12 when：PTC preset 为 true', entry?.options?.when({ agent: { ctx: { preset: 'ptc' } } }) === true)
  check('B13 when：非 PTC preset 为 false', entry?.options?.when({ agent: { ctx: { preset: 'default' } } }) === false)
  check('B14 when：composedPreset 抛错 → false', entry?.options?.when({ agent: {} }) === false)
  const visibleFor = (preset) => s.registrations
    .filter((r) => !r.options?.when || r.options.when({ agent: { ctx: { preset } } }))
    .map((r) => r.def.name)
  check('B15 PTC 可见 / 非 PTC 不可见',
    visibleFor('ptc').includes('computer_cua') && !visibleFor('default').includes('computer_cua'),
    JSON.stringify({ ptc: visibleFor('ptc'), default: visibleFor('default') }))

  const standalone = session({ ptcBridge: 'on' })
  const standaloneEntry = standalone.registrations.find((r) => r.def.name === 'computer_cua')
  check('B16 无 agentPresets → when 恒 true（standalone 全局注册）',
    typeof standaloneEntry?.options?.when === 'function'
      && standaloneEntry.options.when({ agent: { id: 'x' } }) === true)

  const emptyPresets = session({ ptcBridge: 'on' }, { services: makeServices({ agentPresets: {} }) })
  const emptyEntry = emptyPresets.registrations.find((r) => r.def.name === 'computer_cua')
  check('B17 agentPresets 无 composedPreset → when 恒 true',
    typeof emptyEntry?.options?.when === 'function'
      && emptyEntry.options.when({ agent: { id: 'x' } }) === true)

  // Web 组合的加载顺序：apply 时服务还没挂载，when 调用时才出现。
  const lateServices = makeServices()
  const late = session({ ptcBridge: 'on' }, { services: lateServices })
  lateServices.agentPresets = presets
  const lateEntry = late.registrations.find((r) => r.def.name === 'computer_cua')
  check('B18 when 延迟解析 agentPresets（boot order）',
    typeof lateEntry?.options?.when === 'function'
      && lateEntry.options.when({ agent: { ctx: { preset: 'ptc' } } }) === true
      && lateEntry.options.when({ agent: { ctx: { preset: 'standard' } } }) === false)
}

// ── C. 应用/窗口/观察 ────────────────────────────────────────────────
{
  const s = session({ ptcBridge: 'on' })
  const apps = await cuaCall(s, 'listApps')
  check('C1 listApps 只返回 running', Array.isArray(apps) && apps.length === 3 && apps.every((a) => a.pid > 0), JSON.stringify(apps))
  const found = await cuaCall(s, 'findApps', { query: 'widget' })
  check('C2 findApps 返回 installed', found.length === 1 && found[0].isRunning === false, JSON.stringify(found))
  const app = await cuaCall(s, 'getApp', { selector: 'Notepad' })
  check('C3 getApp 返回 pid handle', app.appHandle === 'pid:4242' && app.running === true, JSON.stringify(app))
  const ambiguous = await cuaCall(s, 'getApp', { selector: 'Twin' })
  check('C4 getApp 同名多实例 → APP_AMBIGUOUS', errorCode(ambiguous) === 'APP_AMBIGUOUS', errorCode(ambiguous) || JSON.stringify(ambiguous))
  const launched = await cuaCall(s, 'getApp', { selector: 'Widget' })
  check('C5 getApp stopped → launch_app', launched.appHandle === 'pid:5151', JSON.stringify(launched))
  const windows = await cuaCall(s, 'listWindows', { appHandle: 'pid:4242' })
  check('C6 listWindows bounds/isOnScreen', Array.isArray(windows) && windows.length === 2 && windows[0].bounds.width === 800 && windows[0].isOnScreen === true, JSON.stringify(windows))
  const st = await cuaCall(s, 'getState', { appHandle: 'pid:4242', windowId: 77 })
  check('C7 getState snapshotId/tree/windows', st.snapshotId === 's00000001' && /Save/.test(st.tree) && st.windows.length === 2, JSON.stringify({ sid: st.snapshotId, tree: String(st.tree).slice(0, 50) }))
  const badOpt = await cuaCall(s, 'getState', { appHandle: 'pid:4242', windowId: 77, details: true })
  check('C8 getState details=true → option 诊断', errorCode(badOpt) === 'CAPABILITY_OPTION_UNAVAILABLE', errorCode(badOpt))
  const actions = await cuaCall(s, 'listActions', { appHandle: 'pid:4242', snapshotId: 's00000001', elementId: 's00000001:0' })
  check('C9 listActions 读到快照 actions', Array.isArray(actions) && actions.includes('Invoke'), JSON.stringify(actions))
  const actionIssues = validateSchema(s.reg.get('computer_cua').output.schema, actions)
  check('C9b listActions 字符串数组通过输出 schema', actionIssues.length === 0, actionIssues.join(' | '))
  const stale = await cuaCall(s, 'invoke', { appHandle: 'pid:4242', snapshotId: 's00000001', elementId: 's00000000:0' })
  check('C10 旧 snapshot 前缀 → STALE_SNAPSHOT', errorCode(stale) === 'STALE_SNAPSHOT', errorCode(stale) || JSON.stringify(stale))
}

// ── C2. getApp selector / getState 默认窗口与截断 ────────────────────
{
  const s = session({ ptcBridge: 'on' })
  const byPid = await cuaCall(s, 'getApp', { selector: '4242' })
  check('C11 getApp(pid) → pid handle', byPid.appHandle === 'pid:4242', JSON.stringify(byPid))
  await withEnv('CUA_STUB_PTC_EXTRA', '1', async () => {
    const found = await cuaCall(s, 'findApps', { query: 'Tool' })
    const byPath = await cuaCall(s, 'getApp', { selector: found?.[0]?.path })
    check('C12 getApp(launch_path) 命中运行中应用', found?.length === 1 && byPath.appHandle === 'pid:7001',
      JSON.stringify({ found, byPath }))
    const byBundle = await cuaCall(s, 'getApp', { selector: found?.[0]?.id })
    check('C12b getApp(bundleId) 命中运行中应用', byBundle.appHandle === 'pid:7001', JSON.stringify(byBundle))
  })
  const missing = await cuaCall(s, 'getApp', { selector: '42429999' })
  check('C13 getApp 未运行 pid → APP_NOT_FOUND', errorCode(missing) === 'APP_NOT_FOUND', errorCode(missing))

  const def = await cuaCall(s, 'getState', { appHandle: 'pid:4242' })
  check('C14 getState 无 windowId → 最高 z 序窗口', def.windowId === 77, JSON.stringify({ windowId: def.windowId }))
  const cut = await cuaCall(s, 'getState', { appHandle: 'pid:4242', windowId: 77, maxElements: 2 })
  check('C15 getState maxElements=2 → truncated', cut.truncated === true, JSON.stringify({ n: cut.elementCount, t: cut.truncated }))
  const full = await cuaCall(s, 'getState', { appHandle: 'pid:4242', windowId: 77, maxElements: 5 })
  check('C16 getState maxElements=5 → 未截断', full.truncated === false, JSON.stringify({ n: full.elementCount, t: full.truncated }))
  const depth = await cuaCall(s, 'getState', { appHandle: 'pid:4242', windowId: 77, maxDepth: 3 })
  check('C17 getState maxDepth → option 诊断', errorCode(depth) === 'CAPABILITY_OPTION_UNAVAILABLE', errorCode(depth))
  const menus = await cuaCall(s, 'getState', { appHandle: 'pid:4242', windowId: 77, includeMenus: true })
  check('C18 getState includeMenus → option 诊断', errorCode(menus) === 'CAPABILITY_OPTION_UNAVAILABLE', errorCode(menus))
}

// ── D. 动作映射与策略 ────────────────────────────────────────────────
{
  const s = session({ ptcBridge: 'on' })
  await cuaCall(s, 'getState', { appHandle: 'pid:4242', windowId: 77 })
  const invoked = await cuaCall(s, 'invoke', { appHandle: 'pid:4242', snapshotId: 's00000001', elementId: 's00000001:0' })
  check('D1 invoke → dispatched', invoked.dispatched === true, JSON.stringify(invoked))
  const typed = await cuaCall(s, 'typeText', { appHandle: 'pid:4242', windowId: 77, text: 'hello' })
  check('D2 typeText → dispatched', typed.dispatched === true, JSON.stringify(typed))
  const key = await cuaCall(s, 'pressKey', { appHandle: 'pid:4242', windowId: 77, key: 'return', modifiers: ['control'] })
  check('D3 pressKey → dispatched', key.dispatched === true, JSON.stringify(key))
  const click = await cuaCall(s, 'click', { appHandle: 'pid:4242', windowId: 77, x: 10, y: 10 })
  check('D4 click 坐标 → dispatched', click.dispatched === true, JSON.stringify(click))
  const middle = await cuaCall(s, 'click', { appHandle: 'pid:4242', windowId: 77, x: 10, y: 10, mouseButton: 'middle' })
  check('D5 middle click → option 诊断', errorCode(middle) === 'CAPABILITY_OPTION_UNAVAILABLE', errorCode(middle))
  const hold = await cuaCall(s, 'click', { appHandle: 'pid:4242', windowId: 77, x: 10, y: 10, holdMs: 100 })
  check('D6 holdMs → option 诊断', errorCode(hold) === 'CAPABILITY_OPTION_UNAVAILABLE', errorCode(hold))
  const drag = await cuaCall(s, 'drag', { appHandle: 'pid:4242', windowId: 77, fromX: 1, fromY: 1, toX: 9, toY: 9 })
  check('D7 drag → dispatched', drag.dispatched === true, JSON.stringify(drag))
  const move = await cuaCall(s, 'mouseMove', { appHandle: 'pid:4242', windowId: 77, x: 10, y: 10 })
  check('D8 mouseMove 虚拟光标', move.dispatched === true && move.hoverRoute === 'accessibility' && move.systemPointerMoved === false, JSON.stringify(move))
  const real = await cuaCall(s, 'mouseMove', { appHandle: 'pid:4242', windowId: 77, x: 10, y: 10, useSystemPointer: true })
  check('D9 useSystemPointer → option 诊断', errorCode(real) === 'CAPABILITY_OPTION_UNAVAILABLE', errorCode(real))
}

// ── D2. 无快照时自动观察（typeText/pressKey/click）──────────────────
{
  const auto = async (method, params) => {
    const s = session({ ptcBridge: 'on' })
    snapshotMod.clearSnapshot()
    globalThis.__ptcCalls = []
    const r = await cuaCall(s, method, params)
    const actions = await cuaCall(s, 'listActions', {
      appHandle: 'pid:4242', snapshotId: 's00000001', elementId: 's00000001:0',
    })
    return { r, actions, observed: globalThis.__ptcCalls.some((c) => c.tool === 'get_window_state') }
  }
  const typed = await auto('typeText', { appHandle: 'pid:4242', windowId: 77, text: 'hi' })
  check('D10 typeText 无快照 → 自动观察并建立快照',
    typed.r.dispatched === true && Array.isArray(typed.actions) && typed.observed,
    JSON.stringify({ r: typed.r, actions: typed.actions, observed: typed.observed }))
  const keyed = await auto('pressKey', { appHandle: 'pid:4242', windowId: 77, key: 'return' })
  check('D11 pressKey 无快照 → 自动观察并建立快照',
    keyed.r.dispatched === true && Array.isArray(keyed.actions) && keyed.observed,
    JSON.stringify({ r: keyed.r, observed: keyed.observed }))
  const clicked = await auto('click', { appHandle: 'pid:4242', windowId: 77, x: 10, y: 10 })
  check('D12 click 无快照 → 自动观察并建立快照',
    clicked.r.dispatched === true && Array.isArray(clicked.actions) && clicked.observed,
    JSON.stringify({ r: clicked.r, observed: clicked.observed }))
}

// ── E. show / scroll / performAction ────────────────────────────────
{
  const s = session({ ptcBridge: 'on' })
  const shown = await cuaCall(s, 'show', { appHandle: 'pid:4242', windowId: 77 })
  check('E1 show → dispatched/foregroundChanged', shown.dispatched === true && shown.windowId === 77
    && shown.foregroundChanged === false, JSON.stringify(shown))
  check('E1b show 传 pid/hwnd 给 native', globalThis.__ptcShowCall?.pid === 4242
    && globalThis.__ptcShowCall?.hwnd === 77, JSON.stringify(globalThis.__ptcShowCall))

  const scrolled = await cuaCall(s, 'scroll', {
    appHandle: 'pid:4242', windowId: 77, x: 10, y: 10, deltaLinesY: -3,
  })
  check('E2 scroll → dispatched', scrolled.dispatched === true, JSON.stringify(scrolled))
  check('E2b scroll 屏幕坐标 = screenOrigin + 窗口坐标', globalThis.__ptcScrollCall?.screenX === 110
    && globalThis.__ptcScrollCall?.screenY === 110 && globalThis.__ptcScrollCall?.deltaY === -3,
  JSON.stringify(globalThis.__ptcScrollCall))

  const scrolledRel = await cuaCall(s, 'scroll', {
    appHandle: 'pid:4242', windowId: 77, x: 500, y: 500, deltaLinesY: -1, relative: true,
  })
  check('E3 scroll relative 换算', scrolledRel.dispatched === true
    && globalThis.__ptcScrollCall?.screenX === 500 && globalThis.__ptcScrollCall?.screenY === 400,
  JSON.stringify(globalThis.__ptcScrollCall))

  process.env.CUA_STUB_SCROLL = 'no_pattern'
  const noPattern = await cuaCall(s, 'scroll', {
    appHandle: 'pid:4242', windowId: 77, x: 10, y: 10, deltaLinesY: -1,
  })
  delete process.env.CUA_STUB_SCROLL
  check('E4 scroll 无 ScrollPattern → CAPABILITY_UNAVAILABLE + alternatives',
    errorCode(noPattern) === 'CAPABILITY_UNAVAILABLE'
      && Array.isArray(noPattern?.__error?.details?.alternatives)
      && noPattern.__error.details.alternatives.length > 0,
    `${errorCode(noPattern)} ${JSON.stringify(noPattern?.__error?.details?.alternatives)}`)

  await cuaCall(s, 'getState', { appHandle: 'pid:4242', windowId: 77 })
  const invoked = await cuaCall(s, 'performAction', {
    appHandle: 'pid:4242', snapshotId: 's00000001', elementId: 's00000001:0', action: 'Invoke',
  })
  check('E5 performAction(Invoke) → dispatched', invoked.dispatched === true, JSON.stringify(invoked))
  const set = await cuaCall(s, 'performAction', {
    appHandle: 'pid:4242', snapshotId: 's00000001', elementId: 's00000001:1',
    action: 'ValuePattern.SetValue', argument: 'new',
  })
  check('E6 performAction(ValuePattern.SetValue) → dispatched', set.dispatched === true, JSON.stringify(set))
  const badArg = await cuaCall(s, 'performAction', {
    appHandle: 'pid:4242', snapshotId: 's00000001', elementId: 's00000001:1',
    action: 'ValuePattern.SetValue', argument: { x: 1 },
  })
  check('E7 performAction 对象 argument → INVALID_ARGUMENT', errorCode(badArg) === 'INVALID_ARGUMENT', errorCode(badArg))
  const unsupported = await cuaCall(s, 'performAction', {
    appHandle: 'pid:4242', snapshotId: 's00000001', elementId: 's00000001:1',
    action: 'TextPattern',
  })
  check('E8 performAction 未映射 action → CAPABILITY_UNAVAILABLE + alternatives',
    errorCode(unsupported) === 'CAPABILITY_UNAVAILABLE'
      && Array.isArray(unsupported?.__error?.details?.alternatives),
    `${errorCode(unsupported)} ${JSON.stringify(unsupported?.__error?.details?.alternatives)}`)
}

// ── E3. show native 错误矩阵与最小化选择 ────────────────────────────
{
  const s = session({ ptcBridge: 'on' })
  const cases = [
    ['window_not_found', 'WINDOW_NOT_FOUND'],
    ['uipi', 'CAPABILITY_UNAVAILABLE'],
    ['secure_desktop', 'CAPABILITY_UNAVAILABLE'],
    ['unavailable', 'CAPABILITY_UNAVAILABLE'],
    ['boom', 'OPERATION_FAILED'],
  ]
  for (const [mode, code] of cases) {
    const r = await withEnv('CUA_STUB_SHOW', mode, () => cuaCall(s, 'show', { appHandle: 'pid:4242', windowId: 77 }))
    check(`E9 show native=${mode} → ${code}`, errorCode(r) === code,
      `${errorCode(r)} ${String(r?.__error?.message || '').slice(0, 100)}`)
    if (code === 'CAPABILITY_UNAVAILABLE') {
      check(`E9b show native=${mode} 带 alternatives`, Array.isArray(r?.__error?.details?.alternatives)
        && r.__error.details.alternatives.length > 0)
    }
  }
  const fg = await withEnv('CUA_STUB_SHOW', 'foreground', () => cuaCall(s, 'show', { appHandle: 'pid:4242', windowId: 77 }))
  check('E10 show foregroundChanged 如实透传', fg.foregroundChanged === true && fg.effect === 'confirmed', JSON.stringify(fg))
  const incomplete = await withEnv('CUA_STUB_SHOW', 'incomplete', () => cuaCall(s, 'show', { appHandle: 'pid:4242', windowId: 77 }))
  check('E11 show_incomplete → effect/warningCode 如实返回',
    incomplete.dispatched === true && incomplete.effect === 'unverifiable' && incomplete.warningCode === 'show_incomplete',
    JSON.stringify(incomplete))
  const mini = await withEnv('CUA_STUB_PTC_EXTRA', '1', async () => {
    delete globalThis.__ptcShowCall
    const r = await cuaCall(s, 'show', { appHandle: 'pid:4243' })
    return { r, call: globalThis.__ptcShowCall }
  })
  check('E12 show 无 windowId → 优先最小化窗口', mini.r.windowId === 80 && mini.call?.hwnd === 80,
    JSON.stringify({ r: mini.r, call: mini.call }))
}

// ── E4. scroll native 错误矩阵 ──────────────────────────────────────
{
  const s = session({ ptcBridge: 'on' })
  const cases = [
    ['no_pattern', 'CAPABILITY_UNAVAILABLE'],
    ['not_scrollable', 'CAPABILITY_UNAVAILABLE'],
    ['point_not_in_target', 'CAPABILITY_UNAVAILABLE'],
    ['no_element', 'CAPABILITY_UNAVAILABLE'],
    ['window_not_found', 'WINDOW_NOT_FOUND'],
    ['pid_mismatch', 'INVALID_ARGUMENT'],
    ['timeout', 'OPERATION_TIMEOUT'],
    ['unavailable', 'CAPABILITY_UNAVAILABLE'],
    ['scroll_failed', 'OPERATION_FAILED'],
  ]
  for (const [mode, code] of cases) {
    const r = await withEnv('CUA_STUB_SCROLL', mode, () => cuaCall(s, 'scroll', {
      appHandle: 'pid:4242', windowId: 77, x: 10, y: 10, deltaLinesY: -1,
    }))
    check(`E13 scroll native=${mode} → ${code}`, errorCode(r) === code,
      `${errorCode(r)} ${String(r?.__error?.message || '').slice(0, 100)}`)
  }
  const partial = await withEnv('CUA_STUB_SCROLL', 'partial', () => cuaCall(s, 'scroll', {
    appHandle: 'pid:4242', windowId: 77, x: 10, y: 10, deltaLinesY: -1,
  }))
  check('E14 scroll_partial → OPERATION_FAILED + scrolled',
    errorCode(partial) === 'OPERATION_FAILED' && partial.__error.details?.scrolled === 2,
    `${errorCode(partial)} scrolled=${partial?.__error?.details?.scrolled}`)
  const noEffect = await withEnv('CUA_STUB_SCROLL', 'moved_false', () => cuaCall(s, 'scroll', {
    appHandle: 'pid:4242', windowId: 77, x: 10, y: 10, deltaLinesY: -1,
  }))
  check('E14b scroll_no_effect → OPERATION_FAILED + percent/axis',
    errorCode(noEffect) === 'OPERATION_FAILED'
      && noEffect.__error.details?.code === 'scroll_no_effect'
      && noEffect.__error.details?.moved === false
      && noEffect.__error.details?.percentAfter?.v === 0,
    JSON.stringify(noEffect?.__error?.details))
  const unverified = await withEnv('CUA_STUB_SCROLL', 'moved_null', () => cuaCall(s, 'scroll', {
    appHandle: 'pid:4242', windowId: 77, x: 10, y: 10, deltaLinesY: -1,
  }))
  check('E14c scroll_unverified → dispatched + moved null + effect unverified',
    unverified.dispatched === true && unverified.moved === null && unverified.effect === 'unverified',
    JSON.stringify(unverified))
  const moved = await withEnv('CUA_STUB_SCROLL', 'moved_true', () => cuaCall(s, 'scroll', {
    appHandle: 'pid:4242', windowId: 77, x: 10, y: 10, deltaLinesY: -1,
  }))
  check('E14d moved true → percent/axis/role 透传',
    moved.dispatched === true && moved.moved === true
      && moved.percentAfter?.v === 10 && moved.axisMoved?.v === true && moved.role === 'Pane'
      && moved.attempted === 2,
    JSON.stringify(moved))
  const subtree = await withEnv('CUA_STUB_SCROLL', 'subtree', () => cuaCall(s, 'scroll', {
    appHandle: 'pid:4242', windowId: 77, x: 10, y: 10, deltaLinesY: -1,
  }))
  check('E14e subtree 无候选 → CAPABILITY_UNAVAILABLE + diagnostics',
    errorCode(subtree) === 'CAPABILITY_UNAVAILABLE'
      && subtree.__error.details?.code === 'no_scroll_pattern_in_subtree'
      && subtree.__error.details?.diagnostics?.scan?.visited === 10,
    JSON.stringify(subtree?.__error?.details))
}

// ── E5. scroll 参数与 relative 边界 ────────────────────────────────
{
  const s = session({ ptcBridge: 'on' })
  const base = { appHandle: 'pid:4242', windowId: 77, x: 10, y: 10, deltaLinesY: -1 }
  const missing = await cuaCall(s, 'scroll', { appHandle: 'pid:4242', windowId: 77 })
  check('E15 scroll 缺 x/y → INVALID_ARGUMENT', errorCode(missing) === 'INVALID_ARGUMENT', errorCode(missing))
  const zero = await cuaCall(s, 'scroll', { ...base, deltaLinesY: 0 })
  check('E16 scroll 零 delta → INVALID_ARGUMENT', errorCode(zero) === 'INVALID_ARGUMENT', errorCode(zero))
  const big = await cuaCall(s, 'scroll', { ...base, deltaLinesY: 11 })
  check('E17 scroll delta 越界 → INVALID_ARGUMENT', errorCode(big) === 'INVALID_ARGUMENT', errorCode(big))
  const oob = await cuaCall(s, 'scroll', { ...base, x: 800 })
  check('E18 scroll 绝对坐标越界 → INVALID_ARGUMENT', errorCode(oob) === 'INVALID_ARGUMENT', errorCode(oob))
  const r0 = await cuaCall(s, 'scroll', { ...base, x: 0, y: 0, relative: true })
  check('E19 scroll relative 0 → 屏幕原点', r0.dispatched === true
    && globalThis.__ptcScrollCall?.screenX === 100 && globalThis.__ptcScrollCall?.screenY === 100,
  JSON.stringify(globalThis.__ptcScrollCall))
  const r999 = await cuaCall(s, 'scroll', { ...base, x: 999, y: 999, relative: true })
  check('E20 scroll relative 999 → 窗口右下边界', r999.dispatched === true
    && globalThis.__ptcScrollCall?.screenX === 899 && globalThis.__ptcScrollCall?.screenY === 699,
  JSON.stringify(globalThis.__ptcScrollCall))
  for (const bad of [1000, 1.5]) {
    const r = await cuaCall(s, 'scroll', { ...base, x: bad, y: 10, relative: true })
    check(`E21 scroll relative ${bad} → INVALID_ARGUMENT`, errorCode(r) === 'INVALID_ARGUMENT', errorCode(r))
  }
  const neg = await cuaCall(s, 'scroll', { ...base, x: -1, y: 10, relative: true })
  check('E22 scroll relative -1 → INVALID_ARGUMENT', errorCode(neg) === 'INVALID_ARGUMENT', errorCode(neg))
}

// ── E6. performAction action 列表与值类型 ──────────────────────────
{
  const s = session({ ptcBridge: 'on' })
  await cuaCall(s, 'getState', { appHandle: 'pid:4242', windowId: 77 })
  const ref = (index) => ({ appHandle: 'pid:4242', snapshotId: 's00000001', elementId: `s00000001:${index}` })
  const wrong0 = await cuaCall(s, 'performAction', { ...ref(0), action: 'ValuePattern.SetValue', argument: 'x' })
  check('E23 performAction 元素未声明 action → CAPABILITY_UNAVAILABLE + availableActions',
    errorCode(wrong0) === 'CAPABILITY_UNAVAILABLE'
      && Array.isArray(wrong0?.__error?.details?.availableActions)
      && wrong0.__error.details.availableActions.includes('Invoke'),
    JSON.stringify(wrong0?.__error?.details))
  const wrong1 = await cuaCall(s, 'performAction', { ...ref(1), action: 'Invoke' })
  check('E24 performAction Invoke 未在元素 actions → CAPABILITY_UNAVAILABLE',
    errorCode(wrong1) === 'CAPABILITY_UNAVAILABLE'
      && Array.isArray(wrong1?.__error?.details?.availableActions), errorCode(wrong1))
  const lower = await cuaCall(s, 'performAction', { ...ref(0), action: 'invoke' })
  check('E25 performAction action 大小写归一', lower.dispatched === true, JSON.stringify(lower))
  globalThis.__ptcCalls = []
  const num = await cuaCall(s, 'performAction', { ...ref(1), action: 'ValuePattern.SetValue', argument: 42 })
  const numCall = globalThis.__ptcCalls.find((c) => c.tool === 'set_value')
  check('E26 performAction 数字 argument → set_value 字符串', num.dispatched === true && numCall?.args?.value === '42',
    JSON.stringify(numCall?.args))
  globalThis.__ptcCalls = []
  const bool = await cuaCall(s, 'performAction', { ...ref(1), action: 'ValuePattern.SetValue', argument: true })
  const boolCall = globalThis.__ptcCalls.find((c) => c.tool === 'set_value')
  check('E27 performAction 布尔 argument → set_value 字符串', bool.dispatched === true && boolCall?.args?.value === 'true',
    JSON.stringify(boolCall?.args))
  const empty = await cuaCall(s, 'performAction', { ...ref(2), action: 'Invoke' })
  check('E28 空 actions → Invoke 兜底', empty.dispatched === true, JSON.stringify(empty))
  const driverSet = await cuaCall(s, 'performAction', { ...ref(3), action: 'ValuePattern.SetValue', argument: 'v' })
  check('E29 驱动 set_value action 接受 ValuePattern.SetValue', driverSet.dispatched === true, JSON.stringify(driverSet))
}

// ── E2. 仍为缺口的动作 ──────────────────────────────────────────────
{
  const s = session({ ptcBridge: 'on' })
  for (const [method, params] of [
    ['selectText', { appHandle: 'pid:4242', snapshotId: 's00000001', elementId: 's00000001:1', text: 'hello' }],
    ['paste', { appHandle: 'pid:4242', windowId: 77, text: 'x' }],
    ['sendKeyEvent', { appHandle: 'pid:4242', windowId: 77, key: 'a', direction: 'down' }],
  ]) {
    const r = await cuaCall(s, method, params)
    const detail = r?.__error?.details
    check(`E2-${method} → CAPABILITY_UNAVAILABLE + alternatives`,
      errorCode(r) === 'CAPABILITY_UNAVAILABLE' && Array.isArray(detail?.alternatives) && detail.alternatives.length > 0,
      `${errorCode(r)} ${JSON.stringify(detail?.alternatives)}`)
  }
}

// ── F. 策略/stop 继承 ────────────────────────────────────────────────
{
  const s = session({ ptcBridge: 'on', autonomy: { mode: 'auto', blockedApps: ['Notepad'] } })
  const st = await cuaCall(s, 'getState', { appHandle: 'pid:4242', windowId: 77 })
  check('F1 blockedApps：观察仍允许', st.snapshotId === 's00000001', JSON.stringify(st).slice(0, 80))
  const r = await cuaCall(s, 'invoke', { appHandle: 'pid:4242', snapshotId: 's00000001', elementId: 's00000001:0' })
  check('F2 blockedApps：动作 POLICY_DENIED', errorCode(r) === 'POLICY_DENIED', errorCode(r) || JSON.stringify(r))
  const showDenied = await cuaCall(s, 'show', { appHandle: 'pid:4242', windowId: 77 })
  check('F2b blockedApps：show POLICY_DENIED', errorCode(showDenied) === 'POLICY_DENIED', errorCode(showDenied))
  const scrollDenied = await cuaCall(s, 'scroll', {
    appHandle: 'pid:4242', windowId: 77, x: 10, y: 10, deltaLinesY: -1,
  })
  check('F2c blockedApps：scroll POLICY_DENIED', errorCode(scrollDenied) === 'POLICY_DENIED', errorCode(scrollDenied))

  const s2 = session({ ptcBridge: 'on' })
  const stopped = await call(s2, 'computer_do', { action: 'call', tool: 'computer_stop', args: {} })
  check('F3 stop 可经 dispatcher', stopped.ok === true, String(stopped.result).slice(0, 60))
  const locked = await cuaCall(s2, 'getCapabilities')
  check('F4 stop 后 computer_cua → OPERATION_LOCKED', errorCode(locked) === 'OPERATION_LOCKED', errorCode(locked))
  await call(s2, 'computer_do', { action: 'call', tool: 'computer_resume', args: {} })
  const resumed = await cuaCall(s2, 'getCapabilities')
  check('F5 resume 后恢复', resumed.platform === process.platform, JSON.stringify(resumed).slice(0, 60))
}

// ── G. 截图 ─────────────────────────────────────────────────────────
{
  const s = session({ ptcBridge: 'on' })
  const shot = await cuaCall(s, 'screenshot', { appHandle: 'pid:4242', windowId: 77 })
  check('G1 screenshot 返回 data/attachment/dims', typeof shot.data === 'string' && shot.attachment?.attachmentId
    && shot.pixelWidth === 800 && shot.pixelHeight === 600 && shot.coordinateSpace === 'screenshot-pixels',
  JSON.stringify({ ...shot, data: String(shot.data || '').slice(0, 12) + '…' }))
  const cua = s.reg.get('computer_cua')
  const blocks = cua.output.render({}, shot)
  check('G2 render 含图片块且文本不含 base64', Array.isArray(blocks) && blocks.some((b) => b.type === 'image')
    && !String(blocks[0]?.text || '').includes(String(shot.data).slice(0, 20)), JSON.stringify(blocks.map((b) => b.type)))
  const issues = validateSchema(cua.output.schema, shot)
  check('G3 screenshot 值通过输出 schema', issues.length === 0, issues.join(' | '))
}

// ── G2. screenshot 错误路径与尺寸基准 ──────────────────────────────
{
  const textLlm = {
    async resolveModelInfo() { return { inputModalities: ['text'] } },
    async * stream() { throw new Error('MISSING_CREDENTIAL (stub)') },
  }
  const sText = session({ ptcBridge: 'on' }, { services: makeServices({ llm: textLlm }) })
  const unsupported = await cuaCall(sText, 'screenshot', { appHandle: 'pid:4242', windowId: 77 })
  check('G4 非 image 模型 → IMAGE_UNSUPPORTED', errorCode(unsupported) === 'IMAGE_UNSUPPORTED', errorCode(unsupported))

  const noAttachServices = makeServices()
  delete noAttachServices.attachments
  const sNoAttach = session({ ptcBridge: 'on' }, { services: noAttachServices })
  const noAttach = await cuaCall(sNoAttach, 'screenshot', { appHandle: 'pid:4242', windowId: 77 })
  check('G5 无 attachments → ATTACHMENTS_UNAVAILABLE', errorCode(noAttach) === 'ATTACHMENTS_UNAVAILABLE', errorCode(noAttach))

  const s = session({ ptcBridge: 'on' })
  const noShot = await withEnv('CUA_STUB_CAPTURE', 'none', () => cuaCall(s, 'screenshot', {
    appHandle: 'pid:4242', windowId: 77,
  }))
  check('G6 驱动无截图 → SCREENSHOT_REQUIRED', errorCode(noShot) === 'SCREENSHOT_REQUIRED', errorCode(noShot))

  await cuaCall(s, 'getState', { appHandle: 'pid:4242', windowId: 77 })
  const resized = await withEnv('CUA_STUB_CAPTURE', 'dims', () => cuaCall(s, 'screenshot', {
    appHandle: 'pid:4242', windowId: 77,
  }))
  check('G7 screenshot 尺寸来自本次捕获', resized.pixelWidth === 640 && resized.pixelHeight === 480,
    JSON.stringify({ w: resized.pixelWidth, h: resized.pixelHeight }))
  const rel = await cuaCall(s, 'scroll', {
    appHandle: 'pid:4242', windowId: 77, x: 500, y: 500, deltaLinesY: -1, relative: true,
  })
  check('G8 screenshot 后 relative 使用新尺寸基准', rel.dispatched === true
    && globalThis.__ptcScrollCall?.screenX === 420 && globalThis.__ptcScrollCall?.screenY === 340,
  JSON.stringify(globalThis.__ptcScrollCall))
}

// ── H. facade ───────────────────────────────────────────────────────
{
  const s = session({ ptcBridge: 'on' })
  const cuaDef = s.reg.get('computer_cua')
  const facade = await import(pathToFileURL(join(work, 'lib', 'ptc', 'facade.js')).href)
  const emitted = []
  const images = []
  const api = facade.connectCua(
    () => (operation) => cuaDef.execute(operation, s.exec),
    { onText: (text) => emitted.push(text), onImage: (image) => images.push(image) },
  )
  const app = await api.getApp('Notepad')
  check('H1 facade getApp', app.appHandle === 'pid:4242')
  const windows = await app.getWindows({ emit: false })
  check('H2 facade getWindows', windows.length === 2 && windows[0].windowId === 77)
  const win = await app.getWindow(77)
  const tree = await win.getAccessibilityTree({ emit: true })
  check('H3 facade getAccessibilityTree + emit', /Save/.test(tree) && emitted.some((t) => /Save/.test(t)))
  const clicked = await win.click('s00000001:0')
  check('H4 facade element click 自动注入 snapshot', clicked.dispatched === true, JSON.stringify(clicked))
  const shot = await win.getScreenshot({ emit: true })
  check('H5 facade getScreenshot bytes', shot.bytes instanceof Uint8Array && shot.bytes.length > 0 && shot.windowId === 77, `${shot.bytes?.length}`)
  check('H6 facade onImage 收到截图', images.length === 1 && images[0].windowId === 77)
  const stale = await win.click('s00000000:0').catch((e) => e)
  check('H7 facade 旧元素 → CuaError STALE_SNAPSHOT', stale instanceof facade.CuaError && stale.code === 'STALE_SNAPSHOT', stale?.code)
  const shown = await win.show().catch((e) => e)
  check('H8 facade show 成功', shown instanceof facade.CuaError === false && shown.dispatched === true, JSON.stringify(shown))
  const scrolled = await win.scroll({ x: 10, y: 10, deltaLinesY: -1 }).catch((e) => e)
  check('H9 facade scroll 成功', scrolled instanceof facade.CuaError === false && scrolled.dispatched === true, JSON.stringify(scrolled))
  const unsupported = await win.selectText('s00000001:1', 'hello').catch((e) => e)
  check('H10 facade 仍缺口方法 → CAPABILITY_UNAVAILABLE', unsupported instanceof facade.CuaError && unsupported.code === 'CAPABILITY_UNAVAILABLE', unsupported?.code)
  const actions = await win.listActions('s00000001:0')
  check('H11 facade listActions', Array.isArray(actions) && actions.includes('Invoke'), JSON.stringify(actions))
  const set = await win.setValue('s00000001:1', 'v')
  check('H12 facade setValue', set.dispatched === true, JSON.stringify(set))
  const acted = await win.performAction('s00000001:2', 'Invoke')
  check('H13 facade performAction(Invoke)', acted.dispatched === true, JSON.stringify(acted))
  const badAct = await win.performAction('s00000001:0', 'ValuePattern.SetValue', 'x').catch((e) => e)
  check('H14 facade performAction 未声明 → CuaError CAPABILITY_UNAVAILABLE',
    badAct instanceof facade.CuaError && badAct.code === 'CAPABILITY_UNAVAILABLE', badAct?.code)
  const emittedBefore = emitted.length
  const quietTree = await win.getAccessibilityTree({ emit: false })
  check('H15 facade getAccessibilityTree emit:false 不触发 sink',
    /Save/.test(quietTree) && emitted.length === emittedBefore, `${emittedBefore}->${emitted.length}`)
  const imagesBefore = images.length
  const quietShot = await win.getScreenshot({ emit: false })
  check('H16 facade getScreenshot emit:false 不触发 sink',
    quietShot.bytes instanceof Uint8Array && images.length === imagesBefore, `${imagesBefore}->${images.length}`)
}

// ── I. 配置与 off/on 哨兵 ───────────────────────────────────────────
{
  const s = session({ ptcBridge: 'on' })
  const status = await call(s, 'computer_do', { action: 'status' })
  check('I1 status 含 PTC 行', /PTC：on/.test(status.result), String(status.result).slice(-120))
}

// ── J. ptc_call 轨迹审计 ────────────────────────────────────────────
{
  const s = session({ ptcBridge: 'on' })
  const traj = await import(pathToFileURL(join(work, 'lib', 'trajectory.js')).href)
  const dir = mkdtempSync(join(tmpdir(), 'dsh-cu-ptc-traj-'))
  const file = join(dir, 'trajectory.jsonl')
  let summary
  let shotData = ''
  traj.trajectoryStart({ file, meta: { test: 'ptc' } })
  try {
    await cuaCall(s, 'getCapabilities')
    await cuaCall(s, 'listApps')
    await cuaCall(s, 'getState', { appHandle: 'pid:4242', windowId: 77 })
    await cuaCall(s, 'invoke', { appHandle: 'pid:4242', snapshotId: 's00000001', elementId: 's00000001:0' })
    const shot = await cuaCall(s, 'screenshot', { appHandle: 'pid:4242', windowId: 77 })
    shotData = String(shot.data || '')
  } finally {
    summary = traj.trajectoryStop()
  }
  const text = readFileSync(file, 'utf8')
  const events = text.split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l))
  const calls = events.filter((e) => e.type === 'ptc_call')
  const methods = calls.map((e) => e.method)
  check('J1 ptc_call 覆盖 5 个方法', calls.length === 5
    && ['getCapabilities', 'listApps', 'getState', 'invoke', 'screenshot'].every((m) => methods.includes(m)),
  JSON.stringify(methods))
  const allowed = new Set(['t', 'ms', 'seq', 'type', 'parent', 'method', 'app', 'windowId', 'origin'])
  check('J2 ptc_call 不含 params/text/data', calls.every((e) => Object.keys(e).every((k) => allowed.has(k))),
    JSON.stringify(calls.map((e) => Object.keys(e))))
  check('J3 截图 base64 未落轨迹', shotData.length > 20 && !text.includes(shotData), `len=${shotData.length}`)
  check('J4 computer_cua 外壳透明', !events.some((e) => e.type === 'tool_start' && e.name === 'computer_cua')
    && summary?.tools === 2, `tools=${summary?.tools}`)
  const stateCall = calls.find((e) => e.method === 'getState')
  const invokeCall = calls.find((e) => e.method === 'invoke')
  check('J5 ptc_call 记录 app/windowId 目标', stateCall?.app === 'pid:4242' && stateCall?.windowId === 77
    && invokeCall?.app === 'pid:4242' && invokeCall?.windowId === null,
  JSON.stringify({ stateCall, invokeCall }))
  check('J6 默认 origin=main', calls.every((e) => e.origin === 'main'), JSON.stringify(calls.map((e) => e.origin)))
  rmSync(dir, { recursive: true, force: true })

  const subAgent = {
    id: 'ptc-sub',
    options: { provider: 'p', model: 'm' },
    session: {
      requestHeader: () => ({ config: { provider: 'p', model: 'm' } }),
      header: { origin: 'subagent' },
    },
  }
  const sub = session({ ptcBridge: 'on' }, { agent: subAgent })
  const dir2 = mkdtempSync(join(tmpdir(), 'dsh-cu-ptc-sub-'))
  const file2 = join(dir2, 'trajectory.jsonl')
  traj.trajectoryStart({ file: file2, meta: { test: 'ptc-sub' } })
  try {
    await cuaCall(sub, 'getCapabilities')
  } finally {
    traj.trajectoryStop()
  }
  const subCalls = readFileSync(file2, 'utf8').split(/\r?\n/).filter(Boolean)
    .map((l) => JSON.parse(l)).filter((e) => e.type === 'ptc_call')
  check('J7 子 Agent origin=subagent', subCalls.length === 1 && subCalls[0].origin === 'subagent',
    JSON.stringify(subCalls))
  rmSync(dir2, { recursive: true, force: true })

  const blocked = session({ ptcBridge: 'on', autonomy: { mode: 'auto', blockedApps: ['Notepad'] } })
  const dir3 = mkdtempSync(join(tmpdir(), 'dsh-cu-ptc-policy-'))
  const file3 = join(dir3, 'trajectory.jsonl')
  snapshotMod.clearSnapshot()
  delete globalThis.__ptcShowCall
  delete globalThis.__ptcScrollCall
  let blockedSummary
  traj.trajectoryStart({ file: file3, meta: { test: 'ptc-policy' } })
  try {
    await cuaCall(blocked, 'show', { appHandle: 'pid:4242', windowId: 77 })
    await cuaCall(blocked, 'scroll', { appHandle: 'pid:4242', windowId: 77, x: 10, y: 10, deltaLinesY: -1 })
  } finally {
    blockedSummary = traj.trajectoryStop()
  }
  const policyEvents = readFileSync(file3, 'utf8').split(/\r?\n/).filter(Boolean)
    .map((l) => JSON.parse(l)).filter((e) => e.type === 'policy_decision')
  const policyTools = policyEvents.map((e) => e.tool)
  check('J8 show/scroll 均 POLICY_DENIED', policyEvents.length >= 2
    && policyTools.includes('computer_activate') && policyTools.includes('computer_scroll'),
  JSON.stringify(policyTools))
  check('J9 策略拒绝不调用 native', globalThis.__ptcShowCall === undefined && globalThis.__ptcScrollCall === undefined)
  check('J10 策略审计不改变工具计数（仅 scroll 的观察）', blockedSummary?.tools === 1, `tools=${blockedSummary?.tools}`)
  rmSync(dir3, { recursive: true, force: true })
}

// ── K. native.js 注入式 runner（fake spawn，不启 PowerShell）─────────
{
  const native = await import(new URL('../lib/ptc/native.js', import.meta.url).href)
  const args = { pid: 4242, hwnd: 77, screenX: 110, screenY: 120, deltaX: 0, deltaY: -2 }
  const child = ({ stdout = '', stderr = '', code = 0, error = null, silent = false } = {}) => {
    const c = new EventEmitter()
    c.stdout = new EventEmitter()
    c.stderr = new EventEmitter()
    c.stdout.setEncoding = () => {}
    c.stderr.setEncoding = () => {}
    c.kill = () => {}
    if (!silent) {
      setImmediate(() => {
        if (error) { c.emit('error', error); return }
        if (stdout) c.stdout.emit('data', stdout)
        if (stderr) c.stderr.emit('data', stderr)
        c.emit('close', code)
      })
    }
    return c
  }
  let captured = null
  const runner = native.createScrollRunner({
    platform: 'win32',
    scriptPath: 'fake-uia-scroll.ps1',
    exists: () => true,
    spawnFn: (cmd, argv, opts) => {
      captured = { cmd, argv, opts }
      return child({ stdout: 'noise\n{"ok":true,"scrolled":2}\n' })
    },
  })
  const ok = await runner(args)
  const argv = captured?.argv || []
  check('K1 scroll 固定 argv / 无 shell',
    argv.includes('-File') && argv[argv.indexOf('-File') + 1] === 'fake-uia-scroll.ps1'
      && argv[argv.indexOf('-Hwnd') + 1] === '77'
      && argv[argv.indexOf('-TargetPid') + 1] === '4242'
      && argv[argv.indexOf('-ScreenX') + 1] === '110'
      && argv[argv.indexOf('-ScreenY') + 1] === '120'
      && argv[argv.indexOf('-DeltaX') + 1] === '0'
      && argv[argv.indexOf('-DeltaY') + 1] === '-2'
      && captured.opts.shell === false && captured.opts.windowsHide === true,
    JSON.stringify(captured))
  check('K2 成功 JSON 取最后一行', ok.ok === true && ok.scrolled === 2, JSON.stringify(ok))

  const bad = native.createScrollRunner({
    platform: 'win32', scriptPath: 'x.ps1', exists: () => true,
    spawnFn: () => child({ stdout: 'oops', stderr: 'boom', code: 3 }),
  })
  const badR = await bad(args)
  check('K3 非 JSON → scroll_failed', badR.ok === false && badR.code === 'scroll_failed'
    && /3|boom/.test(badR.error), JSON.stringify(badR))

  const nul = native.createScrollRunner({
    platform: 'win32', scriptPath: 'x.ps1', exists: () => true,
    spawnFn: () => child({ stdout: 'null\n' }),
  })
  const nulR = await nul(args)
  check('K4 非对象 → scroll_failed', nulR.ok === false && nulR.code === 'scroll_failed', JSON.stringify(nulR))

  const slow = native.createScrollRunner({
    platform: 'win32', scriptPath: 'x.ps1', exists: () => true, minTimeoutMs: 5,
    spawnFn: () => child({ silent: true }),
  })
  const slowR = await slow(args, { timeoutMs: 5 })
  check('K5 超时 → timeout', slowR.ok === false && slowR.code === 'timeout', JSON.stringify(slowR))

  const thrown = native.createScrollRunner({
    platform: 'win32', scriptPath: 'x.ps1', exists: () => true,
    spawnFn: () => { throw new Error('no spawn') },
  })
  const thrownR = await thrown(args)
  check('K6 spawn 抛错 → unavailable', thrownR.ok === false && thrownR.code === 'unavailable', JSON.stringify(thrownR))

  const errored = native.createScrollRunner({
    platform: 'win32', scriptPath: 'x.ps1', exists: () => true,
    spawnFn: () => child({ error: new Error('child failed') }),
  })
  const erroredR = await errored(args)
  check('K7 child error → unavailable', erroredR.ok === false && erroredR.code === 'unavailable', JSON.stringify(erroredR))

  const linux = native.createScrollRunner({ platform: 'linux' })
  const linuxR = await linux(args)
  check('K8 非 Windows → unavailable', linuxR.ok === false && linuxR.code === 'unavailable', JSON.stringify(linuxR))

  const missing = native.createScrollRunner({ platform: 'win32', exists: () => false })
  const missingR = await missing(args)
  check('K9 脚本缺失 → unavailable', missingR.ok === false && missingR.code === 'unavailable', JSON.stringify(missingR))

  const showLinux = native.createShowWindow({ platform: 'linux' })
  const showLinuxR = await showLinux({ pid: 1, hwnd: 2 })
  check('K10 show 非 Windows → unavailable', showLinuxR.ok === false && showLinuxR.code === 'unavailable')

  let seen = null
  const fakeShow = native.createShowWindow({
    platform: 'win32',
    native: async (payload, opts) => {
      seen = { payload, opts }
      return { ok: true, effect: 'unverifiable', warning_code: 'show_incomplete' }
    },
  })
  const shown = await fakeShow({ pid: 1, hwnd: 2 }, { timeoutMs: 7 })
  check('K11 show 原生响应原样透传', shown.effect === 'unverifiable' && shown.warning_code === 'show_incomplete'
    && seen?.payload?.hwnd === 2 && seen?.opts?.timeoutMs === 7, JSON.stringify({ shown, seen }))
}

if (!state.failures) cleanupWork(work)
console.log(`\n结果：${state.failures ? '❌ ' + state.failures + ' 项失败' : '✅ 全部通过'}`)
process.exit(state.failures ? 1 : 0)
