/**
 * 强制前台投递的 L3 升级测试（2026-11-15 t01 复盘）。
 *
 * 背景：另存为/覆盖确认对话框上，模型带 foreground=true 的点击/按键被 Windows 前台锁
 * 拦截（foreground_unavailable）。旧 cuaDeliver 在 force 时直接返回，不再尝试
 * bring_to_front，模型只能反复重试。本测试直接调用真实 cuaDeliver（注入 call）验证：
 * - force + foreground_unavailable + window_id → bring_to_front(pid+window_id) → 重试 → 恢复；
 * - 重试仍失败时如实报“仍未送达”；
 * - 无 window_id 不升级；
 * - hotkey 的前台锁失败同样升级；
 * - background 自动升级链保持不变。
 *
 * 运行：node tests/delivery.foreground.mjs
 */
import { cuaDeliver, deliveryFailure, isUnverified } from '../lib/cua.js'
import { resetWindowMap } from '../lib/windowMap.js'
import { makeChecks } from './lib/harness.mjs'

const { check, state: checkState } = makeChecks()

function makeCall({ retry = 'ok' } = {}) {
  const calls = []
  let first = true
  const call = async (tool, args) => {
    calls.push({ tool, args })
    if (tool === 'bring_to_front') {
      if (Number(args.window_id) === 7) return { previous_fg_hwnd: 99 }
      return { ok: true, effect: 'confirmed' }
    }
    if (tool === 'list_windows') return { windows: [{ window_id: 99, pid: 7 }] }
    if ((tool === 'click' || tool === 'hotkey') && args.delivery_mode === 'foreground') {
      if (first) {
        first = false
        return { code: 'foreground_unavailable', detail: 'lock' }
      }
      return retry === 'ok'
        ? { ok: true, effect: 'confirmed', delivery: { mode: 'foreground' } }
        : { code: 'foreground_unavailable', detail: 'still locked' }
    }
    return { ok: true, effect: 'confirmed', delivery: { mode: 'background' } }
  }
  return { call, calls }
}

// 1. force + foreground_unavailable → L3 → 恢复
{
  resetWindowMap()
  const { call, calls } = makeCall()
  const r = await cuaDeliver('click', { session: 's', pid: 42, window_id: 7, x: 1, y: 2 }, 'auto', {
    forceForeground: true, call,
  })
  check('F1: force 失败后 L3 重试成功', r.value?.effect === 'confirmed', JSON.stringify(r.value))
  check('F2: bring_to_front 用 pid+window_id', calls[0]?.tool === 'bring_to_front'
    && calls[0]?.args?.window_id === 7 && calls[0]?.args?.pid === 42, JSON.stringify(calls[0]))
  check('F3: 重试后恢复原前台（pid+window_id）', calls.some((c) => c.tool === 'bring_to_front'
    && c.args?.window_id === 99 && c.args?.pid === 7), JSON.stringify(calls.slice(-1)))
  check('F4: 注记不再说“重试完成”以外的假成功', /绕锁后重试完成/.test(r.note), r.note)
}

// 2. 重试仍失败 → 如实报未送达
{
  resetWindowMap()
  const { call, calls } = makeCall({ retry: 'fail' })
  const r = await cuaDeliver('click', { session: 's', pid: 42, window_id: 7, x: 1, y: 2 }, 'auto', {
    forceForeground: true, call,
  })
  check('F5: 重试仍失败 → 未送达注记', /仍未送达/.test(r.note), r.note)
  check('F6: 重试仍失败 → value 仍是 foreground_unavailable', r.value?.code === 'foreground_unavailable', JSON.stringify(r.value))
  check('F7: 失败也恢复原前台（pid+window_id）', calls.some((c) => c.tool === 'bring_to_front'
    && c.args?.window_id === 99 && c.args?.pid === 7), JSON.stringify(calls))
}

// 3. 无 window_id 不升级（避免 pid-only 选错 Win11 多窗口）
{
  const { call, calls } = makeCall()
  const r = await cuaDeliver('click', { session: 's', pid: 42, x: 1, y: 2 }, 'auto', {
    forceForeground: true, call,
  })
  check('F8: 无 window_id 不 bring_to_front', calls.length === 1 && r.value?.code === 'foreground_unavailable', JSON.stringify(calls))
}

// 4. hotkey 的前台锁失败同样升级
{
  resetWindowMap()
  const { call, calls } = makeCall()
  const r = await cuaDeliver('hotkey', { session: 's', pid: 42, window_id: 7, keys: ['ctrl', 'a'] }, 'auto', {
    forceForeground: true, call,
  })
  check('F9: hotkey 也走 L3', r.value?.effect === 'confirmed'
    && calls.some((c) => c.tool === 'bring_to_front' && c.args?.window_id === 7), JSON.stringify(calls))
}

