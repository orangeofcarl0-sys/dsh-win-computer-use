/**
 * 实验性工具面模式测试（surfaceMode，2026-11-09）：
 *   A dispatcher：只暴露 computer_do + screen_observe；20 个隐藏工具经 action="call" 路由。
 *   B hybrid：再暴露 5 个高频原生工具；长尾经 dispatcher 路由。
 *   默认 dynamic 保持既有行为。
 *
 * 覆盖：注册面、catalog、隐藏工具不可直接调用、guard/stop 锁存、参数校验、未知工具、
 * 图片透传（screen_zoom）、工具列表稳定、宿主 schema 断言。
 */
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { makeWorkCopy, writeStubDriver, loadPlugin, makeServices, makeCtx, makeChecks, cleanupWork } from './lib/harness.mjs'

const work = makeWorkCopy('dispatcher')

writeStubDriver(work, `
export const CUA_BIN = 'stub'
export const CUA_SESSION = 'dispatcher'
export const withSession = (a = {}) => a
export function normalizeMcp(v) { return v }
export function isBackgroundUnavailable() { return false }
export function isForegroundUnavailable() { return false }
export function isUnverified() { return false }

const PNG1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
const WINDOW = { pid: 42, window_id: 7, app_name: 'Stub', title: 'Stub', bounds: { x: 100, y: 100, width: 800, height: 600 }, z_index: 5 }
const ELEMENTS = [
  { element_index: 0, element_token: 'tok-0', role: 'Edit', label: 'body', value: 'hello', frame: { x: 120, y: 150, w: 300, h: 30 }, enabled: true },
  { element_index: 1, element_token: 'tok-1', role: 'Button', label: 'Save', frame: { x: 120, y: 200, w: 60, h: 24 }, enabled: true },
]
export async function cuaCall(tool, args = {}) {
  if (tool === 'check_permissions') return { elevated: false, integrity_level: 'Medium', uia: true, postmessage: true }
  if (tool === 'list_windows') return { windows: [WINDOW] }
  if (tool === 'get_window_state') return {
    window: WINDOW, elements: ELEMENTS, element_count: ELEMENTS.length, total_element_count: ELEMENTS.length,
    screenshot_png_b64: PNG1x1, screenshot_mime_type: 'image/png', screenshot_width: 800, screenshot_height: 600,
    snapshot_id: 's00000001',
  }
  if (tool === 'zoom') return { screenshot_png_b64: PNG1x1, width: 200, height: 150 }
  if (tool === 'get_cursor_position') return { x: 10, y: 20 }
  return { ok: true, effect: 'confirmed', delivery: { mode: 'background' } }
}
export async function cuaDeliver(tool, payload) { return { value: await cuaCall(tool, payload), note: '' } }
`)

const plugin = await loadPlugin(work)
const { check, state } = makeChecks()
const surface = await import(pathToFileURL(join(work, 'lib', 'surface.js')).href)
const dispatcher = await import(pathToFileURL(join(work, 'lib', 'dispatcher.js')).href)

const cfgOf = (mode) => ({
  ttlMs: 60000, maxElements: 120, observeDedup: 'off', verboseReceipts: false,
  taskTimeoutMin: 5, maxTaskCalls: 3, supersession: 'note', allowedApps: [], cursorTheme: '',
  nativeImage: 'auto', visionProvider: 'p', visionModel: 'm', extremePatterns: [],
  passwordScan: 'off', deliveryMode: 'auto', surfaceMode: mode,
})

function session(mode) {
  const { reg, ctx, exec } = makeCtx({
    services: makeServices(),
    agent: {
      id: `dispatcher-${mode}`,
      options: { provider: 'p', model: 'm' },
      session: { requestHeader: () => ({ config: { provider: 'p', model: 'm' } }) },
    },
  })
  plugin.apply(ctx, cfgOf(mode))
  const call = (name, args = {}) => {
    const def = reg.get(name)
    if (!def) return Promise.resolve({ ok: false, result: `[not-visible] ${name}` })
    return def.execute(args, exec)
  }
  return { reg, ctx, exec, call }
}

