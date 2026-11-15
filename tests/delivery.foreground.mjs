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
import { cuaDeliver } from '../lib/cua.js'
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
  check('F2: bring_to_front 用 pid+window_id', calls[1]?.tool === 'bring_to_front'
    && calls[1]?.args?.window_id === 7 && calls[1]?.args?.pid === 42, JSON.stringify(calls[1]))
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

process.exit(checkState.failures > 0 ? 1 : 0)
