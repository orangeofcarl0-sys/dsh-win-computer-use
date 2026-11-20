/**
 * 经典 Win32 HMENU 菜单兜底测试。
 *
 * 覆盖：
 *  - 插件层：驱动结构化拒绝后才回退；confirmed/unverifiable/effect 缺失/超时不回退；
 *    off 零调用；no_hmenu/timeout 的不同回执；pid 缺失跳过；
 *  - 模块层：resolve/invoke 的 JSON、base64、超时、非 Windows、错误透传。
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { EventEmitter } from 'node:events'
import { makeWorkCopy, writeStubDriver, loadPlugin, makeCtx, makeChecks, cleanupWork } from './lib/harness.mjs'

const work = makeWorkCopy('native-menu')

writeStubDriver(work, `
export const CUA_BIN = 'stub'
export const CUA_SESSION = 'native-menu-test'
export const withSession = (a = {}) => a
export function normalizeMcp(v) { return v }
export function isBackgroundUnavailable() { return false }
export function isForegroundUnavailable() { return false }
export function isUnverified(v) { return Boolean(v && v.effect === 'unverifiable') }
export function deliveryFailure() { return null }
export const state = { menuResult: null, calls: [] }
export async function cuaCall(tool, args = {}) {
  if (tool === 'invoke_menu') { state.calls.push(args); return state.menuResult }
  if (tool === 'check_permissions') return { elevated: false, integrity_level: 'Medium', uia: true, postmessage: true }
  if (tool === 'list_windows') return { windows: [] }
  return { ok: true }
}
export async function cuaDeliver(tool, args) { return { value: { ok: true, effect: 'confirmed' }, note: '' } }
`)

writeFileSync(join(work, 'lib', 'nativeMenus.js'), `
export const state = { calls: [], result: null }
export async function tryNativeMenu(args) {
  state.calls.push(args)
  return state.result
}
`, 'utf8')

const plugin = await loadPlugin(work)
const native = await import(pathToFileURL(join(work, 'lib', 'nativeMenus.js')).href)
const driver = await import(pathToFileURL(join(work, 'lib', 'cua.js')).href)
const real = await import(pathToFileURL(join(process.cwd(), 'lib', 'nativeMenus.js')).href)
const { check, state: checkState } = makeChecks()

const refusal = { refusal: { code: 'menu_path_unavailable', message: 'menu path unavailable' } }

async function fresh(cfgExtra = {}, menuResult = refusal) {
  native.state.calls.length = 0
  native.state.result = { ok: true, method: 'WM_COMMAND', commandId: 1001, path: ['Tools', 'Mark'] }
  driver.state.calls.length = 0
  driver.state.menuResult = menuResult
  const { reg, ctx, exec } = makeCtx()
  plugin.apply(ctx, {
    ttlMs: 60000, maxElements: 120, observeDedup: 'off', passwordScan: 'off',
    nativeDialogs: 'off', nativeMenus: 'off', surfaceMode: 'dispatcher', deliveryMode: 'auto', cursorMotion: 'off',
    ...cfgExtra,
  })
  const call = (name, args) => reg.get(name).execute(args, exec)
  return { call, reg, exec }
}

const menuCall = (r, args) => r.call('computer_do', { action: 'call', tool: 'computer_menu', args })

let r
try {
  // A. off：驱动拒绝保持原样，零原生调用
  {
    r = await fresh({ nativeMenus: 'off' })
    const m = await menuCall(r, { pid: 42, window_id: 200, path: ['Tools', 'Mark'] })
    check('M1: nativeMenus=off 不回退', native.state.calls.length === 0 && m.ok === false
      && /菜单调用被引擎拒绝|未确认|不可用/.test(m.result || ''), m.result)
  }

  // B. auto + 驱动结构化拒绝 + 原生成功
  {
    r = await fresh({ nativeMenus: 'auto' })
    const m = await menuCall(r, { pid: 42, window_id: 200, path: ['Tools', 'Mark'] })
    check('M2: 驱动拒绝 → 原生 HMENU 成功', native.state.calls.length === 1 && m.ok === true
      && /经典 Win32 HMENU/.test(m.result || '') && /WM_COMMAND/.test(m.result || '')
      && /不要重复/.test(m.result || ''), m.result)
  }

  // C. no_hmenu：明确 MenuStrip/WPF/WinUI 不支持
  {
    r = await fresh({ nativeMenus: 'auto' })
    native.state.result = { ok: false, code: 'no_hmenu', error: 'target has no HMENU' }
    const m = await menuCall(r, { pid: 42, window_id: 200, path: ['Tools', 'Mark'] })
    check('M3: no_hmenu → MenuStrip 不支持提示', m.ok === false
      && /MenuStrip/.test(m.result || '') && /不要改用像素|坐标点击/.test(m.result || ''), m.result)
  }

  // D. 原生超时：可能已发送，不重试
  {
    r = await fresh({ nativeMenus: 'auto' })
    native.state.result = { ok: false, code: 'timeout', unknown: true, stage: 'invoke', error: 'timeout' }
    const m = await menuCall(r, { pid: 42, window_id: 200, path: ['Tools', 'Mark'] })
    check('M4: 原生 invoke 超时 → 可能已发送/不要重复', m.ok === false
      && /可能已经发送/.test(m.result || '') && /不要重复/.test(m.result || ''), m.result)
  }

  // E. 驱动 confirmed/unverifiable/effect 缺失：不回退
  {
    for (const [name, value, why] of [
      ['M5: confirmed 不回退', { ok: true, effect: 'confirmed' }, 'confirmed'],
      ['M6: unverifiable 不回退', { ok: true, effect: 'unverifiable' }, 'unverified'],
      ['M7: effect 缺失不回退', { ok: true }, 'missing'],
    ]) {
      r = await fresh({ nativeMenus: 'auto' }, value)
      const m = await menuCall(r, { pid: 42, window_id: 200, path: ['Tools', 'Mark'] })
      check(name, native.state.calls.length === 0 && (why === 'confirmed' ? m.ok === true : m.ok === false), m.result)
    }
  }

  // F. pid 缺失：跳过原生回退
  {
    r = await fresh({ nativeMenus: 'auto' })
    const m = await menuCall(r, { window_id: 200, path: ['Tools', 'Mark'] })
    check('M8: pid 缺失跳过原生回退', native.state.calls.length === 0 && m.ok === false, m.result)
  }

  // G. 模块层：真实 nativeMenus.js + fake spawn
  {
    const mkChild = (payload, code = 0) => {
      const child = new EventEmitter()
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.kill = () => {}
      setTimeout(() => {
        if (payload != null) child.stdout.emit('data', JSON.stringify(payload) + '\n')
        child.emit('close', code)
      }, 10)
      return child
    }
    const okSpawn = (payload) => {
      const calls = []
      const fn = (cmd, args) => { calls.push({ cmd, args }); return mkChild(payload) }
      fn.calls = calls
      return fn
    }
    const resolveSpawn = okSpawn({ ok: true, commandId: 1001, path: ['Tools', 'Mark'] })
    const resolved = await real.resolveNativeMenu({ pid: 42, hwnd: 200, path: ['Tools', 'Mark'] }, { spawnFn: resolveSpawn })
    const b64 = resolveSpawn.calls[0].args[resolveSpawn.calls[0].args.indexOf('-PathB64') + 1]
    check('M9: resolve 解析 commandId/base64 路径', resolved.ok === true && resolved.commandId === 1001
      && Buffer.from(b64, 'base64').toString('utf8') === JSON.stringify(['Tools', 'Mark']), JSON.stringify(resolved))

    const invokeSpawn = okSpawn({ ok: true, method: 'WM_COMMAND', commandId: 1001, path: ['Tools', 'Mark'] })
    const invoked = await real.invokeNativeMenu({ pid: 42, hwnd: 200, path: ['Tools', 'Mark'], commandId: 1001 }, { spawnFn: invokeSpawn })
    check('M10: invoke 传 CommandId 并解析结果', invoked.ok === true && invoked.commandId === 1001
      && invokeSpawn.calls[0].args.includes('1001'), JSON.stringify(invoked))

    const timeout = await real.invokeNativeMenu({ pid: 42, hwnd: 200, path: ['Tools', 'Mark'], commandId: 1001 }, {
      spawnFn: () => {
        const child = new EventEmitter()
        child.stdout = new EventEmitter()
        child.stderr = new EventEmitter()
        child.kill = () => {}
        return child
      },
      timeoutMs: 80,
    })
    check('M11: invoke 超时 → timeout/unknown，不冒充未发送', timeout.ok === false
      && timeout.code === 'timeout' && timeout.unknown === true, JSON.stringify(timeout))

    const bad = await real.resolveNativeMenu({ pid: 42, hwnd: 200, path: ['Tools'] }, {
      spawnFn: () => mkChild(null, 2),
    })
    check('M12: 非零退出 → failed（零副作用）', bad.ok === false && bad.code === 'failed', JSON.stringify(bad))

    const noHmenu = await real.resolveNativeMenu({ pid: 42, hwnd: 200, path: ['Tools'] }, {
      spawnFn: okSpawn({ ok: false, code: 'no_hmenu', error: 'no menu' }),
    })
    check('M13: no_hmenu 透传', noHmenu.ok === false && noHmenu.code === 'no_hmenu', JSON.stringify(noHmenu))

    const unavailable = await real.resolveNativeMenu({ pid: 42, hwnd: 200, path: ['Tools'] }, {
      spawnFn: () => { throw new Error('spawn failed') },
    })
    check('M14: spawn 失败 → unavailable', unavailable.ok === false && unavailable.code === 'unavailable', JSON.stringify(unavailable))

    const chainCalls = []
    const chainSpawn = (cmd, args) => {
      chainCalls.push(args)
      return mkChild({ ok: true, hwnd: 999, commandId: 1001, path: ['Tools', 'Mark'] })
    }
    const chained = await real.tryNativeMenu({ pid: 42, hwnd: 200, path: ['Tools', 'Mark'], title: 'My Menu' }, { spawnFn: chainSpawn })
    const invokeArgs = chainCalls.find((a) => a.includes('invoke')) || []
    check('M15: resolve→invoke 使用 resolved hwnd', chained.ok === true && chained.hwnd === 999
      && invokeArgs[invokeArgs.indexOf('-Hwnd') + 1] === '999', JSON.stringify({ chained, invokeArgs }))

    const resolveTimeout = await real.resolveNativeMenu({ pid: 42, hwnd: 200, path: ['Tools'] }, {
      spawnFn: () => { const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.kill = () => {}; return c },
      timeoutMs: 60,
    })
    check('M16: resolve 超时 → 未发送/可重试', resolveTimeout.code === 'timeout'
      && resolveTimeout.stage === 'resolve' && resolveTimeout.unknown === false, JSON.stringify(resolveTimeout))

    const ambiguous = await real.resolveNativeMenu({ pid: 42, hwnd: 200, path: ['Tools'] }, {
      spawnFn: okSpawn({ ok: false, code: 'ambiguous_window', hwndResolved: 0, candidates: [{ hwnd: 1 }, { hwnd: 2 }] }),
    })
    check('M17: ambiguous_window 带候选诊断', ambiguous.ok === false && ambiguous.code === 'ambiguous_window'
      && ambiguous.candidates?.length === 2, JSON.stringify(ambiguous))

    const titleSpawn = okSpawn({ ok: true, hwnd: 999, commandId: 1001, path: ['Tools'] })
    await real.resolveNativeMenu({ pid: 42, hwnd: 200, path: ['Tools'], title: 'My Menu' }, { spawnFn: titleSpawn })
    const targs = titleSpawn.calls[0].args
    const tb64 = targs[targs.indexOf('-TitleB64') + 1]
    check('M18: title 以 base64 传入', Boolean(tb64)
      && Buffer.from(tb64, 'base64').toString('utf8') === 'My Menu', JSON.stringify(targs))
  }
} finally {
  cleanupWork(work)
}

console.log(`\n结果：${checkState.failures === 0 ? '✅ 全部通过' : `❌ ${checkState.failures} 项失败`}`)
process.exit(checkState.failures === 0 ? 0 : 1)