// 5. background 自动升级链不受影响
{
  const calls = []
  const call = async (tool, args) => {
    calls.push({ tool, args })
    if (tool === 'click' && args.delivery_mode === 'background') return { code: 'background_unavailable' }
    if (tool === 'click' && args.delivery_mode === 'foreground') return { ok: true, effect: 'confirmed' }
    return { ok: true }
  }
  const r = await cuaDeliver('click', { session: 's', pid: 42, window_id: 7, x: 1, y: 2 }, 'auto', { call })
  check('F10: background 仍自动升级前台', r.value?.effect === 'confirmed'
    && calls.map((c) => `${c.tool}:${c.args?.delivery_mode || ''}`).join(',') === 'click:background,click:foreground', JSON.stringify(calls))
  check('F11: 升级注记保留', /后台投递不可用/.test(r.note), r.note)
}

// 6. 驱动把 foreground_unavailable 以异常抛出（非 JSON/非零退出）也必须走 L3
{
  resetWindowMap()
  const calls = []
  let first = true
  const call = async (tool, args) => {
    calls.push({ tool, args })
    if (tool === 'bring_to_front') {
      if (Number(args.window_id) === 7) return { previous_fg_hwnd: 99 }
      return { ok: true, effect: 'confirmed' }
    }
    if (tool === 'list_windows') return { windows: [{ window_id: 99, pid: 7 }] }
    if (tool === 'click' && args.delivery_mode === 'foreground') {
      if (first) {
        first = false
        throw new Error('cua-driver click 返回非 JSON: foreground_unavailable: Windows did not confirm exact target HWND 0x1; no mouse input was sent')
      }
      return { ok: true, effect: 'confirmed', delivery: { mode: 'foreground' } }
    }
    return { ok: true }
  }
  const r = await cuaDeliver('click', { session: 's', pid: 42, window_id: 7, x: 1, y: 2 }, 'auto', {
    forceForeground: true, call,
  })
  check('F12: 抛出的 foreground_unavailable 也走 L3', r.value?.effect === 'confirmed'
    && calls.some((c) => c.tool === 'bring_to_front' && c.args?.window_id === 7), JSON.stringify(calls))
}

// 7. 非 foreground 的异常必须继续抛出（XAML hotkey 依赖它进入回退分支）
{
  let threw = false
  const call = async () => { throw new Error('could not find a UIA AcceleratorKey') }
  try {
    await cuaDeliver('hotkey', { session: 's', pid: 42, window_id: 7, keys: ['ctrl', 's'] }, 'auto', {
      forceForeground: true, call,
    })
  } catch { threw = true }
  check('F13: 非 foreground 异常保持抛出', threw)
}

// 8. 投递分类：background_delivery_failed 是 escalation 建议，不是硬失败
{
  const payload = { effect: 'unverifiable', escalation: { reason: 'background_delivery_failed', target: 'foreground' } }
  check('F17: background_delivery_failed 不算 delivery_failed', deliveryFailure(payload) === null, JSON.stringify(payload))
  check('F18: background_delivery_failed 仍是 unverified', isUnverified(payload) === true, JSON.stringify(payload))
  check('F19: 精确 delivery_failed 仍是硬失败', deliveryFailure({ escalation: { reason: 'delivery_failed' } }) === 'delivery_failed')
  check('F20: 字符串形态同样按词边界', deliveryFailure('escalation.reason=background_delivery_failed') === null
    && deliveryFailure('delivery_failed') === 'delivery_failed')
}

// 9. 强制前台 drag 前置后只拖一次（重试会画两遍）
{
  resetWindowMap()
  const calls = []
  const call = async (tool, args) => {
    calls.push({ tool, args })
    if (tool === 'bring_to_front') {
      if (Number(args.window_id) === 7) return { previous_fg_hwnd: 99 }
      return { ok: true, effect: 'confirmed' }
    }
    if (tool === 'list_windows') return { windows: [{ window_id: 99, pid: 7 }] }
    if (tool === 'drag' && args.delivery_mode === 'foreground') {
      return { ok: true, effect: 'unverifiable', delivery: { mode: 'foreground' } }
    }
    return { ok: true }
  }
  const r = await cuaDeliver('drag', {
    session: 's', pid: 42, window_id: 7, from_x: 1, from_y: 2, to_x: 3, to_y: 4,
  }, 'auto', { forceForeground: true, call })
  check('F14b: force drag 前置后只拖一次', calls.filter((c) => c.tool === 'drag').length === 1
    && calls[0]?.tool === 'bring_to_front' && calls[0]?.args?.window_id === 7
    && /已前置目标并拖拽一次/.test(r.note || '')
    && calls.some((c) => c.tool === 'bring_to_front' && c.args?.window_id === 99), JSON.stringify(calls))
}

