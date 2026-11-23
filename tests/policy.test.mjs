/**
 * 自治策略契约测试（auto / locked / guarded）。
 *
 * 纯函数部分直接 import lib/policy.js；集成部分用真实 guard/wrap/receipt，
 * 只把 cua.js 换成受控桩，验证“策略拒绝时 driver 不会被调用”。
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  normalizeAutonomy, evaluatePolicy, resolvePolicyDecision, resetPolicySession,
} from '../lib/policy.js'
import {
  makeWorkCopy, writeStubDriver, loadPlugin, makeServices, makeCtx, makeChecks, cleanupWork,
} from './lib/harness.mjs'

const { check, state } = makeChecks()
const snap = { appName: 'Stub', pid: 42, windowId: 7, screenshotWidth: 800, screenshotHeight: 600 }
const cfgOf = (autonomy, allowedApps = []) => ({ autonomy: normalizeAutonomy(autonomy), allowedApps })

// ── 纯策略矩阵 ────────────────────────────────────────────────────────
{
  const a = normalizeAutonomy()
  check('P1 默认 auto / 空拒绝名单 / 子 Agent 真实指针 deny',
    a.mode === 'auto' && a.blockedApps.length === 0 && a.sensitiveApps.length === 0
      && a.realPointer === 'auto' && a.subagents.realPointer === 'deny' && a.subagents.delegation === 'allow')
  const locked = normalizeAutonomy({ mode: 'locked', realPointer: 'auto', subagents: { realPointer: 'inherit', delegation: 'allow' } })
  check('P2 locked 强制禁真实指针/委派/子 Agent 指针',
    locked.realPointer === 'deny' && locked.subagents.realPointer === 'deny' && locked.subagents.delegation === 'deny')
}

const allow = (a, input, allowedApps = []) => evaluatePolicy(cfgOf(a, allowedApps), input)
const click = { tool: 'computer_click', args: { x: 10, y: 10 }, snapshot: snap }
const observe = { tool: 'screen_observe', args: {}, snapshot: null }

check('P3 auto 普通点击 allow', allow({}, click).decision === 'allow')
check('P4 blockedApps 拒绝点击',
  allow({ blockedApps: ['Stub'] }, click).code === 'policy_blocked_app')
check('P5 blockedApps 不阻断观察', allow({ blockedApps: ['Stub'] }, observe).decision === 'allow')
check('P6 sensitiveApps auto 只读（操作拒绝）',
  allow({ sensitiveApps: ['Stub'] }, click).code === 'policy_sensitive_app')
check('P7 sensitiveApps guarded 产生 ask',
  allow({ mode: 'guarded', sensitiveApps: ['Stub'] }, click).decision === 'ask')
check('P8 locked 无 allowedApps fail-closed',
  allow({ mode: 'locked' }, click).code === 'policy_locked_no_allowlist')
check('P9 locked allowedApps 命中 allow',
  allow({ mode: 'locked' }, click, ['Stub']).decision === 'allow')
check('P10 locked allowedApps 未命中拒绝',
  allow({ mode: 'locked' }, click, ['Other']).code === 'policy_locked')
check('P11 allowedApps 非空时 menu 未命中拒绝',
  allow({}, { tool: 'computer_menu', args: { window_id: 7, path: 'File>Open' }, snapshot: snap }, ['Other']).code === 'policy_not_allowlisted')
check('P12 app_launch 命中 blockedApps 拒绝',
  allow({ blockedApps: ['Stub'] }, { tool: 'app_launch', args: { name: 'Stub' }, snapshot: null }).code === 'policy_blocked_app')
check('P13 子 Agent 真实指针默认拒绝',
  allow({}, { tool: 'computer_hover', args: { x: 1, y: 1, real: true }, snapshot: null, origin: 'subagent' }).code === 'policy_subagent_pointer')
check('P14 主 Agent 真实指针 auto allow',
  allow({}, { tool: 'computer_hover', args: { x: 1, y: 1, real: true }, snapshot: null }).decision === 'allow')
check('P15 realPointer=deny 主 Agent 拒绝',
  allow({ realPointer: 'deny' }, { tool: 'computer_hover', args: { x: 1, y: 1, real: true }, snapshot: null }).code === 'policy_real_pointer_denied')
check('P16 guarded 主 Agent 真实指针 ask',
  allow({ mode: 'guarded' }, { tool: 'computer_hover', args: { x: 1, y: 1, real: true }, snapshot: null }).decision === 'ask')
check('P17 guarded 子 Agent 真实指针拒绝（不能询问）',
  allow({ mode: 'guarded', subagents: { realPointer: 'inherit' } },
    { tool: 'computer_hover', args: { x: 1, y: 1, real: true }, snapshot: null, origin: 'subagent' }).code === 'policy_subagent_pointer')
check('P18 delegation=deny 拒绝 computer_task',
  allow({ subagents: { delegation: 'deny' } }, { tool: 'computer_task', args: { goal: 'x' }, snapshot: null }).code === 'policy_delegation_denied')
check('P19 子 Agent 不能再委派',
  allow({}, { tool: 'computer_task', args: { goal: 'x' }, snapshot: null, origin: 'subagent' }).code === 'policy_delegation_denied')
check('P20 locked 拒绝剪贴板',
  allow({ mode: 'locked' }, { tool: 'computer_clipboard', args: { action: 'read' }, snapshot: null }, ['Stub']).code === 'policy_locked')
check('P21 auto 剪贴板不额外限制',
  allow({}, { tool: 'computer_clipboard', args: { action: 'read' }, snapshot: null }).decision === 'allow')

// ── guarded 询问 / 缓存 / fail-closed ─────────────────────────────────
function questionsStub(label) {
  const svc = {
    calls: 0,
    async ask({ questions }) {
      svc.calls++
      return { answers: [{ id: questions[0].id, selected: [label(questions[0])] }] }
    },
  }
  return svc
}
const mainExec = { agent: { session: { header: { origin: 'main' } } }, signal: new AbortController().signal }
const ctxWith = (svc) => ({ get: (n) => (n === 'userQuestions' ? svc : undefined) })

{
  resetPolicySession()
  const svc = questionsStub((q) => q.options[0].label)
  const d = allow({ mode: 'guarded', sensitiveApps: ['Stub'] }, click)
  const first = await resolvePolicyDecision(ctxWith(svc), mainExec, d)
  const second = await resolvePolicyDecision(ctxWith(svc), mainExec, d)
  check('P22 guarded 允许后缓存，只问一次', first.ok === true && second.ok === true && svc.calls === 1, `calls=${svc.calls}`)
}
{
  resetPolicySession()
  const svc = questionsStub((q) => q.options[1].label)
  const d = allow({ mode: 'guarded', sensitiveApps: ['Stub'] }, click)
  const first = await resolvePolicyDecision(ctxWith(svc), mainExec, d)
  const second = await resolvePolicyDecision(ctxWith(svc), mainExec, d)
  check('P23 guarded 拒绝后缓存，只问一次', first.ok === false && second.ok === false && svc.calls === 1
    && /policy_approval_denied/.test(first.reason || ''), `calls=${svc.calls}`)
}
{
  resetPolicySession()
  const d = allow({ mode: 'guarded', sensitiveApps: ['Stub'] }, click)
  const noSvc = await resolvePolicyDecision(ctxWith(undefined), mainExec, d)
  check('P24 guarded 无 userQuestions fail-closed', noSvc.ok === false && noSvc.code === 'policy_approval_unavailable')
  const subExec = { agent: { session: { header: { origin: 'subagent' } } }, signal: new AbortController().signal }
  const sub = await resolvePolicyDecision(ctxWith(questionsStub(() => '允许本会话')), subExec, d)
  check('P25 子 Agent 不能请求批准', sub.ok === false && sub.code === 'policy_approval_unavailable')
}
{
  resetPolicySession()
  const svc = questionsStub(() => '允许本会话')
  const d = allow({ mode: 'guarded', sensitiveApps: ['Stub'] }, click)
  await resolvePolicyDecision(ctxWith(svc), mainExec, d)
  resetPolicySession()
  await resolvePolicyDecision(ctxWith(svc), mainExec, d)
  check('P26 resetPolicySession 清空缓存', svc.calls === 2, `calls=${svc.calls}`)
}

// ── 集成：真实 wrap/guard/receipt + 桩驱动 ───────────────────────────
const work = makeWorkCopy('policy')
writeStubDriver(work, `
export const CUA_BIN = 'stub'
export const CUA_SESSION = 'policy'
export const withSession = (a = {}) => a
export function normalizeMcp(v) { return v }
export function isBackgroundUnavailable() { return false }
export function isForegroundUnavailable() { return false }
export function isUnverified(v) { return Boolean(v && v.effect === 'unverifiable') }
export function deliveryFailure(v) {
  const s = typeof v === 'string' ? v : JSON.stringify(v || {})
  if (/foreground_unavailable|foreground unavailable/i.test(s)) return 'foreground'
  if (/background_unavailable|background unavailable/i.test(s)) return 'background'
  if (/delivery_failed|delivery failed/i.test(s)) return 'delivery_failed'
  return null
}
export const calls = []
const WINDOW = { pid: 42, window_id: 7, app_name: 'Stub', title: 'Stub', bounds: { x: 100, y: 100, width: 800, height: 600 }, z_index: 5 }
const ELEMENTS = [
  { element_index: 0, element_token: 'tok-0', role: 'Edit', label: 'body', value: 'hello', frame: { x: 120, y: 150, w: 300, h: 30 }, enabled: true, actions: ['ValuePattern'] },
  { element_index: 1, element_token: 'tok-1', role: 'Button', label: 'Save', frame: { x: 120, y: 200, w: 60, h: 24 }, enabled: true, actions: ['Invoke'] },
]
export async function cuaCall(tool, args = {}) {
  calls.push({ tool, args })
  switch (tool) {
    case 'check_permissions': return { elevated: false, integrity_level: 'Medium', uia: true, postmessage: true }
    case 'list_windows': return { windows: [WINDOW] }
    case 'get_window_state': return args.include_accessibility_tree === false
      ? { window: WINDOW, elements: [], element_count: 0, total_element_count: 0,
        screenshot_width: 800, screenshot_height: 600, snapshot_id: 's00000001',
        screenshot_png_b64: 'aGVsbG8=', screenshot_mime_type: 'image/png', capture_id: 'cap1' }
      : { window: WINDOW, elements: ELEMENTS, element_count: ELEMENTS.length, total_element_count: ELEMENTS.length,
        screenshot_width: 800, screenshot_height: 600, snapshot_id: 's00000001' }
    case 'get_desktop_state': return { screenshot_width: 800, screenshot_height: 600 }
    default: return { ok: true, effect: 'confirmed' }
  }
}
export async function cuaDeliver(tool, payload, deliveryMode, opts = {}) {
  const force = opts.forceForeground || deliveryMode === 'foreground'
  return { value: await cuaCall(tool, { ...payload, delivery_mode: force ? 'foreground' : 'background' }), note: '' }
}
`)
const plugin = await loadPlugin(work)
const { calls } = await import(pathToFileURL(join(work, 'lib', 'cua.js')).href)
const cfgBase = {
  ttlMs: 60000, maxElements: 120, observeDedup: 'off', verboseReceipts: false,
  taskTimeoutMin: 5, maxTaskCalls: 3, supersession: 'note', allowedApps: [], cursorTheme: '',
  nativeImage: 'auto', visionProvider: 'p', visionModel: 'm', extremePatterns: [],
  passwordScan: 'off', deliveryMode: 'auto', surfaceMode: 'dispatcher', actionGuard: 'off',
}
const agentMain = { id: 'policy-main' }
const callWith = (reg, exec, name, args = {}) => {
  const direct = reg.get(name)
  if (direct) return direct.execute(args, exec)
  return reg.get('computer_do').execute({ action: 'call', tool: name, args }, exec)
}
async function setup(autonomy, { services = makeServices(), agent = agentMain } = {}) {
  const { reg, ctx, exec } = makeCtx({ services, agent })
  plugin.apply(ctx, { ...cfgBase, autonomy })
  await callWith(reg, exec, 'screen_observe', { window: 'Stub' })
  calls.length = 0
  return { reg, ctx, exec }
}

{
  const { reg, exec } = await setup({ blockedApps: ['Stub'] })
  const r = await callWith(reg, exec, 'computer_click', { x: 10, y: 10 })
  check('I1 blockedApps 拒绝且 driver 未调用',
    r.ok === false && /policy_blocked_app/.test(String(r.result)) && !calls.some((c) => c.tool === 'click'),
    String(r.result).slice(0, 80))
}
{
  const { reg, exec } = await setup({ sensitiveApps: ['Stub'] })
  const r = await callWith(reg, exec, 'computer_click', { x: 10, y: 10 })
  const obs = await callWith(reg, exec, 'screen_observe', { window: 'Stub' })
  check('I2 sensitiveApps auto 只读：操作拒绝、观察可用',
    r.ok === false && /policy_sensitive_app/.test(String(r.result)) && obs.ok === true,
    String(r.result).slice(0, 80))
}
{
  const svc = questionsStub((q) => q.options[0].label)
  const { reg, exec } = await setup({ mode: 'guarded', sensitiveApps: ['Stub'] }, { services: makeServices({ userQuestions: svc }) })
  const r1 = await callWith(reg, exec, 'computer_click', { x: 10, y: 10 })
  const r2 = await callWith(reg, exec, 'computer_click', { x: 11, y: 11 })
  check('I3 guarded 允许后放行且只问一次',
    r1.ok === true && r2.ok === true && svc.calls === 1 && calls.some((c) => c.tool === 'click'),
    `calls=${svc.calls}`)
}
{
  const svc = questionsStub((q) => q.options[1].label)
  const { reg, exec } = await setup({ mode: 'guarded', sensitiveApps: ['Stub'] }, { services: makeServices({ userQuestions: svc }) })
  const r1 = await callWith(reg, exec, 'computer_click', { x: 10, y: 10 })
  const r2 = await callWith(reg, exec, 'computer_click', { x: 11, y: 11 })
  check('I4 guarded 拒绝后不再询问、driver 未调用',
    r1.ok === false && r2.ok === false && svc.calls === 1 && !calls.some((c) => c.tool === 'click'),
    `calls=${svc.calls}`)
}
{
  const subAgent = { id: 'policy-sub', session: { header: { origin: 'subagent' } } }
  const { reg, exec } = await setup({}, { agent: subAgent })
  const r = await callWith(reg, exec, 'computer_hover', { x: 1, y: 1, real: true })
  check('I5 子 Agent 真实指针默认拒绝且未调用 move_cursor',
    r.ok === false && /policy_subagent_pointer/.test(String(r.result)) && !calls.some((c) => c.tool === 'move_cursor'),
    String(r.result).slice(0, 80))
}
{
  const { reg, exec } = await setup({})
  const r = await callWith(reg, exec, 'computer_click', { x: 500, y: 500, relative: true })
  const clickCall = calls.find((c) => c.tool === 'click')
  check('I6 relative 坐标换算为窗口截图 px',
    r.ok === true && clickCall?.args.x === 400 && clickCall?.args.y === 300,
    JSON.stringify(clickCall?.args || {}))
}
{
  const { reg, exec } = await setup({})
  const r = await callWith(reg, exec, 'computer_hover', { x: 500, y: 500, relative: true })
  const move = calls.find((c) => c.tool === 'move_cursor')
  check('I7 hover relative 坐标换算',
    r.ok === true && move?.args.x === 400 && move?.args.y === 300,
    JSON.stringify(move?.args || {}))
}
{
  const { reg, exec } = await setup({})
  const r = await callWith(reg, exec, 'computer_click', { x: 1, y: 1, relative: true, from_zoom: true })
  check('I8 relative 与 from_zoom 互斥',
    r.ok === false && /relative_from_zoom_conflict/.test(String(r.result)) && !calls.some((c) => c.tool === 'click'),
    String(r.result).slice(0, 80))
}
{
  const { reg, exec } = await setup({}, { services: makeServices({ computerUse: { providerName: 'dsh-cua' } }) })
  const r = await callWith(reg, exec, 'computer_do', { action: 'status' })
  check('I9 status 含策略与 provider 冲突提示',
    r.ok === true && /策略：auto/.test(String(r.result)) && /Provider：dsh-cua/.test(String(r.result)),
    String(r.result).slice(0, 120))
}
{
  const services = makeServices({
    llm: {
      async resolveModelInfo(provider, model) { return { provider, id: model, inputModalities: ['text'] } },
      async * stream() {},
    },
  })
  const agent = { id: 'policy-img', options: { provider: 'p', model: 'm' }, session: { requestHeader: () => ({ config: { provider: 'p', model: 'm' } }) } }
  const { reg, exec } = await setup({}, { services, agent })
  const r = await callWith(reg, exec, 'screen_zoom', { window_id: 7, x1: 0, y1: 0, x2: 100, y2: 100 })
  check('I10 图像预检错误码',
    r.ok === false && /model_image_unsupported/.test(String(r.result)),
    String(r.result).slice(0, 100))
}
{
  const { reg, exec } = await setup({ subagents: { delegation: 'deny' } })
  const r = await callWith(reg, exec, 'computer_task', { goal: 'x' })
  check('I11 delegation deny 拒绝委派',
    r.ok === false && /policy_delegation_denied/.test(String(r.result)),
    String(r.result).slice(0, 80))
}
{
  const { reg, exec } = await setup({})
  const r = await callWith(reg, exec, 'computer_click', { x: 0, y: 0, relative: true })
  const clickCall = calls.find((c) => c.tool === 'click')
  check('I12 relative 0 → 窗口左上角',
    r.ok === true && clickCall?.args.x === 0 && clickCall?.args.y === 0,
    JSON.stringify(clickCall?.args || {}))
}
{
  const { reg, exec } = await setup({})
  const r = await callWith(reg, exec, 'computer_click', { x: 999, y: 999, relative: true })
  const clickCall = calls.find((c) => c.tool === 'click')
  check('I13 relative 999 → 窗口右下边界',
    r.ok === true && clickCall?.args.x === 799 && clickCall?.args.y === 599,
    JSON.stringify(clickCall?.args || {}))
}
{
  const { reg, exec } = await setup({})
  const r = await callWith(reg, exec, 'computer_click', { x: 1000, y: 10, relative: true })
  check('I14 relative 越界拒绝且未调用驱动',
    r.ok === false && /relative_coordinate_invalid/.test(String(r.result)) && !calls.some((c) => c.tool === 'click'),
    String(r.result).slice(0, 100))
}
{
  const { reg, exec } = await setup({})
  const r = await callWith(reg, exec, 'computer_double_click', { x: 500, y: 500, relative: true })
  const clickCall = calls.find((c) => c.tool === 'click' && c.args.count === 2)
  check('I15 double_click relative 换算',
    r.ok === true && clickCall?.args.x === 400 && clickCall?.args.y === 300,
    JSON.stringify(clickCall?.args || {}))
}
{
  const { reg, exec } = await setup({})
  const r = await callWith(reg, exec, 'computer_right_click', { x: 500, y: 500, relative: true })
  const clickCall = calls.find((c) => c.tool === 'click' && c.args.button === 'right')
  check('I16 right_click relative 换算',
    r.ok === true && clickCall?.args.x === 400 && clickCall?.args.y === 300,
    JSON.stringify(clickCall?.args || {}))
}

cleanupWork(work)
console.log(`\n结果：${state.failures ? `❌ ${state.failures} 项失败` : '✅ 全部通过'}`)
if (state.failures) process.exitCode = 1