// ── A. dispatcher ───────────────────────────────────────────────────
{
  const s = session('dispatcher')
  const names = [...s.reg.keys()].sort()
  check('A1 只暴露 computer_do + screen_observe', names.join(',') === 'computer_do,screen_observe', names.join(','))
  check('A2 隐藏工具不可直接调用', !s.reg.has('computer_click') && !s.reg.has('computer_menu'))

  const actionEnum = s.reg.get('computer_do').parameters?.properties?.action?.enum || []
  check('A3 computer_do 是 dispatcher 面（call/catalog/status）', actionEnum.includes('call') && actionEnum.includes('catalog') && !actionEnum.includes('enter'), actionEnum.join(','))

  const cat = await s.call('computer_do', { action: 'catalog' })
  check('A4 catalog 列出 20 个隐藏工具', cat.ok === true && (cat.tools || []).length === 20 && /computer_click/.test(cat.result) && /computer_menu/.test(cat.result), `tools=${(cat.tools || []).length}`)
  check('A5 catalog 不改变注册面', s.reg.size === 2, `reg=${s.reg.size}`)
  check('A6 隐藏 click 不在注册表', !s.reg.has('computer_click'))

  let r = await s.call('computer_do', { action: 'call', tool: 'computer_click', args: { element: 0 } })
  check('A7 无快照时隐藏工具仍被 guard 拒绝', r.ok === false && /观察快照/.test(r.result), String(r.result).slice(0, 70))

  await s.call('screen_observe', { window: 'Stub' })
  r = await s.call('computer_do', { action: 'call', tool: 'computer_click', args: { element: 0 } })
  check('A8 dispatcher 成功调用隐藏 click', r.ok === true && /^\[computer_click\]/.test(r.result), String(r.result).slice(0, 70))

  r = await s.call('computer_do', { action: 'call', tool: 'computer_type', args: { element: 0, text: 'hi' } })
  check('A9 dispatcher 成功调用隐藏 type', r.ok === true && /^\[computer_type\]/.test(r.result), String(r.result).slice(0, 70))

  r = await s.call('computer_do', { action: 'call', tool: 'no_such_tool', args: {} })
  check('A10 未知工具给可用清单', r.ok === false && /未知工具/.test(r.result) && /computer_click/.test(r.result), String(r.result).slice(0, 70))

  r = await s.call('computer_do', { action: 'call', tool: 'computer_click', args: {} })
  check('A11 隐藏工具参数校验生效', r.ok === false && /computer_click/.test(r.result), String(r.result).slice(0, 70))

  r = await s.call('computer_do', { action: 'call', tool: 'computer_stop', args: {} })
  check('A12 dispatcher 调用 stop 成功', r.ok === true && /computer_stop/.test(r.result), String(r.result).slice(0, 70))
  r = await s.call('computer_do', { action: 'call', tool: 'computer_click', args: { element: 0 } })
  check('A13 stop 锁存对隐藏工具生效', r.ok === false && /停止/.test(r.result), String(r.result).slice(0, 70))
  r = await s.call('computer_do', { action: 'call', tool: 'computer_resume', args: {} })
  check('A14 dispatcher 仍能调用 resume 解锁', r.ok === true && /computer_resume/.test(r.result), String(r.result).slice(0, 70))

  await s.call('screen_observe', { window: 'Stub' })
  r = await s.call('computer_do', { action: 'call', tool: 'screen_zoom', args: { pid: 42, window_id: 7, x1: 0, y1: 0, x2: 100, y2: 80 } })
  check('A15 screen_zoom 图片经 dispatcher 透传', r.ok === true && r.image && String(r.image.mediaType).startsWith('image/'), `ok=${r.ok} image=${r.image ? r.image.mediaType : 'none'} result=${String(r.result).slice(0, 80)}`)
  const blocks = s.reg.get('computer_do').output.render({}, r)
  check('A16 computer_do render 输出图片块', Array.isArray(blocks) && blocks.some((b) => b.type === 'image'), JSON.stringify(blocks.map((b) => b.type)))

  check('A17 全程 tools 列表未变化', s.reg.size === 2, `reg=${s.reg.size}`)
}