// 10. 强制前台指针 unverifiable → 前置 + 单次动作（不重试）；type 不前置
{
  resetWindowMap()
  const calls = []
  const call = async (tool, args) => {
    calls.push({ tool, args })
    if (tool === 'bring_to_front') {
      if (Number(args.window_id) === 7) return { previous_fg_hwnd: 99 }
      return { ok: true, effect: 'confirmed' }
    }
    if (tool === 'list_windows') return { windows: [{ window_id: 99, pid: 7 }] }
    if (tool === 'click' && args.delivery_mode === 'foreground') {
      return { ok: true, effect: 'unverifiable', delivery: { mode: 'foreground' } }
    }
    return { ok: true }
  }
  const r = await cuaDeliver('click', { session: 's', pid: 42, window_id: 7, x: 1, y: 2 }, 'auto', {
    forceForeground: true, call,
  })
  check('F14: force+unverified click → 前置后只点一次', r.value?.effect === 'unverifiable'
    && calls.filter((c) => c.tool === 'click').length === 1
    && calls[0]?.tool === 'bring_to_front' && calls[0]?.args?.window_id === 7
    && /已前置目标并点击一次/.test(r.note || '')
    && calls.some((c) => c.tool === 'bring_to_front' && c.args?.window_id === 99), JSON.stringify(calls))
}
{
  const calls = []
  const call = async (tool, args) => {
    calls.push({ tool, args })
    if (tool === 'type_text') return { ok: true, effect: 'unverifiable', delivery: { mode: 'foreground' } }
    if (tool === 'bring_to_front') return { previous_fg_hwnd: 99 }
    return { ok: true }
  }
  const r = await cuaDeliver('type_text', { session: 's', pid: 42, window_id: 7, text: 'x' }, 'auto', {
    forceForeground: true, call,
  })
  check('F15: force+unverified type 不 L3', r.value?.effect === 'unverifiable'
    && !calls.some((c) => c.tool === 'bring_to_front'), JSON.stringify(calls))
}
{
  resetWindowMap()
  const calls = []
  const call = async (tool, args) => {
    calls.push({ tool, args })
    if (tool === 'bring_to_front') {
      if (Number(args.window_id) === 7) return { previous_fg_hwnd: 99 }
      return { ok: true, effect: 'confirmed' }
    }
    if (tool === 'list_windows') return { windows: [{ window_id: 99, pid: 7 }] }
    if (tool === 'scroll' && args.delivery_mode === 'foreground') {
      return { ok: true, effect: 'unverifiable', delivery: { mode: 'foreground' } }
    }
    return { ok: true }
  }
  const r = await cuaDeliver('scroll', { session: 's', pid: 42, window_id: 7, x: 1, y: 2, direction: 'down' }, 'auto', {
    forceForeground: true, call,
  })
  check('F16: force+unverified scroll → 前置后只滚一次', r.value?.effect === 'unverifiable'
    && calls.filter((c) => c.tool === 'scroll').length === 1
    && /已前置目标并滚动一次/.test(r.note || '')
    && calls.some((c) => c.tool === 'bring_to_front' && c.args?.window_id === 99), JSON.stringify(calls))
}

// 17. preflight bring 超时：不再继续 click，原样抛 timeout
{
  resetWindowMap()
  const calls = []
  const call = async (tool, args) => {
    calls.push({ tool, args })
    if (tool === 'bring_to_front') {
      const e = new Error('cua-driver bring_to_front timeout after 30000ms')
      e.kind = 'timeout'
      e.tool = 'bring_to_front'
      throw e
    }
    return { ok: true, effect: 'confirmed' }
  }
  let err = null
  try {
    await cuaDeliver('click', { session: 's', pid: 42, window_id: 7, x: 1, y: 2 }, 'auto', {
      forceForeground: true, call,
    })
  } catch (e) { err = e }
  check('F17: preflight bring 超时 → 抛 timeout 且不发送 click',
    err?.kind === 'timeout' && calls.length === 1 && calls[0].tool === 'bring_to_front', JSON.stringify({ err: err?.message, calls }))
}

// 18. preflight click 超时：先恢复原前台，再原样抛 timeout
{
  resetWindowMap()
  const calls = []
  const call = async (tool, args) => {
    calls.push({ tool, args })
    if (tool === 'bring_to_front') {
      if (Number(args.window_id) === 99) return { ok: true, effect: 'confirmed' }
      return { previous_fg_hwnd: 99 }
    }
    if (tool === 'list_windows') return { windows: [{ window_id: 99, pid: 7 }] }
    if (tool === 'click') {
      const e = new Error('cua-driver click timeout after 30000ms')
      e.kind = 'timeout'
      e.tool = 'click'
      throw e
    }
    return { ok: true }
  }
  let err = null
  try {
    await cuaDeliver('click', { session: 's', pid: 42, window_id: 7, x: 1, y: 2 }, 'auto', {
      forceForeground: true, call,
    })
  } catch (e) { err = e }
  check('F18: preflight click 超时 → 恢复原前台并抛 timeout',
    err?.kind === 'timeout'
      && calls.some((c) => c.tool === 'bring_to_front' && c.args?.window_id === 99), JSON.stringify({ err: err?.message, calls }))
}

process.exit(checkState.failures > 0 ? 1 : 0)