// ── B. hybrid ───────────────────────────────────────────────────────
{
  const s = session('hybrid')
  const names = [...s.reg.keys()].sort()
  const hotExpected = [...surface.ALWAYS_VISIBLE, ...dispatcher.HOT_TOOLS].sort()
  check('B1 暴露 computer_do + screen_observe + 5 个热工具', names.join(',') === hotExpected.join(',') && s.reg.size === 7, names.join(','))
  check('B2 长尾工具不可直接调用', !s.reg.has('computer_menu') && !s.reg.has('computer_clipboard'))

  const actionEnum = s.reg.get('computer_do').parameters?.properties?.action?.enum || []
  check('B3 computer_do 是 dispatcher 面', actionEnum.includes('call') && actionEnum.includes('catalog') && !actionEnum.includes('enter'), actionEnum.join(','))

  const cat = await s.call('computer_do', { action: 'catalog' })
  const catNames = cat.tools || []
  check('B4 catalog 只列长尾（不含热工具）', cat.ok === true && catNames.includes('computer_menu') && !catNames.includes('computer_click') && !catNames.includes('computer_type'), catNames.join(','))

  await s.call('screen_observe', { window: 'Stub' })
  let r = await s.call('computer_click', { element: 0 })
  check('B5 热工具可直接调用', r.ok === true && !/not-visible/.test(String(r.result)), String(r.result).slice(0, 70))

  r = await s.call('computer_do', { action: 'call', tool: 'computer_menu', args: { pid: 42, window_id: 7, path: JSON.stringify(['File', 'Save']) } })
  check('B6 长尾菜单经 dispatcher 调用', r.ok === true && /^\[computer_menu\]/.test(r.result), String(r.result).slice(0, 70))

  r = await s.call('computer_do', { action: 'call', tool: 'computer_click', args: { element: 0 } })
  check('B7 已直接可见的热工具不被 dispatcher 重复路由', r.ok === false && /直接可见/.test(r.result), String(r.result).slice(0, 70))

  check('B8 工具列表全程稳定', s.reg.size === 7, `reg=${s.reg.size}`)
}

// ── C. dynamic 默认不变 ─────────────────────────────────────────────
{
  const s = session('dynamic')
  check('C1 dynamic 折叠态仍是 2 个', s.reg.size === 2)
  await s.reg.get('computer_do').execute({ action: 'enter' }, s.exec)
  check('C2 dynamic enter 后仍是 22 个', s.reg.size === 22, `reg=${s.reg.size}`)
  const actionEnum = s.reg.get('computer_do').parameters?.properties?.action?.enum || []
  check('C3 dynamic 仍是 enter/exit/status', actionEnum.includes('enter') && actionEnum.includes('exit') && !actionEnum.includes('call'), actionEnum.join(','))
}

// ── D. 清单/宿主 schema 守门 ───────────────────────────────────────
{
  const hotSubset = dispatcher.HOT_TOOLS.every((n) => surface.EXPANDED_ONLY.includes(n))
  check('D1 HOT_TOOLS 全部在 EXPANDED_ONLY 清单', hotSubset, dispatcher.HOT_TOOLS.join(','))
  const modes = dispatcher.SURFACE_MODES
  check('D2 surfaceMode 枚举完整', modes.includes('dynamic') && modes.includes('dispatcher') && modes.includes('hybrid'), modes.join(','))

  const t = await import('@deepseek-ai/dsh-tools')
  for (const mode of ['dispatcher', 'hybrid']) {
    const s = session(mode)
    const bad = []
    for (const [name, def] of s.reg) {
      try { t.assertSupportedJsonSchema(def.output.schema) } catch (e) { bad.push(`${name}: ${String(e.message).slice(0, 60)}`) }
    }
    check(`D3 ${mode} 所有输出 schema 通过宿主断言`, bad.length === 0, bad.join(' | '))
  }
}

if (!state.failures) cleanupWork(work)
console.log(`\n结果：${state.failures ? '❌ ' + state.failures + ' 项失败' : '✅ 全部通过'}`)
process.exit(state.failures ? 1 : 0)
